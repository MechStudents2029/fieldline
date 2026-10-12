import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  contacts,
  costItems,
  priceBookItems,
  projects,
  purchaseOrderLines,
  purchaseOrders,
  receiptLines,
  receipts,
  stockBalances,
  stockItems,
  stockLocations,
  stockMovements,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import {
  addBalance,
  availableMilli,
  extendCost,
  isLowStock,
  receiveBalance,
  removeBalance,
  reorderQtyMilli,
  stockableQtyMilli,
  takeValue,
  type StockBalance,
} from "@/lib/inventory/math";
import { formatMoney } from "@/lib/money";
import { canManageMoney, canSeeMoney, type Role } from "@/lib/permissions";
import { formatQty } from "@/lib/receiving/match";
import { emitAutomation } from "@/lib/services/automations";
import { ServiceError } from "@/lib/services/errors";
import { createPurchaseOrder } from "@/lib/services/purchase-orders";
import type { Actor } from "@/lib/services/read";

type Writer = AppDatabase;
type BalanceRow = typeof stockBalances.$inferSelect;
type MovementRow = typeof stockMovements.$inferSelect;
type ItemRow = typeof stockItems.$inferSelect;
type LocationRow = typeof stockLocations.$inferSelect;

const PLACE_KINDS = new Set(["yard", "warehouse", "truck"]);
const ADJUST_REASONS = new Set(["count", "damage", "loss"]);

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function assertMover(actor: Actor) {
  if (actor.role === "viewer") throw new ServiceError("Inventory is for the office and the field.");
}

function assertOffice(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Only the office can change this stock.");
}

function seeMoney(actor: Actor) {
  return canSeeMoney(actor.role as Role);
}

function asBalance(row: BalanceRow): StockBalance {
  return { onHandMilli: row.onHandMilli, allocatedMilli: row.allocatedMilli, valueCents: row.valueCents };
}

function audit(db: Writer, actor: Actor, action: string, entityId: string, payload: Record<string, unknown>) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action,
      entityType: "stock_movement",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function nextNumber(db: Writer, orgId: string) {
  const rows = db.select().from(stockMovements).where(eq(stockMovements.orgId, orgId)).all();
  let max = 1000;
  for (const row of rows) {
    const value = Number(row.number.replace(/^MV-/, ""));
    if (Number.isInteger(value)) max = Math.max(max, value);
  }
  return `MV-${max + 1}`;
}

function itemOf(db: Writer, orgId: string, stockItemId: string) {
  const item = db.select().from(stockItems).where(and(eq(stockItems.id, stockItemId), eq(stockItems.orgId, orgId))).get();
  if (!item) throw new ServiceError("Stock item not found.");
  return item;
}

function bookOf(db: Writer, orgId: string, priceBookItemId: string) {
  const book = db.select().from(priceBookItems).where(and(eq(priceBookItems.id, priceBookItemId), eq(priceBookItems.orgId, orgId))).get();
  if (!book) throw new ServiceError("That catalog item is not in this company.");
  return book;
}

function locationOf(db: Writer, orgId: string, locationId: string) {
  const place = db.select().from(stockLocations).where(and(eq(stockLocations.id, locationId), eq(stockLocations.orgId, orgId))).get();
  if (!place) throw new ServiceError("Location not found.");
  return place;
}

function projectOf(db: Writer, orgId: string, projectId: string) {
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  return project;
}

function balanceOf(db: Writer, orgId: string, stockItemId: string, locationId: string) {
  const row = db
    .select()
    .from(stockBalances)
    .where(and(eq(stockBalances.orgId, orgId), eq(stockBalances.stockItemId, stockItemId), eq(stockBalances.locationId, locationId)))
    .get();
  if (row) return row;
  const created: BalanceRow = {
    id: id("bal"),
    orgId,
    stockItemId,
    locationId,
    onHandMilli: 0,
    allocatedMilli: 0,
    valueCents: 0,
  };
  db.insert(stockBalances).values(created).run();
  return created;
}

function saveBalance(db: Writer, row: BalanceRow, next: StockBalance) {
  if (next.allocatedMilli < 0 || next.onHandMilli < 0 || next.valueCents < 0) throw new ServiceError("Void the later movement first.");
  if (next.allocatedMilli > next.onHandMilli) throw new ServiceError("Void the later movement first.");
  db.update(stockBalances)
    .set({ onHandMilli: next.onHandMilli, allocatedMilli: next.allocatedMilli, valueCents: next.valueCents })
    .where(eq(stockBalances.id, row.id))
    .run();
}

function ensureJobLocation(db: Writer, orgId: string, projectId: string) {
  const existing = db
    .select()
    .from(stockLocations)
    .where(and(eq(stockLocations.orgId, orgId), eq(stockLocations.projectId, projectId), eq(stockLocations.kind, "job")))
    .get();
  if (existing) return existing;
  const project = projectOf(db, orgId, projectId);
  const created: LocationRow = {
    id: id("loc"),
    orgId,
    name: project.name,
    kind: "job",
    projectId,
    createdAt: nowIso(),
  };
  db.insert(stockLocations).values(created).run();
  return created;
}

