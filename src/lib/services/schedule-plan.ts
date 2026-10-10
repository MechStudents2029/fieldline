import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import { auditLogs, projects, scheduleBaselineItems, scheduleBaselines, scheduleDelays, scheduleItems, users } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canEditCrm, canEditSchedule, type Role } from "@/lib/permissions";
import { isDelayReason, type DelayReasonId } from "@/lib/schedule/delays";
import { workdayOffset } from "@/lib/schedule/workdays";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { workCalendarFor } from "@/lib/services/work-calendar";

export type DelayInput = { reason: string; note?: string | null };

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function assertEditor(actor: Actor) {
  if (!canEditSchedule(actor.role as Role)) throw new ServiceError("Your role can view the schedule, not change it.");
}

export function cleanDelay(input: DelayInput | null | undefined): { reason: DelayReasonId; note: string | null } {
  const reason = input?.reason?.trim() || "";
  if (!isDelayReason(reason)) throw new ServiceError("Pick a reason.");
  const note = input?.note?.trim().replace(/\s+/g, " ") || "";
  if (reason === "other" && !note) throw new ServiceError("Add a short note.");
  if (note.length > 80) throw new ServiceError("Keep the note under 80 characters.");
  return { reason, note: note || null };
}

function activeBaseline(db: ReturnType<typeof dbFor>, orgId: string, projectId: string) {
  return db
    .select()
    .from(scheduleBaselines)
    .where(and(eq(scheduleBaselines.orgId, orgId), eq(scheduleBaselines.projectId, projectId), eq(scheduleBaselines.current, 1)))
    .get();
}

/** Workdays this finish moved later, when the new finish is past the item's baseline. */
export function delayRequirement(actor: Actor, itemId: string, newEnd: string): { days: number } | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const item = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, itemId))).get();
  if (!item || newEnd <= item.endDate) return null;
  const baseline = activeBaseline(db, actor.orgId, item.projectId);
  if (!baseline) return null;
  const frozen = db
    .select()
    .from(scheduleBaselineItems)
    .where(and(eq(scheduleBaselineItems.orgId, actor.orgId), eq(scheduleBaselineItems.baselineId, baseline.id), eq(scheduleBaselineItems.itemId, itemId)))
    .get();
  if (!frozen || newEnd <= frozen.endDate) return null;
  const days = workdayOffset(item.endDate, newEnd, workCalendarFor(actor.orgId, item.projectId));
  if (days <= 0) return null;
  return { days };
}

export function writeDelay(db: AppDatabase, actor: Actor, projectId: string, itemId: string, days: number, delay: { reason: DelayReasonId; note: string | null }) {
  db.insert(scheduleDelays)
    .values({
      id: id("delay"),
      orgId: actor.orgId,
      projectId,
      itemId,
      days,
      reason: delay.reason,
      note: delay.note,
      actorId: actor.userId,
      createdAt: nowIso(),
    })
    .run();
}

export function setScheduleBaseline(actor: Actor, projectId: string) {
  assertEditor(actor);
  const db = dbFor(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("That job is not in your company.");
  const items = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, projectId)))
    .all();
  if (items.length === 0) throw new ServiceError("Add a schedule item first.");
  const finishDate = items.reduce((max, item) => (item.endDate > max ? item.endDate : max), items[0]!.endDate);
  const now = nowIso();
  const baselineId = id("base");
  db.transaction((tx) => {
    tx.update(scheduleBaselines)
      .set({ current: 0 })
      .where(and(eq(scheduleBaselines.orgId, actor.orgId), eq(scheduleBaselines.projectId, projectId), eq(scheduleBaselines.current, 1)))
      .run();
    tx.insert(scheduleBaselines)
      .values({ id: baselineId, orgId: actor.orgId, projectId, finishDate, current: 1, setAt: now, setBy: actor.userId })
      .run();
    tx.insert(scheduleBaselineItems)
      .values(
        items.map((item) => ({
          id: id("bitem"),
          orgId: actor.orgId,
          baselineId,
          itemId: item.id,
          startDate: item.startDate,
          endDate: item.endDate,
        })),
      )
      .run();
    tx.insert(auditLogs)
      .values({
        id: id("audit"),
        orgId: actor.orgId,
        actorId: actor.userId,
        action: "schedule.baseline",
        entityType: "project",
        entityId: projectId,
        payloadJson: JSON.stringify({ baselineId, finishDate, items: items.length }),
        ip: null,
        createdAt: now,
      })
      .run();
  });
  return { id: baselineId, finishDate };
}

export type BaselineHistoryRow = { id: string; finishDate: string; current: boolean; setAt: string; setBy: string };

export function baselineHistory(actor: Actor, projectId: string): BaselineHistoryRow[] {
  const db = dbFor(actor);
  const rows = db
    .select()
    .from(scheduleBaselines)
    .where(and(eq(scheduleBaselines.orgId, actor.orgId), eq(scheduleBaselines.projectId, projectId)))
    .all()
    .sort((a, b) => b.setAt.localeCompare(a.setAt));
  const people = db.select({ id: users.id, name: users.name }).from(users).all();
  const names = new Map(people.map((person) => [person.id, person.name]));
  return rows.map((row) => ({
    id: row.id,
    finishDate: row.finishDate,
    current: row.current === 1,
    setAt: row.setAt,
    setBy: names.get(row.setBy || "") || "Office",
  }));
}

