import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import { auditLogs, scheduleItems, scheduleLinks, tasks } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canEditSchedule, type Role } from "@/lib/permissions";
import { cascadeShift, hasCycle, movesLabel, type ScheduleShift } from "@/lib/schedule/deps";
import { addWorkdays, endFromDuration, inclusiveWorkdays } from "@/lib/schedule/workdays";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { linkedDeadline } from "@/lib/todos/deadline";
import { refreshLinkedTodos } from "@/lib/services/todos";
import { cleanDelay, delayRequirement, writeDelay } from "@/lib/services/schedule-plan";
import { calendarForOrg } from "@/lib/services/time";
import { workCalendarFor } from "@/lib/services/work-calendar";

export type ScheduleLinkInput = { predecessorId: string; lag: number };

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function assertEditor(actor: Actor) {
  if (!canEditSchedule(actor.role as Role)) throw new ServiceError("Your role can view the schedule, not change it.");
}

function cleanLag(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 60) throw new ServiceError("Lag is 0 to 60 workdays.");
  return value;
}

export function buildSchedulePlan(actor: Actor, itemId: string, startDate: string, endDate: string): ScheduleShift[] {
  assertEditor(actor);
  const db = dbFor(actor);
  const item = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, itemId)))
    .get();
  if (!item) throw new ServiceError("That schedule item is not in your company.");
  const nodes = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, item.projectId)))
    .all()
    .map((row) => ({ id: row.id, start: row.startDate, end: row.endDate }));
  const edges = db
    .select()
    .from(scheduleLinks)
    .where(and(eq(scheduleLinks.orgId, actor.orgId), eq(scheduleLinks.projectId, item.projectId)))
    .all()
    .map((row) => ({ itemId: row.itemId, predecessorId: row.predecessorId, lag: row.lagWorkdays }));
  if (hasCycle(edges)) throw new ServiceError("That link would loop.");
  try {
    return cascadeShift(nodes, edges, itemId, startDate, endDate, workCalendarFor(actor.orgId, item.projectId));
  } catch (error) {
    if (error instanceof Error && error.message === "cycle") throw new ServiceError("That link would loop.");
    throw error;
  }
}

function todoMoves(db: ReturnType<typeof dbFor>, orgId: string, projectId: string, shifts: ScheduleShift[]): number {
  if (shifts.length === 0) return 0;
  const mask = workCalendarFor(orgId, projectId);
  const moved = new Map(shifts.map((shift) => [shift.id, shift]));
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.orgId, orgId))
    .all()
    .filter((row) => {
      if (!row.scheduleItemId || row.deadlineOffset == null) return false;
      if (row.deadlineEdge !== "start" && row.deadlineEdge !== "finish") return false;
      const shift = moved.get(row.scheduleItemId);
      if (!shift) return false;
      const anchor = row.deadlineEdge === "start" ? shift.start : shift.end;
      return (row.dueAt || "").slice(0, 10) !== linkedDeadline(anchor, row.deadlineOffset, mask);
    }).length;
}

export function previewScheduleShift(actor: Actor, itemId: string, startDate: string, endDate: string) {
  const shifts = buildSchedulePlan(actor, itemId, startDate, endDate);
  const db = dbFor(actor);
  const item = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, itemId))).get();
  const count = shifts.length + (item ? todoMoves(db, actor.orgId, item.projectId, shifts) : 0);
  const delay = delayRequirement(actor, itemId, endDate);
  return { count, label: movesLabel(count), shifts, needsReason: Boolean(delay), days: delay?.days ?? 0 };
}

export function writeScheduleShifts(db: AppDatabase, actor: Actor, shifts: ScheduleShift[]) {
  if (shifts.length === 0) return;
  const now = nowIso();
  for (const shift of shifts) {
    db.update(scheduleItems)
      .set({ startDate: shift.start, endDate: shift.end, updatedAt: now })
      .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, shift.id)))
      .run();
  }
  const first = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, shifts[0]!.id))).get();
  const todos = refreshLinkedTodos(db, actor.orgId, shifts, workCalendarFor(actor.orgId, first?.projectId ?? null));
  const count = shifts.length + todos;
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action: "schedule.shift",
      entityType: "schedule_item",
      entityId: shifts[0]?.id ?? null,
      payloadJson: JSON.stringify({ count, label: movesLabel(count), shifts, todos }),
      ip: null,
      createdAt: now,
    })
    .run();
}

