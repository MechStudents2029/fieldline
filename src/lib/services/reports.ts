import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { savedReports } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canManageSettings, canSeeCash, canSeeMoney, type Role } from "@/lib/permissions";
import { BUILTINS, CATALOG, PAGE_REPORTS, builtinById, customRecord, sourceLabel, type SourceId } from "@/lib/reports/catalog";
import {
  emptyQuery,
  formatAgg,
  runEngine,
  shareAllowed,
  sourceAllowed,
  subtotalLabel,
  visibleColumns,
  type EngineColumn,
  type EngineResult,
  type ReportQuery,
} from "@/lib/reports/engine";
import { columnsFor, loadSource, orgToday } from "@/lib/reports/load";
import { leadSourceFooter } from "@/lib/services/lead-sources";
import { customColumns } from "@/lib/services/custom-fields";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";

export type ReportView = {
  id: string;
  name: string;
  source: string;
  sourceLabel: string;
  share: string;
  saved: boolean;
  archived: boolean;
  owner: boolean;
  query: ReportQuery;
  result: EngineResult;
};

const OPS = new Set(["eq", "contains", "gt", "lt", "in"]);

function assertOffice(actor: Actor) {
  if (!canManageSettings(actor.role)) throw new ServiceError("Your role cannot change reports.");
}

export function parseQuery(input: Partial<ReportQuery> | null | undefined): ReportQuery {
  const base = emptyQuery();
  if (!input) return base;
  const columns = Array.isArray(input.columns) ? input.columns.map(String).slice(0, 24) : [];
  const filters = Array.isArray(input.filters)
    ? input.filters
        .slice(0, 8)
        .map((filter) => ({
          column: String(filter.column || ""),
          op: (OPS.has(String(filter.op)) ? filter.op : "eq") as ReportQuery["filters"][number]["op"],
          value: String(filter.value || "").slice(0, 80),
        }))
        .filter((filter) => filter.column)
    : [];
  const chart = input.chart === "bar" || input.chart === "line" ? input.chart : "";
  const dir = input.dir === "desc" ? "desc" : "asc";
  return {
    columns,
    filters,
    dateColumn: String(input.dateColumn || ""),
    from: String(input.from || "").slice(0, 10),
    to: String(input.to || "").slice(0, 10),
    sort: String(input.sort || ""),
    dir,
    groupBy: String(input.groupBy || ""),
    chart,
    chartColumn: String(input.chartColumn || ""),
  };
}

function resolveDates(actor: Actor, query: ReportQuery): ReportQuery {
  if (query.from !== "today" && query.to !== "today") return query;
  const today = orgToday(actor.orgId);
  return { ...query, from: query.from === "today" ? today : query.from, to: query.to === "today" ? today : query.to };
}

function catalogColumns(actor: Actor, source: SourceId): EngineColumn[] {
  const custom = customRecord(source);
  const extra = custom
    ? customColumns(actor, custom).map((column) => ({
        key: column.key,
        label: column.label,
        kind: (column.fieldType === "money" ? "money" : column.fieldType === "number" ? "number" : column.fieldType === "date" ? "date" : "text") as EngineColumn["kind"],
        money: column.fieldType === "money",
      }))
    : [];
  return [...CATALOG[source], ...extra];
}

export function runBuilt(actor: Actor, source: SourceId, query: ReportQuery): EngineResult {
  if (!sourceAllowed(actor.role as Role, source)) throw new ServiceError("Your role cannot see this report.");
  const dated = resolveDates(actor, query);
  const rows = loadSource(actor, source, orgToday(actor.orgId), { from: dated.from, to: dated.to });
  const columns = columnsFor(actor, source, rows);
  const allowed = new Set(columns.map((column) => column.key));
  const hideMoney = !canSeeMoney(actor.role as Role);
  const visible = visibleColumns(columns, hideMoney).filter((column) => allowed.has(column.key));
  const picked = dated.columns.filter((key) => visible.some((column) => column.key === key));
  const result = runEngine(rows, visible, { ...dated, columns: picked.length ? picked : visible.map((column) => column.key) });
  if (source !== "lead_sources") return result;
  return { ...result, footer: leadSourceFooter(result.groups.flatMap((group) => group.rows)) };
}

