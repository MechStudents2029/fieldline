import { and, eq, isNull, or } from "drizzle-orm";
import { officeDb } from "@/lib/db/office";
import { projects, scheduleBaselineItems, scheduleBaselines, scheduleItems, scheduleLinks, workdayExceptions } from "@/lib/db/schema";
import { formatCalendarDay } from "@/lib/format";
import { criticalPath } from "@/lib/schedule/cpm";
import { cleanZoom, type GanttZoom } from "@/lib/schedule/gantt";
import { inclusiveDays } from "@/lib/schedule/range";
import { inclusiveWorkdays, isWorkday } from "@/lib/schedule/workdays";
import { ServiceError } from "@/lib/services/errors";
import { scheduleGateLabels } from "@/lib/services/permits";
import { canEditSchedule, type Role } from "@/lib/permissions";
import type { Actor } from "@/lib/services/read";
import { calendarForOrg } from "@/lib/services/time";
import { workCalendarFor } from "@/lib/services/work-calendar";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

export type GanttBar = {
  id: string;
  projectId: string;
  title: string;
  phase: string;
  start: string;
  end: string;
  workdays: number;
  progressBps: number;
  float: number;
  critical: boolean;
  held: string | null;
  baselineStart: string | null;
  baselineEnd: string | null;
  href: string;
};

export type GanttGroup = {
  id: string;
  title: string;
  start: string;
  end: string;
  progressBps: number;
  bars: GanttBar[];
};

export type GanttDay = { date: string; off: boolean; label: string | null };

export type GanttModel = {
  scope: "job" | "org";
  zoom: GanttZoom;
  canEdit: boolean;
  today: string;
  finish: string;
  finishLabel: string;
  days: GanttDay[];
  groups: GanttGroup[];
  links: { from: string; to: string }[];
};

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function offTitle(date: string, rows: { title: string; startDate: string; endDate: string; yearly: number }[]) {
  let title: string | null = null;
  for (const row of rows) {
    const start = row.yearly === 1 ? `${date.slice(0, 4)}-${row.startDate.slice(5)}` : row.startDate;
    const end = row.yearly === 1 ? `${date.slice(0, 4)}-${row.endDate.slice(5)}` : row.endDate;
    if (start <= date && date <= end) title = row.title;
  }
  return title;
}

function timeline(dates: string[], today: string, calendar: ReturnType<typeof workCalendarFor>, rows: { title: string; startDate: string; endDate: string; yearly: number }[]): GanttDay[] {
  if (dates.length === 0) dates = [today];
  let start = dates.reduce((min, day) => (day < min ? day : min));
  let end = dates.reduce((max, day) => (day > max ? day : max));
  if (today < start) start = today;
  if (today > end) end = today;
  start = addCalendarDays(start, -2);
  end = addCalendarDays(end, 18);
  return inclusiveDays(start, end).map((date) => {
    const off = !isWorkday(date, calendar);
    return { date, off, label: off ? offTitle(date, rows) : null };
  });
}

function rollup(bars: GanttBar[]) {
  const start = bars.reduce((min, bar) => (bar.start < min ? bar.start : min), bars[0]?.start ?? "");
  const end = bars.reduce((max, bar) => (bar.end > max ? bar.end : max), bars[0]?.end ?? "");
  const weight = bars.reduce((sum, bar) => sum + Math.max(1, bar.workdays), 0);
  const progressBps = weight === 0 ? 0 : Math.round(bars.reduce((sum, bar) => sum + bar.progressBps * Math.max(1, bar.workdays), 0) / weight);
  return { start, end, progressBps };
}

function phaseGroups(bars: GanttBar[]): GanttGroup[] {
  if (bars.length === 0) return [];
  if (!bars.some((bar) => bar.phase)) {
    return [{ id: "all", title: "", ...rollup(bars), bars }];
  }
  const buckets = new Map<string, GanttBar[]>();
  for (const bar of bars) {
    const key = bar.phase || "—";
    const list = buckets.get(key) ?? [];
    list.push(bar);
    buckets.set(key, list);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[1][0]!.start.localeCompare(b[1][0]!.start) || a[0].localeCompare(b[0]))
    .map(([title, list]) => ({ id: title, title, ...rollup(list), bars: list }));
}

