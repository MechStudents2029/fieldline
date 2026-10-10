import { and, eq } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  billLines,
  bills,
  budgetLines,
  contacts,
  costCodeMarkups,
  costItems,
  invoiceCosts,
  invoiceLines,
  invoices,
  laborRates,
  organizations,
  projects,
  timeEntries,
} from "@/lib/db/schema";
import {
  billableLaborCents,
  costPlusTotals,
  markupForCode,
  presentCostLines,
  priceCost,
  type CostPlusPresent,
  type MarkupDisplay,
} from "@/lib/invoice/cost-plus";
import { daysFromNow, id, nowIso, token } from "@/lib/ids";
import { canManageMoney, canSeeMoney, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

type Writer = Pick<AppDatabase, "insert" | "select" | "update" | "delete">;

export type CostKind = "bill" | "receipt" | "time";
export type CostState = "unbilled" | "billed" | "nonbillable";

export type CostRow = {
  key: string;
  kind: CostKind;
  sourceId: string;
  costCode: string;
  name: string;
  label: string;
  occurredOn: string;
  costCents: number;
  markupBps: number;
  markupCents: number;
  priceCents: number;
  billRateCents: number | null;
  state: CostState;
  invoiceId: string | null;
  invoiceNumber: string | null;
};

export type CostPlusBoard = {
  projectId: string;
  projectName: string;
  markupBps: number;
  taxBps: number;
  canEdit: boolean;
  costs: CostRow[];
  codes: { costCode: string; name: string; markupBps: number; custom: boolean }[];
  unbilledCostCents: number;
  billedCents: number;
  invoices: { id: string; number: string; status: string; totalCents: number; presentAs: string; markupDisplay: string }[];
};

function office(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Billing is for the office.");
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function zoneOf(db: Writer, orgId: string) {
  return db.select().from(organizations).where(eq(organizations.id, orgId)).get()?.timeZone || "America/New_York";
}

function hoursLabel(minutes: number) {
  const hours = minutes / 60;
  const text = Number.isInteger(hours) ? String(hours) : (Math.round(hours * 10) / 10).toString();
  return `${text} h`;
}

function closedMinutes(entry: { clockInAt: string; clockOutAt: string | null; breakMinutes: number }) {
  if (!entry.clockOutAt) return 0;
  const span = Math.round((Date.parse(entry.clockOutAt) - Date.parse(entry.clockInAt)) / 60000);
  if (!Number.isFinite(span)) return 0;
  return Math.max(0, span - entry.breakMinutes);
}

function billRateFor(rates: { userId: string; hourlyBillCents: number | null }[], userId: string) {
  const personal = rates.find((row) => row.userId === userId);
  if (personal?.hourlyBillCents != null) return personal.hourlyBillCents;
  return rates.find((row) => row.userId === "")?.hourlyBillCents ?? null;
}

type RawCost = Omit<CostRow, "state" | "invoiceId" | "invoiceNumber" | "markupBps" | "markupCents" | "priceCents" | "name"> & {
  costCode: string;
};

function rawCosts(db: Writer, orgId: string, projectId: string): RawCost[] {
  const zone = zoneOf(db, orgId);
  const rates = db.select().from(laborRates).where(eq(laborRates.orgId, orgId)).all();
  const vendorRows = db.select().from(contacts).where(eq(contacts.orgId, orgId)).all();
  const vendorName = new Map(vendorRows.map((row) => [row.id, row.company || row.name]));
  const approved = db
    .select()
    .from(bills)
    .where(and(eq(bills.orgId, orgId), eq(bills.projectId, projectId)))
    .all()
    .filter((bill) => bill.status === "approved" || bill.status === "paid");
  const billIds = new Set(approved.map((bill) => bill.id));
  const lines = db
    .select()
    .from(billLines)
    .where(eq(billLines.orgId, orgId))
    .all()
    .filter((line) => billIds.has(line.billId));
  const rows: RawCost[] = [];
  for (const bill of approved) {
    const day = (bill.billDate || bill.approvedAt || bill.createdAt).slice(0, 10);
    const vendor = vendorName.get(bill.vendorContactId || "") || "Vendor";
    const own = lines.filter((line) => line.billId === bill.id);
    const pieces = own.length > 0 ? own : [{ id: bill.id, costCode: "Uncoded", description: null, amountCents: bill.amountCents }];
    for (const line of pieces) {
      const description = line.description?.trim() || "";
      const sameAsMemo = description && description === (bill.memo || "").trim();
      const label = [vendor, bill.billNumber, sameAsMemo ? "" : description].filter(Boolean).join(" · ");
      rows.push({
        key: `bill:${line.id}`,
        kind: "bill",
        sourceId: line.id,
        costCode: line.costCode || "Uncoded",
        label,
        occurredOn: day,
        costCents: line.amountCents,
        billRateCents: null,
      });
    }
  }
  const receipts = db
    .select()
    .from(costItems)
    .where(and(eq(costItems.orgId, orgId), eq(costItems.projectId, projectId), eq(costItems.source, "receipt")))
    .all();
  for (const item of receipts) {
    const day = localDay(Date.parse(item.createdAt), zone);
    rows.push({
      key: `receipt:${item.id}`,
      kind: "receipt",
      sourceId: item.id,
      costCode: item.costCode || "Uncoded",
      label: item.vendorName?.trim() || "Receipt",
      occurredOn: day,
      costCents: item.amountCents,
      billRateCents: null,
    });
  }
  const entries = db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.projectId, projectId), eq(timeEntries.status, "approved")))
    .all();
  for (const entry of entries) {
    const minutes = closedMinutes(entry);
    const rate = billRateFor(rates, entry.userId);
    if (rate == null || minutes <= 0) continue;
    rows.push({
      key: `time:${entry.id}`,
      kind: "time",
      sourceId: entry.id,
      costCode: entry.costCode || "Uncoded",
      label: `Labor, ${hoursLabel(minutes)}`,
      occurredOn: localDay(Date.parse(entry.clockInAt), zone),
      costCents: billableLaborCents(minutes, rate),
      billRateCents: rate,
    });
  }
  return rows.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.label.localeCompare(b.label));
}

