import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { dashboardRoles, dashboardTiles, dashboards, savedReports } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canManageSettings } from "@/lib/permissions";
import { BUILTINS, builtinById } from "@/lib/reports/catalog";
import { formatAgg, type ReportQuery } from "@/lib/reports/engine";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { openBuiltin, openSaved } from "@/lib/services/reports";

export type TileKind = "number" | "list" | "chart";

export type TileConfig = {
  metric: "count" | "sum" | "avg";
  metricColumn: string;
  filters: ReportQuery["filters"];
};

export type DashTile = {
  id: string;
  title: string;
  kind: TileKind;
  href: string;
  value: string;
  rows: { id: string; title: string; trailing: string }[];
  chart: { label: string; value: number }[];
  chartKind: "bar" | "line";
};

function assertManager(actor: Actor) {
  if (!canManageSettings(actor.role)) throw new ServiceError("Your role cannot change dashboards.");
}

function parseConfig(raw: string): TileConfig {
  const parsed = JSON.parse(raw) as Partial<TileConfig>;
  const metric = parsed.metric === "sum" || parsed.metric === "avg" ? parsed.metric : "count";
  return {
    metric,
    metricColumn: String(parsed.metricColumn || ""),
    filters: Array.isArray(parsed.filters) ? parsed.filters.map((filter) => ({ column: String(filter.column || ""), op: filter.op, value: String(filter.value || "") })) : [],
  };
}

function hrefFor(reportKey: string, filters: ReportQuery["filters"]): string {
  const saved = !builtinById(reportKey);
  const base = saved ? `/reports/saved/${reportKey}` : `/reports/builtin/${reportKey}`;
  const extra = filters[0];
  if (!extra) return base;
  const params = new URLSearchParams({ col: extra.column, op: extra.op, val: extra.value });
  return `${base}?${params.toString()}`;
}

function presentTile(actor: Actor, tile: typeof dashboardTiles.$inferSelect): DashTile | null {
  const config = parseConfig(tile.configJson);
  const kind: TileKind = tile.kind === "list" || tile.kind === "chart" ? tile.kind : "number";
  try {
    const view = builtinById(tile.reportKey) ? openBuiltin(actor, tile.reportKey, config.filters) : openSaved(actor, tile.reportKey);
    const column = view.result.columns.find((item) => item.key === config.metricColumn) ?? view.result.columns.find((item) => item.kind === "money" || item.kind === "number" || item.kind === "percent");
    const agg = column ? view.result.total[column.key] : undefined;
    const which = config.metric === "avg" || column?.kind === "percent" ? "avg" : config.metric === "sum" ? "sum" : "count";
    const value = column ? formatAgg(column, agg, which) : String(view.result.total[view.result.columns[0]?.key ?? ""]?.count ?? 0);
    const rows = view.result.groups
      .flatMap((group) => group.rows)
      .slice(0, 5)
      .map((row) => {
        const first = view.result.columns[0];
        const second = view.result.columns.find((item) => item.kind === "money" || item.kind === "number") ?? view.result.columns[1];
        return { id: row.id, title: row.cells[first?.key ?? ""]?.text ?? "", trailing: second ? row.cells[second.key]?.text ?? "" : "" };
      });
    return {
      id: tile.id,
      title: tile.title,
      kind,
      href: hrefFor(tile.reportKey, config.filters),
      value,
      rows,
      chart: view.result.chart,
      chartKind: view.result.chart.length && view.query.chart === "line" ? "line" : "bar",
    };
  } catch {
    return null;
  }
}

export function dashboardForRole(actor: Actor): { id: string; name: string; tiles: DashTile[] } | null {
  const assignment = getDb()
    .select()
    .from(dashboardRoles)
    .where(and(eq(dashboardRoles.orgId, actor.orgId), eq(dashboardRoles.role, actor.role)))
    .get();
  if (!assignment) return null;
  const board = getDb().select().from(dashboards).where(and(eq(dashboards.id, assignment.dashboardId), eq(dashboards.orgId, actor.orgId))).get();
  if (!board || board.archivedAt) return null;
  const tiles = getDb()
    .select()
    .from(dashboardTiles)
    .where(and(eq(dashboardTiles.orgId, actor.orgId), eq(dashboardTiles.dashboardId, board.id)))
    .all()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((tile) => presentTile(actor, tile))
    .filter((tile): tile is DashTile => tile != null);
  return { id: board.id, name: board.name, tiles };
}