type ItemRow = typeof scheduleItems.$inferSelect;

function barsFor(
  rows: ItemRow[],
  projectName: Map<string, string>,
  calendarByProject: Map<string, ReturnType<typeof workCalendarFor>>,
  gates: Map<string, string>,
  baseline: Map<string, { start: string; end: string }>,
  floats: Map<string, { float: number; critical: boolean }>,
): GanttBar[] {
  return rows
    .slice()
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title))
    .map((row) => {
      const calendar = calendarByProject.get(row.projectId);
      const workdays = calendar ? inclusiveWorkdays(row.startDate, row.endDate, calendar) : 0;
      const mark = floats.get(row.id);
      const base = baseline.get(row.id);
      const progressBps = row.status === "done" ? 10000 : Math.max(0, Math.min(10000, row.progressBps));
      return {
        id: row.id,
        projectId: row.projectId,
        title: row.title,
        phase: row.phase?.trim() || "",
        start: row.startDate,
        end: row.endDate,
        workdays,
        progressBps,
        float: mark?.float ?? 0,
        critical: mark?.critical ?? false,
        held: gates.get(row.id) ?? (row.held ? "Held" : null),
        baselineStart: base?.start ?? null,
        baselineEnd: base?.end ?? null,
        href: `/schedule/items/${row.id}`,
      };
    });
}

function pathFor(rows: ItemRow[], edges: { itemId: string; predecessorId: string; lag: number }[], calendar: ReturnType<typeof workCalendarFor>) {
  try {
    return criticalPath(
      rows.map((row) => ({ id: row.id, start: row.startDate, end: row.endDate })),
      edges,
      calendar,
    );
  } catch {
    return { finish: "", items: [] };
  }
}

function exceptionRows(actor: Actor, projectId: string | null) {
  const db = dbFor(actor);
  return db
    .select()
    .from(workdayExceptions)
    .where(
      and(
        eq(workdayExceptions.orgId, actor.orgId),
        projectId ? or(isNull(workdayExceptions.projectId), eq(workdayExceptions.projectId, projectId)) : isNull(workdayExceptions.projectId),
      ),
    )
    .all()
    .sort((a, b) => Number(Boolean(a.projectId)) - Number(Boolean(b.projectId)));
}

export function jobGantt(actor: Actor, projectId: string, zoom: GanttZoom = "week"): GanttModel | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const project = db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.orgId, actor.orgId), eq(projects.id, projectId)))
    .get();
  if (!project) return null;
  const rows = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, projectId)))
    .all();
  const edges = db
    .select()
    .from(scheduleLinks)
    .where(and(eq(scheduleLinks.orgId, actor.orgId), eq(scheduleLinks.projectId, projectId)))
    .all()
    .map((row) => ({ itemId: row.itemId, predecessorId: row.predecessorId, lag: row.lagWorkdays }));
  const calendar = workCalendarFor(actor.orgId, projectId);
  const path = pathFor(rows, edges, calendar);
  const floats = new Map(path.items.map((item) => [item.id, item]));
  const baselineId = db
    .select({ id: scheduleBaselines.id })
    .from(scheduleBaselines)
    .where(and(eq(scheduleBaselines.orgId, actor.orgId), eq(scheduleBaselines.projectId, projectId), eq(scheduleBaselines.current, 1)))
    .get();
  const frozen = baselineId
    ? db
        .select()
        .from(scheduleBaselineItems)
        .where(and(eq(scheduleBaselineItems.orgId, actor.orgId), eq(scheduleBaselineItems.baselineId, baselineId.id)))
        .all()
    : [];
  const baseline = new Map(frozen.map((row) => [row.itemId, { start: row.startDate, end: row.endDate }]));
  const bars = barsFor(rows, new Map([[project.id, project.name]]), new Map([[project.id, calendar]]), scheduleGateLabels(actor.orgId), baseline, floats);
  const today = localDay(Date.now(), calendarForOrg(actor.orgId).timeZone);
  const finish = bars.reduce((max, bar) => (bar.end > max ? bar.end : max), "");
  const days = timeline(
    bars.flatMap((bar) => [bar.start, bar.end]),
    today,
    calendar,
    exceptionRows(actor, projectId),
  );
  return {
    scope: "job",
    zoom: cleanZoom(zoom) ?? "week",
    canEdit: canEditSchedule(actor.role as Role),
    today,
    finish,
    finishLabel: finish ? formatCalendarDay(finish) : "—",
    days,
    groups: phaseGroups(bars),
    links: edges.map((edge) => ({ from: edge.predecessorId, to: edge.itemId })),
  };
}

