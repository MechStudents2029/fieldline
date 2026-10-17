import { and, eq } from "drizzle-orm";
import { creditStatusLabel, creditView, damagedCreditCents, poCreditFacts, remainingCreditCents, settlePayment, shortCreditCents } from "@/lib/credits/math";
import { netPayableCents } from "@/lib/bills/retainage";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  bills,
  contacts,
  costItems,
  memberships,
  notifications,
  organizations,
  projects,
  punchItems,
  purchaseOrderLines,
  purchaseOrders,
  receiptLines,
  receipts,
  vendorCreditApplications,
  vendorCredits,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { canManageMoney, canSeeMoney, type Role } from "@/lib/permissions";
import { emitAutomation } from "@/lib/services/automations";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

type Database = NonNullable<ReturnType<typeof officeDb>>;
type CreditRow = typeof vendorCredits.$inferSelect;

const LIVE = new Set(["issued", "acknowledged", "disputed"]);
const APPLY = new Set(["issued", "acknowledged"]);

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function office(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Credits are for the office.");
}

function propose(actor: Actor) {
  const role = actor.role as Role;
  if (role !== "field" && !canManageMoney(role)) throw new ServiceError("You cannot propose a credit.");
}

function audit(db: Database, orgId: string, actorId: string | null, action: string, entityId: string, payload: unknown) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "vendor_credit",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function appliedMap(db: Database, orgId: string) {
  const map = new Map<string, number>();
  for (const row of db.select().from(vendorCreditApplications).where(eq(vendorCreditApplications.orgId, orgId)).all()) {
    map.set(row.creditId, (map.get(row.creditId) ?? 0) + row.amountCents);
  }
  return map;
}

function appliedTo(db: Database, orgId: string, creditId: string) {
  return db
    .select()
    .from(vendorCreditApplications)
    .where(and(eq(vendorCreditApplications.orgId, orgId), eq(vendorCreditApplications.creditId, creditId)))
    .all()
    .reduce((sum, row) => sum + row.amountCents, 0);
}

export function billCreditApplied(orgId: string, billId: string) {
  const db = officeDb(orgId);
  if (!db) return 0;
  return appliedCentsForBill(db, orgId, billId);
}

export function appliedCentsForBill(db: Database, orgId: string, billId: string) {
  return db
    .select()
    .from(vendorCreditApplications)
    .where(and(eq(vendorCreditApplications.orgId, orgId), eq(vendorCreditApplications.billId, billId)))
    .all()
    .reduce((sum, row) => sum + row.amountCents, 0);
}

function names(db: Database, orgId: string) {
  const vendors = new Map(
    db
      .select()
      .from(contacts)
      .where(eq(contacts.orgId, orgId))
      .all()
      .map((row) => [row.id, row.company?.trim() || row.name]),
  );
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row.name]));
  return { vendors, jobs };
}