function existingKey(db: Writer, orgId: string, sourceKey: string) {
  const key = sourceKey.trim();
  if (!key) return null;
  return db
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.orgId, orgId), eq(stockMovements.sourceKey, key)))
    .all()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

function postCost(db: Writer, actor: Actor, projectId: string, costCode: string, amountCents: number, memo: string) {
  const costId = id("cost");
  const now = nowIso();
  db.insert(costItems)
    .values({
      id: costId,
      orgId: actor.orgId,
      projectId,
      budgetLineId: null,
      costCode,
      amountCents,
      vendorName: "Stock",
      memo,
      source: "inventory",
      aiExtracted: 0,
      documentId: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  return costId;
}

function dropCost(db: Writer, orgId: string, costId: string | null) {
  if (!costId) return;
  db.delete(costItems).where(and(eq(costItems.id, costId), eq(costItems.orgId, orgId))).run();
}

function insertMovement(
  db: Writer,
  actor: Actor,
  input: {
    stockItemId: string;
    type: string;
    qtyMilli: number;
    costCents: number;
    fromLocationId: string | null;
    toLocationId: string | null;
    projectId: string | null;
    fromProjectId: string | null;
    costItemId: string | null;
    counterCostItemId: string | null;
    sourceKey: string | null;
    receiptId: string | null;
    reason: string | null;
  },
) {
  const now = nowIso();
  const movementId = id("mov");
  const number = nextNumber(db, actor.orgId);
  db.insert(stockMovements)
    .values({
      id: movementId,
      orgId: actor.orgId,
      number,
      stockItemId: input.stockItemId,
      type: input.type,
      status: "posted",
      qtyMilli: input.qtyMilli,
      costCents: input.costCents,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      projectId: input.projectId,
      fromProjectId: input.fromProjectId,
      costItemId: input.costItemId,
      counterCostItemId: input.counterCostItemId,
      sourceKey: input.sourceKey,
      receiptId: input.receiptId,
      reason: input.reason,
      voidReason: null,
      createdAt: now,
      createdBy: actor.userId,
      voidedAt: null,
    })
    .run();
  audit(db, actor, `stock.${input.type}`, movementId, { number, qtyMilli: input.qtyMilli, costCents: input.costCents });
  return { id: movementId, number, existing: false };
}

function companyAvailable(db: Writer, orgId: string, stockItemId: string) {
  return db
    .select()
    .from(stockBalances)
    .where(and(eq(stockBalances.orgId, orgId), eq(stockBalances.stockItemId, stockItemId)))
    .all()
    .reduce((sum, row) => sum + availableMilli(row.onHandMilli, row.allocatedMilli), 0);
}

function noteLow(actor: Actor, stockItemId: string) {
  const db = dbFor(actor);
  const item = itemOf(db, actor.orgId, stockItemId);
  const book = bookOf(db, actor.orgId, item.priceBookItemId);
  const available = companyAvailable(db, actor.orgId, item.id);
  if (!isLowStock(available, item.reorderPointMilli)) return;
  emitAutomation({
    orgId: actor.orgId,
    kind: "stock_low",
    recordType: "stock_item",
    recordId: item.id,
    recordLabel: book.name,
    projectId: null,
    name: book.name,
  });
}

export function stockPlaces(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  return db
    .select()
    .from(stockLocations)
    .where(eq(stockLocations.orgId, orgId))
    .all()
    .filter((row) => PLACE_KINDS.has(row.kind))
    .map((row) => ({ id: row.id, name: row.name, kind: row.kind }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function stockPostedReceipt(
  db: Writer,
  actor: Actor,
  receiptId: string,
  stockTo: string | null,
) {
  const receipt = db.select().from(receipts).where(and(eq(receipts.id, receiptId), eq(receipts.orgId, actor.orgId))).get();
  if (!receipt || receipt.status === "void") return [];
  const lines = db.select().from(receiptLines).where(and(eq(receiptLines.orgId, actor.orgId), eq(receiptLines.receiptId, receipt.id))).all();
  if (stockableQtyMilli(lines) < 1) return [];
  const orderLines = db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orgId, actor.orgId)).all();
  const lineById = new Map(orderLines.map((line) => [line.id, line]));
  const books = db.select().from(priceBookItems).where(eq(priceBookItems.orgId, actor.orgId)).all();
  const bookByCode = new Map(books.map((row) => [row.code.toUpperCase(), row]));
  const items = db.select().from(stockItems).where(eq(stockItems.orgId, actor.orgId)).all();
  const itemByBook = new Map(items.map((row) => [row.priceBookItemId, row]));
  const destination = !stockTo || stockTo === "job" ? ensureJobLocation(db, actor.orgId, receipt.projectId) : locationOf(db, actor.orgId, stockTo);
  if (destination.kind === "job" && destination.projectId !== receipt.projectId && stockTo && stockTo !== "job") {
    throw new ServiceError("That location is on a different job.");
  }
  if (stockTo && stockTo !== "job" && !PLACE_KINDS.has(destination.kind)) throw new ServiceError("Put stock in the yard, a truck, or the job.");
  const grouped = new Map<string, { item: ItemRow; qtyMilli: number; costCents: number }>();
  for (const line of lines) {
    if (line.condition !== "ok" || line.qtyMilli < 1) continue;
    const orderLine = lineById.get(line.purchaseOrderLineId);
    if (!orderLine) continue;
    const book = bookByCode.get(orderLine.costCode.toUpperCase());
    if (!book) continue;
    const item = itemByBook.get(book.id);
    if (!item) continue;
    const unit = orderLine.unitCostCents ?? book.unitCostCents;
    const current = grouped.get(item.id) ?? { item, qtyMilli: 0, costCents: 0 };
    current.qtyMilli += line.qtyMilli;
    current.costCents += extendCost(line.qtyMilli, unit);
    grouped.set(item.id, current);
  }
  const saved = [];
  const touched: string[] = [];
  for (const group of grouped.values()) {
    const key = `receipt:${receipt.id}:${group.item.id}`;
    const prior = existingKey(db, actor.orgId, key);
    if (prior) {
      saved.push({ id: prior.id, number: prior.number, existing: true });
      continue;
    }
    touched.push(group.item.id);
    const row = balanceOf(db, actor.orgId, group.item.id, destination.id);
    saveBalance(db, row, {
      onHandMilli: row.onHandMilli + group.qtyMilli,
      allocatedMilli: row.allocatedMilli,
      valueCents: row.valueCents + group.costCents,
    });
    saved.push(
      insertMovement(db, actor, {
        stockItemId: group.item.id,
        type: "receive",
        qtyMilli: group.qtyMilli,
        costCents: group.costCents,
        fromLocationId: null,
        toLocationId: destination.id,
        projectId: destination.kind === "job" ? destination.projectId : null,
        fromProjectId: null,
        costItemId: null,
        counterCostItemId: null,
        sourceKey: key,
        receiptId: receipt.id,
        reason: null,
      }),
    );
  }
  for (const stockItemId of touched) noteLow(actor, stockItemId);
  return saved;
}

export function voidReceiptStock(db: Writer, actor: Actor, receiptId: string, reason: string) {
  const rows = db
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.orgId, actor.orgId), eq(stockMovements.receiptId, receiptId), eq(stockMovements.status, "posted")))
    .all();
  for (const row of rows) voidPosted(db, actor, row, reason);
}