export function library(actor: Actor) {
  const role = actor.role as Role;
  const visible = (id: string, field: boolean) => {
    if (id === "cash" || id === "cash_13") return canSeeCash(role);
    return field || role !== "field";
  };
  const ready = [
    ...BUILTINS.filter((report) => report.id !== "cash_13" && visible(report.id, report.field)).map((report) => ({
      id: report.id,
      name: report.name,
      href: report.href ?? `/reports/builtin/${report.id}`,
      kind: "builtin" as const,
    })),
    ...PAGE_REPORTS.filter((report) => visible(report.id, report.field)).map((report) => ({
      id: report.id,
      name: report.name,
      href: report.href,
      kind: "page" as const,
    })),
  ];
  const saved = getDb()
    .select()
    .from(savedReports)
    .where(eq(savedReports.orgId, actor.orgId))
    .all()
    .filter((row) => !row.archivedAt && shareAllowed(role, actor.userId, row.share, row.ownerUserId) && sourceAllowed(role, row.source))
    .map((row) => ({ id: row.id, name: row.name, href: `/reports/saved/${row.id}`, share: row.share, kind: "saved" as const }));
  return { ready, saved };
}

export function openBuiltin(actor: Actor, reportId: string, extra?: ReportQuery["filters"], range?: { from?: string; to?: string }): ReportView {
  const report = builtinById(reportId);
  if (!report) throw new ServiceError("That report is not in your company.");
  if (!report.field && actor.role === "field") throw new ServiceError("Your role cannot see this report.");
  if (report.source === "cash" && !canSeeCash(actor.role as Role)) throw new ServiceError("Your role cannot see this report.");
  const query = parseQuery({
    ...report.query,
    filters: [...report.query.filters, ...(extra ?? [])],
    ...(report.id === "lead_sources" && range ? { from: range.from || "", to: range.to || "" } : {}),
  });
  return {
    id: report.id,
    name: report.name,
    source: report.source,
    sourceLabel: sourceLabel(report.source),
    share: "everyone",
    saved: false,
    archived: false,
    owner: false,
    query,
    result: runBuilt(actor, report.source, query),
  };
}

function rowVisible(actor: Actor, row: typeof savedReports.$inferSelect) {
  if (row.orgId !== actor.orgId) return false;
  if (!sourceAllowed(actor.role as Role, row.source)) return false;
  return shareAllowed(actor.role as Role, actor.userId, row.share, row.ownerUserId);
}

export function openSaved(actor: Actor, reportId: string): ReportView {
  const row = getDb().select().from(savedReports).where(and(eq(savedReports.id, reportId), eq(savedReports.orgId, actor.orgId))).get();
  if (!row || row.archivedAt || !rowVisible(actor, row)) throw new ServiceError("That report is not in your company.");
  const query = parseQuery(JSON.parse(row.definitionJson) as ReportQuery);
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    sourceLabel: sourceLabel(row.source),
    share: row.share,
    saved: true,
    archived: false,
    owner: row.ownerUserId === actor.userId || canManageSettings(actor.role),
    query,
    result: runBuilt(actor, row.source as SourceId, query),
  };
}

function cleanShare(value: string): "private" | "office" | "everyone" {
  if (value === "office" || value === "everyone") return value;
  return "private";
}

