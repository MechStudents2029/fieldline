import { and, eq } from "drizzle-orm";
import { suggestCostCode } from "@/lib/ai/cost-code";
import { RECEIPT_REVIEW_CONFIDENCE } from "@/lib/ai/receipt";
import { officeDb } from "@/lib/db/office";
import {
  activities,
  billEvents,
  billLines,
  bills,
  budgetLines,
  contacts,
  costItems,
  documents,
  organizations,
  priceBookItems,
  projects,
  purchaseOrderLines,
  purchaseOrders,
} from "@/lib/db/schema";
import { poOverageMessage } from "@/lib/bills/from-po";
import { netPayableCents, retainedCents } from "@/lib/bills/retainage";
import { id, nowIso } from "@/lib/ids";
import { overageByCode } from "@/lib/margin/commitment";
import { positiveMoneyError } from "@/lib/money";
import { canManageMoney, canSeeMoney, type Role } from "@/lib/permissions";
import { assertBillFree } from "@/lib/services/cost-plus";
import { ServiceError } from "@/lib/services/errors";
import { assessBill } from "@/lib/services/pay-ready";
import { vendorCommitmentTotals } from "@/lib/services/purchase-orders";
import type { Actor } from "@/lib/services/read";
import { saveUploadedText } from "@/lib/services/write";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

const PAY_METHODS = new Set(["check", "ach", "card", "cash", "other"]);
const VENDOR_TYPES = new Set(["sub", "vendor"]);

export type BillLineInput = {
  costCode: string;
  amountCents: number;
  description?: string;
};

export type BillInput = {
  projectId: string;
  vendorContactId: string;
  billNumber: string;
  billDate: string;
  dueDate: string;
  memo?: string;
  documentId?: string | null;
  purchaseOrderId?: string | null;
  lowConfidence?: boolean;
  lines: BillLineInput[];
};

export type BillTiming = "overdue" | "upcoming" | "later" | "none";

export type BillListFilter = {
  projectId?: string;
  vendorContactId?: string;
  status?: string;
};

export type BillRow = {
  id: string;
  projectId: string;
  projectName: string;
  vendorContactId: string | null;
  vendorName: string;
  billNumber: string;
  billDate: string | null;
  dueDate: string | null;
  status: string;
  amountCents: number;
  retainageCents: number;
  netCents: number;
  kind: "standard" | "release";
  timing: BillTiming;
  lowConfidence: boolean;
};

export type VendorCodeSpend = {
  code: string;
  billedCents: number;
  budgetCents: number;
};

export type VendorBillSummary = {
  contactId: string;
  name: string;
  company: string | null;
  billedCents: number;
  paidCents: number;
  outstandingCents: number;
  committedCents: number;
  openBalanceCents: number;
  retainedCents: number;
  codes: VendorCodeSpend[];
};

type LineRow = typeof billLines.$inferSelect;
type BillRecord = typeof bills.$inferSelect;
type Writer = NonNullable<ReturnType<typeof officeDb>>;

function assertOffice(actor: Actor) {
  if (!canManageMoney(actor.role)) throw new ServiceError("Bills are for the office.");
}

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function companyDb(orgId: string) {
  return officeDb(orgId);
}

export function normalizeBillNumber(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function vendorLabel(contact: { name: string; company: string | null }) {
  return contact.company?.trim() || contact.name;
}

/** Approved bills past the company-local due date are overdue. Paid, draft, and void are not. */
export function billTiming(status: string, dueDate: string | null, today: string): BillTiming {
  if (status !== "approved" || !dueDate) return "none";
  if (dueDate < today) return "overdue";
  if (dueDate <= addCalendarDays(today, 7)) return "upcoming";
  return "later";
}

export function duplicateBill(orgId: string, vendorContactId: string, billNumber: string, exceptId?: string) {
  const db = companyDb(orgId);
  if (!db) return null;
  const number = normalizeBillNumber(billNumber);
  if (!number) return null;
  return (
    db
      .select()
      .from(bills)
      .where(and(eq(bills.orgId, orgId), eq(bills.vendorContactId, vendorContactId), eq(bills.billNumber, number)))
      .all()
      .find((row) => row.status !== "void" && row.id !== exceptId) ?? null
  );
}

function requireVendor(db: Writer, orgId: string, contactId: string) {
  const contact = db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId))).get();
  if (!contact || contact.deletedAt || !VENDOR_TYPES.has(contact.type)) {
    throw new ServiceError("Pick a subcontractor or vendor in this company.");
  }
  return contact;
}

