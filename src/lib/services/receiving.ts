import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import { auditLogs, purchaseOrderLines, purchaseOrders, receiptLines, receipts, scheduleItems } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canSeeMoney, type Role } from "@/lib/permissions";
import {
  deliveryRows,
  lineById,
  lineKind,
  poReceiving,
  progressOf,
  slicesOf,
  todayKey,
  unbilledOnOrder,
  type DeliveryBucket,
} from "@/lib/receiving/facts";
import { assertReceive, isCondition, parsePercentBps, parseQtyMilli, type ReceiptCondition } from "@/lib/receiving/match";
import { notifyDelivery } from "@/lib/receiving/notify";
import { createBill } from "@/lib/services/bills";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { emitAutomation } from "@/lib/services/automations";

type Writer = AppDatabase;

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function assertReceiveRole(actor: Actor) {
  if (actor.role === "viewer") throw new ServiceError("Deliveries are for the office and the field.");
}

function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function guard(run: () => void) {
  try {
    run();
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof Error) throw new ServiceError(error.message);
    throw error;
  }
}

export type ReceiveLineInput = {
  lineId: string;
  qtyMilli: number;
  percentBps: number;
  condition: ReceiptCondition;
  expectedOn: string | null;
  scheduleItemId: string | null;
  note: string | null;
};

export function receiveDelivery(
  actor: Actor,
  input: { purchaseOrderId: string; receivedOn: string; note: string | null; documentId: string | null; lines: ReceiveLineInput[] },
) {
  assertReceiveRole(actor);
  const db = dbFor(actor);
  const order = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, input.purchaseOrderId), eq(purchaseOrders.orgId, actor.orgId))).get();
  if (!order) throw new ServiceError("Purchase order not found.");
  if (order.status !== "issued" && order.status !== "closed") throw new ServiceError("Issue the purchase order before receiving.");
  if (!validDay(input.receivedOn)) throw new ServiceError("Enter the delivery date.");
  const kind = lineKind(order.kind);
  const picked = input.lines.filter((line) => (kind === "work" ? line.percentBps > 0 || line.condition === "backordered" : line.qtyMilli > 0 || line.condition === "backordered"));
  if (picked.length === 0) throw new ServiceError("Enter a quantity.");
  const receiptId = id("rcp");
  const now = nowIso();
  guard(() => {
    db.transaction((tx) => {
      for (const line of picked) {
        const row = lineById(tx as Writer, actor.orgId, line.lineId);
        if (!row || row.purchaseOrderId !== order.id) throw new ServiceError("That line is not on this order.");
        if (line.scheduleItemId) {
          const item = tx.select().from(scheduleItems).where(and(eq(scheduleItems.id, line.scheduleItemId), eq(scheduleItems.orgId, actor.orgId))).get();
          if (!item || item.projectId !== order.projectId) throw new ServiceError("That schedule item is on a different job.");
        }
        const slices = slicesOf(tx as Writer, actor.orgId, row.id);
        const progress = progressOf(kind, row, slices);
        assertReceive({
          kind,
          ordered: progress.ordered,
          received: progress.received,
          qtyMilli: line.qtyMilli,
          percentBps: line.percentBps,
          condition: line.condition,
          expectedOn: line.expectedOn,
        });
      }
      tx.insert(receipts)
        .values({
          id: receiptId,
          orgId: actor.orgId,
          projectId: order.projectId,
          purchaseOrderId: order.id,
          receivedOn: input.receivedOn,
          note: input.note?.trim() || null,
          documentId: input.documentId,
          status: "posted",
          voidReason: null,
          createdAt: now,
          createdBy: actor.userId,
          voidedAt: null,
        })
        .run();
      for (const line of picked) {
        tx.insert(receiptLines)
          .values({
            id: id("rcl"),
            orgId: actor.orgId,
            receiptId,
            purchaseOrderLineId: line.lineId,
            qtyMilli: kind === "work" ? 0 : line.qtyMilli,
            percentBps: kind === "work" ? line.percentBps : 0,
            condition: line.condition,
            expectedOn: line.expectedOn,
            note: line.note?.trim() || null,
          })
          .run();
        const patch: { expectedOn?: string | null; scheduleItemId?: string | null } = {};
        if (line.expectedOn) patch.expectedOn = line.expectedOn;
        if (line.scheduleItemId) patch.scheduleItemId = line.scheduleItemId;
        if (Object.keys(patch).length > 0) {
          tx.update(purchaseOrderLines)
            .set(patch)
            .where(and(eq(purchaseOrderLines.id, line.lineId), eq(purchaseOrderLines.orgId, actor.orgId)))
            .run();
        }
      }
      tx.insert(auditLogs)
        .values({
          id: id("audit"),
          orgId: actor.orgId,
          actorId: actor.userId,
          action: "receipt.receive",
          entityType: "receipt",
          entityId: receiptId,
          payloadJson: JSON.stringify({ number: order.number, lines: picked.length }),
          ip: null,
          createdAt: now,
        })
        .run();
    });
  });
  notifyDelivery(actor.orgId, {
    entityType: "receipt",
    entityId: receiptId,
    projectId: order.projectId,
    snippet: `${order.number} received`,
    actorName: actor.name,
  });
  emitAutomation({
    orgId: actor.orgId,
    kind: "delivery_received",
    recordType: "purchase_order",
    recordId: order.id,
    recordLabel: order.number,
    projectId: order.projectId,
    name: order.number,
  });
  return { id: receiptId, projectId: order.projectId, number: order.number };
}

