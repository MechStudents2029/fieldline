import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import { auditLogs, scheduleItems, scheduleLinks } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canEditSchedule, type Role } from "@/lib/permissions";
import { cascadeShift, hasCycle, movesLabel, type ScheduleShift } from "@/lib/schedule/deps";
import { addWorkdays, endFromDuration, inclusiveWorkdays } from "@/lib/schedule/workdays";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { calendarForOrg, workdaysForOrg } from "@/lib/services/time";

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
    return cascadeShift(nodes, edges, itemId, startDate, endDate, workdaysForOrg(actor.orgId));
  } catch (error) {
    if (error instanceof Error && error.message === "cycle") throw new ServiceError("That link would loop.");
    throw error;
  }
}

export function previewScheduleShift(actor: Actor, itemId: string, startDate: string, endDate: string) {
  const shifts = buildSchedulePlan(actor, itemId, startDate, endDate);
  return { count: shifts.length, label: movesLabel(shifts.length), shifts };
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
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action: "schedule.shift",
      entityType: "schedule_item",
      entityId: shifts[0]?.id ?? null,
      payloadJson: JSON.stringify({ count: shifts.length, label: movesLabel(shifts.length), shifts }),
      ip: null,
      createdAt: now,
    })
    .run();
}

export function shiftScheduleDates(actor: Actor, itemId: string, startDate: string, endDate: string) {
  const db = dbFor(actor);
  const shifts = buildSchedulePlan(actor, itemId, startDate, endDate);
  db.transaction((tx) => {
    writeScheduleShifts(tx as unknown as AppDatabase, actor, shifts);
  });
  return { count: shifts.length, label: movesLabel(shifts.length), shifts };
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
export function workdaySpan(actor: Actor, startDate: string, endDate: string, days: number) {
  const mask = workdaysForOrg(actor.orgId);
  const duration = Math.max(1, inclusiveWorkdays(startDate, endDate, mask));
  const start = addWorkdays(startDate, days, mask);
  return { startDate: start, endDate: endFromDuration(start, duration, mask) };
}

export function companyZone(actor: Actor) {
  return calendarForOrg(actor.orgId).timeZone;
}