function requireProject(db: Writer, orgId: string, projectId: string) {
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  return project;
}

function cleanLines(lines: BillLineInput[]) {
  const cleaned = lines
    .map((line) => ({
      costCode: line.costCode.trim().toUpperCase(),
      amountCents: line.amountCents,
      description: line.description?.trim() || null,
    }))
    .filter((line) => line.costCode || line.amountCents || line.description);
  if (cleaned.length === 0) throw new ServiceError("Add at least one line with a cost code and an amount.");
  for (const line of cleaned) {
    if (!line.costCode) throw new ServiceError("Each line needs a cost code.");
    const amountError = positiveMoneyError(line.amountCents);
    if (amountError) throw new ServiceError(amountError);
  }
  return cleaned;
}

function requireDates(input: BillInput) {
  const billNumber = normalizeBillNumber(input.billNumber);
  if (billNumber.length < 1 || billNumber.length > 40) throw new ServiceError("Enter the bill number from the vendor.");
  if (!validDay(input.billDate)) throw new ServiceError("Enter the bill date.");
  if (!validDay(input.dueDate)) throw new ServiceError("Enter the due date.");
  return billNumber;
}

function loadBill(db: Writer, orgId: string, billId: string) {
  return db.select().from(bills).where(and(eq(bills.id, billId), eq(bills.orgId, orgId))).get();
}

function loadLines(db: Writer, orgId: string, billId: string) {
  return db
    .select()
    .from(billLines)
    .where(and(eq(billLines.billId, billId), eq(billLines.orgId, orgId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function writeEvent(
  db: Writer,
  orgId: string,
  billId: string,
  actorId: string,
  type: string,
  reason: string | null,
  beforeJson: string | null,
  afterJson: string | null,
) {
  db.insert(billEvents)
    .values({
      id: id("bev"),
      orgId,
      billId,
      actorId,
      type,
      reason,
      beforeJson,
      afterJson,
      createdAt: nowIso(),
    })
    .run();
}

function snapshot(bill: BillRecord, lines: LineRow[]) {
  return JSON.stringify({
    status: bill.status,
    amountCents: bill.amountCents,
    billNumber: bill.billNumber,
    costItemIds: lines.map((line) => line.costItemId).filter((value): value is string => Boolean(value)),
  });
}

function noteActivity(db: Writer, orgId: string, projectId: string, actorId: string, summary: string) {
  db.insert(activities)
    .values({
      id: id("act"),
      orgId,
      entityType: "project",
      entityId: projectId,
      type: "bill",
      actorType: "user",
      actorId,
      summary,
      payloadJson: null,
      createdAt: nowIso(),
    })
    .run();
}

function insertLines(db: Writer, orgId: string, billId: string, lines: ReturnType<typeof cleanLines>) {
  lines.forEach((line, index) => {
    db.insert(billLines)
      .values({
        id: id("bln"),
        orgId,
        billId,
        costCode: line.costCode,
        description: line.description,
        amountCents: line.amountCents,
        costItemId: null,
        sortOrder: index,
      })
      .run();
  });
}

function replaceLines(db: Writer, orgId: string, billId: string, lines: ReturnType<typeof cleanLines>) {
  db.delete(billLines).where(and(eq(billLines.billId, billId), eq(billLines.orgId, orgId))).run();
  insertLines(db, orgId, billId, lines);
}

function linkedPurchaseOrder(db: Writer, orgId: string, purchaseOrderId: string | null | undefined, projectId: string, vendorId: string) {
  if (!purchaseOrderId) return null;
  const order = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.orgId, orgId))).get();
  if (!order) throw new ServiceError("Purchase order not found.");
  if (order.projectId !== projectId || order.vendorContactId !== vendorId) {
    throw new ServiceError("That purchase order is not on this job for this vendor.");
  }
  if (order.status !== "issued" && order.status !== "closed") {
    throw new ServiceError("Issue the purchase order before linking a bill.");
  }
  return order;
}

function poWarning(db: Writer, orgId: string, purchaseOrderId: string | null | undefined, lines: { costCode: string; amountCents: number }[], exceptBillId?: string) {
  if (!purchaseOrderId) return null;
  const order = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.orgId, orgId))).get();
  if (!order) return null;
  const poLines = db
    .select()
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.purchaseOrderId, order.id), eq(purchaseOrderLines.orgId, orgId)))
    .all();
  const priorBills = db
    .select()
    .from(bills)
    .where(and(eq(bills.orgId, orgId), eq(bills.purchaseOrderId, order.id)))
    .all()
    .filter((bill) => (bill.status === "approved" || bill.status === "paid") && bill.kind !== "release" && bill.id !== exceptBillId);
  const priorIds = priorBills.map((bill) => bill.id);
  const priorLines = priorIds.length
    ? db
        .select()
        .from(billLines)
        .where(eq(billLines.orgId, orgId))
        .all()
        .filter((line) => priorIds.includes(line.billId))
    : [];
  const overs = overageByCode(poLines, priorLines, lines);
  const message = poOverageMessage(order.number, overs);
  return message ? `${message} It was still saved.` : null;
}