function applyRemove(db: Writer, orgId: string, stockItemId: string, locationId: string, qtyMilli: number) {
  const row = balanceOf(db, orgId, stockItemId, locationId);
  const taken = removeBalance(asBalance(row), qtyMilli);
  saveBalance(db, row, taken.balance);
  return taken.costCents;
}

function applyAdd(db: Writer, orgId: string, stockItemId: string, locationId: string, qtyMilli: number, costCents: number, allocatedDelta: number) {
  const row = balanceOf(db, orgId, stockItemId, locationId);
  const next = addBalance(asBalance(row), qtyMilli, costCents);
  saveBalance(db, row, { ...next, allocatedMilli: next.allocatedMilli + allocatedDelta });
}

export function issueStock(
  actor: Actor,
  input: { stockItemId: string; fromLocationId: string; projectId: string; qtyMilli: number; sourceKey: string },
) {
  assertMover(actor);
  if (input.qtyMilli < 1) throw new ServiceError("Enter a quantity.");
  const db = dbFor(actor);
  const key = input.sourceKey.trim();
  if (!key) throw new ServiceError("Enter a quantity.");
  const prior = existingKey(db, actor.orgId, key);
  if (prior) return { id: prior.id, number: prior.number, existing: true, projectId: prior.projectId };
  const item = itemOf(db, actor.orgId, input.stockItemId);
  const book = bookOf(db, actor.orgId, item.priceBookItemId);
  const from = locationOf(db, actor.orgId, input.fromLocationId);
  const project = projectOf(db, actor.orgId, input.projectId);
  const job = ensureJobLocation(db, actor.orgId, project.id);
  if (from.id === job.id) throw new ServiceError("That stock is already on the job.");
  let saved = { id: "", number: "", existing: false, projectId: project.id };
  db.transaction((tx) => {
    const writer = tx as unknown as Writer;
    const costCents = applyRemove(writer, actor.orgId, item.id, from.id, input.qtyMilli);
    applyAdd(writer, actor.orgId, item.id, job.id, input.qtyMilli, costCents, input.qtyMilli);
    const costItemId = postCost(writer, actor, project.id, book.code, costCents, book.name);
    const movement = insertMovement(writer, actor, {
      stockItemId: item.id,
      type: "issue",
      qtyMilli: input.qtyMilli,
      costCents,
      fromLocationId: from.id,
      toLocationId: job.id,
      projectId: project.id,
      fromProjectId: null,
      costItemId,
      counterCostItemId: null,
      sourceKey: key,
      receiptId: null,
      reason: null,
    });
    saved = { ...movement, projectId: project.id };
  });
  noteLow(actor, item.id);
  return saved;
}