export type ScheduleCompare = {
  baselineFinish: string | null;
  currentFinish: string | null;
  variance: number | null;
  setAt: string | null;
  items: {
    id: string;
    baselineStart: string | null;
    baselineEnd: string | null;
    variance: number | null;
  }[];
};

export function scheduleCompare(actor: Actor, projectId: string): ScheduleCompare {
  const db = officeDb(actor.orgId);
  const empty: ScheduleCompare = { baselineFinish: null, currentFinish: null, variance: null, setAt: null, items: [] };
  if (!db) return empty;
  const project = db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) return empty;
  const items = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, projectId))).all();
  const currentFinish = items.reduce<string | null>((max, item) => (max == null || item.endDate > max ? item.endDate : max), null);
  const baseline = activeBaseline(db, actor.orgId, projectId);
  if (!baseline) return { ...empty, currentFinish };
  const frozen = db
    .select()
    .from(scheduleBaselineItems)
    .where(and(eq(scheduleBaselineItems.orgId, actor.orgId), eq(scheduleBaselineItems.baselineId, baseline.id)))
    .all();
  const calendar = workCalendarFor(actor.orgId, projectId);
  const byItem = new Map(frozen.map((row) => [row.itemId, row]));
  return {
    baselineFinish: baseline.finishDate,
    currentFinish,
    variance: currentFinish ? workdayOffset(baseline.finishDate, currentFinish, calendar) : null,
    setAt: baseline.setAt,
    items: items.map((item) => {
      const base = byItem.get(item.id);
      return {
        id: item.id,
        baselineStart: base?.startDate ?? null,
        baselineEnd: base?.endDate ?? null,
        variance: base ? workdayOffset(base.endDate, item.endDate, calendar) : null,
      };
    }),
  };
}

export type VarianceRow = {
  projectId: string;
  name: string;
  baselineFinish: string | null;
  currentFinish: string | null;
  variance: number | null;
  delays: Record<DelayReasonId, number>;
};

const EMPTY_DELAYS = (): Record<DelayReasonId, number> => ({
  weather: 0,
  client: 0,
  change_order: 0,
  material: 0,
  sub: 0,
  inspection: 0,
  other: 0,
});

function varianceRows(orgId: string): VarianceRow[] {
  const db = officeDb(orgId);
  if (!db) return [];
  const jobs = db
    .select()
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .all()
    .filter((project) => project.status === "active")
    .sort((a, b) => a.name.localeCompare(b.name));
  const baselines = db.select().from(scheduleBaselines).where(and(eq(scheduleBaselines.orgId, orgId), eq(scheduleBaselines.current, 1))).all();
  const current = new Map(baselines.map((row) => [row.projectId, row]));
  const items = db.select().from(scheduleItems).where(eq(scheduleItems.orgId, orgId)).all();
  const delays = db.select().from(scheduleDelays).where(eq(scheduleDelays.orgId, orgId)).all();
  return jobs.map((project) => {
    const finish = items.filter((item) => item.projectId === project.id).reduce<string | null>((max, item) => (max == null || item.endDate > max ? item.endDate : max), null);
    const baseline = current.get(project.id);
    const calendar = workCalendarFor(orgId, project.id);
    const bucket = EMPTY_DELAYS();
    for (const delay of delays) {
      if (delay.projectId !== project.id || !isDelayReason(delay.reason)) continue;
      bucket[delay.reason] += delay.days;
    }
    return {
      projectId: project.id,
      name: project.name,
      baselineFinish: baseline?.finishDate ?? null,
      currentFinish: finish,
      variance: baseline && finish ? workdayOffset(baseline.finishDate, finish, calendar) : null,
      delays: bucket,
    };
  });
}

export function scheduleVariance(actor: Actor): { rows: VarianceRow[] } {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot open this report.");
  return { rows: varianceRows(actor.orgId) };
}

export function slippedSchedule(orgId: string): { count: number; href: string | null } {
  const count = varianceRows(orgId).filter((row) => row.variance != null && row.variance >= 5).length;
  return { count, href: count > 0 ? "/reports/schedule" : null };
}

export function scheduleVarianceCsv(actor: Actor): { filename: string; body: string } {
  const report = scheduleVariance(actor);
  const header = ["Job", "Baseline finish", "Current finish", "Variance", "Weather", "Client decision", "Change order", "Material", "Sub", "Inspection", "Other"];
  const lines = report.rows.map((row) =>
    [
      row.name,
      row.baselineFinish ?? "",
      row.currentFinish ?? "",
      row.variance == null ? "" : String(row.variance),
      String(row.delays.weather),
      String(row.delays.client),
      String(row.delays.change_order),
      String(row.delays.material),
      String(row.delays.sub),
      String(row.delays.inspection),
      String(row.delays.other),
    ]
      .map((cell) => `"${cell.replace(/"/g, '""')}"`)
      .join(","),
  );
  return { filename: "schedule-variance.csv", body: [header.join(","), ...lines].join("\n") };
}