function projectCosts(db: Writer, orgId: string, projectId: string): CostRow[] {
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
  if (!project) return [];
  const overrides = db
    .select()
    .from(costCodeMarkups)
    .where(and(eq(costCodeMarkups.orgId, orgId), eq(costCodeMarkups.projectId, projectId)))
    .all();
  const names = new Map<string, string>();
  for (const line of db.select().from(budgetLines).where(and(eq(budgetLines.orgId, orgId), eq(budgetLines.projectId, projectId))).all()) {
    if (line.costCode && !names.has(line.costCode)) names.set(line.costCode, line.name);
  }
  const links = db.select().from(invoiceCosts).where(and(eq(invoiceCosts.orgId, orgId), eq(invoiceCosts.projectId, projectId))).all();
  const linkBySource = new Map(links.map((link) => [`${link.sourceKind}:${link.sourceId}`, link]));
  const invoiceRows = db.select().from(invoices).where(and(eq(invoices.orgId, orgId), eq(invoices.projectId, projectId))).all();
  const numberOf = new Map(invoiceRows.map((row) => [row.id, row.number]));
  return rawCosts(db, orgId, projectId).map((row) => {
    const link = linkBySource.get(row.key);
    const billed = Boolean(link?.invoiceId);
    const state: CostState = billed ? "billed" : link?.nonBillable ? "nonbillable" : "unbilled";
    const markupBps = link && billed ? link.markupBps : markupForCode(project.markupBps, overrides, row.costCode);
    const priced = link && billed ? { markupCents: link.markupCents, priceCents: link.priceCents } : priceCost(row.costCents, markupBps);
    return {
      ...row,
      name: names.get(row.costCode) || row.costCode,
      markupBps,
      markupCents: priced.markupCents,
      priceCents: priced.priceCents,
      state,
      invoiceId: link?.invoiceId ?? null,
      invoiceNumber: link?.invoiceId ? numberOf.get(link.invoiceId) ?? null : null,
    };
  });
}

export function costPlusBoard(actor: Actor, projectId: string): CostPlusBoard | null {
  if (!canSeeMoney(actor.role as Role)) return null;
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project || project.billingMode !== "cost_plus") return null;
  const costs = projectCosts(db, actor.orgId, projectId);
  const overrides = db
    .select()
    .from(costCodeMarkups)
    .where(and(eq(costCodeMarkups.orgId, actor.orgId), eq(costCodeMarkups.projectId, projectId)))
    .all();
  const codes = new Map<string, string>();
  for (const cost of costs) codes.set(cost.costCode, cost.name);
  const invoiceRows = db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, actor.orgId), eq(invoices.projectId, projectId)))
    .all()
    .filter((row) => row.type === "cost_plus" && row.status !== "void");
  return {
    projectId,
    projectName: project.name,
    markupBps: project.markupBps,
    taxBps: project.taxBps,
    canEdit: canManageMoney(actor.role as Role),
    costs,
    codes: [...codes.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([costCode, name]) => {
        const custom = overrides.find((row) => row.costCode === costCode);
        return { costCode, name, markupBps: custom?.markupBps ?? project.markupBps, custom: Boolean(custom) };
      }),
    unbilledCostCents: costs.filter((row) => row.state === "unbilled").reduce((sum, row) => sum + row.costCents, 0),
    billedCents: invoiceRows.reduce((sum, row) => sum + row.totalCents, 0),
    invoices: invoiceRows.map((row) => ({
      id: row.id,
      number: row.number,
      status: row.status,
      totalCents: row.totalCents,
      presentAs: row.presentAs,
      markupDisplay: row.markupDisplay,
    })),
  };
}