export function returnStock(
  actor: Actor,
  input: { stockItemId: string; fromLocationId: string; toLocationId: string; qtyMilli: number; sourceKey: string },
) {
  assertMover(actor);
  if (input.qtyMilli < 1) throw new ServiceError("Enter a quantity.");
  const db = dbFor(actor);
  const key = input.sourceKey.trim();
  if (!key) throw new ServiceError("Enter a quantity.");
  const prior = existingKey(db, actor.orgId, key);
  if (prior) return { id: prior.id, number: prior.number, existing: true };
  const item = itemOf(db, actor.orgId, input.stockItemId);
  const book = bookOf(db, actor.orgId, item.priceBookItemId);
  const from = locationOf(db, actor.orgId, input.fromLocationId);
  const to = locationOf(db, actor.orgId, input.toLocationId);
  if (from.kind !== "job" || !from.projectId) throw new ServiceError("Return stock from a job.");
  if (!PLACE_KINDS.has(to.kind)) throw new ServiceError("Return stock to the yard or a truck.");
  const held = balanceOf(db, actor.orgId, item.id, from.id);
  if (input.qtyMilli > held.allocatedMilli) throw new ServiceError("That is more than issued.");
  let saved = { id: "", number: "", existing: false };
  db.transaction((tx) => {
    const writer = tx as unknown as Writer;
    const costCents = takeValue(held.onHandMilli, held.valueCents, input.qtyMilli);
    saveBalance(writer, held, {
      onHandMilli: held.onHandMilli - input.qtyMilli,
      allocatedMilli: held.allocatedMilli - input.qtyMilli,
      valueCents: held.valueCents - costCents,
    });
    applyAdd(writer, actor.orgId, item.id, to.id, input.qtyMilli, costCents, 0);
    const costItemId = postCost(writer, actor, from.projectId!, book.code, -costCents, book.name);
    saved = insertMovement(writer, actor, {
      stockItemId: item.id,
      type: "return",
      qtyMilli: input.qtyMilli,
      costCents,
      fromLocationId: from.id,
      toLocationId: to.id,
      projectId: from.projectId,
      fromProjectId: null,
      costItemId,
      counterCostItemId: null,
      sourceKey: key,
      receiptId: null,
      reason: null,
    });
  });
  noteLow(actor, item.id);
  return saved;
}

export function transferStock(
  actor: Actor,
  input: { stockItemId: string; fromLocationId: string; toLocationId: string; qtyMilli: number; sourceKey: string },
) {
  assertOffice(actor);
  if (input.qtyMilli < 1) throw new ServiceError("Enter a quantity.");
  const db = dbFor(actor);
  const key = input.sourceKey.trim();
  if (!key) throw new ServiceError("Enter a quantity.");
  const prior = existingKey(db, actor.orgId, key);
  if (prior) return { id: prior.id, number: prior.number, existing: true };
  const item = itemOf(db, actor.orgId, input.stockItemId);
  const from = locationOf(db, actor.orgId, input.fromLocationId);
  const to = locationOf(db, actor.orgId, input.toLocationId);
  if (from.id === to.id) throw new ServiceError("Pick a different location.");
  if (!PLACE_KINDS.has(from.kind) || !PLACE_KINDS.has(to.kind)) throw new ServiceError("Transfer stock between the yard and trucks.");
  let saved = { id: "", number: "", existing: false };
  db.transaction((tx) => {
    const writer = tx as unknown as Writer;
    const costCents = applyRemove(writer, actor.orgId, item.id, from.id, input.qtyMilli);
    applyAdd(writer, actor.orgId, item.id, to.id, input.qtyMilli, costCents, 0);
    saved = insertMovement(writer, actor, {
      stockItemId: item.id,
      type: "transfer",
      qtyMilli: input.qtyMilli,
      costCents,
      fromLocationId: from.id,
      toLocationId: to.id,
      projectId: null,
      fromProjectId: null,
      costItemId: null,
      counterCostItemId: null,
      sourceKey: key,
      receiptId: null,
      reason: null,
    });
  });
  return saved;
}

