import { and, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { officeDb } from "@/lib/db/office";
import { auditLogs, savedViewPins, savedViews } from "@/lib/db/schema";
import type { AppDatabase } from "@/lib/db/client";
import { id, nowIso } from "@/lib/ids";
import { writeQuery } from "@/lib/lists/query";
import { canEditCrm, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";

export const LIST_FILTERS: Record<string, string[]> = {
  todos: ["assignee", "job", "priority", "due", "status", "q"],
  rfis: ["job", "assignee", "status", "overdue", "q"],
  bills: ["job", "vendor", "status", "q"],
  "purchase-orders": ["job", "vendor", "status", "q"],
  wip: ["asof", "pm", "status", "q"],
  contacts: ["type", "q"],
  leads: ["source", "q"],
  inbox: ["filter", "q"],
  jobs: ["group", "q"],
};

export const LIST_PATH: Record<string, string> = {
  todos: "/todos",
  rfis: "/rfis",
  bills: "/bills",
  "purchase-orders": "/purchase-orders",
  wip: "/reports/wip",
  contacts: "/contacts",
  leads: "/pipeline",
  inbox: "/inbox",
  jobs: "/projects",
};

export type SavedView = {
  id: string;
  listKey: string;
  name: string;
  query: Record<string, string>;
  sortKey: string | null;
  sortDir: "asc" | "desc" | null;
  shared: boolean;
  mine: boolean;
  pinned: boolean;
  ownerId: string;
};

export type ViewInput = {
  list: string;
  name: string;
  query: Record<string, string>;
  sortKey?: string | null;
  sortDir?: string | null;
  shared?: boolean;
};

function dbFor(actor: Actor): AppDatabase {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function audit(db: AppDatabase, actor: Actor, action: string, entityId: string, payload: Record<string, unknown>) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action,
      entityType: "saved_view",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

export function listKey(value: string): string {
  if (!LIST_FILTERS[value]) throw new ServiceError("That list is not saved.");
  return value;
}

export function cleanViewQuery(list: string, input: Record<string, string>): Record<string, string> {
  const allow = new Set(LIST_FILTERS[list] ?? []);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allow.has(key) || typeof value !== "string") continue;
    const text = value.trim().slice(0, 80);
    if (text) out[key] = text;
  }
  return out;
}

function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 40) throw new ServiceError("Add a name.");
  return name;
}

function cleanSort(list: string, sortKey: string | null | undefined, sortDir: string | null | undefined) {
  const key = (sortKey || "").trim().slice(0, 16);
  const dir = sortDir === "desc" ? "desc" : sortDir === "asc" ? "asc" : null;
  if (!key || !/^[a-z]+$/.test(key)) return { sortKey: null, sortDir: null };
  if (!LIST_FILTERS[list]) return { sortKey: null, sortDir: null };
  return { sortKey: key, sortDir: dir ?? "asc" };
}

function parseQuery(raw: string, list: string): Record<string, string> {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string") out[key] = item;
    }
    return cleanViewQuery(list, out);
  } catch {
    return {};
  }
}

function visibleRows(db: AppDatabase, actor: Actor, list: string) {
  return db
    .select()
    .from(savedViews)
    .where(and(eq(savedViews.orgId, actor.orgId), eq(savedViews.listKey, list)))
    .all()
    .filter((row) => row.userId === actor.userId || row.shared === 1);
}

function present(row: typeof savedViews.$inferSelect, actor: Actor, pinId: string | null): SavedView {
  const sortDir = row.sortDir === "asc" || row.sortDir === "desc" ? row.sortDir : null;
  return {
    id: row.id,
    listKey: row.listKey,
    name: row.name,
    query: parseQuery(row.queryJson, row.listKey),
    sortKey: row.sortKey,
    sortDir,
    shared: row.shared === 1,
    mine: row.userId === actor.userId,
    pinned: pinId === row.id,
    ownerId: row.userId,
  };
}