function nextNumber(db: Database, orgId: string) {
  let max = 1043;
  for (const row of db.select().from(vendorCredits).where(eq(vendorCredits.orgId, orgId)).all()) {
    const match = /BC-(\d+)/.exec(row.number);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `BC-${max + 1}`;
}

function postCost(db: Database, actor: Actor, credit: CreditRow) {
  if (credit.costItemId) return credit.costItemId;
  if (credit.amountCents < 1) throw new ServiceError("Enter the amount before issuing.");
  const vendor = db.select().from(contacts).where(and(eq(contacts.id, credit.vendorContactId), eq(contacts.orgId, actor.orgId))).get();
  const costId = id("cost");
  const now = nowIso();
  db.insert(costItems)
    .values({
      id: costId,
      orgId: actor.orgId,
      projectId: credit.projectId,
      budgetLineId: null,
      costCode: credit.costCode,
      amountCents: -credit.amountCents,
      vendorName: vendor ? vendor.company?.trim() || vendor.name : "Vendor",
      memo: credit.number,
      source: "vendor_credit",
      aiExtracted: 0,
      documentId: credit.documentId,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  return costId;
}

function clearCost(db: Database, orgId: string, costItemId: string | null) {
  if (!costItemId) return;
  db.delete(costItems).where(and(eq(costItems.id, costItemId), eq(costItems.orgId, orgId))).run();
}

function existingSource(db: Database, orgId: string, sourceKey: string) {
  return db
    .select()
    .from(vendorCredits)
    .where(and(eq(vendorCredits.orgId, orgId), eq(vendorCredits.sourceKey, sourceKey)))
    .all()
    .find((row) => row.status !== "void");
}

function insertCredit(
  db: Database,
  actor: Actor,
  input: {
    projectId: string;
    vendorContactId: string;
    kind: "backcharge" | "credit";
    reason: string;
    amountCents: number;
    costCode: string | null;
    purchaseOrderId: string | null;
    purchaseOrderLineId: string | null;
    receiptId: string | null;
    punchItemId: string | null;
    billId: string | null;
    sourceKey: string | null;
    documentId: string | null;
    issue: boolean;
  },
) {
  const reason = input.reason.trim();
  if (reason.length < 2) throw new ServiceError("Enter a reason.");
  if (input.issue && input.amountCents < 1) throw new ServiceError("Enter the amount before issuing.");
  const now = nowIso();
  const creditId = id("vc");
  const number = nextNumber(db, actor.orgId);
  const status = input.issue ? "issued" : "draft";
  db.insert(vendorCredits)
    .values({
      id: creditId,
      orgId: actor.orgId,
      number,
      projectId: input.projectId,
      vendorContactId: input.vendorContactId,
      kind: input.kind,
      reason,
      amountCents: Math.max(0, input.amountCents),
      costCode: input.costCode,
      status,
      purchaseOrderId: input.purchaseOrderId,
      purchaseOrderLineId: input.purchaseOrderLineId,
      receiptId: input.receiptId,
      punchItemId: input.punchItemId,
      billId: input.billId,
      sourceKey: input.sourceKey,
      costItemId: null,
      documentId: input.documentId,
      disputeNote: null,
      issuedAt: input.issue ? now : null,
      voidReason: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  const row = db.select().from(vendorCredits).where(eq(vendorCredits.id, creditId)).get();
  if (!row) throw new ServiceError("Credit was not saved.");
  if (input.issue) {
    const costItemId = postCost(db, actor, row);
    db.update(vendorCredits).set({ costItemId, updatedAt: now }).where(eq(vendorCredits.id, creditId)).run();
  }
  audit(db, actor.orgId, actor.userId, input.issue ? "credit.issue" : "credit.draft", creditId, { number, amountCents: input.amountCents });
  if (input.issue) {
    emitAutomation({
      orgId: actor.orgId,
      kind: "vendor_credit_issued",
      recordType: "vendor_credit",
      recordId: creditId,
      recordLabel: number,
      projectId: input.projectId,
      name: number,
      amountCents: input.amountCents,
    });
  }
  return { id: creditId, number, status, amountCents: input.amountCents };
}

function sourceKeyFor(base: string, another: boolean, db: Database, orgId: string) {
  if (!another) return base;
  let n = 2;
  while (existingSource(db, orgId, `${base}#${n}`)) n += 1;
  return `${base}#${n}`;
}

function receiptAmount(db: Database, orgId: string, receiptId: string) {
  const receipt = db.select().from(receipts).where(and(eq(receipts.id, receiptId), eq(receipts.orgId, orgId))).get();
  if (!receipt || receipt.status === "void") throw new ServiceError("Receipt not found.");
  const order = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, receipt.purchaseOrderId), eq(purchaseOrders.orgId, orgId))).get();
  if (!order) throw new ServiceError("Purchase order not found.");
  const lines = db.select().from(receiptLines).where(and(eq(receiptLines.orgId, orgId), eq(receiptLines.receiptId, receipt.id))).all();
  const poLines = db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orgId, orgId)).all();
  let amount = 0;
  let costCode: string | null = null;
  let lineId: string | null = null;
  for (const line of lines) {
    if (line.condition !== "short" && line.condition !== "damaged") continue;
    const poLine = poLines.find((row) => row.id === line.purchaseOrderLineId);
    if (!poLine) continue;
    const unit = poLine.unitCostCents ?? 0;
    const piece = line.condition === "damaged" ? damagedCreditCents(line.qtyMilli, unit) : shortCreditCents(poLine.qtyMilli ?? 0, line.qtyMilli, unit);
    amount += piece;
    if (piece > 0 && !lineId) {
      costCode = poLine.costCode;
      lineId = poLine.id;
    }
  }
  if (amount < 1) throw new ServiceError("This receipt has no short or damaged quantity.");
  return { receipt, order, amount, costCode, lineId };
}