export function transferJobStock(
  actor: Actor,
  input: { stockItemId: string; fromProjectId: string; toProjectId: string; qtyMilli: number; sourceKey: string },
) {
  assertOffice(actor);
  if (input.qtyMilli < 1) throw new ServiceError("Enter a quantity.");
  if (input.fromProjectId === input.toProjectId) throw new ServiceError("Pick a different job.");
  const db = dbFor(actor);
  const key = input.sourceKey.trim();
  if (!key) throw new ServiceError("Enter a quantity.");
  const prior = existingKey(db, actor.orgId, key);
  if (prior) return { id: prior.id, number: prior.number, existing: true };
  const item = itemOf(db, actor.orgId, input.stockItemId);
  const book = bookOf(db, actor.orgId, item.priceBookItemId);
  const fromProject = projectOf(db, actor.orgId, input.fromProjectId);
  const toProject = projectOf(db, actor.orgId, input.toProjectId);
  const from = ensureJobLocation(db, actor.orgId, fromProject.id);
  const to = ensureJobLocation(db, actor.orgId, toProject.id);
  const held = balanceOf(db, actor.orgId, item.id, from.id);
  if (input.qtyMilli > held.allocatedMilli) throw new ServiceError("That is more than issued.");
  let saved = { id: "", number: "", existing: false };
  db.transaction((tx) => {
    const writer = tx as unknown as Writer;
    const costCents = takeValue(held.onHandMilli, held.valueCents, input.qtyMilli);
    saveBalance(writer, held, {
      onHandMilli: held.onHandMilli - input.qtyMilli,
      allocatedMilli: held.allocatedMilli - input.qtyMilli,
      valueCents: held.valueCents - costCents,
    });
    applyAdd(writer, actor.orgId, item.id, to.id, input.qtyMilli, costCents, input.qtyMilli);
    const outId = postCost(writer, actor, fromProject.id, book.code, -costCents, book.name);
    const inId = postCost(writer, actor, toProject.id, book.code, costCents, book.name);
    saved = insertMovement(writer, actor, {
      stockItemId: item.id,
      type: "job_transfer",
      qtyMilli: input.qtyMilli,
      costCents,
      fromLocationId: from.id,
      toLocationId: to.id,
      projectId: toProject.id,
      fromProjectId: fromProject.id,
      costItemId: outId,
      counterCostItemId: inId,
      sourceKey: key,
      receiptId: null,
      reason: null,
    });
  });
  return saved;
}

export function adjustStock(
  actor: Actor,
  input: { stockItemId: string; locationId: string; qtyMilli: number; direction: "in" | "out"; reason: string; sourceKey: string },
) {
  assertOffice(actor);
  if (input.qtyMilli < 1) throw new ServiceError("Enter a quantity.");
  if (!ADJUST_REASONS.has(input.reason)) throw new ServiceError("Pick a reason.");
  if (input.reason !== "count" && input.direction !== "out") throw new ServiceError("Damage and loss come out of stock.");
  const db = dbFor(actor);
  const key = input.sourceKey.trim();
  if (!key) throw new ServiceError("Enter a quantity.");
  const prior = existingKey(db, actor.orgId, key);
  if (prior) return { id: prior.id, number: prior.number, existing: true };
  const item = itemOf(db, actor.orgId, input.stockItemId);
  const book = bookOf(db, actor.orgId, item.priceBookItemId);
  const place = locationOf(db, actor.orgId, input.locationId);
  let saved = { id: "", number: "", existing: false };
  db.transaction((tx) => {
    const writer = tx as unknown as Writer;
    const row = balanceOf(writer, actor.orgId, item.id, place.id);
    if (input.direction === "out") {
      const taken = removeBalance(asBalance(row), input.qtyMilli);
      saveBalance(writer, row, taken.balance);
      saved = insertMovement(writer, actor, {
        stockItemId: item.id,
        type: "adjust",
        qtyMilli: input.qtyMilli,
        costCents: taken.costCents,
        fromLocationId: place.id,
        toLocationId: null,
        projectId: place.projectId,
        fromProjectId: null,
        costItemId: null,
        counterCostItemId: null,
        sourceKey: key,
        receiptId: null,
        reason: input.reason,
      });
      return;
    }
    const unit = row.onHandMilli > 0 ? Math.round((row.valueCents * 1000) / row.onHandMilli) : book.unitCostCents;
    const next = receiveBalance(asBalance(row), input.qtyMilli, unit);
    const costCents = next.valueCents - row.valueCents;
    saveBalance(writer, row, next);
    saved = insertMovement(writer, actor, {
      stockItemId: item.id,
      type: "adjust",
      qtyMilli: input.qtyMilli,
      costCents,
      fromLocationId: null,
      toLocationId: place.id,
      projectId: place.projectId,
      fromProjectId: null,
      costItemId: null,
      counterCostItemId: null,
      sourceKey: key,
      receiptId: null,
      reason: input.reason,
    });
  });
  noteLow(actor, item.id);
  return saved;
}