export function createBill(actor: Actor, input: BillInput) {
  assertOffice(actor);
  const db = dbFor(actor);
  const billNumber = requireDates(input);
  const lines = cleanLines(input.lines);
  const vendor = requireVendor(db, actor.orgId, input.vendorContactId);
  requireProject(db, actor.orgId, input.projectId);
  const order = linkedPurchaseOrder(db, actor.orgId, input.purchaseOrderId, input.projectId, vendor.id);
  if (input.documentId) {
    const document = db
      .select()
      .from(documents)
      .where(and(eq(documents.id, input.documentId), eq(documents.orgId, actor.orgId), eq(documents.projectId, input.projectId)))
      .get();
    if (!document || document.deletedAt) throw new ServiceError("That file is not on this job.");
  }
  const duplicate = duplicateBill(actor.orgId, vendor.id, billNumber);
  if (duplicate) {
    throw new ServiceError(`${vendorLabel(vendor)} already has bill ${billNumber}.`);
  }
  const billId = id("bill");
  const now = nowIso();
  const amountCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  try {
    db.transaction((tx) => {
      tx.insert(bills)
        .values({
          id: billId,
          orgId: actor.orgId,
          projectId: input.projectId,
          vendorContactId: vendor.id,
          billNumber,
          billDate: input.billDate,
          amountCents,
          dueDate: input.dueDate,
          status: "draft",
          memo: input.memo?.trim() || null,
          voidReason: null,
          paidAt: null,
          payMethod: null,
          payReference: null,
          documentId: input.documentId || null,
          purchaseOrderId: order?.id ?? null,
          approvedAt: null,
          lowConfidence: input.lowConfidence ? 1 : 0,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.userId,
          retainageCents: retainedCents(amountCents, order?.retainageBps ?? 0),
          kind: "standard",
        })
        .run();
      insertLines(tx, actor.orgId, billId, lines);
      writeEvent(tx, actor.orgId, billId, actor.userId, "created", null, null, null);
    });
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/bills_vendor_number|unique/i.test(message)) {
      throw new ServiceError(`${vendorLabel(vendor)} already has bill ${billNumber}.`);
    }
    throw error;
  }
  return { id: billId, warning: poWarning(db, actor.orgId, order?.id, lines) };
}

export function updateDraft(actor: Actor, billId: string, input: BillInput) {
  assertOffice(actor);
  const db = dbFor(actor);
  const bill = loadBill(db, actor.orgId, billId);
  if (!bill) throw new ServiceError("Bill not found.");
  if (bill.status !== "draft") throw new ServiceError("Only a draft bill can be edited.");
  const billNumber = requireDates(input);
  const lines = cleanLines(input.lines);
  const vendor = requireVendor(db, actor.orgId, input.vendorContactId);
  requireProject(db, actor.orgId, input.projectId);
  const order = linkedPurchaseOrder(db, actor.orgId, input.purchaseOrderId, input.projectId, vendor.id);
  const duplicate = duplicateBill(actor.orgId, vendor.id, billNumber, bill.id);
  if (duplicate) throw new ServiceError(`${vendorLabel(vendor)} already has bill ${billNumber}.`);
  const now = nowIso();
  const before = snapshot(bill, loadLines(db, actor.orgId, bill.id));
  db.transaction((tx) => {
    tx.update(bills)
      .set({
        projectId: input.projectId,
        vendorContactId: vendor.id,
        billNumber,
        billDate: input.billDate,
        dueDate: input.dueDate,
        amountCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
        retainageCents: retainedCents(
          lines.reduce((sum, line) => sum + line.amountCents, 0),
          order?.retainageBps ?? 0,
        ),
        memo: input.memo?.trim() || null,
        purchaseOrderId: order?.id ?? null,
        lowConfidence: input.lowConfidence ? 1 : 0,
        updatedAt: now,
      })
      .where(and(eq(bills.id, bill.id), eq(bills.orgId, actor.orgId)))
      .run();
    replaceLines(tx, actor.orgId, bill.id, lines);
    const after = loadBill(tx, actor.orgId, bill.id);
    writeEvent(tx, actor.orgId, bill.id, actor.userId, "updated", null, before, after ? snapshot(after, loadLines(tx, actor.orgId, bill.id)) : null);
  });
  return { id: bill.id, warning: poWarning(db, actor.orgId, order?.id, lines, bill.id) };
}