export function createCreditFromReceipt(actor: Actor, receiptId: string, input: { another?: boolean; reason?: string } = {}) {
  propose(actor);
  const db = dbFor(actor);
  const loaded = receiptAmount(db, actor.orgId, receiptId);
  const base = `receipt:${loaded.receipt.id}`;
  const another = Boolean(input.another);
  if (!another) {
    const prior = existingSource(db, actor.orgId, base);
    if (prior) return { id: prior.id, number: prior.number, status: prior.status, amountCents: prior.amountCents, existing: true };
  }
  const issue = canManageMoney(actor.role as Role);
  return {
    ...insertCredit(db, actor, {
      projectId: loaded.order.projectId,
      vendorContactId: loaded.order.vendorContactId,
      kind: "backcharge",
      reason: input.reason?.trim() || loaded.receipt.note || "Short or damaged delivery",
      amountCents: loaded.amount,
      costCode: loaded.costCode,
      purchaseOrderId: loaded.order.id,
      purchaseOrderLineId: loaded.lineId,
      receiptId: loaded.receipt.id,
      punchItemId: null,
      billId: null,
      sourceKey: sourceKeyFor(base, another, db, actor.orgId),
      documentId: loaded.receipt.documentId,
      issue,
    }),
    existing: false,
  };
}

export function draftObservationBackcharge(
  actor: Actor,
  input: { projectId: string; vendorContactId: string; reason: string; costCode: string | null; sourceKey: string; documentId: string | null },
) {
  office(actor);
  const db = dbFor(actor);
  const prior = existingSource(db, actor.orgId, input.sourceKey);
  if (prior) return { id: prior.id, number: prior.number, status: prior.status, amountCents: prior.amountCents, existing: true as const };
  return {
    ...insertCredit(db, actor, {
      projectId: input.projectId,
      vendorContactId: input.vendorContactId,
      kind: "backcharge",
      reason: input.reason,
      amountCents: 0,
      costCode: input.costCode,
      purchaseOrderId: null,
      purchaseOrderLineId: null,
      receiptId: null,
      punchItemId: null,
      billId: null,
      sourceKey: input.sourceKey,
      documentId: input.documentId,
      issue: false,
    }),
    existing: false as const,
  };
}

export function createCreditFromPunch(actor: Actor, punchItemId: string, input: { another?: boolean; reason?: string; amountCents?: number } = {}) {
  propose(actor);
  const db = dbFor(actor);
  const item = db.select().from(punchItems).where(and(eq(punchItems.id, punchItemId), eq(punchItems.orgId, actor.orgId))).get();
  if (!item) throw new ServiceError("Punch item not found.");
  if (!item.assigneeContactId) throw new ServiceError("Assign the item to a vendor first.");
  const base = `punch:${item.id}`;
  const another = Boolean(input.another);
  if (!another) {
    const prior = existingSource(db, actor.orgId, base);
    if (prior) return { id: prior.id, number: prior.number, status: prior.status, amountCents: prior.amountCents, existing: true };
  }
  const issue = canManageMoney(actor.role as Role);
  const amount = issue ? Math.round(input.amountCents ?? 0) : 0;
  if (issue && amount < 1) throw new ServiceError("Enter the amount.");
  return {
    ...insertCredit(db, actor, {
      projectId: item.projectId,
      vendorContactId: item.assigneeContactId,
      kind: "backcharge",
      reason: input.reason?.trim() || item.title,
      amountCents: amount,
      costCode: item.costCode,
      purchaseOrderId: null,
      purchaseOrderLineId: null,
      receiptId: null,
      punchItemId: item.id,
      billId: null,
      sourceKey: sourceKeyFor(base, another, db, actor.orgId),
      documentId: item.beforeDocumentId,
      issue: issue && amount > 0,
    }),
    existing: false,
  };
}