function voidPosted(db: Writer, actor: Actor, movement: MovementRow, reason: string) {
  const why = reason.trim();
  if (why.length < 2) throw new ServiceError("Enter a reason to void this movement.");
  if (movement.status === "void") throw new ServiceError("That movement is already void.");
  const qty = movement.qtyMilli;
  const cost = movement.costCents;
  if (movement.type === "receive" && movement.toLocationId) {
    const row = balanceOf(db, actor.orgId, movement.stockItemId, movement.toLocationId);
    if (qty > availableMilli(row.onHandMilli, row.allocatedMilli) || cost > row.valueCents) throw new ServiceError("Void the later movement first.");
    saveBalance(db, row, { onHandMilli: row.onHandMilli - qty, allocatedMilli: row.allocatedMilli, valueCents: row.valueCents - cost });
  } else if (movement.type === "issue" && movement.fromLocationId && movement.toLocationId) {
    const dest = balanceOf(db, actor.orgId, movement.stockItemId, movement.toLocationId);
    if (qty > dest.allocatedMilli || qty > dest.onHandMilli || cost > dest.valueCents) throw new ServiceError("Void the later movement first.");
    saveBalance(db, dest, { onHandMilli: dest.onHandMilli - qty, allocatedMilli: dest.allocatedMilli - qty, valueCents: dest.valueCents - cost });
    applyAdd(db, actor.orgId, movement.stockItemId, movement.fromLocationId, qty, cost, 0);
    dropCost(db, actor.orgId, movement.costItemId);
  } else if (movement.type === "return" && movement.fromLocationId && movement.toLocationId) {
    const dest = balanceOf(db, actor.orgId, movement.stockItemId, movement.toLocationId);
    if (qty > availableMilli(dest.onHandMilli, dest.allocatedMilli) || cost > dest.valueCents) throw new ServiceError("Void the later movement first.");
    saveBalance(db, dest, { onHandMilli: dest.onHandMilli - qty, allocatedMilli: dest.allocatedMilli, valueCents: dest.valueCents - cost });
    applyAdd(db, actor.orgId, movement.stockItemId, movement.fromLocationId, qty, cost, qty);
    dropCost(db, actor.orgId, movement.costItemId);
  } else if (movement.type === "transfer" && movement.fromLocationId && movement.toLocationId) {
    const dest = balanceOf(db, actor.orgId, movement.stockItemId, movement.toLocationId);
    if (qty > availableMilli(dest.onHandMilli, dest.allocatedMilli) || cost > dest.valueCents) throw new ServiceError("Void the later movement first.");
    saveBalance(db, dest, { onHandMilli: dest.onHandMilli - qty, allocatedMilli: dest.allocatedMilli, valueCents: dest.valueCents - cost });
    applyAdd(db, actor.orgId, movement.stockItemId, movement.fromLocationId, qty, cost, 0);
  } else if (movement.type === "job_transfer" && movement.fromLocationId && movement.toLocationId) {
    const dest = balanceOf(db, actor.orgId, movement.stockItemId, movement.toLocationId);
    if (qty > dest.allocatedMilli || cost > dest.valueCents) throw new ServiceError("Void the later movement first.");
    saveBalance(db, dest, { onHandMilli: dest.onHandMilli - qty, allocatedMilli: dest.allocatedMilli - qty, valueCents: dest.valueCents - cost });
    applyAdd(db, actor.orgId, movement.stockItemId, movement.fromLocationId, qty, cost, qty);
    dropCost(db, actor.orgId, movement.costItemId);
    dropCost(db, actor.orgId, movement.counterCostItemId);
  } else if (movement.type === "adjust" && movement.toLocationId && !movement.fromLocationId) {
    const dest = balanceOf(db, actor.orgId, movement.stockItemId, movement.toLocationId);
    if (qty > availableMilli(dest.onHandMilli, dest.allocatedMilli) || cost > dest.valueCents) throw new ServiceError("Void the later movement first.");
    saveBalance(db, dest, { onHandMilli: dest.onHandMilli - qty, allocatedMilli: dest.allocatedMilli, valueCents: dest.valueCents - cost });
  } else if (movement.type === "adjust" && movement.fromLocationId) {
    applyAdd(db, actor.orgId, movement.stockItemId, movement.fromLocationId, qty, cost, 0);
  } else {
    throw new ServiceError("That movement cannot be voided.");
  }
  const now = nowIso();
  db.update(stockMovements)
    .set({ status: "void", voidReason: why, voidedAt: now })
    .where(and(eq(stockMovements.id, movement.id), eq(stockMovements.orgId, actor.orgId)))
    .run();
  audit(db, actor, "stock.void", movement.id, { number: movement.number, reason: why });
}

export function voidMovement(actor: Actor, movementId: string, reason: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const movement = db.select().from(stockMovements).where(and(eq(stockMovements.id, movementId), eq(stockMovements.orgId, actor.orgId))).get();
  if (!movement) throw new ServiceError("Movement not found.");
  db.transaction((tx) => {
    voidPosted(tx as unknown as Writer, actor, movement, reason);
  });
  noteLow(actor, movement.stockItemId);
  return { id: movement.id, stockItemId: movement.stockItemId };
}