export function confirmBillRead(actor: Actor, billId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const bill = loadBill(db, actor.orgId, billId);
  if (!bill) throw new ServiceError("Bill not found.");
  if (bill.status !== "draft") throw new ServiceError("Only a draft bill can be confirmed.");
  if (!bill.lowConfidence) return { id: bill.id };
  const now = nowIso();
  db.update(bills)
    .set({ lowConfidence: 0, updatedAt: now })
    .where(and(eq(bills.id, bill.id), eq(bills.orgId, actor.orgId)))
    .run();
  writeEvent(db, actor.orgId, bill.id, actor.userId, "confirmed", null, null, null);
  return { id: bill.id };
}

function postLines(db: Writer, actor: Actor, bill: BillRecord, vendorName: string) {
  if (bill.kind === "release") return [];
  const lines = loadLines(db, actor.orgId, bill.id);
  const posted: string[] = [];
  const now = nowIso();
  for (const line of lines) {
    if (line.costItemId) {
      posted.push(line.costItemId);
      continue;
    }
    const costId = id("cost");
    db.insert(costItems)
      .values({
        id: costId,
        orgId: actor.orgId,
        projectId: bill.projectId,
        budgetLineId: null,
        costCode: line.costCode,
        amountCents: line.amountCents,
        vendorName,
        memo: `Bill ${bill.billNumber}${line.description ? ` · ${line.description}` : ""}`,
        source: "bill",
        aiExtracted: bill.documentId ? 1 : 0,
        documentId: bill.documentId,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    db.update(billLines)
      .set({ costItemId: costId })
      .where(and(eq(billLines.id, line.id), eq(billLines.orgId, actor.orgId)))
      .run();
    posted.push(costId);
  }
  return posted;
}

function reverseLines(db: Writer, orgId: string, billId: string) {
  const lines = loadLines(db, orgId, billId);
  const removed: string[] = [];
  for (const line of lines) {
    if (!line.costItemId) continue;
    db.delete(costItems).where(and(eq(costItems.id, line.costItemId), eq(costItems.orgId, orgId))).run();
    db.update(billLines)
      .set({ costItemId: null })
      .where(and(eq(billLines.id, line.id), eq(billLines.orgId, orgId)))
      .run();
    removed.push(line.costItemId);
  }
  return removed;
}

export function approveBill(actor: Actor, billId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const bill = loadBill(db, actor.orgId, billId);
  if (!bill) throw new ServiceError("Bill not found.");
  if (bill.status === "approved" || bill.status === "paid") return { id: bill.id, posted: false, warning: null };
  if (bill.status !== "draft") throw new ServiceError("Only a draft bill can be approved.");
  if (bill.lowConfidence) {
    throw new ServiceError("This read stays a draft. Confirm the vendor, date, and lines before approving.");
  }
  const vendor = requireVendor(db, actor.orgId, bill.vendorContactId ?? "");
  const lines = loadLines(db, actor.orgId, bill.id);
  const warning = poWarning(db, actor.orgId, bill.purchaseOrderId, lines, bill.id);
  const before = snapshot(bill, lines);
  db.transaction((tx) => {
    const costItemIds = postLines(tx, actor, bill, vendorLabel(vendor));
    const now = nowIso();
    const order = bill.purchaseOrderId
      ? tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, bill.purchaseOrderId), eq(purchaseOrders.orgId, actor.orgId))).get()
      : undefined;
    tx.update(bills)
      .set({
        status: "approved",
        approvedAt: now,
        updatedAt: now,
        retainageCents: bill.kind === "release" ? 0 : retainedCents(bill.amountCents, order?.retainageBps ?? 0),
      })
      .where(and(eq(bills.id, bill.id), eq(bills.orgId, actor.orgId)))
      .run();
    const after = loadBill(tx, actor.orgId, bill.id);
    writeEvent(
      tx,
      actor.orgId,
      bill.id,
      actor.userId,
      "approved",
      null,
      before,
      JSON.stringify({ status: "approved", costItemIds, amountCents: after?.amountCents ?? bill.amountCents }),
    );
    noteActivity(tx, actor.orgId, bill.projectId, actor.userId, `Approved bill ${bill.billNumber} from ${vendorLabel(vendor)}.`);
  });
  return { id: bill.id, posted: true, warning };
}