export function createCreditFromOrder(actor: Actor, purchaseOrderId: string, input: { another?: boolean; reason?: string } = {}) {
  propose(actor);
  const db = dbFor(actor);
  const creditable = creditableReceiptIds(actor.orgId);
  const receipt = db
    .select()
    .from(receipts)
    .where(and(eq(receipts.orgId, actor.orgId), eq(receipts.purchaseOrderId, purchaseOrderId)))
    .all()
    .filter((row) => row.status !== "void" && creditable.has(row.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!receipt) throw new ServiceError("This order has no short or damaged receipt.");
  return createCreditFromReceipt(actor, receipt.id, input);
}

export function createCreditFromLine(actor: Actor, lineId: string, input: { another?: boolean; reason?: string } = {}) {
  office(actor);
  const db = dbFor(actor);
  const line = db.select().from(purchaseOrderLines).where(and(eq(purchaseOrderLines.id, lineId), eq(purchaseOrderLines.orgId, actor.orgId))).get();
  if (!line) throw new ServiceError("Line not found.");
  const order = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, line.purchaseOrderId), eq(purchaseOrders.orgId, actor.orgId))).get();
  if (!order || order.status === "void") throw new ServiceError("Purchase order not found.");
  const base = `line:${line.id}`;
  if (!input.another) {
    const prior = existingSource(db, actor.orgId, base);
    if (prior) return { id: prior.id, number: prior.number, status: prior.status, amountCents: prior.amountCents, existing: true };
  }
  return {
    ...insertCredit(db, actor, {
      projectId: order.projectId,
      vendorContactId: order.vendorContactId,
      kind: "credit",
      reason: input.reason?.trim() || line.description || line.costCode,
      amountCents: line.amountCents,
      costCode: line.costCode,
      purchaseOrderId: order.id,
      purchaseOrderLineId: line.id,
      receiptId: null,
      punchItemId: null,
      billId: null,
      sourceKey: sourceKeyFor(base, Boolean(input.another), db, actor.orgId),
      documentId: null,
      issue: true,
    }),
    existing: false,
  };
}

export function issueCredit(actor: Actor, creditId: string, amountCents: number) {
  office(actor);
  const db = dbFor(actor);
  const credit = db.select().from(vendorCredits).where(and(eq(vendorCredits.id, creditId), eq(vendorCredits.orgId, actor.orgId))).get();
  if (!credit) throw new ServiceError("Credit not found.");
  if (credit.status === "void") throw new ServiceError("This credit is void.");
  if (credit.status !== "draft") return { id: credit.id, number: credit.number };
  if (!Number.isInteger(amountCents) || amountCents < 1) throw new ServiceError("Enter the amount.");
  const now = nowIso();
  const next = { ...credit, amountCents };
  const costItemId = postCost(db, actor, next);
  db.update(vendorCredits)
    .set({ status: "issued", amountCents, costItemId, issuedAt: now, updatedAt: now })
    .where(and(eq(vendorCredits.id, credit.id), eq(vendorCredits.orgId, actor.orgId)))
    .run();
  audit(db, actor.orgId, actor.userId, "credit.issue", credit.id, { number: credit.number, amountCents });
  emitAutomation({
    orgId: actor.orgId,
    kind: "vendor_credit_issued",
    recordType: "vendor_credit",
    recordId: credit.id,
    recordLabel: credit.number,
    projectId: credit.projectId,
    name: credit.number,
    amountCents,
  });
  return { id: credit.id, number: credit.number };
}

export function voidCredit(actor: Actor, creditId: string, reason: string) {
  office(actor);
  const db = dbFor(actor);
  const credit = db.select().from(vendorCredits).where(and(eq(vendorCredits.id, creditId), eq(vendorCredits.orgId, actor.orgId))).get();
  if (!credit) throw new ServiceError("Credit not found.");
  if (credit.status === "void") throw new ServiceError("This credit is already void.");
  if (appliedTo(db, actor.orgId, credit.id) > 0) throw new ServiceError("Unapply this credit before voiding it.");
  const why = reason.trim();
  if (why.length < 2) throw new ServiceError("Enter a reason.");
  clearCost(db, actor.orgId, credit.costItemId);
  const now = nowIso();
  db.update(vendorCredits)
    .set({ status: "void", voidReason: why, costItemId: null, updatedAt: now })
    .where(and(eq(vendorCredits.id, credit.id), eq(vendorCredits.orgId, actor.orgId)))
    .run();
  audit(db, actor.orgId, actor.userId, "credit.void", credit.id, { number: credit.number, reason: why });
  return { id: credit.id, number: credit.number, projectId: credit.projectId };
}