export function saveReport(actor: Actor, input: { name: string; source: string; share: string; query: ReportQuery }) {
  if (!CATALOG[input.source as SourceId]) throw new ServiceError("Pick a record type.");
  if (!sourceAllowed(actor.role as Role, input.source)) throw new ServiceError("Your role cannot see this report.");
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) throw new ServiceError("Name the report.");
  const now = nowIso();
  const reportId = id("rpt");
  getDb()
    .insert(savedReports)
    .values({
      id: reportId,
      orgId: actor.orgId,
      name,
      source: input.source,
      definitionJson: JSON.stringify(parseQuery(input.query)),
      share: cleanShare(input.share),
      ownerUserId: actor.userId,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return reportId;
}

export function updateReport(actor: Actor, reportId: string, input: { name?: string; share?: string; query?: ReportQuery }) {
  const row = getDb().select().from(savedReports).where(and(eq(savedReports.id, reportId), eq(savedReports.orgId, actor.orgId))).get();
  if (!row) throw new ServiceError("That report is not in your company.");
  if (row.ownerUserId !== actor.userId && !canManageSettings(actor.role)) throw new ServiceError("Your role cannot change this report.");
  const name = input.name == null ? row.name : input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) throw new ServiceError("Name the report.");
  getDb()
    .update(savedReports)
    .set({
      name,
      share: input.share == null ? row.share : cleanShare(input.share),
      definitionJson: input.query ? JSON.stringify(parseQuery(input.query)) : row.definitionJson,
      updatedAt: nowIso(),
    })
    .where(eq(savedReports.id, row.id))
    .run();
}

export function duplicateReport(actor: Actor, reportId: string) {
  const row = getDb().select().from(savedReports).where(and(eq(savedReports.id, reportId), eq(savedReports.orgId, actor.orgId))).get();
  if (!row || !rowVisible(actor, row)) throw new ServiceError("That report is not in your company.");
  return saveReport(actor, { name: `${row.name} copy`, source: row.source, share: "private", query: parseQuery(JSON.parse(row.definitionJson) as ReportQuery) });
}

export function archiveReport(actor: Actor, reportId: string) {
  const row = getDb().select().from(savedReports).where(and(eq(savedReports.id, reportId), eq(savedReports.orgId, actor.orgId))).get();
  if (!row) throw new ServiceError("That report is not in your company.");
  if (row.ownerUserId !== actor.userId && !canManageSettings(actor.role)) throw new ServiceError("Your role cannot change this report.");
  const now = nowIso();
  getDb().update(savedReports).set({ archivedAt: row.archivedAt ? null : now, updatedAt: now }).where(eq(savedReports.id, row.id)).run();
}

export function builderColumns(actor: Actor, source: string): EngineColumn[] {
  if (!CATALOG[source as SourceId]) return [];
  return visibleColumns(catalogColumns(actor, source as SourceId), !canSeeMoney(actor.role as Role));
}

export function previewReport(actor: Actor, source: string, query: ReportQuery): EngineResult {
  if (!CATALOG[source as SourceId]) throw new ServiceError("Pick a record type.");
  return runBuilt(actor, source as SourceId, query);
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function reportCsv(view: ReportView): string {
  const lines = [view.result.columns.map((column) => csvCell(column.label)).join(",")];
  for (const group of view.result.groups) {
    for (const row of group.rows) {
      lines.push(view.result.columns.map((column) => csvCell(row.cells[column.key]?.text ?? "")).join(","));
    }
    if (view.result.grouped) {
      lines.push(view.result.columns.map((column, index) => csvCell(index === 0 ? group.key : subtotalLabel(column, group.subtotal[column.key]))).join(","));
    }
  }
  if (view.result.footer) {
    lines.push(view.result.columns.map((column) => csvCell(view.result.footer?.[column.key] ?? "")).join(","));
  } else {
    lines.push(view.result.columns.map((column, index) => csvCell(index === 0 ? "Total" : formatAgg(column, view.result.total[column.key], column.kind === "percent" ? "avg" : column.kind === "text" || column.kind === "date" ? "count" : "sum"))).join(","));
  }
  return lines.join("\n");
}

export { assertOffice };