export function orgGantt(actor: Actor, zoom: GanttZoom = "week"): GanttModel {
  const db = dbFor(actor);
  const rows = db
    .select({ item: scheduleItems, name: projects.name })
    .from(scheduleItems)
    .innerJoin(projects, and(eq(projects.id, scheduleItems.projectId), eq(projects.orgId, scheduleItems.orgId)))
    .where(eq(scheduleItems.orgId, actor.orgId))
    .all();
  const edges = db
    .select()
    .from(scheduleLinks)
    .where(eq(scheduleLinks.orgId, actor.orgId))
    .all();
  const gates = scheduleGateLabels(actor.orgId);
  const company = workCalendarFor(actor.orgId, null);
  const today = localDay(Date.now(), calendarForOrg(actor.orgId).timeZone);
  const byProject = new Map<string, { name: string; rows: ItemRow[] }>();
  for (const row of rows) {
    const bucket = byProject.get(row.item.projectId) ?? { name: row.name, rows: [] };
    bucket.rows.push(row.item);
    byProject.set(row.item.projectId, bucket);
  }
  const groups: GanttGroup[] = [];
  const floats = new Map<string, { float: number; critical: boolean }>();
  for (const [projectId, bucket] of byProject) {
    const calendar = workCalendarFor(actor.orgId, projectId);
    const projectEdges = edges
      .filter((edge) => edge.projectId === projectId)
      .map((edge) => ({ itemId: edge.itemId, predecessorId: edge.predecessorId, lag: edge.lagWorkdays }));
    for (const item of pathFor(bucket.rows, projectEdges, calendar).items) floats.set(item.id, item);
    const bars = barsFor(bucket.rows, new Map([[projectId, bucket.name]]), new Map([[projectId, calendar]]), gates, new Map(), floats);
    if (bars.length === 0) continue;
    groups.push({ id: projectId, title: bucket.name, ...rollup(bars), bars });
  }
  groups.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  const finish = groups.reduce((max, group) => (group.end > max ? group.end : max), "");
  return {
    scope: "org",
    zoom: cleanZoom(zoom) ?? "week",
    canEdit: canEditSchedule(actor.role as Role),
    today,
    finish,
    finishLabel: finish ? formatCalendarDay(finish) : "—",
    days: timeline(
      groups.flatMap((group) => [group.start, group.end]),
      today,
      company,
      exceptionRows(actor, null),
    ),
    groups,
    links: edges.map((edge) => ({ from: edge.predecessorId, to: edge.itemId })),
  };
}

export function floatForItem(actor: Actor, itemId: string): number | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const item = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, itemId)))
    .get();
  if (!item) return null;
  const rows = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, item.projectId)))
    .all();
  const edges = db
    .select()
    .from(scheduleLinks)
    .where(and(eq(scheduleLinks.orgId, actor.orgId), eq(scheduleLinks.projectId, item.projectId)))
    .all()
    .map((row) => ({ itemId: row.itemId, predecessorId: row.predecessorId, lag: row.lagWorkdays }));
  const path = pathFor(rows, edges, workCalendarFor(actor.orgId, item.projectId));
  return path.items.find((row) => row.id === itemId)?.float ?? null;
}