export function voidReceipt(actor: Actor, receiptId: string, reason: string) {
  if (actor.role !== "owner" && actor.role !== "admin" && actor.role !== "estimator") {
    throw new ServiceError("Only the office can void a receipt.");
  }
  const db = dbFor(actor);
  const why = reason.trim();
  if (why.length < 2) throw new ServiceError("Enter a reason to void this receipt.");
  const head = db.select().from(receipts).where(and(eq(receipts.id, receiptId), eq(receipts.orgId, actor.orgId))).get();
  if (!head) throw new ServiceError("Receipt not found.");
  if (head.status === "void") throw new ServiceError("That receipt is already void.");
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(receipts)
      .set({ status: "void", voidReason: why, voidedAt: now })
      .where(and(eq(receipts.id, head.id), eq(receipts.orgId, actor.orgId)))
      .run();
    tx.insert(auditLogs)
      .values({
        id: id("audit"),
        orgId: actor.orgId,
        actorId: actor.userId,
        action: "receipt.void",
        entityType: "receipt",
        entityId: head.id,
        payloadJson: JSON.stringify({ reason: why }),
        ip: null,
        createdAt: now,
      })
      .run();
  });
  return { id: head.id, projectId: head.projectId, purchaseOrderId: head.purchaseOrderId };
}

export function canBillReceived(orgId: string, purchaseOrderId: string) {
  const db = officeDb(orgId);
  if (!db) return false;
  return unbilledOnOrder(db, orgId, purchaseOrderId).length > 0;
}

export function billReceived(actor: Actor, purchaseOrderId: string, input: { billNumber: string; billDate: string; dueDate: string }) {
  const db = dbFor(actor);
  const order = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.orgId, actor.orgId))).get();
  if (!order) throw new ServiceError("Purchase order not found.");
  const lines = unbilledOnOrder(db, actor.orgId, order.id);
  if (lines.length === 0) throw new ServiceError("Nothing received is left to bill.");
  return createBill(actor, {
    projectId: order.projectId,
    vendorContactId: order.vendorContactId,
    billNumber: input.billNumber,
    billDate: input.billDate,
    dueDate: input.dueDate,
    memo: `Received on ${order.number}`,
    purchaseOrderId: order.id,
    lines,
  });
}