export function respondVendorCredit(
  db: Database,
  orgId: string,
  contactId: string,
  vendorName: string,
  input: { creditId: string; decision: "acknowledge" | "dispute"; note: string },
) {
  const credit = db.select().from(vendorCredits).where(and(eq(vendorCredits.id, input.creditId), eq(vendorCredits.orgId, orgId))).get();
  if (!credit || credit.vendorContactId !== contactId) throw new ServiceError("Credit not found.");
  if (credit.status === "draft" || credit.status === "void") throw new ServiceError("This credit is not open.");
  const now = nowIso();
  if (input.decision === "acknowledge") {
    db.update(vendorCredits).set({ status: "acknowledged", updatedAt: now }).where(eq(vendorCredits.id, credit.id)).run();
    audit(db, orgId, null, "credit.acknowledge", credit.id, { number: credit.number });
    return { id: credit.id, number: credit.number };
  }
  const note = input.note.trim();
  if (note.length < 2) throw new ServiceError("Enter a note.");
  db.update(vendorCredits).set({ status: "disputed", disputeNote: note, updatedAt: now }).where(eq(vendorCredits.id, credit.id)).run();
  audit(db, orgId, null, "credit.dispute", credit.id, { number: credit.number, note });
  notifyOffice(db, orgId, credit, `${credit.number} disputed. ${note}`, vendorName);
  return { id: credit.id, number: credit.number };
}

function notifyOffice(db: Database, orgId: string, credit: CreditRow, snippet: string, actorName: string) {
  const members = db.select().from(memberships).where(eq(memberships.orgId, orgId)).all();
  const now = nowIso();
  for (const member of members) {
    if (member.role !== "owner" && member.role !== "admin") continue;
    db.insert(notifications)
      .values({
        id: id("note"),
        orgId,
        userId: member.userId,
        kind: "dispute",
        commentId: null,
        entityType: "vendor_credit",
        entityId: credit.id,
        projectId: credit.projectId,
        actorId: null,
        actorName,
        snippet,
        readAt: null,
        createdAt: now,
      })
      .run();
  }
}

export type CreditListRow = {
  id: string;
  number: string;
  projectId: string;
  projectName: string;
  vendorContactId: string;
  vendorName: string;
  kind: string;
  reason: string;
  amountCents: number;
  appliedCents: number;
  remainingCents: number;
  status: string;
  statusLabel: string;
  view: string;
  issuedAt: string | null;
};

function toList(row: CreditRow, applied: number, vendorName: string, projectName: string, seeMoney: boolean): CreditListRow {
  const view = creditView(row.status, row.amountCents, applied);
  return {
    id: row.id,
    number: row.number,
    projectId: row.projectId,
    projectName,
    vendorContactId: row.vendorContactId,
    vendorName,
    kind: row.kind,
    reason: row.reason,
    amountCents: seeMoney ? row.amountCents : 0,
    appliedCents: seeMoney ? applied : 0,
    remainingCents: seeMoney ? remainingCreditCents(Math.max(row.amountCents, applied), applied) : 0,
    status: row.status,
    statusLabel: creditStatusLabel(view),
    view,
    issuedAt: row.issuedAt,
  };
}

