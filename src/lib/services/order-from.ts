import { and, eq } from "drizzle-orm";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  budgetLines,
  changeOrderLines,
  changeOrders,
  contacts,
  memberships,
  notifications,
  projects,
  purchaseOrderEvents,
  purchaseOrderLines,
  purchaseOrders,
  selectionChoices,
  selections,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canManageMoney, type Role } from "@/lib/permissions";
import {
  budgetRemainder,
  committedByCode,
  coveredSourceIds,
  isStale,
  lineAmountCents,
  PO_STALE_DAYS,
  selectionSourceId,
  type CoverRow,
} from "@/lib/purchasing/cover";
import { ServiceError } from "@/lib/services/errors";
import { createPurchaseOrder, type PoLineInput } from "@/lib/services/purchase-orders";
import type { Actor } from "@/lib/services/read";

const OPEN = new Set(["draft", "issued"]);
const LIVE = new Set(["draft", "issued", "closed"]);
const VENDOR_TYPES = new Set(["sub", "vendor"]);

export type OrderSourceKind = "selection" | "change_order_line" | "budget_line";

export type OrderRequest = {
  sourceKind: OrderSourceKind;
  sourceIds: string[];
  vendorContactId?: string;
  purchaseOrderId?: string;
  kind?: "purchase" | "work";
};

export type OrderResult = {
  orders: { id: string; number: string; added: number; projectId: string }[];
};

type Wanted = {
  sourceKind: OrderSourceKind;
  sourceId: string;
  projectId: string;
  vendorContactId: string | null;
  line: PoLineInput;
};

type Writer = NonNullable<ReturnType<typeof officeDb>>;

function assertOffice(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Purchase orders are for the office.");
}

function dbFor(orgId: string) {
  const db = officeDb(orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function vendorName(contact: { name: string; company: string | null }) {
  return contact.company?.trim() || contact.name;
}

function coverRows(db: Writer, orgId: string): CoverRow[] {
  const orders = db.select().from(purchaseOrders).where(eq(purchaseOrders.orgId, orgId)).all();
  const byId = new Map(orders.map((order) => [order.id, order]));
  return db
    .select()
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.orgId, orgId))
    .all()
    .flatMap((line) => {
      const order = byId.get(line.purchaseOrderId);
      if (!order) return [];
      return [
        {
          sourceKind: line.sourceKind,
          sourceId: line.sourceId,
          status: order.status,
          projectId: order.projectId,
          costCode: line.costCode,
          amountCents: line.amountCents,
        },
      ];
    });
}

function matchVendor(db: Writer, orgId: string, label: string | null) {
  const needle = label?.trim().toLowerCase() ?? "";
  if (!needle) return null;
  return (
    db
      .select()
      .from(contacts)
      .where(eq(contacts.orgId, orgId))
      .all()
      .find(
        (contact) =>
          !contact.deletedAt &&
          VENDOR_TYPES.has(contact.type) &&
          (contact.company?.trim().toLowerCase() === needle || contact.name.trim().toLowerCase() === needle),
      ) ?? null
  );
}

function audit(db: Writer, actor: Actor, action: string, purchaseOrderId: string, payload: Record<string, unknown>) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action,
      entityType: "purchase_order",
      entityId: purchaseOrderId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function resolveSelections(db: Writer, orgId: string, ids: string[]): Wanted[] {
  const wanted: Wanted[] = [];
  for (const selectionId of ids) {
    const selection = db.select().from(selections).where(and(eq(selections.id, selectionId), eq(selections.orgId, orgId))).get();
    if (!selection) throw new ServiceError("Selection not found.");
    if (selection.status !== "chosen" && selection.status !== "locked") throw new ServiceError("That selection is not approved.");
    if (!selection.chosenChoiceId) throw new ServiceError("That selection is not approved.");
    const choice = db
      .select()
      .from(selectionChoices)
      .where(and(eq(selectionChoices.id, selection.chosenChoiceId), eq(selectionChoices.orgId, orgId)))
      .get();
    if (!choice) throw new ServiceError("That selection is not approved.");
    const allowance = selection.allowanceBudgetLineId
      ? db
          .select()
          .from(budgetLines)
          .where(and(eq(budgetLines.id, selection.allowanceBudgetLineId), eq(budgetLines.orgId, orgId), eq(budgetLines.projectId, selection.projectId)))
          .get()
      : undefined;
    const costCode = allowance?.costCode?.trim() ?? "";
    if (!costCode) throw new ServiceError("That selection has no cost code.");
    const amountCents = lineAmountCents(selection.qtyMilli, choice.unitCostCents);
    if (amountCents <= 0) throw new ServiceError("Nothing to order.");
    const vendor = matchVendor(db, orgId, choice.vendor);
    wanted.push({
      sourceKind: "selection",
      sourceId: selectionSourceId(selection.id, choice.id),
      projectId: selection.projectId,
      vendorContactId: vendor?.id ?? null,
      line: {
        costCode,
        amountCents,
        description: choice.name,
        qtyMilli: selection.qtyMilli,
        unitCostCents: choice.unitCostCents,
        sourceKind: "selection",
        sourceId: selectionSourceId(selection.id, choice.id),
        note: `Selection ${selection.title}`,
      },
    });
  }
  return wanted;
}