export function unapproveBill(actor: Actor, billId: string, reason: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const bill = loadBill(db, actor.orgId, billId);
  if (!bill) throw new ServiceError("Bill not found.");
  if (bill.status !== "approved") throw new ServiceError("Only an approved bill can be moved back to draft.");
  assertBillFree(db, actor.orgId, bill.id);
  const why = reason.trim();
  if (why.length < 2) throw new ServiceError("Enter a reason for taking this bill off the job.");
  const before = snapshot(bill, loadLines(db, actor.orgId, bill.id));
  db.transaction((tx) => {
    const removed = reverseLines(tx, actor.orgId, bill.id);
    const now = nowIso();
    tx.update(bills)
      .set({ status: "draft", approvedAt: null, updatedAt: now })
      .where(and(eq(bills.id, bill.id), eq(bills.orgId, actor.orgId)))
      .run();
    writeEvent(tx, actor.orgId, bill.id, actor.userId, "unapproved", why, before, JSON.stringify({ status: "draft", removedCostItemIds: removed }));
    noteActivity(tx, actor.orgId, bill.projectId, actor.userId, `Moved bill ${bill.billNumber} back to draft. ${why}`);
  });
  return { id: bill.id };
}

export function markBillPaid(actor: Actor, billId: string, input: { paidOn: string; method: string; reference: string }) {
  assertOffice(actor);
  const db = dbFor(actor);
  const bill = loadBill(db, actor.orgId, billId);
  if (!bill) throw new ServiceError("Bill not found.");
  if (bill.status !== "approved") throw new ServiceError("Approve the bill before marking it paid.");
  if (!validDay(input.paidOn)) throw new ServiceError("Enter the date it was paid.");
  const method = input.method.trim().toLowerCase();
  if (!PAY_METHODS.has(method)) throw new ServiceError("Pick how it was paid.");
  const reference = input.reference.trim();
  if (reference.length < 1 || reference.length > 80) throw new ServiceError("Enter a check number or other reference.");
  const gate = assessBill(db, actor.orgId, bill);
  if (gate.payError) throw new ServiceError(gate.payError);
  const before = snapshot(bill, loadLines(db, actor.orgId, bill.id));
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(bills)
      .set({ status: "paid", paidAt: input.paidOn, payMethod: method, payReference: reference, updatedAt: now })
      .where(and(eq(bills.id, bill.id), eq(bills.orgId, actor.orgId)))
      .run();
    writeEvent(
      tx,
      actor.orgId,
      bill.id,
      actor.userId,
      "paid",
      null,
      before,
      JSON.stringify({ status: "paid", paidOn: input.paidOn, method, reference }),
    );
    noteActivity(tx, actor.orgId, bill.projectId, actor.userId, `Marked bill ${bill.billNumber} paid by ${method} ${reference}. No payment was sent.`);
  });
  return { id: bill.id, warning: gate.payWarning };
}

export function markBillsPaid(actor: Actor, billIds: string[], input: { paidOn: string; method: string; reference: string }) {
  assertOffice(actor);
  const db = dbFor(actor);
  const ids = [...new Set(billIds.map((billId) => billId.trim()).filter(Boolean))];
  if (ids.length === 0) throw new ServiceError("Select a bill.");
  if (!validDay(input.paidOn)) throw new ServiceError("Enter the date it was paid.");
  const method = input.method.trim().toLowerCase();
  if (!PAY_METHODS.has(method)) throw new ServiceError("Pick how it was paid.");
  const reference = input.reference.trim();
  if (reference.length < 1 || reference.length > 80) throw new ServiceError("Enter a check number or other reference.");
  const loaded = ids.map((billId) => {
    const bill = loadBill(db, actor.orgId, billId);
    if (!bill) throw new ServiceError("Bill not found.");
    if (bill.status !== "approved") throw new ServiceError("Approve the bill before marking it paid.");
    const decision = assessBill(db, actor.orgId, bill);
    if (decision.payError) throw new ServiceError(decision.payError);
    return bill;
  });
  const warnings: string[] = [];
  const paidIds: string[] = [];
  for (const bill of loaded) {
    const paid = markBillPaid(actor, bill.id, { paidOn: input.paidOn, method, reference });
    paidIds.push(paid.id);
    if (paid.warning) warnings.push(paid.warning);
  }
  return { ids: paidIds, warning: warnings[0] ?? null };
}