export function listVendorCredits(actor: Actor, filter: { projectId?: string; vendorContactId?: string; status?: string; attention?: boolean } = {}) {
  const db = officeDb(actor.orgId);
  if (!db) return [];
  const seeMoney = canSeeMoney(actor.role as Role);
  const applied = appliedMap(db, actor.orgId);
  const { vendors, jobs } = names(db, actor.orgId);
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  const today = localDay(Date.now(), org?.timeZone || "America/New_York");
  const staleBefore = addCalendarDays(today, -(org?.creditStaleDays ?? 7));
  return db
    .select()
    .from(vendorCredits)
    .where(eq(vendorCredits.orgId, actor.orgId))
    .all()
    .map((row) => toList(row, applied.get(row.id) ?? 0, vendors.get(row.vendorContactId) ?? "Vendor", jobs.get(row.projectId) ?? "Job", seeMoney))
    .filter((row) => {
      if (!seeMoney && row.status !== "draft") return false;
      if (filter.projectId && row.projectId !== filter.projectId) return false;
      if (filter.vendorContactId && row.vendorContactId !== filter.vendorContactId) return false;
      if (filter.status && filter.status !== "all" && row.view !== filter.status && row.status !== filter.status) return false;
      if (filter.attention) {
        const old = (row.issuedAt ?? "") .slice(0, 10) <= staleBefore && row.remainingCents > 0 && row.status !== "void" && row.status !== "draft";
        if (row.view !== "disputed" && !old) return false;
      }
      return true;
    })
    .sort((a, b) => b.number.localeCompare(a.number));
}

export function vendorCreditDetail(actor: Actor, creditId: string) {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const row = db.select().from(vendorCredits).where(and(eq(vendorCredits.id, creditId), eq(vendorCredits.orgId, actor.orgId))).get();
  if (!row) return null;
  const seeMoney = canSeeMoney(actor.role as Role);
  if (!seeMoney && row.status !== "draft") return null;
  const applied = appliedTo(db, actor.orgId, row.id);
  const { vendors, jobs } = names(db, actor.orgId);
  const apps = db
    .select()
    .from(vendorCreditApplications)
    .where(and(eq(vendorCreditApplications.orgId, actor.orgId), eq(vendorCreditApplications.creditId, row.id)))
    .all();
  const billNumbers = new Map(db.select().from(bills).where(eq(bills.orgId, actor.orgId)).all().map((bill) => [bill.id, bill.billNumber]));
  return {
    ...toList(row, applied, vendors.get(row.vendorContactId) ?? "Vendor", jobs.get(row.projectId) ?? "Job", seeMoney),
    costCode: row.costCode,
    disputeNote: row.disputeNote,
    voidReason: row.voidReason,
    documentId: row.documentId,
    purchaseOrderId: row.purchaseOrderId,
    punchItemId: row.punchItemId,
    receiptId: row.receiptId,
    applications: apps.map((app) => ({
      id: app.id,
      billId: app.billId,
      billNumber: billNumbers.get(app.billId) ?? "Bill",
      amountCents: seeMoney ? app.amountCents : 0,
    })),
  };
}

