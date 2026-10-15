import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  auditLogs,
  contacts,
  materialRequestLines,
  materialRequests,
  memberships,
  notifications,
  organizations,
  priceBookItems,
  projects,
  purchaseOrderLines,
  purchaseOrders,
  stockBalances,
  stockItems,
  users,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { extendCost } from "@/lib/inventory/math";
import {
  duplicateRequest,
  formatQty,
  isMaterialAttention,
  isMaterialStatus,
  isUrgency,
  materialStatusLabel,
  urgencyLabel,
  type MaterialStatus,
  type MaterialUrgency,
} from "@/lib/material/request";
import { canManageMoney, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import { issueStock, stockPlaces } from "@/lib/services/inventory";
import { createPurchaseOrder, savePurchaseOrder } from "@/lib/services/purchase-orders";
import type { Actor } from "@/lib/services/read";
import { localDay } from "@/lib/time/calendar";

const VENDOR_TYPES = new Set(["sub", "vendor"]);
const OFFICE = new Set(["owner", "admin", "estimator"]);

export type MaterialLineInput = {
  stockItemId?: string | null;
  description?: string;
  qtyMilli: number;
  costCode?: string | null;
};

export type MaterialInput = {
  userId?: string;
  projectId: string;
  urgency: string;
  note?: string;
  lines: MaterialLineInput[];
  submit?: boolean;
};

export type MaterialLineView = {
  id: string;
  stockItemId: string | null;
  sku: string | null;
  description: string;
  qtyMilli: number;
  qtyLabel: string;
  costCode: string | null;
  movementId: string | null;
};

export type MaterialListRow = {
  id: string;
  userId: string;
  personName: string;
  projectId: string;
  projectName: string;
  status: MaterialStatus;
  statusLabel: string;
  urgency: MaterialUrgency;
  urgencyLabel: string;
  note: string | null;
  rejectNote: string | null;
  title: string;
  qtyLabel: string;
  duplicateId: string | null;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  createdAt: string;
};

type RequestRow = typeof materialRequests.$inferSelect;
type LineRow = typeof materialRequestLines.$inferSelect;

function roleOf(actor: Actor): Role {
  return actor.role;
}

function assertLog(actor: Actor) {
  if (roleOf(actor) === "viewer") throw new ServiceError("Your role cannot request material.");
}

function assertOffice(actor: Actor) {
  if (!canManageMoney(roleOf(actor))) throw new ServiceError("Material requests are approved in the office.");
}

function orgZone(orgId: string) {
  const org = getDb().select().from(organizations).where(eq(organizations.id, orgId)).get();
  return org?.timeZone || "America/New_York";
}

function namesFor(orgId: string) {
  const db = getDb();
  const people = db
    .select({ userId: memberships.userId, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all();
  const jobs = db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, orgId)).all();
  return {
    people: new Map(people.map((row) => [row.userId, row])),
    jobs: new Map(jobs.map((row) => [row.id, row.name])),
  };
}

function loadRequests(orgId: string) {
  return getDb().select().from(materialRequests).where(eq(materialRequests.orgId, orgId)).all();
}

function loadLines(orgId: string, requestId?: string) {
  const rows = getDb().select().from(materialRequestLines).where(eq(materialRequestLines.orgId, orgId)).all();
  const scoped = requestId ? rows.filter((row) => row.requestId === requestId) : rows;
  return scoped.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function visible(actor: Actor) {
  const rows = loadRequests(actor.orgId);
  if (roleOf(actor) === "field") return rows.filter((row) => row.userId === actor.userId);
  return rows;
}

function dayOf(iso: string | null, timeZone: string) {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return localDay(parsed, timeZone);
}

function stockCatalog(orgId: string) {
  const db = getDb();
  const items = db.select().from(stockItems).where(eq(stockItems.orgId, orgId)).all();
  const books = new Map(db.select().from(priceBookItems).where(eq(priceBookItems.orgId, orgId)).all().map((row) => [row.id, row]));
  return new Map(
    items.map((item) => {
      const book = books.get(item.priceBookItemId);
      return [item.id, { item, book }] as const;
    }),
  );
}

function audit(actor: Actor, action: string, entityId: string, payload: Record<string, unknown>) {
  getDb()
    .insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action,
      entityType: "material_request",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function notifyOffice(actor: Actor, requestId: string, snippet: string, projectId: string) {
  const names = namesFor(actor.orgId);
  const now = nowIso();
  const rows = [...names.people.values()].filter((person) => OFFICE.has(person.role) && person.userId !== actor.userId);
  if (rows.length === 0) return;
  getDb()
    .insert(notifications)
    .values(
      rows.map((person) => ({
        id: id("note"),
        orgId: actor.orgId,
        userId: person.userId,
        kind: "material",
        commentId: null,
        entityType: "material_request",
        entityId: requestId,
        projectId,
        actorId: actor.userId,
        actorName: actor.name,
        snippet,
        readAt: null,
        createdAt: now,
      })),
    )
    .run();
}

function cleanLines(actor: Actor, lines: MaterialLineInput[]) {
  if (lines.length === 0 || lines.length > 8) throw new ServiceError("Add a line.");
  const catalog = stockCatalog(actor.orgId);
  const books = getDb().select().from(priceBookItems).where(eq(priceBookItems.orgId, actor.orgId)).all();
  const byCode = new Map(books.map((row) => [row.code.toUpperCase(), row]));
  return lines.map((line, index) => {
    if (!Number.isInteger(line.qtyMilli) || line.qtyMilli <= 0) throw new ServiceError("Enter a quantity.");
    const stockId = (line.stockItemId ?? "").trim();
    const stock = stockId ? catalog.get(stockId) : undefined;
    if (stockId && !stock?.book) throw new ServiceError("That item is not in stock.");
    const codeText = (line.costCode ?? "").trim().toUpperCase();
    if (codeText.length > 40) throw new ServiceError("Keep the cost code short.");
    let description = (line.description ?? "").trim();
    if (stock?.book) description = description || stock.book.name;
    if (!description) throw new ServiceError("Name the material.");
    if (description.length > 160) throw new ServiceError("Keep the description under 160 characters.");
    const costCode = codeText || stock?.book?.code || null;
    if (costCode && !stock && !byCode.has(costCode)) throw new ServiceError("That cost code is not on the price book.");
    return {
      stockItemId: stock ? stock.item.id : null,
      description,
      qtyMilli: line.qtyMilli,
      costCode,
      sortOrder: index,
    };
  });
}

function assertProject(orgId: string, projectId: string) {
  const row = getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .get();
  if (!row) throw new ServiceError("Job not found.");
  return row.id;
}

function assertPerson(actor: Actor, requested: string | undefined) {
  const names = namesFor(actor.orgId);
  const userId = canManageMoney(roleOf(actor)) ? (requested || "").trim() || actor.userId : actor.userId;
  if (!names.people.has(userId)) throw new ServiceError("Person not found.");
  return userId;
}

function cleanNote(value: string | undefined) {
  const text = (value ?? "").trim();
  if (text.length > 500) throw new ServiceError("Keep the note under 500 characters.");
  return text || null;
}

function requireRequest(actor: Actor, requestId: string) {
  const row = getDb()
    .select()
    .from(materialRequests)
    .where(and(eq(materialRequests.id, requestId), eq(materialRequests.orgId, actor.orgId)))
    .get();
  if (!row) throw new ServiceError("Request not found.");
  if (roleOf(actor) === "field" && row.userId !== actor.userId) throw new ServiceError("Request not found.");
  return row;
}

function canEditRow(actor: Actor, row: RequestRow) {
  if (row.status !== "draft" && row.status !== "submitted") return false;
  if (canManageMoney(roleOf(actor))) return true;
  return roleOf(actor) !== "viewer" && row.userId === actor.userId;
}

function lineViews(orgId: string, lines: LineRow[]): MaterialLineView[] {
  const catalog = stockCatalog(orgId);
  return lines.map((line) => ({
    id: line.id,
    stockItemId: line.stockItemId,
    sku: line.stockItemId ? (catalog.get(line.stockItemId)?.item.sku ?? null) : null,
    description: line.description,
    qtyMilli: line.qtyMilli,
    qtyLabel: formatQty(line.qtyMilli),
    costCode: line.costCode,
    movementId: line.movementId,
  }));
}

function listed(actor: Actor, rows: RequestRow[]): MaterialListRow[] {
  const names = namesFor(actor.orgId);
  const zone = orgZone(actor.orgId);
  const allLines = loadLines(actor.orgId);
  const byRequest = new Map<string, LineRow[]>();
  for (const line of allLines) {
    const list = byRequest.get(line.requestId) ?? [];
    list.push(line);
    byRequest.set(line.requestId, list);
  }
  const orders = new Map(getDb().select().from(purchaseOrders).where(eq(purchaseOrders.orgId, actor.orgId)).all().map((row) => [row.id, row.number]));
  const dupSource = rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    stockItemIds: (byRequest.get(row.id) ?? []).map((line) => line.stockItemId).filter((value): value is string => Boolean(value)),
    createdOn: dayOf(row.createdAt, zone) ?? row.createdAt.slice(0, 10),
  }));
  const visibleIds = new Set(rows.map((row) => row.id));
  return rows
    .map((row) => {
      const lines = byRequest.get(row.id) ?? [];
      const status = (isMaterialStatus(row.status) ? row.status : "draft") as MaterialStatus;
      const urgency = (isUrgency(row.urgency) ? row.urgency : "normal") as MaterialUrgency;
      const other = duplicateRequest(dupSource, row.id);
      return {
        id: row.id,
        userId: row.userId,
        personName: names.people.get(row.userId)?.name ?? "Crew",
        projectId: row.projectId,
        projectName: names.jobs.get(row.projectId) ?? "Job",
        status,
        statusLabel: materialStatusLabel(status),
        urgency,
        urgencyLabel: urgencyLabel(urgency),
        note: row.note,
        rejectNote: row.rejectNote,
        title: lines[0]?.description ?? "Material",
        qtyLabel: lines[0] ? formatQty(lines[0].qtyMilli) : "0",
        duplicateId: other && visibleIds.has(other) ? other : null,
        purchaseOrderId: row.purchaseOrderId,
        purchaseOrderNumber: row.purchaseOrderId ? (orders.get(row.purchaseOrderId) ?? null) : null,
        createdAt: row.createdAt,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

export function materialJobs(orgId: string) {
  return getDb()
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function materialStock(orgId: string) {
  const catalog = stockCatalog(orgId);
  return [...catalog.values()]
    .filter((row) => row.book)
    .map((row) => ({ id: row.item.id, sku: row.item.sku ?? "", name: row.book!.name }))
    .sort((a, b) => a.sku.localeCompare(b.sku) || a.name.localeCompare(b.name));
}

export function materialCodes(orgId: string) {
  return getDb()
    .select({ code: priceBookItems.code })
    .from(priceBookItems)
    .where(eq(priceBookItems.orgId, orgId))
    .all()
    .map((row) => row.code)
    .sort((a, b) => a.localeCompare(b));
}

export function materialPeople(actor: Actor) {
  const names = namesFor(actor.orgId);
  if (roleOf(actor) === "field") return [{ id: actor.userId, name: names.people.get(actor.userId)?.name ?? actor.name }];
  return [...names.people.values()]
    .map((person) => ({ id: person.userId, name: person.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function materialVendors(orgId: string) {
  return getDb()
    .select()
    .from(contacts)
    .where(eq(contacts.orgId, orgId))
    .all()
    .filter((row) => !row.deletedAt && VENDOR_TYPES.has(row.type))
    .map((row) => ({ id: row.id, name: row.company?.trim() || row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function materialPlaces(orgId: string) {
  return stockPlaces(orgId);
}

export function listMaterialRequests(actor: Actor, filters: { personId?: string | null; projectId?: string | null; status?: string | null; urgency?: string | null } = {}): MaterialListRow[] {
  let rows = visible(actor);
  const personId = (filters.personId ?? "").trim();
  if (personId && roleOf(actor) !== "field") rows = rows.filter((row) => row.userId === personId);
  const projectId = (filters.projectId ?? "").trim();
  if (projectId) rows = rows.filter((row) => row.projectId === projectId);
  const status = (filters.status ?? "").trim();
  if (status && isMaterialStatus(status)) rows = rows.filter((row) => row.status === status);
  const urgency = (filters.urgency ?? "").trim();
  if (urgency && isUrgency(urgency)) rows = rows.filter((row) => row.urgency === urgency);
  return listed(actor, rows);
}

export function materialDetail(actor: Actor, requestId: string) {
  const row = requireRequest(actor, requestId);
  const view = listed(actor, visible(actor)).find((item) => item.id === row.id);
  if (!view) throw new ServiceError("Request not found.");
  const office = canManageMoney(roleOf(actor));
  const lines = lineViews(actor.orgId, loadLines(actor.orgId, row.id));
  const stocked = lines.length > 0 && lines.every((line) => line.stockItemId);
  return {
    ...view,
    lines,
    canEdit: canEditRow(actor, row),
    canSubmit: canEditRow(actor, row) && row.status === "draft",
    canApprove: office && row.status === "submitted",
    canReject: office && (row.status === "submitted" || row.status === "approved"),
    canFulfill: office && row.status === "approved" && stocked,
    canOrder: office && row.status === "approved" && !row.purchaseOrderId,
  };
}

export function materialAttention(actor: Actor): { count: number; href: string | null } {
  const zone = orgZone(actor.orgId);
  const today = localDay(Date.now(), zone);
  const count = visible(actor).filter((row) => isMaterialAttention(row.status, row.urgency, dayOf(row.submittedAt, zone), today)).length;
  return { count, href: count > 0 ? "/material-requests?status=submitted" : null };
}

export function materialInbox(orgId: string, requestId: string): { record: string; href: string } | null {
  const row = getDb()
    .select()
    .from(materialRequests)
    .where(and(eq(materialRequests.id, requestId), eq(materialRequests.orgId, orgId)))
    .get();
  if (!row || row.status !== "submitted") return null;
  return { record: "Materials", href: `/material-requests/${row.id}` };
}

function replaceLines(orgId: string, requestId: string, lines: ReturnType<typeof cleanLines>) {
  const db = getDb();
  db.delete(materialRequestLines).where(and(eq(materialRequestLines.orgId, orgId), eq(materialRequestLines.requestId, requestId))).run();
  db.insert(materialRequestLines)
    .values(
      lines.map((line) => ({
        id: id("mrl"),
        orgId,
        requestId,
        stockItemId: line.stockItemId,
        description: line.description,
        qtyMilli: line.qtyMilli,
        costCode: line.costCode,
        sortOrder: line.sortOrder,
        movementId: null,
      })),
    )
    .run();
}

export function createMaterialRequest(actor: Actor, input: MaterialInput) {
  assertLog(actor);
  const projectId = assertProject(actor.orgId, input.projectId.trim());
  const userId = assertPerson(actor, input.userId);
  if (!isUrgency(input.urgency)) throw new ServiceError("Pick normal or urgent.");
  const lines = cleanLines(actor, input.lines);
  const now = nowIso();
  const submit = Boolean(input.submit);
  const requestId = id("mrq");
  getDb()
    .insert(materialRequests)
    .values({
      id: requestId,
      orgId: actor.orgId,
      projectId,
      userId,
      status: submit ? "submitted" : "draft",
      urgency: input.urgency,
      note: cleanNote(input.note),
      rejectNote: null,
      purchaseOrderId: null,
      submittedAt: submit ? now : null,
      approvedAt: null,
      fulfilledAt: null,
      orderedAt: null,
      rejectedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  replaceLines(actor.orgId, requestId, lines);
  audit(actor, "material.create", requestId, { projectId, urgency: input.urgency, lines: lines.length, status: submit ? "submitted" : "draft" });
  if (submit) {
    audit(actor, "material.submit", requestId, { projectId });
    notifyOffice(actor, requestId, lines[0]?.description ?? "Material", projectId);
  }
  return { id: requestId };
}

export function editMaterialRequest(actor: Actor, requestId: string, input: MaterialInput) {
  const row = requireRequest(actor, requestId);
  if (!canEditRow(actor, row)) throw new ServiceError("That request can no longer be edited.");
  const projectId = assertProject(actor.orgId, input.projectId.trim());
  const userId = canManageMoney(roleOf(actor)) ? assertPerson(actor, input.userId) : row.userId;
  if (!isUrgency(input.urgency)) throw new ServiceError("Pick normal or urgent.");
  const lines = cleanLines(actor, input.lines);
  const now = nowIso();
  getDb()
    .update(materialRequests)
    .set({ projectId, userId, urgency: input.urgency, note: cleanNote(input.note), updatedAt: now })
    .where(and(eq(materialRequests.id, row.id), eq(materialRequests.orgId, actor.orgId)))
    .run();
  replaceLines(actor.orgId, row.id, lines);
  audit(actor, "material.edit", row.id, { projectId, urgency: input.urgency, lines: lines.length });
  return { id: row.id };
}

export function submitMaterialRequest(actor: Actor, requestId: string) {
  const row = requireRequest(actor, requestId);
  if (!canEditRow(actor, row)) throw new ServiceError("That request can no longer be edited.");
  if (row.status !== "draft") throw new ServiceError("That request is already submitted.");
  const now = nowIso();
  getDb()
    .update(materialRequests)
    .set({ status: "submitted", submittedAt: now, updatedAt: now })
    .where(and(eq(materialRequests.id, row.id), eq(materialRequests.orgId, actor.orgId)))
    .run();
  const lines = loadLines(actor.orgId, row.id);
  audit(actor, "material.submit", row.id, { projectId: row.projectId });
  notifyOffice(actor, row.id, lines[0]?.description ?? "Material", row.projectId);
  return { id: row.id };
}

export function approveMaterialRequest(actor: Actor, requestId: string) {
  assertOffice(actor);
  const row = requireRequest(actor, requestId);
  if (row.status !== "submitted") throw new ServiceError("That request is not waiting.");
  const now = nowIso();
  getDb()
    .update(materialRequests)
    .set({ status: "approved", approvedAt: now, updatedAt: now })
    .where(and(eq(materialRequests.id, row.id), eq(materialRequests.orgId, actor.orgId)))
    .run();
  audit(actor, "material.approve", row.id, { projectId: row.projectId });
  return { id: row.id };
}

export function rejectMaterialRequest(actor: Actor, requestId: string, note: string) {
  assertOffice(actor);
  const row = requireRequest(actor, requestId);
  if (row.status !== "submitted" && row.status !== "approved") throw new ServiceError("That request is not waiting.");
  const rejectNote = note.trim();
  if (!rejectNote) throw new ServiceError("Add a note.");
  if (rejectNote.length > 500) throw new ServiceError("Keep the note under 500 characters.");
  const now = nowIso();
  getDb()
    .update(materialRequests)
    .set({ status: "rejected", rejectNote, rejectedAt: now, updatedAt: now })
    .where(and(eq(materialRequests.id, row.id), eq(materialRequests.orgId, actor.orgId)))
    .run();
  audit(actor, "material.reject", row.id, { rejectNote });
  return { id: row.id };
}

export function fulfillMaterialRequest(actor: Actor, requestId: string, locationId: string) {
  assertOffice(actor);
  const row = requireRequest(actor, requestId);
  if (row.status !== "approved") throw new ServiceError("Approve the request before issuing stock.");
  const lines = loadLines(actor.orgId, row.id);
  if (lines.length === 0 || lines.some((line) => !line.stockItemId)) throw new ServiceError("Order the lines that are not in stock.");
  const place = (locationId || "").trim();
  const known = stockPlaces(actor.orgId).some((item) => item.id === place);
  if (!known) throw new ServiceError("Pick a yard or a truck.");
  for (const line of lines) {
    const balance = getDb()
      .select()
      .from(stockBalances)
      .where(and(eq(stockBalances.orgId, actor.orgId), eq(stockBalances.stockItemId, line.stockItemId!), eq(stockBalances.locationId, place)))
      .get();
    const available = balance ? balance.onHandMilli - balance.allocatedMilli : 0;
    if (available < line.qtyMilli) throw new ServiceError("Not enough in stock.");
  }
  const movements: string[] = [];
  for (const line of lines) {
    const posted = issueStock(actor, {
      stockItemId: line.stockItemId!,
      fromLocationId: place,
      projectId: row.projectId,
      qtyMilli: line.qtyMilli,
      sourceKey: `material:${row.id}:${line.id}`,
    });
    movements.push(posted.id);
    getDb()
      .update(materialRequestLines)
      .set({ movementId: posted.id })
      .where(and(eq(materialRequestLines.id, line.id), eq(materialRequestLines.orgId, actor.orgId)))
      .run();
  }
  const now = nowIso();
  getDb()
    .update(materialRequests)
    .set({ status: "fulfilled", fulfilledAt: now, updatedAt: now })
    .where(and(eq(materialRequests.id, row.id), eq(materialRequests.orgId, actor.orgId)))
    .run();
  audit(actor, "material.fulfill", row.id, { locationId: place, movements });
  return { id: row.id, movementId: movements[0] ?? null };
}

function pricedLines(actor: Actor, lines: LineRow[]) {
  const catalog = stockCatalog(actor.orgId);
  const books = getDb().select().from(priceBookItems).where(eq(priceBookItems.orgId, actor.orgId)).all();
  const byCode = new Map(books.map((row) => [row.code.toUpperCase(), row]));
  return lines.map((line) => {
    const stock = line.stockItemId ? catalog.get(line.stockItemId) : undefined;
    const book = stock?.book ?? (line.costCode ? byCode.get(line.costCode.toUpperCase()) : undefined);
    if (!book) throw new ServiceError("That line needs a cost code on the price book.");
    return {
      costCode: book.code,
      description: line.description,
      qtyMilli: line.qtyMilli,
      unitCostCents: book.unitCostCents,
      amountCents: extendCost(line.qtyMilli, book.unitCostCents),
      sourceKind: "material_request",
      sourceId: line.id,
      note: null as string | null,
    };
  });
}

export function orderMaterialRequest(actor: Actor, requestId: string, vendorContactId: string) {
  assertOffice(actor);
  const row = requireRequest(actor, requestId);
  if (row.status !== "approved") throw new ServiceError("Approve the request before ordering.");
  if (row.purchaseOrderId) throw new ServiceError("That request is already on a purchase order.");
  const vendorId = vendorContactId.trim();
  const vendor = getDb()
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, vendorId), eq(contacts.orgId, actor.orgId)))
    .get();
  if (!vendor || vendor.deletedAt || !VENDOR_TYPES.has(vendor.type)) throw new ServiceError("Pick a vendor.");
  const lines = pricedLines(actor, loadLines(actor.orgId, row.id));
  const drafts = getDb()
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.orgId, actor.orgId))
    .all()
    .filter((order) => order.status === "draft" && order.projectId === row.projectId && order.vendorContactId === vendor.id);
  const existing = drafts[0];
  let saved: { id: string; number: string };
  if (existing) {
    const current = getDb()
      .select()
      .from(purchaseOrderLines)
      .where(and(eq(purchaseOrderLines.orgId, actor.orgId), eq(purchaseOrderLines.purchaseOrderId, existing.id)))
      .all()
      .sort((a, b) => a.sortOrder - b.sortOrder);
    saved = savePurchaseOrder(actor, existing.id, {
      projectId: existing.projectId,
      vendorContactId: existing.vendorContactId,
      scope: existing.scope ?? undefined,
      kind: existing.kind === "work" ? "work" : "purchase",
      lines: [
        ...current.map((line) => ({
          costCode: line.costCode,
          description: line.description ?? undefined,
          qtyMilli: line.qtyMilli,
          unitCostCents: line.unitCostCents,
          amountCents: line.amountCents,
          sourceKind: line.sourceKind,
          sourceId: line.sourceId,
          note: line.note,
        })),
        ...lines,
      ],
    });
  } else {
    saved = createPurchaseOrder(actor, {
      projectId: row.projectId,
      vendorContactId: vendor.id,
      scope: "Material request",
      lines,
    });
  }
  const now = nowIso();
  getDb()
    .update(materialRequests)
    .set({ status: "ordered", purchaseOrderId: saved.id, orderedAt: now, updatedAt: now })
    .where(and(eq(materialRequests.id, row.id), eq(materialRequests.orgId, actor.orgId)))
    .run();
  audit(actor, "material.order", row.id, { purchaseOrderId: saved.id, number: saved.number });
  return { id: row.id, purchaseOrderId: saved.id, number: saved.number };
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

export function materialCsv(actor: Actor) {
  const rows = listMaterialRequests(actor);
  const header = ["Person", "Job", "Status", "Urgency", "Item", "Qty", "PO", "Note"];
  const body = rows.map((row) =>
    [row.personName, row.projectName, row.statusLabel, row.urgencyLabel, row.title, row.qtyLabel, row.purchaseOrderNumber ?? "", row.note ?? row.rejectNote ?? ""].map(csvCell).join(","),
  );
  return [header.join(","), ...body].join("\n");
}