export function shiftScheduleDates(actor: Actor, itemId: string, startDate: string, endDate: string, delay: { reason: string; note?: string | null } | null = null) {
  const db = dbFor(actor);
  const item = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, itemId))).get();
  if (!item) throw new ServiceError("That schedule item is not in your company.");
  const needs = delayRequirement(actor, itemId, endDate);
  const reason = needs ? cleanDelay(delay) : null;
  const shifts = buildSchedulePlan(actor, itemId, startDate, endDate);
  const count = shifts.length + todoMoves(db, actor.orgId, item.projectId, shifts);
  db.transaction((tx) => {
    const writer = tx as unknown as AppDatabase;
    writeScheduleShifts(writer, actor, shifts);
    if (needs && reason) writeDelay(writer, actor, item.projectId, itemId, needs.days, reason);
  });
  return { count, label: movesLabel(count), shifts };
}

export function replaceScheduleLinks(actor: Actor, itemId: string, links: ScheduleLinkInput[]) {
  assertEditor(actor);
  const db = dbFor(actor);
  const item = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, itemId)))
    .get();
  if (!item) throw new ServiceError("That schedule item is not in your company.");
  const cleaned = links.map((link) => ({ predecessorId: link.predecessorId, lag: cleanLag(link.lag) }));
  const unique = new Map(cleaned.map((link) => [link.predecessorId, link]));
  if (unique.has(itemId)) throw new ServiceError("That link would loop.");
  const siblings = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, item.projectId)))
    .all();
  const ids = new Set(siblings.map((row) => row.id));
  for (const link of unique.values()) {
    if (!ids.has(link.predecessorId)) throw new ServiceError("That item is not on this job.");
  }
  const existing = db
    .select()
    .from(scheduleLinks)
    .where(and(eq(scheduleLinks.orgId, actor.orgId), eq(scheduleLinks.projectId, item.projectId)))
    .all()
    .filter((row) => row.itemId !== itemId)
    .map((row) => ({ itemId: row.itemId, predecessorId: row.predecessorId, lag: row.lagWorkdays }));
  const proposed = [
    ...existing,
    ...[...unique.values()].map((link) => ({ itemId, predecessorId: link.predecessorId, lag: link.lag })),
  ];
  if (hasCycle(proposed)) throw new ServiceError("That link would loop.");
  const now = nowIso();
  db.transaction((tx) => {
    tx.delete(scheduleLinks).where(and(eq(scheduleLinks.orgId, actor.orgId), eq(scheduleLinks.itemId, itemId))).run();
    if (unique.size > 0) {
      tx.insert(scheduleLinks)
        .values(
          [...unique.values()].map((link) => ({
            id: id("slnk"),
            orgId: actor.orgId,
            projectId: item.projectId,
            itemId,
            predecessorId: link.predecessorId,
            lagWorkdays: link.lag,
          })),
        )
        .run();
    }
    tx.insert(auditLogs)
      .values({
        id: id("audit"),
        orgId: actor.orgId,
        actorId: actor.userId,
        action: "schedule.link",
        entityType: "schedule_item",
        entityId: itemId,
        payloadJson: JSON.stringify({ links: [...unique.values()] }),
        ip: null,
        createdAt: now,
      })
      .run();
  });
}

/** Move a linked item by whole workdays and keep its workday length. Used by the RFI schedule impact. */
export function workdaySpan(actor: Actor, startDate: string, endDate: string, days: number, projectId?: string | null) {
  const mask = workCalendarFor(actor.orgId, projectId ?? null);
  const duration = Math.max(1, inclusiveWorkdays(startDate, endDate, mask));
  const start = addWorkdays(startDate, days, mask);
  return { startDate: start, endDate: endFromDuration(start, duration, mask) };
}

export function companyZone(actor: Actor) {
  return calendarForOrg(actor.orgId).timeZone;
}
