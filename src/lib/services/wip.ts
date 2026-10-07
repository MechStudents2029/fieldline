import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  billLines,
  bills,
  budgetLines,
  changeOrders,
  costItems,
  invoices,
  organizations,
  payAppLines,
  projects,
  purchaseOrderLines,
  purchaseOrders,
  timeApprovals,
  timeEntries,
  users,
  wipAttempts,
  wipOverrides,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { openCommitmentByCode } from "@/lib/margin/commitment";
import { costCodeKey } from "@/lib/margin/category";
import { MAX_MONEY_CENTS, formatPercent, formatWhole } from "@/lib/money";
import { canEditCrm, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { localDay } from "@/lib/time/calendar";
import { invoiceBilledCents, jobFigures, projectedCostCents, sumFigures, type JobFigures } from "@/lib/wip/math";

const LIMIT = 20;
const WINDOW_MS = 10 * 60 * 1000;
const POSTED = new Set(["approved", "paid"]);
const ISSUED = new Set(["open", "paid"]);

export type WipQuery = {
  asOf?: string | null;
  pmUserId?: string | null;
  status?: string | null;
  sort?: string | null;
  dir?: string | null;
};

export type WipCode = {
  code: string;
  revisedBudgetCents: number;
  committedOpenCents: number;
  costToDateCents: number;
  projectedCents: number;
  percentBps: number;
  costToCompleteCents: number;
};

export type WipRow = JobFigures & {
  projectId: string;
  name: string;
  status: string;
  pmUserId: string | null;
  pmName: string;
  override: { amountCents: number; note: string } | null;
  codes: WipCode[];
};

export type WipReport = {
  asOf: string;
  rows: WipRow[];
  totals: JobFigures;
  pms: { id: string; name: string }[];
  underbilled: { count: number; cents: number };
};

function dbFor(actor: Actor): AppDatabase {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function assertOffice(actor: Actor) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot see this report.");
}

function day(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

function onOrBefore(value: string | null | undefined, asOf: string): boolean {
  const dated = day(value);
  return dated !== "" && dated <= asOf;
}

export function wipQuery(input: { asof?: string | null; pm?: string | null; status?: string | null; sort?: string | null; dir?: string | null }): WipQuery {
  return { asOf: input.asof, pmUserId: input.pm, status: input.status, sort: input.sort, dir: input.dir };
}

export function wipSearch(query: WipQuery): string {
  const params = new URLSearchParams();
  if (query.asOf) params.set("asof", query.asOf);
  if (query.pmUserId) params.set("pm", query.pmUserId);
  if (query.status && query.status !== "active") params.set("status", query.status);
  if (query.sort && query.sort !== "job") params.set("sort", query.sort);
  if (query.dir === "desc") params.set("dir", "desc");
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function cleanAsOf(value: string | null | undefined, today: string): string {
  const trimmed = value?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : today;
}

function guardRate(db: AppDatabase, actor: Actor) {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const recent = db
    .select()
    .from(wipAttempts)
    .where(and(eq(wipAttempts.orgId, actor.orgId), eq(wipAttempts.userId, actor.userId)))
    .all()
    .filter((row) => row.createdAt >= since);
  if (recent.length >= LIMIT) throw new ServiceError("Wait a few minutes");
  db.insert(wipAttempts)
    .values({ id: id("watt"), orgId: actor.orgId, userId: actor.userId, createdAt: nowIso() })
    .run();
}

function sortValue(row: WipRow, key: string): string | number {
  if (key === "job") return row.name;
  if (key === "contract") return row.contractCents;
  if (key === "projected") return row.projectedCents;
  if (key === "cost") return row.costToDateCents;
  if (key === "percent") return row.percentBps;
  if (key === "earned") return row.earnedCents;
  if (key === "billed") return row.billedCents;
  if (key === "under") return row.overUnderCents;
  if (key === "profit") return row.profitCents;
  if (key === "margin") return row.profitBps;
  if (key === "left") return row.costToCompleteCents;
  return row.name;
}

export function sortWipRows(rows: WipRow[], sort: string | null | undefined, dir: string | null | undefined): WipRow[] {
  const key = sort || "job";
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const left = sortValue(a, key);
    const right = sortValue(b, key);
    const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return order * sign || a.name.localeCompare(b.name);
  });
}

function wantedStatus(status: string | null | undefined, projectStatus: string): boolean {
  if (status === "all") return projectStatus === "active" || projectStatus === "complete";
  if (status === "complete") return projectStatus === "complete";
  return projectStatus === "active";
}

export function wipReport(actor: Actor, query: WipQuery = {}): WipReport {
  assertOffice(actor);
  const db = dbFor(actor);
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  const zone = org?.timeZone || "America/New_York";
  const asOf = cleanAsOf(query.asOf, localDay(Date.now(), zone));
  const pmFilter = query.pmUserId?.trim() || "";
  const people = new Map(db.select().from(users).all().map((user) => [user.id, user.name]));
  const matching = db
    .select()
    .from(projects)
    .where(eq(projects.orgId, actor.orgId))
    .all()
    .filter((project) => wantedStatus(query.status, project.status));
  const jobs = matching.filter((project) => !pmFilter || project.pmUserId === pmFilter);
  const ids = new Set(jobs.map((project) => project.id));
  const inJob = <T extends { projectId: string }>(rows: T[]) => rows.filter((row) => ids.has(row.projectId));
  const budgets = inJob(db.select().from(budgetLines).where(eq(budgetLines.orgId, actor.orgId)).all()).filter((line) => onOrBefore(line.createdAt, asOf));
  const costs = inJob(db.select().from(costItems).where(eq(costItems.orgId, actor.orgId)).all());
  const billRows = inJob(db.select().from(bills).where(eq(bills.orgId, actor.orgId)).all());
  const billIds = new Set(billRows.map((bill) => bill.id));
  const lines = db
    .select()
    .from(billLines)
    .where(eq(billLines.orgId, actor.orgId))
    .all()
    .filter((line) => billIds.has(line.billId));
  const orders = db
    .select()
    .from(changeOrders)
    .where(eq(changeOrders.orgId, actor.orgId))
    .all()
    .filter((order) => ids.has(order.projectId) && order.status === "approved" && onOrBefore(order.approvedAt, asOf));
  const invoiceRows = inJob(db.select().from(invoices).where(eq(invoices.orgId, actor.orgId)).all()).filter(
    (invoice) => ISSUED.has(invoice.status) && onOrBefore(invoice.issueDate, asOf),
  );
  const invoiceIds = new Set(invoiceRows.map((invoice) => invoice.id));
  const applications = db
    .select()
    .from(payAppLines)
    .where(eq(payAppLines.orgId, actor.orgId))
    .all()
    .filter((line) => invoiceIds.has(line.invoiceId));
  const purchaseRows = inJob(db.select().from(purchaseOrders).where(eq(purchaseOrders.orgId, actor.orgId)).all()).filter(
    (order) => order.status === "issued" && onOrBefore(order.issuedAt || order.createdAt, asOf),
  );
  const purchaseIds = new Set(purchaseRows.map((order) => order.id));
  const purchaseLines = db
    .select()
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.orgId, actor.orgId))
    .all()
    .filter((line) => purchaseIds.has(line.purchaseOrderId));
  const approvals = db
    .select()
    .from(timeApprovals)
    .where(eq(timeApprovals.orgId, actor.orgId))
    .all()
    .filter((row) => row.status === "active" && row.costItemId);
  const entries = new Map(
    db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.orgId, actor.orgId))
      .all()
      .map((entry) => [entry.id, entry]),
  );
  const overrides = db
    .select()
    .from(wipOverrides)
    .where(eq(wipOverrides.orgId, actor.orgId))
    .all()
    .filter((row) => ids.has(row.projectId) && onOrBefore(row.updatedAt, asOf));
  const billByCost = new Map<string, (typeof billRows)[number]>();
  for (const line of lines) {
    if (!line.costItemId) continue;
    const bill = billRows.find((row) => row.id === line.billId);
    if (bill) billByCost.set(line.costItemId, bill);
  }
  const approvalByCost = new Map(approvals.map((row) => [row.costItemId as string, row]));

  function costDated(item: (typeof costs)[number]): boolean {
    const bill = billByCost.get(item.id);
    if (bill) {
      if (!POSTED.has(bill.status)) return false;
      return onOrBefore(bill.billDate || bill.approvedAt || item.createdAt, asOf);
    }
    const approval = approvalByCost.get(item.id);
    if (approval) {
      const entry = entries.get(approval.entryId);
      if (!entry || entry.status !== "approved") return false;
      const worked = Number.isNaN(Date.parse(entry.clockInAt)) ? day(item.createdAt) : localDay(Date.parse(entry.clockInAt), zone);
      return worked <= asOf;
    }
    return onOrBefore(item.createdAt, asOf);
  }

  const rows = jobs.map((project) => {
    const codeActual = new Map<string, number>();
    const codeBudget = new Map<string, number>();
    const codeOpen = new Map<string, number>();
    for (const line of budgets.filter((row) => row.projectId === project.id)) {
      const code = costCodeKey(line.costCode);
      codeBudget.set(code, (codeBudget.get(code) ?? 0) + line.budgetCostCents);
    }
    for (const item of costs.filter((row) => row.projectId === project.id && costDated(row))) {
      const code = costCodeKey(item.costCode);
      codeActual.set(code, (codeActual.get(code) ?? 0) + item.amountCents);
    }
    const projectOrders = purchaseRows.filter((order) => order.projectId === project.id);
    for (const order of projectOrders) {
      const relieved = lines.filter((line) => {
        const bill = billRows.find((row) => row.id === line.billId);
        return bill?.purchaseOrderId === order.id && POSTED.has(bill.status) && onOrBefore(bill.billDate || bill.approvedAt || bill.createdAt, asOf);
      });
      for (const open of openCommitmentByCode(
        purchaseLines.filter((line) => line.purchaseOrderId === order.id),
        relieved,
      )) {
        codeOpen.set(open.costCode, (codeOpen.get(open.costCode) ?? 0) + open.amountCents);
      }
    }
    const codes = [...new Set([...codeBudget.keys(), ...codeActual.keys(), ...codeOpen.keys()])].sort().map((code) => {
      const revisedBudgetCents = codeBudget.get(code) ?? 0;
      const committedOpenCents = codeOpen.get(code) ?? 0;
      const costToDateCents = codeActual.get(code) ?? 0;
      const projected = projectedCostCents({ revisedBudgetCents, committedOpenCents, actualCents: costToDateCents });
      return {
        code,
        revisedBudgetCents,
        committedOpenCents,
        costToDateCents,
        projectedCents: projected,
        percentBps: projected <= 0 || costToDateCents <= 0 ? 0 : costToDateCents >= projected ? 10_000 : Math.round((costToDateCents * 10_000) / projected),
        costToCompleteCents: projected - costToDateCents,
      };
    });
    const override = overrides.find((row) => row.projectId === project.id) ?? null;
    const billed = invoiceRows
      .filter((invoice) => invoice.projectId === project.id)
      .reduce((sum, invoice) => {
        const application = applications.filter((line) => line.invoiceId === invoice.id);
        const applicationCents = application.length ? application.reduce((total, line) => total + line.thisCents, 0) : null;
        return sum + invoiceBilledCents({ ...invoice, applicationCents });
      }, 0);
    const contract =
      project.originalContractCents +
      orders.filter((order) => order.projectId === project.id).reduce((sum, order) => sum + order.priceDeltaCents, 0);
    const figures = jobFigures({
      contractCents: contract,
      costToDateCents: codes.reduce((sum, code) => sum + code.costToDateCents, 0),
      codeProjectedCents: codes.reduce((sum, code) => sum + code.projectedCents, 0),
      overrideCents: override ? override.amountCents : null,
      billedCents: billed,
    });
    return {
      ...figures,
      projectId: project.id,
      name: project.name,
      status: project.status,
      pmUserId: project.pmUserId,
      pmName: project.pmUserId ? people.get(project.pmUserId) || "PM" : "",
      override: override ? { amountCents: override.amountCents, note: override.note } : null,
      codes,
    };
  });
  const sorted = sortWipRows(rows, query.sort, query.dir);
  const under = sorted.filter((row) => row.overUnderCents < 0);
  const pms = [...new Map(matching.filter((job) => job.pmUserId).map((job) => [job.pmUserId as string, people.get(job.pmUserId as string) || "PM"])).entries()]
    .map(([pmId, name]) => ({ id: pmId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    asOf,
    rows: sorted,
    totals: sumFigures(sorted),
    pms,
    underbilled: { count: under.length, cents: under.reduce((sum, row) => sum + row.overUnderCents, 0) },
  };
}

export function wipJob(actor: Actor, projectId: string, asOf?: string | null): WipRow | null {
  assertOffice(actor);
  const db = dbFor(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) return null;
  const report = wipReport(actor, { asOf, status: "all" });
  return report.rows.find((row) => row.projectId === projectId) ?? null;
}

export function underbilledSummary(actor: Actor): { count: number; cents: number } {
  if (!canEditCrm(actor.role as Role)) return { count: 0, cents: 0 };
  const report = wipReport(actor, { status: "active", sort: "under", dir: "asc" });
  return report.underbilled;
}

export function setWipOverride(actor: Actor, projectId: string, input: { amountCents: number; note: string }) {
  assertOffice(actor);
  const db = dbFor(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("That job is not in your company.");
  const note = input.note.trim().replace(/\s+/g, " ");
  if (!note || note.length > 200) throw new ServiceError("Add a note.");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0 || input.amountCents > MAX_MONEY_CENTS) {
    throw new ServiceError("That amount is not valid.");
  }
  guardRate(db, actor);
  const stamp = nowIso();
  const existing = db.select().from(wipOverrides).where(and(eq(wipOverrides.orgId, actor.orgId), eq(wipOverrides.projectId, projectId))).get();
  db.transaction((tx) => {
    if (existing) {
      tx.update(wipOverrides)
        .set({ amountCents: input.amountCents, note, updatedAt: stamp, updatedBy: actor.userId })
        .where(and(eq(wipOverrides.id, existing.id), eq(wipOverrides.orgId, actor.orgId)))
        .run();
    } else {
      tx.insert(wipOverrides)
        .values({
          id: id("wip"),
          orgId: actor.orgId,
          projectId,
          amountCents: input.amountCents,
          note,
          updatedAt: stamp,
          updatedBy: actor.userId,
        })
        .run();
    }
    tx.insert(auditLogs)
      .values({
        id: id("audit"),
        orgId: actor.orgId,
        actorId: actor.userId,
        action: "wip.override",
        entityType: "project",
        entityId: projectId,
        payloadJson: JSON.stringify({ amountCents: input.amountCents, note }),
        ip: null,
        createdAt: stamp,
      })
      .run();
  });
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function wipCsv(actor: Actor, query: WipQuery = {}): { filename: string; body: string } {
  const report = wipReport(actor, query);
  const headers = ["Job", "Contract", "Projected cost", "Cost to date", "% complete", "Earned revenue", "Billed to date", "Over/under billing", "Projected gross profit", "GP", "Cost to complete"];
  const line = (name: string, row: JobFigures) =>
    [name, formatWhole(row.contractCents), formatWhole(row.projectedCents), formatWhole(row.costToDateCents), formatPercent(row.percentBps), formatWhole(row.earnedCents), formatWhole(row.billedCents), formatWhole(row.overUnderCents), formatWhole(row.profitCents), formatPercent(row.profitBps), formatWhole(row.costToCompleteCents)]
      .map(csvCell)
      .join(",");
  const body = [headers.join(","), ...report.rows.map((row) => line(row.name, row)), line("Total", report.totals)].join("\n");
  return { filename: `wip-${report.asOf}.csv`, body };
}