export function costPlusSummary(orgId: string, projectId: string) {
  const db = officeDb(orgId);
  if (!db) return null;
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
  if (!project || project.billingMode !== "cost_plus") return null;
  const costs = projectCosts(db, orgId, projectId);
  const billed = db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.projectId, projectId)))
    .all()
    .filter((row) => row.type === "cost_plus" && row.status !== "void")
    .reduce((sum, row) => sum + row.totalCents, 0);
  return {
    unbilledCostCents: costs.filter((row) => row.state === "unbilled").reduce((sum, row) => sum + row.costCents, 0),
    billedCents: billed,
  };
}

export function agedCostPlus(orgId: string, today: string): { count: number; href: string | null } {
  const db = officeDb(orgId);
  if (!db) return { count: 0, href: null };
  const cutoff = addCalendarDays(today, -14);
  const jobs = db
    .select()
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.status, "active"), eq(projects.billingMode, "cost_plus")))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const aged = jobs.filter((job) => projectCosts(db, orgId, job.id).some((cost) => cost.state === "unbilled" && cost.occurredOn <= cutoff));
  return { count: aged.length, href: aged[0] ? `/projects/${aged[0].id}/costs` : null };
}

export function lockedCostMessage(db: Writer, orgId: string, kind: CostKind, sourceId: string): string | null {
  const link = db
    .select()
    .from(invoiceCosts)
    .where(and(eq(invoiceCosts.orgId, orgId), eq(invoiceCosts.sourceKind, kind), eq(invoiceCosts.sourceId, sourceId)))
    .get();
  if (!link?.invoiceId) return null;
  const invoice = db.select().from(invoices).where(and(eq(invoices.id, link.invoiceId), eq(invoices.orgId, orgId))).get();
  if (!invoice || invoice.status === "void") return null;
  return `This cost is on ${invoice.number}.`;
}

export function assertCostFree(db: Writer, orgId: string, kind: CostKind, sourceId: string) {
  const message = lockedCostMessage(db, orgId, kind, sourceId);
  if (message) throw new ServiceError(message);
}

export function assertBillFree(db: Writer, orgId: string, billId: string) {
  const lines = db.select().from(billLines).where(and(eq(billLines.orgId, orgId), eq(billLines.billId, billId))).all();
  assertCostFree(db, orgId, "bill", billId);
  for (const line of lines) assertCostFree(db, orgId, "bill", line.id);
}

export function assertReceiptFree(db: Writer, orgId: string, documentId: string) {
  const items = db
    .select()
    .from(costItems)
    .where(and(eq(costItems.orgId, orgId), eq(costItems.documentId, documentId), eq(costItems.source, "receipt")))
    .all();
  for (const item of items) assertCostFree(db, orgId, "receipt", item.id);
}

export function releaseInvoiceCosts(tx: Writer, orgId: string, invoiceId: string) {
  tx.delete(invoiceCosts).where(and(eq(invoiceCosts.orgId, orgId), eq(invoiceCosts.invoiceId, invoiceId))).run();
}

function parsePresent(value: string): CostPlusPresent {
  return value === "itemized" ? "itemized" : "grouped";
}

function parseDisplay(value: string): MarkupDisplay {
  return value === "separate" ? "separate" : "baked";
}