export function listDashboards(actor: Actor) {
  assertManager(actor);
  const boards = getDb().select().from(dashboards).where(eq(dashboards.orgId, actor.orgId)).all().filter((board) => !board.archivedAt);
  const roles = getDb().select().from(dashboardRoles).where(eq(dashboardRoles.orgId, actor.orgId)).all();
  return boards.map((board) => ({
    id: board.id,
    name: board.name,
    roles: roles.filter((role) => role.dashboardId === board.id).map((role) => role.role),
    tiles: getDb()
      .select()
      .from(dashboardTiles)
      .where(and(eq(dashboardTiles.orgId, actor.orgId), eq(dashboardTiles.dashboardId, board.id)))
      .all()
      .sort((left, right) => left.sortOrder - right.sortOrder),
  }));
}

export function createDashboard(actor: Actor, name: string) {
  assertManager(actor);
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean || clean.length > 80) throw new ServiceError("Name the dashboard.");
  const now = nowIso();
  const boardId = id("dash");
  getDb()
    .insert(dashboards)
    .values({ id: boardId, orgId: actor.orgId, name: clean, archivedAt: null, createdAt: now, updatedAt: now, createdBy: actor.userId })
    .run();
  return boardId;
}

export function addTile(actor: Actor, dashboardId: string, input: { title: string; kind: string; reportKey: string; metric: string; metricColumn: string }) {
  assertManager(actor);
  const board = getDb().select().from(dashboards).where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, actor.orgId))).get();
  if (!board) throw new ServiceError("That dashboard is not in your company.");
  const builtin = builtinById(input.reportKey);
  const saved = getDb().select().from(savedReports).where(and(eq(savedReports.id, input.reportKey), eq(savedReports.orgId, actor.orgId))).get();
  if (!builtin && !saved) throw new ServiceError("Pick a report.");
  const title = input.title.trim().replace(/\s+/g, " ") || builtin?.name || saved?.name || "Tile";
  const kind = input.kind === "list" || input.kind === "chart" ? input.kind : "number";
  const existing = getDb().select().from(dashboardTiles).where(and(eq(dashboardTiles.orgId, actor.orgId), eq(dashboardTiles.dashboardId, board.id))).all();
  getDb()
    .insert(dashboardTiles)
    .values({
      id: id("tile"),
      orgId: actor.orgId,
      dashboardId: board.id,
      title,
      kind,
      reportKey: input.reportKey,
      configJson: JSON.stringify({ metric: input.metric === "sum" || input.metric === "avg" ? input.metric : "count", metricColumn: input.metricColumn, filters: [] }),
      sortOrder: existing.length,
    })
    .run();
}

export function orderTiles(actor: Actor, dashboardId: string, ids: string[]) {
  assertManager(actor);
  const rows = getDb().select().from(dashboardTiles).where(and(eq(dashboardTiles.orgId, actor.orgId), eq(dashboardTiles.dashboardId, dashboardId))).all();
  const known = new Set(rows.map((row) => row.id));
  const next = ids.filter((item) => known.has(item));
  if (next.length !== rows.length) throw new ServiceError("That order is missing a tile.");
  next.forEach((tileId, index) => {
    getDb().update(dashboardTiles).set({ sortOrder: index }).where(eq(dashboardTiles.id, tileId)).run();
  });
}

export function assignDashboard(actor: Actor, dashboardId: string, role: string) {
  assertManager(actor);
  if (!["owner", "admin", "estimator", "field", "viewer"].includes(role)) throw new ServiceError("Pick a role.");
  const board = getDb().select().from(dashboards).where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, actor.orgId))).get();
  if (!board) throw new ServiceError("That dashboard is not in your company.");
  const existing = getDb().select().from(dashboardRoles).where(and(eq(dashboardRoles.orgId, actor.orgId), eq(dashboardRoles.role, role))).get();
  if (existing) {
    getDb().update(dashboardRoles).set({ dashboardId: board.id }).where(eq(dashboardRoles.id, existing.id)).run();
    return;
  }
  getDb().insert(dashboardRoles).values({ id: id("drole"), orgId: actor.orgId, role, dashboardId: board.id }).run();
}

export function reportChoices(actor: Actor) {
  const saved = getDb()
    .select()
    .from(savedReports)
    .where(eq(savedReports.orgId, actor.orgId))
    .all()
    .filter((row) => !row.archivedAt)
    .map((row) => ({ id: row.id, name: row.name }));
  const ready = BUILTINS.filter((report) => report.field || actor.role !== "field").map((report) => ({ id: report.id, name: report.name }));
  return [...ready, ...saved];
}
