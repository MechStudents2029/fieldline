import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  billLines,
  bills,
  contacts as contactTable,
  organizations,
  projects as projectTable,
  purchaseOrderLines,
  purchaseOrders,
  receiptLines,
  receipts,
  scheduleLinks,
  users as userTable,
} from "@/lib/db/schema";
import {
  formatComplete,
  formatQty,
  isCondition,
  matchApplies,
  orderLabel,
  orderedMilli,
  overReceived,
  receiveLabel,
  receiveOverageMessage,
  receivedCents,
  receivedQty,
  remainingQty,
  trackedLine,
  unbilledReceived,
  type LineKind,
  type PostedSlice,
  type ReceiveLabel,
} from "@/lib/receiving/match";
import { localDay } from "@/lib/time/calendar";

export type Progress = {
  ordered: number;
  received: number;
  remaining: number;
  label: ReceiveLabel;
  receivedCents: number;
  text: string;
  backordered: boolean;
};

type LineRow = typeof purchaseOrderLines.$inferSelect;
type SliceRow = PostedSlice & { purchaseOrderLineId: string; expectedOn: string | null };

export function todayKey(db: AppDatabase, orgId: string, now = Date.now()) {
  const org = db.select({ timeZone: organizations.timeZone }).from(organizations).where(eq(organizations.id, orgId)).get();
  return localDay(now, org?.timeZone || "America/New_York");
}

export function lineKind(value: string | null | undefined): LineKind {
  return value === "work" ? "work" : "purchase";
}

function slicesFor(db: AppDatabase, orgId: string): Map<string, SliceRow[]> {
  const heads = new Map(
    db
      .select()
      .from(receipts)
      .where(eq(receipts.orgId, orgId))
      .all()
      .map((row) => [row.id, row.status === "void"]),
  );
  const grouped = new Map<string, SliceRow[]>();
  for (const row of db.select().from(receiptLines).where(eq(receiptLines.orgId, orgId)).all()) {
    const condition = isCondition(row.condition) ? row.condition : "ok";
    const slice: SliceRow = {
      purchaseOrderLineId: row.purchaseOrderLineId,
      qtyMilli: row.qtyMilli,
      percentBps: row.percentBps,
      condition,
      voided: heads.get(row.receiptId) !== false,
      expectedOn: row.expectedOn,
    };
    const list = grouped.get(row.purchaseOrderLineId) ?? [];
    list.push(slice);
    grouped.set(row.purchaseOrderLineId, list);
  }
  return grouped;
}

export function progressOf(kind: LineKind, line: { qtyMilli: number | null; amountCents: number; expectedOn?: string | null }, slices: PostedSlice[]): Progress {
  const ordered = orderedMilli(kind, line.qtyMilli, line.amountCents);
  const received = receivedQty(kind, slices);
  const remaining = remainingQty(ordered, received);
  const label = receiveLabel(ordered, received);
  const cents = receivedCents(line.amountCents, ordered, received);
  const text = kind === "work" ? formatComplete(received) : `${formatQty(received)} of ${formatQty(ordered)}`;
  return {
    ordered,
    received,
    remaining,
    label,
    receivedCents: cents,
    text,
    backordered: slices.some((slice) => !slice.voided && slice.condition === "backordered") && label !== "Received",
  };
}

function priorBillLines(db: AppDatabase, orgId: string, purchaseOrderId: string, exceptBillId?: string) {
  const prior = db
    .select()
    .from(bills)
    .where(and(eq(bills.orgId, orgId), eq(bills.purchaseOrderId, purchaseOrderId)))
    .all()
    .filter((bill) => (bill.status === "approved" || bill.status === "paid") && bill.kind !== "release" && bill.id !== exceptBillId);
  const ids = new Set(prior.map((bill) => bill.id));
  if (ids.size === 0) return [];
  return db
    .select()
    .from(billLines)
    .where(eq(billLines.orgId, orgId))
    .all()
    .filter((line) => ids.has(line.billId))
    .map((line) => ({ costCode: line.costCode, amountCents: line.amountCents }));
}

export function receiveGap(
  db: AppDatabase,
  orgId: string,
  purchaseOrderId: string,
  incoming: { costCode: string; amountCents: number }[],
  exceptBillId?: string,
): string | null {
  const order = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.orgId, orgId))).get();
  if (!order || (order.status !== "issued" && order.status !== "closed")) return null;
  const lines = db
    .select()
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.purchaseOrderId, order.id), eq(purchaseOrderLines.orgId, orgId)))
    .all();
  const slices = slicesFor(db, orgId);
  const flat = lines.flatMap((line) => slices.get(line.id) ?? []);
  if (!matchApplies(lines, flat)) return null;
  const kind = lineKind(order.kind);
  const overs = overReceived(
    lines.map((line) => ({ costCode: line.costCode, receivedCents: progressOf(kind, line, slices.get(line.id) ?? []).receivedCents })),
    priorBillLines(db, orgId, order.id, exceptBillId),
    incoming,
  );
  return receiveOverageMessage(order.number, overs);
}