function resolveChangeOrders(db: Writer, orgId: string, ids: string[]): Wanted[] {
  const wanted: Wanted[] = [];
  for (const lineId of ids) {
    const line = db.select().from(changeOrderLines).where(and(eq(changeOrderLines.id, lineId), eq(changeOrderLines.orgId, orgId))).get();
    if (!line) throw new ServiceError("Change order line not found.");
    const order = db.select().from(changeOrders).where(and(eq(changeOrders.id, line.changeOrderId), eq(changeOrders.orgId, orgId))).get();
    if (!order || order.status !== "approved") throw new ServiceError("That change order is not approved.");
    const costCode = line.costCode?.trim() ?? "";
    if (!costCode || line.qtyMilli <= 0 || line.unitCostCents <= 0) throw new ServiceError("Nothing to order.");
    const amountCents = lineAmountCents(line.qtyMilli, line.unitCostCents);
    if (amountCents <= 0) throw new ServiceError("Nothing to order.");
    wanted.push({
      sourceKind: "change_order_line",
      sourceId: line.id,
      projectId: order.projectId,
      vendorContactId: null,
      line: {
        costCode,
        amountCents,
        description: line.name,
        qtyMilli: line.qtyMilli,
        unitCostCents: line.unitCostCents,
        sourceKind: "change_order_line",
        sourceId: line.id,
        note: `CO ${order.number} ${order.title}`,
      },
    });
  }
  return wanted;
}

function resolveBudget(db: Writer, orgId: string, ids: string[]): Wanted[] {
  const rows = coverRows(db, orgId);
  const sourced = coveredSourceIds(rows, "budget_line", LIVE);
  const wanted: Wanted[] = [];
  for (const lineId of ids) {
    const line = db.select().from(budgetLines).where(and(eq(budgetLines.id, lineId), eq(budgetLines.orgId, orgId))).get();
    if (!line) throw new ServiceError("Budget line not found.");
    if (sourced.has(line.id)) continue;
    const costCode = line.costCode?.trim().toUpperCase() ?? "";
    if (!costCode) throw new ServiceError("That budget line has no cost code.");
    const committed = committedByCode(rows, line.projectId).get(costCode) ?? 0;
    const remainder = budgetRemainder(line.budgetCostCents, committed);
    if (remainder <= 0) continue;
    wanted.push({
      sourceKind: "budget_line",
      sourceId: line.id,
      projectId: line.projectId,
      vendorContactId: null,
      line: {
        costCode,
        amountCents: remainder,
        description: line.name,
        qtyMilli: 1000,
        unitCostCents: remainder,
        sourceKind: "budget_line",
        sourceId: line.id,
        note: `Budget ${line.name}`,
      },
    });
  }
  return wanted;
}

function resolve(db: Writer, orgId: string, kind: OrderSourceKind, ids: string[]) {
  if (kind === "selection") return resolveSelections(db, orgId, ids);
  if (kind === "change_order_line") return resolveChangeOrders(db, orgId, ids);
  return resolveBudget(db, orgId, ids);
}

function ordersCovering(db: Writer, orgId: string, sourceIds: Set<string>) {
  if (sourceIds.size === 0) return [];
  const lines = db
    .select()
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.orgId, orgId))
    .all()
    .filter((line) => sourceIds.has(line.sourceId));
  const ids = [...new Set(lines.map((line) => line.purchaseOrderId))];
  return db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.orgId, orgId))
    .all()
    .filter((order) => ids.includes(order.id) && order.status !== "void");
}