export function createCostInvoice(
  actor: Actor,
  projectId: string,
  input: { keys: string[]; presentAs: string; markupDisplay: string },
) {
  const db = office(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  if (project.billingMode !== "cost_plus") throw new ServiceError("This job is not cost-plus.");
  const wanted = new Set(input.keys.filter(Boolean));
  if (wanted.size === 0) throw new ServiceError("Select a cost.");
  const costs = projectCosts(db, actor.orgId, projectId).filter((row) => wanted.has(row.key));
  if (costs.length !== wanted.size) throw new ServiceError("That cost is not on this job.");
  if (costs.some((row) => row.state !== "unbilled")) throw new ServiceError("That cost is already on an invoice.");
  const presentAs = parsePresent(input.presentAs);
  const markupDisplay = parseDisplay(input.markupDisplay);
  const totals = costPlusTotals(costs, project.taxBps);
  const lines = presentCostLines(costs, presentAs, markupDisplay);
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  const terms = org?.paymentTermsDays ?? 7;
  const now = nowIso();
  const invoiceId = id("inv");
  const payToken = token();
  const existingNumbers = db.select({ number: invoices.number }).from(invoices).where(eq(invoices.orgId, actor.orgId)).all();
  const maxNumber = existingNumbers.reduce((max, row) => {
    const value = Number(row.number.replace(/^\D+/, ""));
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 1000);
  const number = `RR-${maxNumber + 1}`;
  try {
    db.transaction((tx) => {
      tx.insert(invoices)
        .values({
          id: invoiceId,
          orgId: actor.orgId,
          projectId,
          changeOrderId: null,
          number,
          type: "cost_plus",
          status: "draft",
          scheduleIndex: null,
          issueDate: now.slice(0, 10),
          dueDate: daysFromNow(terms).slice(0, 10),
          subtotalCents: totals.priceCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          amountPaidCents: 0,
          payToken,
          applicationNumber: null,
          retainageCents: 0,
          presentAs,
          markupDisplay,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.userId,
        })
        .run();
      lines.forEach((line, index) => {
        tx.insert(invoiceLines)
          .values({
            id: id("invl"),
            orgId: actor.orgId,
            invoiceId,
            description: line.description,
            amountCents: line.amountCents,
            sortOrder: index,
          })
          .run();
      });
      for (const cost of costs) {
        tx.insert(invoiceCosts)
          .values({
            id: id("icost"),
            orgId: actor.orgId,
            projectId,
            invoiceId,
            sourceKind: cost.kind,
            sourceId: cost.sourceId,
            costCode: cost.costCode,
            label: cost.label,
            occurredOn: cost.occurredOn,
            costCents: cost.costCents,
            markupBps: cost.markupBps,
            markupCents: cost.markupCents,
            priceCents: cost.priceCents,
            nonBillable: 0,
            createdAt: now,
          })
          .run();
      }
      tx.insert(auditLogs)
        .values({
          id: id("audit"),
          orgId: actor.orgId,
          actorId: actor.userId,
          action: "invoice.create",
          entityType: "invoice",
          entityId: invoiceId,
          payloadJson: JSON.stringify({ type: "cost_plus", costs: costs.length, totalCents: totals.totalCents }),
          ip: null,
          createdAt: now,
        })
        .run();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/invoice_costs_source|unique/i.test(message)) throw new ServiceError("That cost is already on an invoice.");
    throw error;
  }
  return { invoiceId, number };
}

export function openCostInvoice(actor: Actor, invoiceId: string) {
  const db = office(actor);
  const invoice = db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, actor.orgId))).get();
  if (!invoice || invoice.type !== "cost_plus") throw new ServiceError("Invoice not found.");
  if (invoice.status === "void") throw new ServiceError("That invoice is void.");
  if (invoice.status !== "draft") return { id: invoice.id, projectId: invoice.projectId };
  const now = nowIso();
  db.update(invoices)
    .set({ status: "open", issueDate: now.slice(0, 10), updatedAt: now })
    .where(and(eq(invoices.id, invoice.id), eq(invoices.orgId, actor.orgId)))
    .run();
  return { id: invoice.id, projectId: invoice.projectId };
}