export function vendorCreditCsv(actor: Actor): string | null {
  if (!canSeeMoney(actor.role as Role)) return null;
  const rows = listVendorCredits(actor);
  const header = ["Credit", "Vendor", "Job", "Status", "Amount", "Applied", "Remaining", "Reason"];
  const lines = rows.map((row) =>
    [row.number, row.vendorName, row.projectName, row.statusLabel, formatMoney(row.amountCents), formatMoney(row.appliedCents), formatMoney(row.remainingCents), row.reason]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function openCreditBalance(orgId: string, vendorContactId: string) {
  const db = officeDb(orgId);
  if (!db) return { cents: 0, count: 0 };
  const applied = appliedMap(db, orgId);
  let cents = 0;
  let count = 0;
  for (const row of db.select().from(vendorCredits).where(and(eq(vendorCredits.orgId, orgId), eq(vendorCredits.vendorContactId, vendorContactId))).all()) {
    if (!LIVE.has(row.status)) continue;
    const left = remainingCreditCents(Math.max(row.amountCents, applied.get(row.id) ?? 0), applied.get(row.id) ?? 0);
    if (left < 1) continue;
    cents += left;
    count += 1;
  }
  return { cents, count };
}

export function jobCreditSummary(orgId: string, projectId: string) {
  const db = officeDb(orgId);
  if (!db) return null;
  const applied = appliedMap(db, orgId);
  let openCents = 0;
  let count = 0;
  for (const row of db.select().from(vendorCredits).where(and(eq(vendorCredits.orgId, orgId), eq(vendorCredits.projectId, projectId))).all()) {
    if (row.status === "void" || row.status === "draft") continue;
    count += 1;
    openCents += remainingCreditCents(Math.max(row.amountCents, applied.get(row.id) ?? 0), applied.get(row.id) ?? 0);
  }
  if (count === 0) return null;
  return { count, openCents, href: `/vendor-credits?job=${projectId}` };
}

export function creditAttention(orgId: string, role: Role) {
  if (!canSeeMoney(role)) return { count: 0, cents: 0, href: null as string | null };
  const db = officeDb(orgId);
  if (!db) return { count: 0, cents: 0, href: null };
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  const today = localDay(Date.now(), org?.timeZone || "America/New_York");
  const staleBefore = addCalendarDays(today, -(org?.creditStaleDays ?? 7));
  const applied = appliedMap(db, orgId);
  let count = 0;
  let cents = 0;
  for (const row of db.select().from(vendorCredits).where(eq(vendorCredits.orgId, orgId)).all()) {
    if (!LIVE.has(row.status)) continue;
    const left = remainingCreditCents(Math.max(row.amountCents, applied.get(row.id) ?? 0), applied.get(row.id) ?? 0);
    const old = (row.issuedAt ?? "").slice(0, 10) <= staleBefore && left > 0;
    if (row.status !== "disputed" && !old) continue;
    count += 1;
    cents += row.status === "disputed" ? row.amountCents : left;
  }
  return { count, cents, href: count ? "/vendor-credits?attention=1" : null };
}

export function creditsForVendor(orgId: string, vendorContactId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  const applied = appliedMap(db, orgId);
  return db
    .select()
    .from(vendorCredits)
    .where(and(eq(vendorCredits.orgId, orgId), eq(vendorCredits.vendorContactId, vendorContactId)))
    .all()
    .filter((row) => APPLY.has(row.status))
    .map((row) => ({
      id: row.id,
      number: row.number,
      reason: row.reason,
      remainingCents: remainingCreditCents(Math.max(row.amountCents, applied.get(row.id) ?? 0), applied.get(row.id) ?? 0),
    }))
    .filter((row) => row.remainingCents > 0);
}

export function poCredits(orgId: string, purchaseOrderId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  const applied = appliedMap(db, orgId);
  return db
    .select()
    .from(vendorCredits)
    .where(and(eq(vendorCredits.orgId, orgId), eq(vendorCredits.purchaseOrderId, purchaseOrderId)))
    .all()
    .filter((row) => LIVE.has(row.status))
    .map((row) => ({ amountCents: row.amountCents, appliedCents: applied.get(row.id) ?? 0 }));
}

export function poFactsFor(orgId: string, po: { id: string; status: string; amountCents: number; openCents: number }, billedCents: number) {
  return poCreditFacts({
    status: po.status,
    amountCents: po.amountCents,
    billedCents,
    openCents: po.openCents,
    credits: poCredits(orgId, po.id),
  });
}

export type CreditApplicationInput = { creditId: string; amountCents: number };

export function planBillApplications(orgId: string, bill: { id: string; vendorContactId: string | null; amountCents: number; retainageCents: number; kind: string }, requested: CreditApplicationInput[]) {
  const db = officeDb(orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  const slices: { creditId: string; remainingCents: number; requestedCents: number }[] = [];
  for (const row of requested) {
    if (!row.amountCents) continue;
    const credit = db.select().from(vendorCredits).where(and(eq(vendorCredits.id, row.creditId), eq(vendorCredits.orgId, orgId))).get();
    if (!credit || credit.vendorContactId !== bill.vendorContactId) throw new ServiceError("That credit is not for this vendor.");
    if (!APPLY.has(credit.status)) throw new ServiceError("That credit cannot be applied.");
    const remaining = remainingCreditCents(credit.amountCents, appliedTo(db, orgId, credit.id));
    slices.push({ creditId: credit.id, remainingCents: remaining, requestedCents: row.amountCents });
  }
  const kind = bill.kind === "release" ? "release" : "standard";
  const net = netPayableCents(bill.amountCents, bill.retainageCents, kind);
  try {
    const settled = settlePayment({
      billNetCents: net,
      slices: slices.map((row) => ({ remainingCents: row.remainingCents, requestedCents: row.requestedCents })),
    });
    return { slices: slices.filter((row) => row.requestedCents > 0), ...settled, billNetCents: net };
  } catch (error) {
    throw new ServiceError(error instanceof Error ? error.message : "Credit could not be applied.");
  }
}

export function recordApplicationsOnBill(db: Database, orgId: string, actorId: string, billId: string, slices: { creditId: string; requestedCents: number }[]) {
  const now = nowIso();
  for (const slice of slices) {
    if (slice.requestedCents < 1) continue;
    db.insert(vendorCreditApplications)
      .values({
        id: id("vca"),
        orgId,
        creditId: slice.creditId,
        billId,
        amountCents: slice.requestedCents,
        createdAt: now,
        createdBy: actorId,
      })
      .run();
  }
}

export function portalCredits(db: Database, orgId: string, contactId: string) {
  const applied = appliedMap(db, orgId);
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row.name]));
  return db
    .select()
    .from(vendorCredits)
    .where(and(eq(vendorCredits.orgId, orgId), eq(vendorCredits.vendorContactId, contactId)))
    .all()
    .filter((row) => row.status !== "draft" && row.status !== "void")
    .map((row) => {
      const used = applied.get(row.id) ?? 0;
      const view = creditView(row.status, row.amountCents, used);
      return {
        id: row.id,
        number: row.number,
        job: jobs.get(row.projectId) ?? "Job",
        reason: row.reason,
        amountCents: row.amountCents,
        statusLabel: creditStatusLabel(view),
        disputeNote: row.disputeNote,
        documentId: row.documentId,
        canRespond: row.status === "issued" || row.status === "acknowledged",
      };
    });
}