export function reorderStock(actor: Actor, stockItemId: string, projectId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const item = itemOf(db, actor.orgId, stockItemId);
  const book = bookOf(db, actor.orgId, item.priceBookItemId);
  if (!item.preferredVendorContactId) throw new ServiceError("Set a preferred vendor.");
  const vendor = db.select().from(contacts).where(and(eq(contacts.id, item.preferredVendorContactId), eq(contacts.orgId, actor.orgId))).get();
  if (!vendor || vendor.deletedAt) throw new ServiceError("Set a preferred vendor.");
  projectOf(db, actor.orgId, projectId);
  const available = companyAvailable(db, actor.orgId, item.id);
  if (!isLowStock(available, item.reorderPointMilli)) throw new ServiceError("This item is above its reorder point.");
  const orders = db.select().from(purchaseOrders).where(eq(purchaseOrders.orgId, actor.orgId)).all();
  const open = new Map(orders.filter((order) => order.status === "draft" || order.status === "issued").map((order) => [order.id, order]));
  const line = db
    .select()
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.orgId, actor.orgId))
    .all()
    .find((row) => row.sourceKind === "stock_item" && row.sourceId === item.id && open.has(row.purchaseOrderId));
  if (line) {
    const order = open.get(line.purchaseOrderId)!;
    return { id: order.id, number: order.number, existing: true, projectId: order.projectId };
  }
  const qtyMilli = reorderQtyMilli(available, item.reorderPointMilli);
  const created = createPurchaseOrder(actor, {
    projectId,
    vendorContactId: vendor.id,
    scope: "Stock",
    lines: [
      {
        costCode: book.code,
        description: book.name,
        qtyMilli,
        unitCostCents: book.unitCostCents,
        amountCents: extendCost(qtyMilli, book.unitCostCents),
        sourceKind: "stock_item",
        sourceId: item.id,
        note: "Reorder",
      },
    ],
  });
  return { id: created.id, number: created.number, existing: false, projectId };
}

type Listed = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  code: string;
  onHandMilli: number;
  allocatedMilli: number;
  availableMilli: number;
  valueCents: number;
  reorderPointMilli: number;
  low: boolean;
};

