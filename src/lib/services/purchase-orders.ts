import { and, eq, inArray } from "drizzle-orm";
import { officeDb } from "@/lib/db/office";
import {
  activities,
  billLines,
  bills,
  changeOrders,
  contacts,
  organizations,
  projects,
  purchaseOrderEvents,
  purchaseOrderLines,
  purchaseOrders,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { openCommitmentByCode } from "@/lib/margin/commitment";
import { positiveMoneyError } from "@/lib/money";
import { canManageMoney, canSeeMoney, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

const VENDOR_TYPES = new Set(["sub", "vendor"]);
const RELIEVING = new Set(["approved", "paid"]);

export type PoLineInput = {
  costCode: string;
  amountCents: number;
  description?: string;
};

export type PoInput = {
  projectId: string;
  vendorContactId: string;
  scope?: string;
  changeOrderId?: string | null;
  lines: PoLineInput[];
};

export type PoListFilter = {
  projectId?: string;
  vendorContactId?: string;
  status?: string;
};

export type PurchaseOrderRow = {
  id: string;
  number: string;
  projectId: string;
  projectName: string;
  vendorContactId: string;
  vendorName: string;
  status: string;
  amountCents: number;
  openCents: number;
  issuedAt: string | null;
};

type PoRecord = typeof purchaseOrders.$inferSelect;
type LineRow = typeof purchaseOrderLines.$inferSelect;
type Writer = NonNullable<ReturnType<typeof officeDb>>;

function assertOffice(actor: Actor) {
  if (!canManageMoney(actor.role)) throw new ServiceError("Purchase orders are for the office.");
}

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function companyDb(orgId: string) {
  return officeDb(orgId);
}

function vendorLabel(contact: { name: string; company: string | null }) {
  return contact.company?.trim() || contact.name;
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

function cleanLines(lines: PoLineInput[]) {
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

function cleanScope(scope: string | undefined) {
  const text = scope?.trim() || null;
  if (text && text.length > 2000) throw new ServiceError("Keep the scope note under 2,000 characters.");
  return text;
}

function requireChangeOrder(db: Writer, orgId: string, projectId: string, changeOrderId: string | null | undefined) {
  if (!changeOrderId) return null;
  const order = db
    .select()
    .from(changeOrders)
    .where(and(eq(changeOrders.id, changeOrderId), eq(changeOrders.orgId, orgId)))
    .get();
  if (!order || order.projectId !== projectId) throw new ServiceError("That change order is on a different job.");
  return order.id;
}

function loadPo(db: Writer, orgId: string, poId: string) {
  return db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.orgId, orgId))).get();
}

function loadLines(db: Writer, orgId: string, poId: string) {
  return db
    .select()
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.purchaseOrderId, poId), eq(purchaseOrderLines.orgId, orgId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function nextPoNumber(db: Writer, orgId: string) {
  const rows = db.select({ number: purchaseOrders.number }).from(purchaseOrders).where(eq(purchaseOrders.orgId, orgId)).all();
  let max = 1000;
  for (const row of rows) {
    const match = /^PO-(\d+)$/.exec(row.number);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `PO-${max + 1}`;
}

function lineSnapshot(lines: { costCode: string; amountCents: number; description: string | null }[]) {
  return lines.map((line) => ({ costCode: line.costCode, amountCents: line.amountCents, description: line.description }));
}

function writeEvent(
  db: Writer,
  orgId: string,
  purchaseOrderId: string,
  actorId: string,
  type: string,
  reason: string | null,
  beforeJson: string | null,
  afterJson: string | null,
) {
  db.insert(purchaseOrderEvents)
    .values({
      id: id("poe"),
      orgId,
      purchaseOrderId,
      actorId,
      type,
      reason,
      beforeJson,
      afterJson,
      createdAt: nowIso(),
    })
    .run();
}

function noteActivity(db: Writer, orgId: string, projectId: string, actorId: string, summary: string) {
  db.insert(activities)
    .values({
      id: id("act"),
      orgId,
      entityType: "project",
      entityId: projectId,
      type: "purchase_order",
      actorType: "user",
      actorId,
      summary,
      payloadJson: null,
      createdAt: nowIso(),
    })
    .run();
}

function insertLines(db: Writer, orgId: string, purchaseOrderId: string, lines: ReturnType<typeof cleanLines>) {
  lines.forEach((line, index) => {
    db.insert(purchaseOrderLines)
      .values({
        id: id("pol"),
        orgId,
        purchaseOrderId,
        costCode: line.costCode,
        description: line.description,
        amountCents: line.amountCents,
        sortOrder: index,
      })
      .run();
  });
}

function replaceLines(db: Writer, orgId: string, purchaseOrderId: string, lines: ReturnType<typeof cleanLines>) {
  db.delete(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId), eq(purchaseOrderLines.orgId, orgId)))
    .run();
  insertLines(db, orgId, purchaseOrderId, lines);
}

function relievingLines(db: Writer, orgId: string, purchaseOrderIds: string[]) {
  if (purchaseOrderIds.length === 0) return new Map<string, { costCode: string; amountCents: number }[]>();
  const linked = db
    .select()
    .from(bills)
    .where(and(eq(bills.orgId, orgId), inArray(bills.purchaseOrderId, purchaseOrderIds)))
    .all()
    .filter((bill) => RELIEVING.has(bill.status));
  const ids = linked.map((bill) => bill.id);
  const lines = ids.length
    ? db
        .select()
        .from(billLines)
        .where(and(eq(billLines.orgId, orgId), inArray(billLines.billId, ids)))
        .all()
    : [];
  const byPo = new Map<string, { costCode: string; amountCents: number }[]>();
  for (const bill of linked) {
    if (!bill.purchaseOrderId) continue;
    const list = byPo.get(bill.purchaseOrderId) ?? [];
    for (const line of lines.filter((row) => row.billId === bill.id)) {
      list.push({ costCode: line.costCode, amountCents: line.amountCents });
    }
    byPo.set(bill.purchaseOrderId, list);
  }
  return byPo;
}

function openFor(po: PoRecord, lines: LineRow[], relieved: { costCode: string; amountCents: number }[]) {
  if (po.status !== "issued") return 0;
  return openCommitmentByCode(lines, relieved).reduce((sum, row) => sum + row.amountCents, 0);
}

function hasLiveBill(db: Writer, orgId: string, purchaseOrderId: string) {
  return db
    .select()
    .from(bills)
    .where(and(eq(bills.orgId, orgId), eq(bills.purchaseOrderId, purchaseOrderId)))
    .all()
    .some((bill) => bill.status !== "void");
}

export function createPurchaseOrder(actor: Actor, input: PoInput) {
  assertOffice(actor);
  const db = dbFor(actor);
  const lines = cleanLines(input.lines);
  const scope = cleanScope(input.scope);
  const vendor = requireVendor(db, actor.orgId, input.vendorContactId);
  requireProject(db, actor.orgId, input.projectId);
  const changeOrderId = requireChangeOrder(db, actor.orgId, input.projectId, input.changeOrderId);
  const poId = id("po");
  const now = nowIso();
  let number = "";
  db.transaction((tx) => {
    number = nextPoNumber(tx, actor.orgId);
    tx.insert(purchaseOrders)
      .values({
        id: poId,
        orgId: actor.orgId,
        projectId: input.projectId,
        vendorContactId: vendor.id,
        changeOrderId,
        number,
        scope,
        status: "draft",
        voidReason: null,
        issuedAt: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    insertLines(tx, actor.orgId, poId, lines);
    writeEvent(tx, actor.orgId, poId, actor.userId, "created", null, null, JSON.stringify({ number, scope, lines: lineSnapshot(lines) }));
  });
  return { id: poId, number };
}

export function savePurchaseOrder(actor: Actor, poId: string, input: PoInput) {
  assertOffice(actor);
  const db = dbFor(actor);
  const po = loadPo(db, actor.orgId, poId);
  if (!po) throw new ServiceError("Purchase order not found.");
  if (po.status === "draft") return updateDraft(actor, po, input);
  if (po.status === "issued") return reviseIssued(actor, po, input);
  throw new ServiceError("This purchase order can no longer be edited.");
}

function updateDraft(actor: Actor, po: PoRecord, input: PoInput) {
  const db = dbFor(actor);
  const lines = cleanLines(input.lines);
  const scope = cleanScope(input.scope);
  const vendor = requireVendor(db, actor.orgId, input.vendorContactId);
  requireProject(db, actor.orgId, input.projectId);
  const changeOrderId = requireChangeOrder(db, actor.orgId, input.projectId, input.changeOrderId);
  const before = JSON.stringify({ scope: po.scope, lines: lineSnapshot(loadLines(db, actor.orgId, po.id)) });
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(purchaseOrders)
      .set({
        projectId: input.projectId,
        vendorContactId: vendor.id,
        changeOrderId,
        scope,
        updatedAt: now,
      })
      .where(and(eq(purchaseOrders.id, po.id), eq(purchaseOrders.orgId, actor.orgId)))
      .run();
    replaceLines(tx, actor.orgId, po.id, lines);
    writeEvent(tx, actor.orgId, po.id, actor.userId, "updated", null, before, JSON.stringify({ scope, lines: lineSnapshot(lines) }));
  });
  return { id: po.id, number: po.number };
}

function reviseIssued(actor: Actor, po: PoRecord, input: PoInput) {
  const db = dbFor(actor);
  if (input.projectId !== po.projectId || input.vendorContactId !== po.vendorContactId) {
    throw new ServiceError("An issued purchase order keeps its job and vendor.");
  }
  const lines = cleanLines(input.lines);
  const scope = cleanScope(input.scope);
  const changeOrderId = requireChangeOrder(db, actor.orgId, po.projectId, input.changeOrderId);
  const beforeLines = loadLines(db, actor.orgId, po.id);
  const before = JSON.stringify({ scope: po.scope, changeOrderId: po.changeOrderId, lines: lineSnapshot(beforeLines) });
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(purchaseOrders)
      .set({ scope, changeOrderId, updatedAt: now })
      .where(and(eq(purchaseOrders.id, po.id), eq(purchaseOrders.orgId, actor.orgId)))
      .run();
    replaceLines(tx, actor.orgId, po.id, lines);
    writeEvent(
      tx,
      actor.orgId,
      po.id,
      actor.userId,
      "revised",
      null,
      before,
      JSON.stringify({ scope, changeOrderId, lines: lineSnapshot(lines) }),
    );
    noteActivity(tx, actor.orgId, po.projectId, actor.userId, `Revised ${po.number}. The previous lines stay in the history.`);
  });
  return { id: po.id, number: po.number };
}