function appendLines(db: Writer, actor: Actor, purchaseOrderId: string, lines: PoLineInput[]) {
  const existing = db
    .select()
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId), eq(purchaseOrderLines.orgId, actor.orgId)))
    .all();
  const start = existing.reduce((max, line) => Math.max(max, line.sortOrder), -1) + 1;
  lines.forEach((line, index) => {
    db.insert(purchaseOrderLines)
      .values({
        id: id("pol"),
        orgId: actor.orgId,
        purchaseOrderId,
        costCode: line.costCode.trim().toUpperCase(),
        description: line.description?.trim() || null,
        amountCents: line.amountCents,
        sortOrder: start + index,
        qtyMilli: line.qtyMilli ?? null,
        unitCostCents: line.unitCostCents ?? null,
        sourceKind: line.sourceKind || "",
        sourceId: line.sourceId || "",
        note: line.note?.trim() || null,
      })
      .run();
  });
  const now = nowIso();
  db.update(purchaseOrders)
    .set({ updatedAt: now })
    .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.orgId, actor.orgId)))
    .run();
  db.insert(purchaseOrderEvents)
    .values({
      id: id("poe"),
      orgId: actor.orgId,
      purchaseOrderId,
      actorId: actor.userId,
      type: "lines_added",
      reason: null,
      beforeJson: null,
      afterJson: JSON.stringify({ added: lines.length }),
      createdAt: now,
    })
    .run();
}

export function createOrdersFrom(actor: Actor, input: OrderRequest): OrderResult {
  assertOffice(actor);
  const ids = [...new Set(input.sourceIds.map((value) => value.trim()).filter(Boolean))];
  if (ids.length === 0) throw new ServiceError("Select a line.");
  const db = dbFor(actor.orgId);
  const wanted = resolve(db, actor.orgId, input.sourceKind, ids);
  if (wanted.length === 0) throw new ServiceError("Nothing to order.");
  const covered = coveredSourceIds(coverRows(db, actor.orgId), input.sourceKind, LIVE);
  const fresh = wanted.filter((row) => !covered.has(row.sourceId));
  if (fresh.length === 0) {
    const existing = ordersCovering(db, actor.orgId, new Set(wanted.map((row) => row.sourceId)));
    return { orders: existing.map((order) => ({ id: order.id, number: order.number, added: 0, projectId: order.projectId })) };
  }
  const override = input.vendorContactId?.trim() || "";
  const kind = input.kind === "work" ? "work" : "purchase";
  if (input.purchaseOrderId) {
    const po = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, input.purchaseOrderId), eq(purchaseOrders.orgId, actor.orgId))).get();
    if (!po || po.status !== "draft") throw new ServiceError("Pick a draft.");
    if (fresh.some((row) => row.projectId !== po.projectId)) throw new ServiceError("That draft is on a different job.");
    if (override && override !== po.vendorContactId) throw new ServiceError("That draft is for a different vendor.");
    appendLines(db, actor, po.id, fresh.map((row) => row.line));
    audit(db, actor, "po.add", po.id, { number: po.number, added: fresh.length, kind: po.kind });
    if (po.kind === "work") audit(db, actor, "po.work_order", po.id, { number: po.number, added: fresh.length });
    return { orders: [{ id: po.id, number: po.number, added: fresh.length, projectId: po.projectId }] };
  }
  const groups = new Map<string, Wanted[]>();
  for (const row of fresh) {
    const vendorId = override || row.vendorContactId;
    if (!vendorId) throw new ServiceError("Pick a vendor.");
    const key = `${row.projectId}:${vendorId}`;
    const list = groups.get(key) ?? [];
    list.push({ ...row, vendorContactId: vendorId });
    groups.set(key, list);
  }
  const orders: OrderResult["orders"] = [];
  for (const [key, rows] of groups) {
    const [projectId, vendorContactId] = key.split(":");
    const created = createPurchaseOrder(actor, {
      projectId: projectId!,
      vendorContactId: vendorContactId!,
      kind,
      scope: rows.map((row) => row.line.note).filter(Boolean).join("\n"),
      lines: rows.map((row) => row.line),
    });
    const action = kind === "work" ? "po.work_order" : "po.create";
    audit(db, actor, action, created.id, { number: created.number, added: rows.length, kind });
    orders.push({ id: created.id, number: created.number, added: rows.length, projectId: projectId! });
  }
  return { orders };
}

export function orderedSourceIds(orgId: string, sourceKind: OrderSourceKind) {
  const db = officeDb(orgId);
  if (!db) return new Set<string>();
  return coveredSourceIds(coverRows(db, orgId), sourceKind, LIVE);
}