export function voidBill(actor: Actor, billId: string, reason: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const bill = loadBill(db, actor.orgId, billId);
  if (!bill) throw new ServiceError("Bill not found.");
  if (bill.status === "void") throw new ServiceError("This bill is already void.");
  assertBillFree(db, actor.orgId, bill.id);
  const why = reason.trim();
  if (why.length < 2) throw new ServiceError("Enter a reason for voiding this bill.");
  const before = snapshot(bill, loadLines(db, actor.orgId, bill.id));
  db.transaction((tx) => {
    const removed = bill.status === "approved" || bill.status === "paid" ? reverseLines(tx, actor.orgId, bill.id) : [];
    const now = nowIso();
    tx.update(bills)
      .set({ status: "void", voidReason: why, updatedAt: now })
      .where(and(eq(bills.id, bill.id), eq(bills.orgId, actor.orgId)))
      .run();
    writeEvent(tx, actor.orgId, bill.id, actor.userId, "voided", why, before, JSON.stringify({ status: "void", removedCostItemIds: removed }));
    noteActivity(tx, actor.orgId, bill.projectId, actor.userId, `Voided bill ${bill.billNumber}. ${why}`);
  });
  return { id: bill.id };
}

function orgToday(orgId: string, now: number) {
  const db = companyDb(orgId);
  if (!db) return null;
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) return null;
  return { db, today: localDay(now, org.timeZone) };
}

function vendorNameMap(db: Writer, orgId: string) {
  const rows = db.select().from(contacts).where(eq(contacts.orgId, orgId)).all();
  return new Map(rows.map((row) => [row.id, row]));
}

function projectNameMap(db: Writer, orgId: string) {
  const rows = db.select().from(projects).where(eq(projects.orgId, orgId)).all();
  return new Map(rows.map((row) => [row.id, row.name]));
}

function toRow(
  bill: BillRecord,
  names: Map<string, { name: string; company: string | null }>,
  projectsById: Map<string, string>,
  today: string,
): BillRow {
  const contact = bill.vendorContactId ? names.get(bill.vendorContactId) : undefined;
  return {
    id: bill.id,
    projectId: bill.projectId,
    projectName: projectsById.get(bill.projectId) ?? "Job",
    vendorContactId: bill.vendorContactId,
    vendorName: contact ? vendorLabel(contact) : "Vendor",
    billNumber: bill.billNumber,
    billDate: bill.billDate,
    dueDate: bill.dueDate,
    status: bill.status,
    amountCents: bill.amountCents,
    retainageCents: bill.kind === "release" ? 0 : bill.retainageCents,
    netCents: netPayableCents(bill.amountCents, bill.retainageCents, bill.kind === "release" ? "release" : "standard"),
    kind: bill.kind === "release" ? "release" : "standard",
    timing: billTiming(bill.status, bill.dueDate, today),
    lowConfidence: bill.lowConfidence === 1,
  };
}

export function listBills(orgId: string, role: Role, filter: BillListFilter = {}, now = Date.now()): BillRow[] {
  if (!canSeeMoney(role)) return [];
  const scoped = orgToday(orgId, now);
  if (!scoped) return [];
  const names = vendorNameMap(scoped.db, orgId);
  const jobs = projectNameMap(scoped.db, orgId);
  return scoped.db
    .select()
    .from(bills)
    .where(eq(bills.orgId, orgId))
    .all()
    .map((bill) => toRow(bill, names, jobs, scoped.today))
    .filter((bill) => {
      if (filter.projectId && bill.projectId !== filter.projectId) return false;
      if (filter.vendorContactId && bill.vendorContactId !== filter.vendorContactId) return false;
      if (filter.status === "overdue") return bill.timing === "overdue";
      if (filter.status === "upcoming") return bill.timing === "upcoming";
      if (filter.status && filter.status !== "all" && bill.status !== filter.status) return false;
      return true;
    })
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.billNumber.localeCompare(b.billNumber));
}