export function issuePurchaseOrder(actor: Actor, poId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const po = loadPo(db, actor.orgId, poId);
  if (!po) throw new ServiceError("Purchase order not found.");
  if (po.status === "issued") return { id: po.id, number: po.number };
  if (po.status !== "draft") throw new ServiceError("Only a draft can be issued.");
  const lines = loadLines(db, actor.orgId, po.id);
  if (lines.length === 0) throw new ServiceError("Add a line before issuing.");
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(purchaseOrders)
      .set({ status: "issued", issuedAt: now, updatedAt: now })
      .where(and(eq(purchaseOrders.id, po.id), eq(purchaseOrders.orgId, actor.orgId)))
      .run();
    writeEvent(tx, actor.orgId, po.id, actor.userId, "issued", null, JSON.stringify({ status: "draft" }), JSON.stringify({ status: "issued", lines: lineSnapshot(lines) }));
    noteActivity(tx, actor.orgId, po.projectId, actor.userId, `Issued ${po.number}. Nothing was sent to the vendor.`);
  });
  return { id: po.id, number: po.number };
}

export function closePurchaseOrder(actor: Actor, poId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const po = loadPo(db, actor.orgId, poId);
  if (!po) throw new ServiceError("Purchase order not found.");
  if (po.status === "closed") return { id: po.id, number: po.number };
  if (po.status !== "issued") throw new ServiceError("Only an issued purchase order can be closed.");
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(purchaseOrders)
      .set({ status: "closed", closedAt: now, updatedAt: now })
      .where(and(eq(purchaseOrders.id, po.id), eq(purchaseOrders.orgId, actor.orgId)))
      .run();
    writeEvent(tx, actor.orgId, po.id, actor.userId, "closed", null, JSON.stringify({ status: "issued" }), JSON.stringify({ status: "closed" }));
    noteActivity(tx, actor.orgId, po.projectId, actor.userId, `Closed ${po.number}. Unbilled balance is no longer committed.`);
  });
  return { id: po.id, number: po.number };
}