export function setCostBillable(actor: Actor, projectId: string, key: string, billable: boolean) {
  const db = office(actor);
  const cost = projectCosts(db, actor.orgId, projectId).find((row) => row.key === key);
  if (!cost) throw new ServiceError("That cost is not on this job.");
  if (cost.state === "billed") throw new ServiceError(`This cost is on ${cost.invoiceNumber}.`);
  const now = nowIso();
  if (billable) {
    db.delete(invoiceCosts)
      .where(and(eq(invoiceCosts.orgId, actor.orgId), eq(invoiceCosts.sourceKind, cost.kind), eq(invoiceCosts.sourceId, cost.sourceId)))
      .run();
    return;
  }
  const existing = db
    .select()
    .from(invoiceCosts)
    .where(and(eq(invoiceCosts.orgId, actor.orgId), eq(invoiceCosts.sourceKind, cost.kind), eq(invoiceCosts.sourceId, cost.sourceId)))
    .get();
  if (existing) {
    db.update(invoiceCosts)
      .set({ nonBillable: 1, invoiceId: null })
      .where(eq(invoiceCosts.id, existing.id))
      .run();
    return;
  }
  db.insert(invoiceCosts)
    .values({
      id: id("icost"),
      orgId: actor.orgId,
      projectId,
      invoiceId: null,
      sourceKind: cost.kind,
      sourceId: cost.sourceId,
      costCode: cost.costCode,
      label: cost.label,
      occurredOn: cost.occurredOn,
      costCents: cost.costCents,
      markupBps: cost.markupBps,
      markupCents: cost.markupCents,
      priceCents: cost.priceCents,
      nonBillable: 1,
      createdAt: now,
    })
    .run();
}

export function saveCostMarkups(
  actor: Actor,
  projectId: string,
  input: { markupBps: number; taxBps: number; codes: { costCode: string; markupBps: number | null }[] },
) {
  const db = office(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project || project.billingMode !== "cost_plus") throw new ServiceError("This job is not cost-plus.");
  if (!Number.isInteger(input.markupBps) || input.markupBps < 0 || input.markupBps > 50000) throw new ServiceError("Markup is 0 to 500%.");
  if (!Number.isInteger(input.taxBps) || input.taxBps < 0 || input.taxBps > 10000) throw new ServiceError("Tax is 0 to 100%.");
  db.update(projects)
    .set({ markupBps: input.markupBps, taxBps: input.taxBps, updatedAt: nowIso() })
    .where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId)))
    .run();
  for (const code of input.codes) {
    const current = db
      .select()
      .from(costCodeMarkups)
      .where(and(eq(costCodeMarkups.orgId, actor.orgId), eq(costCodeMarkups.projectId, projectId), eq(costCodeMarkups.costCode, code.costCode)))
      .get();
    if (code.markupBps == null || code.markupBps === input.markupBps) {
      if (current) db.delete(costCodeMarkups).where(eq(costCodeMarkups.id, current.id)).run();
      continue;
    }
    if (!Number.isInteger(code.markupBps) || code.markupBps < 0 || code.markupBps > 50000) throw new ServiceError("Markup is 0 to 500%.");
    if (current) {
      db.update(costCodeMarkups).set({ markupBps: code.markupBps }).where(eq(costCodeMarkups.id, current.id)).run();
    } else {
      db.insert(costCodeMarkups)
        .values({ id: id("mkup"), orgId: actor.orgId, projectId, costCode: code.costCode, markupBps: code.markupBps })
        .run();
    }
  }
}

export function costInvoiceDetail(actor: Actor, projectId: string, invoiceId: string) {
  if (!canSeeMoney(actor.role as Role)) return null;
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const invoice = db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, actor.orgId), eq(invoices.projectId, projectId)))
    .get();
  if (!invoice || invoice.type !== "cost_plus") return null;
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) return null;
  const lines = db
    .select()
    .from(invoiceLines)
    .where(and(eq(invoiceLines.orgId, actor.orgId), eq(invoiceLines.invoiceId, invoice.id)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const links = db.select().from(invoiceCosts).where(and(eq(invoiceCosts.orgId, actor.orgId), eq(invoiceCosts.invoiceId, invoice.id))).all();
  return {
    project,
    invoice,
    lines: lines.map((line) => ({ id: line.id, description: line.description, amountCents: line.amountCents })),
    costCents: links.reduce((sum, link) => sum + link.costCents, 0),
    markupCents: links.reduce((sum, link) => sum + link.markupCents, 0),
  };
}

export function portalCostInvoices(tokenValue: string) {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, tokenValue)).get();
  if (!project) return [];
  const rows = db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, project.orgId), eq(invoices.projectId, project.id)))
    .all()
    .filter((row) => row.type === "cost_plus" && row.status !== "draft" && row.status !== "void");
  return rows.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    subtotalCents: invoice.subtotalCents,
    taxCents: invoice.taxCents,
    totalCents: invoice.totalCents,
    payToken: invoice.payToken,
    markupDisplay: invoice.markupDisplay,
    lines: db
      .select()
      .from(invoiceLines)
      .where(and(eq(invoiceLines.orgId, project.orgId), eq(invoiceLines.invoiceId, invoice.id)))
      .all()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((line) => ({ id: line.id, description: line.description, amountCents: line.amountCents })),
  }));
}