export function unbilledOnOrder(db: AppDatabase, orgId: string, purchaseOrderId: string) {
  const order = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.orgId, orgId))).get();
  if (!order) return [];
  const lines = db
    .select()
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.purchaseOrderId, order.id), eq(purchaseOrderLines.orgId, orgId)))
    .all();
  const slices = slicesFor(db, orgId);
  const kind = lineKind(order.kind);
  return unbilledReceived(
    lines.map((line) => ({
      costCode: line.costCode,
      description: line.description,
      receivedCents: progressOf(kind, line, slices.get(line.id) ?? []).receivedCents,
    })),
    priorBillLines(db, orgId, order.id),
  );
}

export type DeliveryBucket = "expected" | "late" | "received";

export type DeliveryRow = {
  id: string;
  poId: string;
  number: string;
  projectId: string;
  job: string;
  vendor: string;
  description: string;
  expectedOn: string | null;
  label: ReceiveLabel;
  text: string;
  bucket: DeliveryBucket;
  backordered: boolean;
  amountCents: number | null;
};

export function deliveryRows(orgId: string, seeMoney: boolean): DeliveryRow[] {
  const db = officeDb(orgId);
  if (!db) return [];
  const today = todayKey(db, orgId);
  const orders = db.select().from(purchaseOrders).where(eq(purchaseOrders.orgId, orgId)).all();
  const lines = db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orgId, orgId)).all();
  const slices = slicesFor(db, orgId);
  const { projects, contacts } = loadNames(db, orgId);
  const rows: DeliveryRow[] = [];
  for (const order of orders) {
    if (order.status !== "issued" && order.status !== "closed") continue;
    const kind = lineKind(order.kind);
    for (const line of lines.filter((row) => row.purchaseOrderId === order.id)) {
      const lineSlices = slices.get(line.id) ?? [];
      if (!trackedLine(kind, line.qtyMilli, line.expectedOn, lineSlices)) continue;
      const progress = progressOf(kind, line, lineSlices);
      const bucket: DeliveryBucket =
        progress.label === "Received" ? "received" : line.expectedOn && line.expectedOn < today ? "late" : "expected";
      rows.push({
        id: line.id,
        poId: order.id,
        number: order.number,
        projectId: order.projectId,
        job: projects.get(order.projectId) ?? "Job",
        vendor: contacts.get(order.vendorContactId) ?? "Vendor",
        description: line.description?.trim() || line.costCode,
        expectedOn: line.expectedOn,
        label: progress.label,
        text: progress.text,
        bucket,
        backordered: progress.backordered,
        amountCents: seeMoney ? line.amountCents : null,
      });
    }
  }
  return rows.sort((a, b) => (a.expectedOn ?? "9999").localeCompare(b.expectedOn ?? "9999") || a.number.localeCompare(b.number));
}

function loadNames(db: AppDatabase, orgId: string) {
  const projects = new Map(
    db
      .select()
      .from(projectTable)
      .where(eq(projectTable.orgId, orgId))
      .all()
      .map((row) => [row.id, row.name]),
  );
  const people = new Map(
    db
      .select()
      .from(contactTable)
      .where(eq(contactTable.orgId, orgId))
      .all()
      .map((row) => [row.id, row.company?.trim() || row.name]),
  );
  return { projects, contacts: people };
}

export function orderReceiptLabel(orgId: string): Map<string, ReceiveLabel> {
  const db = officeDb(orgId);
  const labels = new Map<string, ReceiveLabel>();
  if (!db) return labels;
  const lines = db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orgId, orgId)).all();
  const slices = slicesFor(db, orgId);
  const orders = db.select().from(purchaseOrders).where(eq(purchaseOrders.orgId, orgId)).all();
  for (const order of orders) {
    if (order.status !== "issued" && order.status !== "closed") continue;
    const kind = lineKind(order.kind);
    const tracked = lines.filter((line) => line.purchaseOrderId === order.id && trackedLine(kind, line.qtyMilli, line.expectedOn, slices.get(line.id) ?? []));
    if (tracked.length === 0) continue;
    const label = orderLabel(tracked.map((line) => {
      const progress = progressOf(kind, line, slices.get(line.id) ?? []);
      return { ordered: progress.ordered, received: progress.received };
    }));
    if (label) labels.set(order.id, label);
  }
  return labels;
}

export type LineReceipt = Progress & {
  id: string;
  description: string;
  expectedOn: string | null;
  scheduleItemId: string | null;
  defaultQty: string;
};

export type ReceiptView = {
  id: string;
  receivedOn: string;
  note: string | null;
  status: string;
  voidReason: string | null;
  person: string;
  summary: string;
};