export function voidPurchaseOrder(actor: Actor, poId: string, reason: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const po = loadPo(db, actor.orgId, poId);
  if (!po) throw new ServiceError("Purchase order not found.");
  if (po.status === "void") throw new ServiceError("This purchase order is already void.");
  const why = reason.trim();
  if (why.length < 2) throw new ServiceError("Enter a reason for voiding this purchase order.");
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(purchaseOrders)
      .set({ status: "void", voidReason: why, updatedAt: now })
      .where(and(eq(purchaseOrders.id, po.id), eq(purchaseOrders.orgId, actor.orgId)))
      .run();
    writeEvent(tx, actor.orgId, po.id, actor.userId, "voided", why, JSON.stringify({ status: po.status }), JSON.stringify({ status: "void" }));
    noteActivity(tx, actor.orgId, po.projectId, actor.userId, `Voided ${po.number}. ${why}`);
  });
  return { id: po.id, number: po.number };
}

function orgToday(orgId: string, now: number) {
  const db = companyDb(orgId);
  if (!db) return null;
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) return null;
  return { db, today: localDay(now, org.timeZone), timeZone: org.timeZone };
}

function nameMaps(db: Writer, orgId: string) {
  const contactsById = new Map(
    db
      .select()
      .from(contacts)
      .where(eq(contacts.orgId, orgId))
      .all()
      .map((row) => [row.id, row]),
  );
  const jobs = new Map(
    db
      .select()
      .from(projects)
      .where(eq(projects.orgId, orgId))
      .all()
      .map((row) => [row.id, row.name]),
  );
  return { contactsById, jobs };
}