export function billsAttention(orgId: string, role: Role, now = Date.now()) {
  const rows = listBills(orgId, role, {}, now);
  return {
    overdue: rows.filter((row) => row.timing === "overdue"),
    upcoming: rows.filter((row) => row.timing === "upcoming"),
  };
}

export function projectBills(orgId: string, projectId: string, role: Role, now = Date.now()) {
  return listBills(orgId, role, { projectId }, now);
}

export function billDetail(orgId: string, billId: string, role: Role, now = Date.now()) {
  if (!canSeeMoney(role)) return null;
  const scoped = orgToday(orgId, now);
  if (!scoped) return null;
  const bill = loadBill(scoped.db, orgId, billId);
  if (!bill) return null;
  const names = vendorNameMap(scoped.db, orgId);
  const jobs = projectNameMap(scoped.db, orgId);
  const lines = loadLines(scoped.db, orgId, bill.id);
  const events = scoped.db
    .select()
    .from(billEvents)
    .where(and(eq(billEvents.billId, bill.id), eq(billEvents.orgId, orgId)))
    .all()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const order = bill.purchaseOrderId
    ? scoped.db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, bill.purchaseOrderId), eq(purchaseOrders.orgId, orgId))).get()
    : undefined;
  return {
    bill: toRow(bill, names, jobs, scoped.today),
    lines,
    events,
    memo: bill.memo,
    voidReason: bill.voidReason,
    paidAt: bill.paidAt,
    payMethod: bill.payMethod,
    payReference: bill.payReference,
    purchaseOrderId: bill.purchaseOrderId,
    purchaseOrderNumber: order?.number ?? null,
    poWarning: poWarning(scoped.db, orgId, bill.purchaseOrderId, lines, bill.id),
  };
}