export function punchCanCredit(actor: Actor, punchItemId: string) {
  const db = officeDb(actor.orgId);
  if (!db) return false;
  const item = db.select().from(punchItems).where(and(eq(punchItems.id, punchItemId), eq(punchItems.orgId, actor.orgId))).get();
  return Boolean(item?.assigneeContactId);
}

export function creditableOrderIds(orgId: string) {
  const db = officeDb(orgId);
  const ids = new Set<string>();
  if (!db) return ids;
  const creditable = creditableReceiptIds(orgId);
  for (const row of db.select().from(receipts).where(eq(receipts.orgId, orgId)).all()) {
    if (creditable.has(row.id)) ids.add(row.purchaseOrderId);
  }
  return ids;
}

export function creditableReceiptIds(orgId: string) {
  const db = officeDb(orgId);
  const ids = new Set<string>();
  if (!db) return ids;
  const voided = new Set(
    db
      .select()
      .from(receipts)
      .where(eq(receipts.orgId, orgId))
      .all()
      .filter((row) => row.status === "void")
      .map((row) => row.id),
  );
  for (const line of db.select().from(receiptLines).where(eq(receiptLines.orgId, orgId)).all()) {
    if (voided.has(line.receiptId)) continue;
    if (line.condition === "short" || line.condition === "damaged") ids.add(line.receiptId);
  }
  return ids;
}

export function accountingCreditRows(orgId: string): string[][] {
  const db = officeDb(orgId);
  if (!db) return [];
  const { vendors, jobs } = names(db, orgId);
  const applied = appliedMap(db, orgId);
  return db
    .select()
    .from(vendorCredits)
    .where(eq(vendorCredits.orgId, orgId))
    .all()
    .filter((row) => LIVE.has(row.status))
    .map((row) => {
      const used = applied.get(row.id) ?? 0;
      const view = creditView(row.status, row.amountCents, used);
      return [
        row.number,
        vendors.get(row.vendorContactId) ?? "",
        jobs.get(row.projectId) ?? "",
        creditStatusLabel(view),
        formatMoney(-row.amountCents),
        formatMoney(0),
        formatMoney(-remainingCreditCents(row.amountCents, used)),
        formatMoney(0),
        "Vendor credit",
      ];
    });
}

export function setCreditStaleDays(actor: Actor, days: number) {
  office(actor);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new ServiceError("Credit age is 1 to 90 days.");
  const db = dbFor(actor);
  db.update(organizations).set({ creditStaleDays: days, updatedAt: nowIso() }).where(eq(organizations.id, actor.orgId)).run();
  audit(db, actor.orgId, actor.userId, "credit.settings", actor.orgId, { days });
}