function toRow(
  po: PoRecord,
  lines: LineRow[],
  relieved: { costCode: string; amountCents: number }[],
  names: ReturnType<typeof nameMaps>,
): PurchaseOrderRow {
  const contact = names.contactsById.get(po.vendorContactId);
  return {
    id: po.id,
    number: po.number,
    projectId: po.projectId,
    projectName: names.jobs.get(po.projectId) ?? "Job",
    vendorContactId: po.vendorContactId,
    vendorName: contact ? vendorLabel(contact) : "Vendor",
    status: po.status,
    amountCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
    openCents: openFor(po, lines, relieved),
    issuedAt: po.issuedAt,
  };
}

export function listPurchaseOrders(orgId: string, role: Role, filter: PoListFilter = {}): PurchaseOrderRow[] {
  if (!canSeeMoney(role)) return [];
  const db = companyDb(orgId);
  if (!db) return [];
  const orders = db.select().from(purchaseOrders).where(eq(purchaseOrders.orgId, orgId)).all();
  const lines = db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orgId, orgId)).all();
  const relieved = relievingLines(
    db,
    orgId,
    orders.map((order) => order.id),
  );
  const names = nameMaps(db, orgId);
  return orders
    .map((order) => toRow(order, lines.filter((line) => line.purchaseOrderId === order.id), relieved.get(order.id) ?? [], names))
    .filter((order) => {
      if (filter.projectId && order.projectId !== filter.projectId) return false;
      if (filter.vendorContactId && order.vendorContactId !== filter.vendorContactId) return false;
      if (filter.status && filter.status !== "all" && order.status !== filter.status) return false;
      return true;
    })
    .sort((a, b) => b.number.localeCompare(a.number));
}

export function projectPurchaseOrders(orgId: string, projectId: string, role: Role) {
  return listPurchaseOrders(orgId, role, { projectId });
}

export function purchaseOrderDetail(orgId: string, poId: string, role: Role) {
  if (!canSeeMoney(role)) return null;
  const db = companyDb(orgId);
  if (!db) return null;
  const po = loadPo(db, orgId, poId);
  if (!po) return null;
  const lines = loadLines(db, orgId, po.id);
  const relieved = relievingLines(db, orgId, [po.id]).get(po.id) ?? [];
  const names = nameMaps(db, orgId);
  const events = db
    .select()
    .from(purchaseOrderEvents)
    .where(and(eq(purchaseOrderEvents.purchaseOrderId, po.id), eq(purchaseOrderEvents.orgId, orgId)))
    .all()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const changeOrder = po.changeOrderId
    ? db.select().from(changeOrders).where(and(eq(changeOrders.id, po.changeOrderId), eq(changeOrders.orgId, orgId))).get()
    : undefined;
  return {
    po: toRow(po, lines, relieved, names),
    scope: po.scope,
    voidReason: po.voidReason,
    changeOrderId: po.changeOrderId,
    changeOrderLabel: changeOrder ? `CO ${changeOrder.number} · ${changeOrder.title}` : null,
    lines,
    events,
  };
}