export function vendorBillSummaries(orgId: string, role: Role): VendorBillSummary[] {
  if (!canSeeMoney(role)) return [];
  const db = companyDb(orgId);
  if (!db) return [];
  const rows = db.select().from(bills).where(eq(bills.orgId, orgId)).all();
  const lines = db.select().from(billLines).where(eq(billLines.orgId, orgId)).all();
  const budgets = db.select().from(budgetLines).where(eq(budgetLines.orgId, orgId)).all();
  const names = vendorNameMap(db, orgId);
  const byVendor = new Map<string, BillRecord[]>();
  for (const bill of rows) {
    if (!bill.vendorContactId || bill.status === "void" || bill.status === "draft") continue;
    const list = byVendor.get(bill.vendorContactId) ?? [];
    list.push(bill);
    byVendor.set(bill.vendorContactId, list);
  }
  const commitments = vendorCommitmentTotals(orgId);
  const summaries: VendorBillSummary[] = [];
  const vendorIds = new Set<string>([...byVendor.keys(), ...commitments.keys()]);
  for (const contactId of vendorIds) {
    const vendorBills = byVendor.get(contactId) ?? [];
    const contact = names.get(contactId);
    if (!contact) continue;
    const ids = new Set(vendorBills.map((bill) => bill.id));
    const vendorLines = lines.filter((line) => ids.has(line.billId));
    const jobsByCode = new Map<string, Set<string>>();
    const billedByCode = new Map<string, number>();
    for (const line of vendorLines) {
      const bill = vendorBills.find((row) => row.id === line.billId);
      if (!bill || bill.kind === "release") continue;
      billedByCode.set(line.costCode, (billedByCode.get(line.costCode) ?? 0) + line.amountCents);
      const jobs = jobsByCode.get(line.costCode) ?? new Set<string>();
      jobs.add(bill.projectId);
      jobsByCode.set(line.costCode, jobs);
    }
    const codes = [...billedByCode.entries()]
      .map(([code, billedCents]) => {
        const jobs = jobsByCode.get(code) ?? new Set<string>();
        const budgetCents = budgets
          .filter((line) => jobs.has(line.projectId) && (line.costCode ?? "").toUpperCase() === code)
          .reduce((sum, line) => sum + line.budgetCostCents, 0);
        return { code, billedCents, budgetCents };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
    const cash = (bill: BillRecord) => netPayableCents(bill.amountCents, bill.retainageCents, bill.kind === "release" ? "release" : "standard");
    const paidCents = vendorBills.filter((bill) => bill.status === "paid").reduce((sum, bill) => sum + cash(bill), 0);
    const outstandingCents = vendorBills.filter((bill) => bill.status === "approved").reduce((sum, bill) => sum + cash(bill), 0);
    const retainedOnPaid = vendorBills
      .filter((bill) => bill.kind !== "release" && bill.status === "paid")
      .reduce((sum, bill) => sum + bill.retainageCents, 0);
    const commitment = commitments.get(contactId) ?? { committedCents: 0, openBalanceCents: 0 };
    summaries.push({
      contactId,
      name: contact.name,
      company: contact.company,
      billedCents: vendorBills.filter((bill) => bill.kind !== "release").reduce((sum, bill) => sum + bill.amountCents, 0),
      paidCents,
      outstandingCents,
      retainedCents: retainedOnPaid,
      committedCents: commitment.committedCents,
      openBalanceCents: commitment.openBalanceCents,
      codes,
    });
  }
  return summaries.sort((a, b) => (a.company ?? a.name).localeCompare(b.company ?? b.name));
}

function dueFrom(text: string) {
  const iso = text.match(/due(?:\s+date)?\s*[:\-]?\s*(\d{4})-(\d{2})-(\d{2})/i);
  if (iso && validDay(`${iso[1]}-${iso[2]}-${iso[3]}`)) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = text.match(/due(?:\s+date)?\s*[:\-]?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (!us) return null;
  let year = Number(us[3]);
  if (year < 100) year += 2000;
  const month = String(Number(us[1])).padStart(2, "0");
  const day = String(Number(us[2])).padStart(2, "0");
  const value = `${year}-${month}-${day}`;
  return validDay(value) ? value : null;
}

function billNumberFrom(text: string) {
  const match = text.match(/(?:bill|invoice)\s*(?:#|no\.?|number)?\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9./-]{0,40})/i);
  if (!match) return "";
  return normalizeBillNumber(match[1].replace(/[.,]+$/, ""));
}

export function readBillFile(actor: Actor, projectId: string, filename: string, text: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  requireProject(db, actor.orgId, projectId);
  const saved = saveUploadedText(actor, projectId, filename, text);
  const extraction = saved.extraction;
  const book = db.select().from(priceBookItems).where(eq(priceBookItems.orgId, actor.orgId)).all();
  const history = db
    .select({ costCode: costItems.costCode, vendorName: costItems.vendorName, projectId: costItems.projectId })
    .from(costItems)
    .where(eq(costItems.orgId, actor.orgId))
    .all();
  const suggestion = suggestCostCode({
    vendor: extraction.vendor,
    lineText: extraction.lines.map((line) => line.description).join(" "),
    book: book.map((item) => ({ code: item.code, name: item.name, vendor: item.vendor, keywords: item.keywords })),
    history,
    projectId,
  });
  const vendorRows = db
    .select()
    .from(contacts)
    .where(eq(contacts.orgId, actor.orgId))
    .all()
    .filter((row) => !row.deletedAt && VENDOR_TYPES.has(row.type));
  const needle = extraction.vendor?.trim().toLowerCase() ?? "";
  const vendor = needle
    ? vendorRows.find((row) => row.company?.toLowerCase() === needle || row.name.toLowerCase() === needle) ??
      vendorRows.find((row) => (row.company && needle.includes(row.company.toLowerCase())) || (row.company && row.company.toLowerCase().includes(needle)))
    : undefined;
  const parsedLines = extraction.lines.filter((line) => line.amountCents != null && line.amountCents > 0);
  const lines =
    parsedLines.length > 0
      ? parsedLines.map((line) => ({
          description: line.description,
          amountCents: line.amountCents ?? 0,
          costCode: suggestion?.code ?? "",
        }))
      : extraction.amountCents
        ? [{ description: extraction.vendor ?? "Bill", amountCents: extraction.amountCents, costCode: suggestion?.code ?? "" }]
        : [];
  return {
    documentId: saved.documentId,
    vendorContactId: vendor?.id ?? "",
    vendorLabel: vendor ? vendorLabel(vendor) : (extraction.vendor ?? ""),
    billNumber: billNumberFrom(text),
    billDate: extraction.purchasedOn ?? "",
    dueDate: dueFrom(text) ?? "",
    confidence: extraction.confidence,
    lowConfidence: extraction.confidence < RECEIPT_REVIEW_CONFIDENCE,
    note: extraction.note,
    lines,
  };
}