function listedRows(orgId: string, locationId: string): Listed[] {
  const db = officeDb(orgId);
  if (!db) return [];
  const items = db.select().from(stockItems).where(eq(stockItems.orgId, orgId)).all();
  const books = new Map(db.select().from(priceBookItems).where(eq(priceBookItems.orgId, orgId)).all().map((row) => [row.id, row]));
  const balances = db
    .select()
    .from(stockBalances)
    .where(eq(stockBalances.orgId, orgId))
    .all()
    .filter((row) => !locationId || row.locationId === locationId);
  return items
    .map((item) => {
      const book = books.get(item.priceBookItemId);
      if (!book) return null;
      const rows = balances.filter((row) => row.stockItemId === item.id);
      const onHandMilli = rows.reduce((sum, row) => sum + row.onHandMilli, 0);
      const allocated = rows.reduce((sum, row) => sum + row.allocatedMilli, 0);
      const valueCents = rows.reduce((sum, row) => sum + row.valueCents, 0);
      const available = onHandMilli - allocated;
      return {
        id: item.id,
        name: book.name,
        sku: item.sku,
        unit: book.unit,
        code: book.code,
        onHandMilli,
        allocatedMilli: allocated,
        availableMilli: available,
        valueCents,
        reorderPointMilli: item.reorderPointMilli,
        low: isLowStock(available, item.reorderPointMilli),
      };
    })
    .filter((row): row is Listed => row != null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listStock(actor: Actor, filter: { locationId?: string; low?: boolean }) {
  const rows = listedRows(actor.orgId, filter.locationId?.trim() || "").filter((row) => !filter.low || row.low);
  const money = seeMoney(actor);
  return {
    rows: rows.map((row) => ({ ...row, valueCents: money ? row.valueCents : null })),
    money,
  };
}

export function stockCsv(actor: Actor, filter: { locationId?: string; low?: boolean }) {
  const board = listStock(actor, filter);
  const header = board.money ? ["Item", "SKU", "Code", "On hand", "Allocated", "Available", "Value"] : ["Item", "SKU", "Code", "On hand", "Allocated", "Available"];
  const lines = board.rows.map((row) => {
    const cells = [
      row.name,
      row.sku ?? "",
      row.code,
      `${formatQty(row.onHandMilli)} ${row.unit}`,
      formatQty(row.allocatedMilli),
      formatQty(row.availableMilli),
    ];
    if (board.money) cells.push(formatMoney(row.valueCents ?? 0));
    return cells.map(csvCell).join(",");
  });
  return [header.join(","), ...lines].join("\n");
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function stockDetail(actor: Actor, stockItemId: string) {
  const db = dbFor(actor);
  const item = db.select().from(stockItems).where(and(eq(stockItems.id, stockItemId), eq(stockItems.orgId, actor.orgId))).get();
  if (!item) return null;
  const book = bookOf(db, actor.orgId, item.priceBookItemId);
  const money = seeMoney(actor);
  const locations = db.select().from(stockLocations).where(eq(stockLocations.orgId, actor.orgId)).all();
  const byLocation = new Map(locations.map((row) => [row.id, row]));
  const balances = db
    .select()
    .from(stockBalances)
    .where(and(eq(stockBalances.orgId, actor.orgId), eq(stockBalances.stockItemId, item.id)))
    .all()
    .filter((row) => row.onHandMilli > 0 || row.allocatedMilli > 0)
    .map((row) => {
      const place = byLocation.get(row.locationId);
      return {
        locationId: row.locationId,
        name: place?.name ?? "Location",
        kind: place?.kind ?? "",
        projectId: place?.projectId ?? null,
        onHandMilli: row.onHandMilli,
        allocatedMilli: row.allocatedMilli,
        availableMilli: row.onHandMilli - row.allocatedMilli,
        valueCents: money ? row.valueCents : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const movements = db
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.orgId, actor.orgId), eq(stockMovements.stockItemId, item.id)))
    .all()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((row) => ({
      id: row.id,
      number: row.number,
      type: row.type,
      status: row.status,
      qtyMilli: row.qtyMilli,
      costCents: money ? row.costCents : null,
      fromName: row.fromLocationId ? byLocation.get(row.fromLocationId)?.name ?? "" : "",
      toName: row.toLocationId ? byLocation.get(row.toLocationId)?.name ?? "" : "",
      reason: row.reason,
      createdAt: row.createdAt,
    }));
  const jobs = db
    .select()
    .from(projects)
    .where(eq(projects.orgId, actor.orgId))
    .all()
    .filter((row) => row.status !== "complete")
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const places = locations
    .filter((row) => PLACE_KINDS.has(row.kind))
    .map((row) => ({ id: row.id, name: row.name, kind: row.kind }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const jobPlaces = locations
    .filter((row) => row.kind === "job" && row.projectId)
    .map((row) => ({ id: row.id, name: row.name, projectId: row.projectId as string }));
  const available = balances.reduce((sum, row) => sum + row.availableMilli, 0);
  return {
    id: item.id,
    name: book.name,
    sku: item.sku,
    unit: book.unit,
    code: book.code,
    reorderPointMilli: item.reorderPointMilli,
    low: isLowStock(available, item.reorderPointMilli),
    money,
    office: canManageMoney(actor.role as Role),
    balances,
    movements,
    jobs,
    places,
    jobPlaces,
    vendorReady: Boolean(item.preferredVendorContactId),
  };
}

export function lowStockCount(orgId: string) {
  return listedRows(orgId, "").filter((row) => row.low).length;
}

export function jobStockSummary(orgId: string, projectId: string, role: string) {
  const db = officeDb(orgId);
  if (!db) return null;
  const money = canSeeMoney(role as Role);
  const costs = db
    .select()
    .from(costItems)
    .where(and(eq(costItems.orgId, orgId), eq(costItems.projectId, projectId), eq(costItems.source, "inventory")))
    .all();
  const issuedCents = costs.reduce((sum, row) => sum + row.amountCents, 0);
  const place = db
    .select()
    .from(stockLocations)
    .where(and(eq(stockLocations.orgId, orgId), eq(stockLocations.projectId, projectId), eq(stockLocations.kind, "job")))
    .get();
  const balances = place
    ? db.select().from(stockBalances).where(and(eq(stockBalances.orgId, orgId), eq(stockBalances.locationId, place.id))).all().filter((row) => row.onHandMilli > 0)
    : [];
  const books = new Map(db.select().from(priceBookItems).where(eq(priceBookItems.orgId, orgId)).all().map((row) => [row.id, row]));
  const items = new Map(db.select().from(stockItems).where(eq(stockItems.orgId, orgId)).all().map((row) => [row.id, row]));
  const qty = balances
    .map((row) => {
      const item = items.get(row.stockItemId);
      const book = item ? books.get(item.priceBookItemId) : null;
      if (!book) return "";
      return `${formatQty(row.onHandMilli)} ${book.unit}`;
    })
    .filter(Boolean)
    .join(" · ");
  if (issuedCents === 0 && !qty) return null;
  return { issuedCents: money ? issuedCents : null, qty, href: "/inventory" };
}

export function accountingInventoryRows(orgId: string): string[][] {
  const db = officeDb(orgId);
  if (!db) return [];
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row.name]));
  return db
    .select()
    .from(costItems)
    .where(and(eq(costItems.orgId, orgId), eq(costItems.source, "inventory")))
    .all()
    .filter((row) => row.amountCents !== 0)
    .map((row) => [
      row.memo || "Stock",
      "Stock",
      jobs.get(row.projectId) ?? "",
      row.amountCents < 0 ? "Returned" : "Issued",
      formatMoney(row.amountCents),
      formatMoney(0),
      formatMoney(row.amountCents),
      formatMoney(0),
      "Inventory",
    ]);
}