/** Open commitment on issued purchase orders, per job and cost code. Closed, void, and draft contribute nothing. */
export function openCommitments(orgId: string, projectIds: string[]) {
  if (projectIds.length === 0) return [];
  const db = companyDb(orgId);
  if (!db) return [];
  const orders = db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.orgId, orgId), inArray(purchaseOrders.projectId, projectIds), eq(purchaseOrders.status, "issued")))
    .all();
  if (orders.length === 0) return [];
  const ids = orders.map((order) => order.id);
  const lines = db
    .select()
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.orgId, orgId), inArray(purchaseOrderLines.purchaseOrderId, ids)))
    .all();
  const relieved = relievingLines(db, orgId, ids);
  const rows: { projectId: string; costCode: string; amountCents: number }[] = [];
  for (const order of orders) {
    const open = openCommitmentByCode(
      lines.filter((line) => line.purchaseOrderId === order.id),
      relieved.get(order.id) ?? [],
    );
    for (const row of open) rows.push({ projectId: order.projectId, costCode: row.costCode, amountCents: row.amountCents });
  }
  return rows;
}

export function vendorCommitmentTotals(orgId: string) {
  const totals = new Map<string, { committedCents: number; openBalanceCents: number }>();
  const db = companyDb(orgId);
  if (!db) return totals;
  const orders = db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.status, "issued")))
    .all();
  if (orders.length === 0) return totals;
  const ids = orders.map((order) => order.id);
  const lines = db
    .select()
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.orgId, orgId), inArray(purchaseOrderLines.purchaseOrderId, ids)))
    .all();
  const relieved = relievingLines(db, orgId, ids);
  for (const order of orders) {
    const orderLines = lines.filter((line) => line.purchaseOrderId === order.id);
    const current = totals.get(order.vendorContactId) ?? { committedCents: 0, openBalanceCents: 0 };
    current.committedCents += orderLines.reduce((sum, line) => sum + line.amountCents, 0);
    current.openBalanceCents += openFor(order, orderLines, relieved.get(order.id) ?? []);
    totals.set(order.vendorContactId, current);
  }
  return totals;
}

export function listLinkablePurchaseOrders(orgId: string, role: Role) {
  if (!canSeeMoney(role)) return [];
  return listPurchaseOrders(orgId, role).filter((order) => order.status === "issued" || order.status === "closed");
}

export function changeOrderChoices(orgId: string) {
  const db = companyDb(orgId);
  if (!db) return [];
  const orders = db.select().from(changeOrders).where(eq(changeOrders.orgId, orgId)).all();
  const jobs = new Map(
    db
      .select()
      .from(projects)
      .where(eq(projects.orgId, orgId))
      .all()
      .map((row) => [row.id, row.name]),
  );
  return orders
    .map((order) => ({
      id: order.id,
      projectId: order.projectId,
      label: `CO ${order.number} · ${order.title} · ${jobs.get(order.projectId) ?? "Job"}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Issued purchase orders with no non-void bill, once the issue day is 30 company-local days old. */
export function stalePurchaseOrders(orgId: string, role: Role, now = Date.now()): PurchaseOrderRow[] {
  if (!canSeeMoney(role)) return [];
  const scoped = orgToday(orgId, now);
  if (!scoped) return [];
  const cutoff = addCalendarDays(scoped.today, -30);
  return listPurchaseOrders(orgId, role, { status: "issued" }).filter((order) => {
    if (!order.issuedAt) return false;
    const issuedOn = localDay(Date.parse(order.issuedAt), scoped.timeZone);
    if (issuedOn > cutoff) return false;
    return !hasLiveBill(scoped.db, orgId, order.id);
  });
}