export function deliveryBoard(actor: Actor, bucket: DeliveryBucket | "today" | "") {
  assertReceiveRole(actor);
  const seeMoney = canSeeMoney(actor.role as Role);
  const today = companyToday(actor.orgId);
  const rows = deliveryRows(actor.orgId, seeMoney).filter((row) => {
    if (!bucket) return true;
    if (bucket === "today") return row.expectedOn === today && row.bucket !== "received";
    return row.bucket === bucket;
  });
  return { rows, seeMoney };
}

export function openDeliveries(orgId: string, projectId: string, seeMoney: boolean) {
  return deliveryRows(orgId, seeMoney).filter((row) => row.projectId === projectId && row.bucket !== "received");
}

export function deliveryAttention(orgId: string) {
  const rows = deliveryRows(orgId, false);
  const today = rows.filter((row) => row.bucket === "expected" && row.expectedOn && row.expectedOn === companyToday(orgId));
  const late = rows.filter((row) => row.bucket === "late");
  return {
    today: { count: today.length, href: today.length ? "/deliveries?status=today" : null },
    late: { count: late.length, href: late.length ? "/deliveries?status=late" : null },
  };
}

export function companyToday(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return "";
  return todayKey(db, orgId);
}

export function receiveChoices(actor: Actor) {
  assertReceiveRole(actor);
  const db = dbFor(actor);
  const orders = db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.orgId, actor.orgId))
    .all()
    .filter((order) => order.status === "issued" || order.status === "closed");
  const items = db.select().from(scheduleItems).where(eq(scheduleItems.orgId, actor.orgId)).all();
  return orders
    .map((order) => {
      const view = poReceiving(actor.orgId, order.id);
      const lines = view.lines.filter((line) => line.remaining > 0 || line.label !== "Received");
      return {
        id: order.id,
        number: order.number,
        projectId: order.projectId,
        kind: lineKind(order.kind),
        label: `${order.number}`,
        lines: lines.map((line) => ({
          id: line.id,
          description: line.description,
          progress: line.text,
          defaultQty: line.defaultQty,
          expectedOn: line.expectedOn ?? "",
          scheduleItemId: line.scheduleItemId ?? "",
          work: lineKind(order.kind) === "work",
        })),
        schedule: items.filter((item) => item.projectId === order.projectId).map((item) => ({ id: item.id, title: item.title })),
      };
    })
    .filter((order) => order.lines.length > 0);
}

export function deliveriesCsv(actor: Actor, bucket: DeliveryBucket | "today" | "") {
  const board = deliveryBoard(actor, bucket);
  const header = ["Order", "Job", "Vendor", "Line", "Expected", "Status", "Qty", ...(board.seeMoney ? ["Amount"] : [])];
  const body = board.rows.map((row) => {
    const cells = [row.number, row.job, row.vendor, row.description, row.expectedOn ?? "", row.backordered ? `${row.label} · backordered` : row.label, row.text];
    if (board.seeMoney) cells.push(row.amountCents == null ? "" : (row.amountCents / 100).toFixed(2));
    return cells.map(csvCell).join(",");
  });
  return { filename: "deliveries.csv", body: [header.join(","), ...body].join("\n") };
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function parseReceiveLines(orderKind: string, form: { lineId: string; qty: string; pct: string; condition: string; expectedOn: string; scheduleItemId: string; note: string }[]): ReceiveLineInput[] {
  const kind = lineKind(orderKind);
  return form.map((row) => {
    const condition = isCondition(row.condition) ? row.condition : "ok";
    const qtyMilli = kind === "work" ? 0 : parseQtyMilli(row.qty) ?? 0;
    const percentBps = kind === "work" ? parsePercentBps(row.pct) ?? 0 : 0;
    return {
      lineId: row.lineId,
      qtyMilli,
      percentBps,
      condition,
      expectedOn: row.expectedOn.trim() || null,
      scheduleItemId: row.scheduleItemId.trim() || null,
      note: row.note.trim() || null,
    };
  });
}