export function orderDesk(orgId: string, projectId: string) {
  const db = officeDb(orgId);
  if (!db) return { vendors: [], drafts: [] as { id: string; number: string; label: string }[] };
  const people = db
    .select()
    .from(contacts)
    .where(eq(contacts.orgId, orgId))
    .all()
    .filter((contact) => !contact.deletedAt && VENDOR_TYPES.has(contact.type))
    .map((contact) => ({ id: contact.id, name: vendorName(contact) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const names = new Map(people.map((person) => [person.id, person.name]));
  const drafts = db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.projectId, projectId), eq(purchaseOrders.status, "draft")))
    .all()
    .map((order) => ({ id: order.id, number: order.number, label: `${order.number} · ${names.get(order.vendorContactId) ?? "Vendor"}` }))
    .sort((a, b) => a.number.localeCompare(b.number));
  return { vendors: people, drafts };
}

export function budgetCandidates(orgId: string, projectId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  const rows = coverRows(db, orgId);
  const sourced = coveredSourceIds(rows, "budget_line", LIVE);
  const committed = committedByCode(rows, projectId);
  return db
    .select()
    .from(budgetLines)
    .where(and(eq(budgetLines.orgId, orgId), eq(budgetLines.projectId, projectId)))
    .all()
    .filter((line) => {
      const code = line.costCode?.trim().toUpperCase() ?? "";
      if (!code || sourced.has(line.id)) return false;
      return budgetRemainder(line.budgetCostCents, committed.get(code) ?? 0) > 0;
    })
    .map((line) => ({ id: line.id, label: line.name, ordered: false }));
}

export function changeOrderCandidates(orgId: string, orderId: string) {
  const db = officeDb(orgId);
  if (!db) return { projectId: "", rows: [] as { id: string; label: string; ordered: boolean }[] };
  const order = db.select().from(changeOrders).where(and(eq(changeOrders.id, orderId), eq(changeOrders.orgId, orgId))).get();
  if (!order || order.status !== "approved") return { projectId: order?.projectId ?? "", rows: [] };
  const covered = coveredSourceIds(coverRows(db, orgId), "change_order_line", LIVE);
  const rows = db
    .select()
    .from(changeOrderLines)
    .where(and(eq(changeOrderLines.changeOrderId, order.id), eq(changeOrderLines.orgId, orgId)))
    .all()
    .filter((line) => (line.costCode?.trim() ?? "") && line.qtyMilli > 0 && line.unitCostCents > 0 && lineAmountCents(line.qtyMilli, line.unitCostCents) > 0)
    .map((line) => ({ id: line.id, label: line.name, ordered: covered.has(line.id) }));
  return { projectId: order.projectId, rows };
}

export function selectionsNeedingPo(orgId: string, now = Date.now()) {
  const db = officeDb(orgId);
  if (!db) return [];
  const open = coveredSourceIds(coverRows(db, orgId), "selection", OPEN);
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row.name]));
  return db
    .select()
    .from(selections)
    .where(eq(selections.orgId, orgId))
    .all()
    .filter((row) => (row.status === "chosen" || row.status === "locked") && row.chosenChoiceId && isStale(row.updatedAt, now) && !open.has(selectionSourceId(row.id, row.chosenChoiceId)))
    .map((row) => ({
      id: row.id,
      projectId: row.projectId,
      projectName: jobs.get(row.projectId) ?? "Job",
      title: row.title,
      href: `/projects/${row.projectId}/selections`,
    }));
}

export function notifySelectionNeedsPo(orgId: string, selectionId: string, actorName: string) {
  const db = officeDb(orgId);
  if (!db) return;
  const selection = db.select().from(selections).where(and(eq(selections.id, selectionId), eq(selections.orgId, orgId))).get();
  if (!selection?.chosenChoiceId) return;
  const open = coveredSourceIds(coverRows(db, orgId), "selection", OPEN);
  if (open.has(selectionSourceId(selection.id, selection.chosenChoiceId))) return;
  const members = db.select().from(memberships).where(eq(memberships.orgId, orgId)).all();
  const now = nowIso();
  for (const member of members) {
    if (member.role !== "owner" && member.role !== "admin") continue;
    db.insert(notifications)
      .values({
        id: id("note"),
        orgId,
        userId: member.userId,
        kind: "selection",
        commentId: null,
        entityType: "selection",
        entityId: selection.id,
        projectId: selection.projectId,
        actorId: null,
        actorName,
        snippet: `${selection.title} needs a purchase order`,
        readAt: null,
        createdAt: now,
      })
      .run();
  }
}

export { PO_STALE_DAYS };