export function poReceiving(orgId: string, purchaseOrderId: string): { label: ReceiveLabel | null; lines: LineReceipt[]; receipts: ReceiptView[] } {
  const db = officeDb(orgId);
  if (!db) return { label: null, lines: [], receipts: [] };
  const order = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.orgId, orgId))).get();
  if (!order) return { label: null, lines: [], receipts: [] };
  const kind = lineKind(order.kind);
  const lines = db
    .select()
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.purchaseOrderId, order.id), eq(purchaseOrderLines.orgId, orgId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const slices = slicesFor(db, orgId);
  const tracked = lines.filter((line) => trackedLine(kind, line.qtyMilli, line.expectedOn, slices.get(line.id) ?? []));
  const view = lines.map((line) => {
    const progress = progressOf(kind, line, slices.get(line.id) ?? []);
    const on = trackedLine(kind, line.qtyMilli, line.expectedOn, slices.get(line.id) ?? []);
    return {
      ...progress,
      id: line.id,
      description: line.description?.trim() || line.costCode,
      expectedOn: line.expectedOn,
      scheduleItemId: line.scheduleItemId,
      defaultQty: !on ? "" : kind === "work" ? String(Math.round(progress.remaining / 100)) : formatQty(progress.remaining),
      label: on ? progress.label : progress.label,
      text: on ? progress.text : "",
    };
  });
  const label = orderLabel(
    tracked.map((line) => {
      const progress = progressOf(kind, line, slices.get(line.id) ?? []);
      return { ordered: progress.ordered, received: progress.received };
    }),
  );
  const people = new Map(db.select({ id: userTable.id, name: userTable.name }).from(userTable).all().map((row) => [row.id, row.name]));
  const heads = db
    .select()
    .from(receipts)
    .where(and(eq(receipts.orgId, orgId), eq(receipts.purchaseOrderId, order.id)))
    .all()
    .sort((a, b) => b.receivedOn.localeCompare(a.receivedOn));
  const detail = db.select().from(receiptLines).where(eq(receiptLines.orgId, orgId)).all();
  const receiptsView = heads.map((head) => {
    const parts = detail
      .filter((row) => row.receiptId === head.id)
      .map((row) => {
        const line = lines.find((item) => item.id === row.purchaseOrderLineId);
        const qty = kind === "work" ? formatComplete(row.percentBps) : formatQty(row.qtyMilli);
        return `${line?.description || line?.costCode || "Line"} ${qty} ${row.condition}`;
      });
    return {
      id: head.id,
      receivedOn: head.receivedOn,
      note: head.note,
      status: head.status,
      voidReason: head.voidReason,
      person: people.get(head.createdBy ?? "") ?? "Office",
      summary: parts.join(", "),
    };
  });
  return { label, lines: view.filter((line) => line.text), receipts: receiptsView };
}

export function deliveryHolds(orgId: string): Map<string, string> {
  const db = officeDb(orgId);
  const notes = new Map<string, string>();
  if (!db) return notes;
  const today = todayKey(db, orgId);
  const orders = new Map(db.select().from(purchaseOrders).where(eq(purchaseOrders.orgId, orgId)).all().map((row) => [row.id, row]));
  const lines = db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orgId, orgId)).all();
  const slices = slicesFor(db, orgId);
  const direct = new Map<string, string[]>();
  for (const line of lines) {
    if (!line.scheduleItemId) continue;
    const order = orders.get(line.purchaseOrderId);
    if (!order || order.status === "void" || order.status === "draft") continue;
    const progress = progressOf(lineKind(order.kind), line, slices.get(line.id) ?? []);
    const late = Boolean(line.expectedOn && line.expectedOn < today && progress.label !== "Received");
    if (!late && !progress.backordered) continue;
    const bits = [late ? `${order.number} late` : "", progress.backordered ? `${order.number} backordered` : ""].filter(Boolean);
    const list = direct.get(line.scheduleItemId) ?? [];
    list.push(bits.join(" · "));
    direct.set(line.scheduleItemId, list);
  }
  for (const [itemId, bits] of direct) notes.set(itemId, bits.join(" · "));
  for (const link of db.select().from(scheduleLinks).where(eq(scheduleLinks.orgId, orgId)).all()) {
    const pred = direct.get(link.predecessorId);
    if (!pred) continue;
    const extra = `After ${pred.join(" · ")}`;
    const current = notes.get(link.itemId);
    notes.set(link.itemId, current && current !== extra ? `${current} · ${extra}` : current || extra);
  }
  return notes;
}

export function slicesOf(db: AppDatabase, orgId: string, lineId: string): PostedSlice[] {
  return slicesFor(db, orgId).get(lineId) ?? [];
}

export function lineById(db: AppDatabase, orgId: string, lineId: string): LineRow | undefined {
  return db.select().from(purchaseOrderLines).where(and(eq(purchaseOrderLines.id, lineId), eq(purchaseOrderLines.orgId, orgId))).get();
}