export function listSavedViews(actor: Actor, list: string): SavedView[] {
  if (!LIST_FILTERS[list]) return [];
  const db = officeDb(actor.orgId);
  if (!db) return [];
  const pin = db
    .select()
    .from(savedViewPins)
    .where(and(eq(savedViewPins.orgId, actor.orgId), eq(savedViewPins.userId, actor.userId), eq(savedViewPins.listKey, list)))
    .get();
  return visibleRows(db, actor, list)
    .map((row) => present(row, actor, pin?.viewId ?? null))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function viewHref(view: Pick<SavedView, "listKey" | "id" | "query" | "sortKey" | "sortDir">): string {
  return writeQuery(LIST_PATH[view.listKey] || "/", {
    ...view.query,
    view: view.id,
    ...(view.sortKey ? { sort: view.sortKey } : {}),
    ...(view.sortDir ? { dir: view.sortDir } : {}),
  });
}

function loadVisible(db: AppDatabase, actor: Actor, viewId: string) {
  const row = db.select().from(savedViews).where(and(eq(savedViews.id, viewId), eq(savedViews.orgId, actor.orgId))).get();
  if (!row || (row.userId !== actor.userId && row.shared !== 1)) throw new ServiceError("That view is not in your company.");
  return row;
}

export function saveView(actor: Actor, input: ViewInput): SavedView {
  const list = listKey(input.list);
  const db = dbFor(actor);
  const shared = Boolean(input.shared);
  if (shared && !canEditCrm(actor.role as Role)) throw new ServiceError("Office can share a view.");
  const name = cleanName(input.name);
  const query = cleanViewQuery(list, input.query);
  const sort = cleanSort(list, input.sortKey, input.sortDir);
  const now = nowIso();
  const viewId = id("view");
  db.insert(savedViews)
    .values({
      id: viewId,
      orgId: actor.orgId,
      userId: actor.userId,
      listKey: list,
      name,
      queryJson: JSON.stringify(query),
      sortKey: sort.sortKey,
      sortDir: sort.sortDir,
      shared: shared ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  audit(db, actor, "view.create", viewId, { list, name, query, shared });
  return present(loadVisible(db, actor, viewId), actor, null);
}

export function renameView(actor: Actor, viewId: string, name: string): SavedView {
  const db = dbFor(actor);
  const row = loadVisible(db, actor, viewId);
  if (row.userId !== actor.userId) throw new ServiceError("That view is not yours.");
  const next = cleanName(name);
  db.update(savedViews)
    .set({ name: next, updatedAt: nowIso() })
    .where(and(eq(savedViews.id, viewId), eq(savedViews.orgId, actor.orgId)))
    .run();
  audit(db, actor, "view.rename", viewId, { name: next });
  return present(loadVisible(db, actor, viewId), actor, null);
}

export function deleteView(actor: Actor, viewId: string) {
  const db = dbFor(actor);
  const row = loadVisible(db, actor, viewId);
  if (row.userId !== actor.userId) throw new ServiceError("That view is not yours.");
  db.delete(savedViewPins).where(and(eq(savedViewPins.orgId, actor.orgId), eq(savedViewPins.viewId, viewId))).run();
  db.delete(savedViews).where(and(eq(savedViews.id, viewId), eq(savedViews.orgId, actor.orgId))).run();
  audit(db, actor, "view.delete", viewId, { name: row.name, list: row.listKey });
}

export function pinView(actor: Actor, viewId: string): SavedView {
  const db = dbFor(actor);
  const row = loadVisible(db, actor, viewId);
  db.delete(savedViewPins)
    .where(and(eq(savedViewPins.orgId, actor.orgId), eq(savedViewPins.userId, actor.userId), eq(savedViewPins.listKey, row.listKey)))
    .run();
  db.insert(savedViewPins)
    .values({ id: id("pin"), orgId: actor.orgId, userId: actor.userId, listKey: row.listKey, viewId: row.id })
    .run();
  audit(db, actor, "view.pin", viewId, { list: row.listKey });
  return present(row, actor, row.id);
}

export function unpinView(actor: Actor, viewId: string): SavedView {
  const db = dbFor(actor);
  const row = loadVisible(db, actor, viewId);
  db.delete(savedViewPins)
    .where(and(eq(savedViewPins.orgId, actor.orgId), eq(savedViewPins.userId, actor.userId), eq(savedViewPins.listKey, row.listKey), eq(savedViewPins.viewId, viewId)))
    .run();
  audit(db, actor, "view.unpin", viewId, { list: row.listKey });
  return present(row, actor, null);
}

export function shareView(actor: Actor, viewId: string, shared: boolean): SavedView {
  const db = dbFor(actor);
  const row = loadVisible(db, actor, viewId);
  if (row.userId !== actor.userId) throw new ServiceError("That view is not yours.");
  if (shared && !canEditCrm(actor.role as Role)) throw new ServiceError("Office can share a view.");
  db.update(savedViews)
    .set({ shared: shared ? 1 : 0, updatedAt: nowIso() })
    .where(and(eq(savedViews.id, viewId), eq(savedViews.orgId, actor.orgId)))
    .run();
  audit(db, actor, "view.share", viewId, { shared });
  return present(loadVisible(db, actor, viewId), actor, null);
}

export function savedViewsPolicy(): boolean {
  const sql = readFileSync("supabase/rls.sql", "utf8");
  return sql.includes("saved_views_scope") && sql.includes("saved_view_pins_scope");
}
