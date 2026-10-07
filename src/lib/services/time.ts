import { and, eq, inArray } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  activities,
  costItems,
  laborRates,
  memberships,
  priceBookItems,
  organizations,
  projects,
  timeApprovals,
  timeEntries,
  timeEntryEvents,
  users,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import {
  DEFAULT_TIME_ZONE,
  DEFAULT_WEEK_START,
  isValidTimeZone,
  formatLocalInput,
  localDay,
  localWeek,
  weekdayName,
  zonedTimeToUtc,
  type WorkCalendar,
} from "@/lib/time/calendar";
import { aggregateWeek, dayHeading, rangeLabel, reviewDays, reviewView, shiftAnchor, type ReviewView } from "@/lib/time/grid";
import { canAddFieldNotes, canManageMoney, canManageSettings, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";

export const OPEN_SHIFT_MS = 12 * 60 * 60 * 1000;
export const OVERTIME_MINUTES = 40 * 60;
const MAX_HOURLY_CENTS = 50_000;
const DEFAULT_RATE_USER = "";

type Entry = typeof timeEntries.$inferSelect;
type Writer = Pick<AppDatabase, "insert" | "select" | "update" | "delete">;

export type TimeFlag = {
  kind: "open_long" | "overtime" | "overlap";
  userId: string;
  entryIds: string[];
  detail: string;
};

export type PublicEntry = {
  id: string;
  userId: string;
  projectId: string;
  projectName: string;
  costCode: string;
  status: string;
  clockInAt: string;
  clockOutAt: string | null;
  breakMinutes: number;
  note: string | null;
  minutes: number;
  flags: string[];
};

export function laborCostCents(minutes: number, hourlyCostCents: number): number {
  if (!Number.isInteger(minutes) || minutes < 0) throw new ServiceError("Hours must be zero or more.");
  if (!Number.isInteger(hourlyCostCents) || hourlyCostCents <= 0) throw new ServiceError("Enter an hourly cost greater than zero.");
  return Math.round((minutes * hourlyCostCents) / 60);
}

export function workedMinutes(entry: { clockInAt: string; clockOutAt: string | null; breakMinutes: number; status: string; breakStartedAt: string | null }, now = Date.now()): number {
  const start = Date.parse(entry.clockInAt);
  const end = entry.clockOutAt ? Date.parse(entry.clockOutAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  let breakMs = Math.max(0, entry.breakMinutes) * 60_000;
  if (entry.status === "break" && entry.breakStartedAt) {
    const breakStart = Date.parse(entry.breakStartedAt);
    if (Number.isFinite(breakStart)) breakMs += Math.max(0, now - breakStart);
  }
  return Math.max(0, Math.round((end - start - breakMs) / 60_000));
}

export function calendarForOrg(orgId: string): WorkCalendar {
  const org = getDb()
    .select({ timeZone: organizations.timeZone, weekStartsOn: organizations.weekStartsOn })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .get();
  const timeZone = org && isValidTimeZone(org.timeZone) ? org.timeZone : DEFAULT_TIME_ZONE;
  const weekStartsOn =
    org && Number.isInteger(org.weekStartsOn) && org.weekStartsOn >= 0 && org.weekStartsOn <= 6 ? org.weekStartsOn : DEFAULT_WEEK_START;
  return { timeZone, weekStartsOn };
}

/** Monday–Friday unless the company saved a different set. Bit 0 is Sunday. */
export function workdaysForOrg(orgId: string): number {
  const org = getDb()
    .select({ workdaysMask: organizations.workdaysMask })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .get();
  const mask = org?.workdaysMask;
  if (typeof mask === "number" && mask > 0 && mask < 128) return mask;
  return 62;
}

export function detectTimeFlags(
  entries: { id: string; userId: string; status: string; clockInAt: string; clockOutAt: string | null; breakMinutes: number; breakStartedAt: string | null }[],
  now = Date.now(),
  calendar: WorkCalendar = { timeZone: DEFAULT_TIME_ZONE, weekStartsOn: DEFAULT_WEEK_START },
): TimeFlag[] {
  const flags: TimeFlag[] = [];
  const live = entries.filter((entry) => entry.status !== "void");
  for (const entry of live) {
    if ((entry.status === "open" || entry.status === "break") && now - Date.parse(entry.clockInAt) >= OPEN_SHIFT_MS) {
      flags.push({
        kind: "open_long",
        userId: entry.userId,
        entryIds: [entry.id],
        detail: "Still clocked in after 12 hours. Likely a forgotten clock-out.",
      });
    }
  }
  const byUser = new Map<string, typeof live>();
  for (const entry of live) {
    const list = byUser.get(entry.userId) ?? [];
    list.push(entry);
    byUser.set(entry.userId, list);
  }
  const week = localWeek(now, calendar);
  for (const [userId, rows] of byUser) {
    const weekMinutes = rows
      .filter((entry) => {
        const start = Date.parse(entry.clockInAt);
        return start >= week.start && start < week.end;
      })
      .reduce((sum, entry) => sum + workedMinutes(entry, now), 0);
    if (weekMinutes > OVERTIME_MINUTES) {
      flags.push({
        kind: "overtime",
        userId,
        entryIds: rows.map((entry) => entry.id),
        detail: "Over 40 hours this week. This is a flag only, not a wage calculation.",
      });
    }
    const intervals = rows
      .map((entry) => ({
        id: entry.id,
        start: Date.parse(entry.clockInAt),
        end: entry.clockOutAt ? Date.parse(entry.clockOutAt) : now,
      }))
      .filter((interval) => interval.end > interval.start)
      .sort((a, b) => a.start - b.start);
    let cursor = intervals[0];
    for (let i = 1; i < intervals.length; i += 1) {
      const current = intervals[i];
      if (!cursor || !current) continue;
      if (current.start < cursor.end) {
        flags.push({
          kind: "overlap",
          userId,
          entryIds: [cursor.id, current.id],
          detail: "Two time entries overlap.",
        });
        if (current.end > cursor.end) cursor = { ...cursor, end: current.end };
      } else {
        cursor = current;
      }
    }
  }
  return flags;
}

export function formatHours(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}h ${String(safe % 60).padStart(2, "0")}m`;
}

export function clockIn(
  actor: Actor,
  input: { projectId: string; costCode: string; lat?: string | null; lng?: string | null },
  now = Date.now(),
) {
  assertClock(actor);
  const db = officeOrThrow(actor);
  if (openFor(db, actor.orgId, actor.userId)) throw new ServiceError("You are already clocked in. Switch jobs instead.");
  const projectId = requireProject(db, actor.orgId, input.projectId);
  const costCode = requireCode(input.costCode);
  const stamp = new Date(now).toISOString();
  const entryId = id("time");
  const coords = pair(input.lat, input.lng);
  db.transaction((tx) => {
    tx.insert(timeEntries)
      .values({
        id: entryId,
        orgId: actor.orgId,
        userId: actor.userId,
        projectId,
        costCode,
        status: "open",
        clockInAt: stamp,
        clockOutAt: null,
        breakMinutes: 0,
        breakStartedAt: null,
        note: null,
        clockInLatE6: coords.lat,
        clockInLngE6: coords.lng,
        clockOutLatE6: null,
        clockOutLngE6: null,
        source: "clock",
        createdAt: stamp,
        updatedAt: stamp,
        createdBy: actor.userId,
      })
      .run();
    record(tx, actor, entryId, "created", null, { status: "open", projectId, costCode, clockInAt: stamp }, null, stamp);
  });
  return { entryId };
}

export function switchJob(
  actor: Actor,
  input: { projectId: string; costCode: string },
  now = Date.now(),
) {
  assertClock(actor);
  const db = officeOrThrow(actor);
  const current = openFor(db, actor.orgId, actor.userId);
  if (!current) throw new ServiceError("Clock in before switching jobs.");
  const projectId = requireProject(db, actor.orgId, input.projectId);
  const costCode = requireCode(input.costCode);
  if (current.projectId === projectId && current.costCode === costCode) {
    throw new ServiceError("You are already on that job and cost code.");
  }
  const stamp = new Date(now).toISOString();
  const nextId = id("time");
  db.transaction((tx) => {
    const closed = finishOpen(current, stamp, now);
    tx.update(timeEntries)
      .set({ ...closed, updatedAt: stamp })
      .where(and(eq(timeEntries.id, current.id), eq(timeEntries.orgId, actor.orgId)))
      .run();
    record(tx, actor, current.id, "switched", snapshot(current), snapshot({ ...current, ...closed }), null, stamp);
    tx.insert(timeEntries)
      .values({
        id: nextId,
        orgId: actor.orgId,
        userId: actor.userId,
        projectId,
        costCode,
        status: "open",
        clockInAt: stamp,
        clockOutAt: null,
        breakMinutes: 0,
        breakStartedAt: null,
        note: null,
        clockInLatE6: null,
        clockInLngE6: null,
        clockOutLatE6: null,
        clockOutLngE6: null,
        source: "clock",
        createdAt: stamp,
        updatedAt: stamp,
        createdBy: actor.userId,
      })
      .run();
    record(tx, actor, nextId, "created", null, { status: "open", projectId, costCode, clockInAt: stamp }, null, stamp);
  });
  return { entryId: nextId };
}

export function startBreak(actor: Actor, now = Date.now()) {
  assertClock(actor);
  const db = officeOrThrow(actor);
  const current = openFor(db, actor.orgId, actor.userId);
  if (!current || current.status !== "open") throw new ServiceError("Clock in before starting a break.");
  const stamp = new Date(now).toISOString();
  db.transaction((tx) => {
    tx.update(timeEntries)
      .set({ status: "break", breakStartedAt: stamp, updatedAt: stamp })
      .where(and(eq(timeEntries.id, current.id), eq(timeEntries.orgId, actor.orgId)))
      .run();
    record(tx, actor, current.id, "break_started", snapshot(current), { ...snapshot(current), status: "break" }, null, stamp);
  });
}

export function endBreak(actor: Actor, now = Date.now()) {
  assertClock(actor);
  const db = officeOrThrow(actor);
  const current = openFor(db, actor.orgId, actor.userId);
  if (!current || current.status !== "break") throw new ServiceError("You are not on a break.");
  const stamp = new Date(now).toISOString();
  const extra = current.breakStartedAt ? Math.max(0, Math.round((now - Date.parse(current.breakStartedAt)) / 60_000)) : 0;
  const breakMinutes = current.breakMinutes + extra;
  db.transaction((tx) => {
    tx.update(timeEntries)
      .set({ status: "open", breakMinutes, breakStartedAt: null, updatedAt: stamp })
      .where(and(eq(timeEntries.id, current.id), eq(timeEntries.orgId, actor.orgId)))
      .run();
    record(tx, actor, current.id, "break_ended", snapshot(current), { ...snapshot(current), status: "open", breakMinutes }, null, stamp);
  });
}

export function clockOut(
  actor: Actor,
  input: { note?: string | null; lat?: string | null; lng?: string | null },
  now = Date.now(),
) {
  assertClock(actor);
  const db = officeOrThrow(actor);
  const current = openFor(db, actor.orgId, actor.userId);
  if (!current) throw new ServiceError("You are not clocked in.");
  const stamp = new Date(now).toISOString();
  const closed = finishOpen(current, stamp, now);
  const note = cleanNote(input.note);
  const coords = pair(input.lat, input.lng);
  db.transaction((tx) => {
    tx.update(timeEntries)
      .set({ ...closed, note, clockOutLatE6: coords.lat, clockOutLngE6: coords.lng, updatedAt: stamp })
      .where(and(eq(timeEntries.id, current.id), eq(timeEntries.orgId, actor.orgId)))
      .run();
    record(tx, actor, current.id, "clocked_out", snapshot(current), { ...snapshot({ ...current, ...closed }), note }, null, stamp);
  });
}

export function officeClockOut(actor: Actor, entryId: string, reason: string, now = Date.now()) {
  assertOffice(actor);
  const why = requireReason(reason);
  const db = officeOrThrow(actor);
  const entry = requireEntry(db, actor.orgId, entryId);
  if (entry.status !== "open" && entry.status !== "break") throw new ServiceError("That person is not clocked in.");
  const stamp = new Date(now).toISOString();
  const closed = finishOpen(entry, stamp, now);
  db.transaction((tx) => {
    tx.update(timeEntries)
      .set({ ...closed, updatedAt: stamp })
      .where(and(eq(timeEntries.id, entry.id), eq(timeEntries.orgId, actor.orgId)))
      .run();
    record(tx, actor, entry.id, "clocked_out", snapshot(entry), snapshot({ ...entry, ...closed }), why, stamp);
  });
}

export function addManualTime(
  actor: Actor,
  input: { userId: string; projectId: string; costCode: string; clockInAt: string; clockOutAt: string; breakMinutes?: number; note?: string | null; reason: string },
) {
  assertOffice(actor);
  const reason = requireReason(input.reason);
  const db = officeOrThrow(actor);
  requireMember(db, actor.orgId, input.userId);
  const projectId = requireProject(db, actor.orgId, input.projectId);
  const costCode = requireCode(input.costCode);
  const zone = calendarForOrg(actor.orgId).timeZone;
  const clockInAt = requireWhen(input.clockInAt, zone);
  const clockOutAt = requireWhen(input.clockOutAt, zone);
  const breakMinutes = requireBreak(input.breakMinutes ?? 0, clockInAt, clockOutAt);
  const stamp = nowIso();
  const entryId = id("time");
  const after = { status: "pending", projectId, costCode, clockInAt, clockOutAt, breakMinutes, note: cleanNote(input.note) };
  db.transaction((tx) => {
    tx.insert(timeEntries)
      .values({
        id: entryId,
        orgId: actor.orgId,
        userId: input.userId,
        projectId,
        costCode,
        status: "pending",
        clockInAt,
        clockOutAt,
        breakMinutes,
        breakStartedAt: null,
        note: after.note,
        clockInLatE6: null,
        clockInLngE6: null,
        clockOutLatE6: null,
        clockOutLngE6: null,
        source: "manual",
        createdAt: stamp,
        updatedAt: stamp,
        createdBy: actor.userId,
      })
      .run();
    record(tx, actor, entryId, "created", null, after, reason, stamp);
  });
  return { entryId };
}

export function editTime(
  actor: Actor,
  entryId: string,
  input: { projectId: string; costCode: string; clockInAt: string; clockOutAt?: string | null; breakMinutes?: number; note?: string | null; reason: string },
) {
  assertOffice(actor);
  const reason = requireReason(input.reason);
  const db = officeOrThrow(actor);
  const entry = requireEntry(db, actor.orgId, entryId);
  if (entry.status === "approved") throw new ServiceError("Reopen this entry before changing it.");
  if (entry.status === "void") throw new ServiceError("Voided time stays on the record.");
  const projectId = requireProject(db, actor.orgId, input.projectId);
  const costCode = requireCode(input.costCode);
  const zone = calendarForOrg(actor.orgId).timeZone;
  const clockInAt = requireWhen(input.clockInAt, zone);
  const open = entry.status === "open" || entry.status === "break";
  const clockOutAt = open ? null : requireWhen(input.clockOutAt || "", zone);
  if (clockOutAt) requireBreak(input.breakMinutes ?? entry.breakMinutes, clockInAt, clockOutAt);
  const breakMinutes = Math.max(0, Math.round(input.breakMinutes ?? entry.breakMinutes));
  const stamp = nowIso();
  const after = { status: entry.status, projectId, costCode, clockInAt, clockOutAt, breakMinutes, note: cleanNote(input.note ?? entry.note) };
  db.transaction((tx) => {
    tx.update(timeEntries)
      .set({ projectId, costCode, clockInAt, clockOutAt, breakMinutes, note: after.note, updatedAt: stamp })
      .where(and(eq(timeEntries.id, entry.id), eq(timeEntries.orgId, actor.orgId)))
      .run();
    record(tx, actor, entry.id, "edited", snapshot(entry), after, reason, stamp);
  });
}

export function approveTime(actor: Actor, entryId: string, now = Date.now()) {
  assertOffice(actor);
  const db = officeOrThrow(actor);
  const entry = requireEntry(db, actor.orgId, entryId);
  if (entry.status !== "pending") throw new ServiceError("Only a finished entry can be approved.");
  const minutes = workedMinutes(entry, now);
  if (minutes <= 0) throw new ServiceError("This entry has no time. Edit it before approving.");
  const rate = hourlyCostFor(db, actor.orgId, entry.userId);
  if (rate == null) throw new ServiceError("Set an hourly cost before approving.");
  const amountCents = laborCostCents(minutes, rate);
  if (amountCents <= 0) throw new ServiceError("This entry is too short to post. Edit the times first.");
  const worker = db.select().from(users).where(eq(users.id, entry.userId)).get();
  const stamp = new Date(now).toISOString();
  const costId = id("cost");
  db.transaction((tx) => {
    const updated = tx
      .update(timeEntries)
      .set({ status: "approved", updatedAt: stamp })
      .where(and(eq(timeEntries.id, entry.id), eq(timeEntries.orgId, actor.orgId), eq(timeEntries.status, "pending")))
      .run() as { changes?: number };
    if (!updated.changes) throw new ServiceError("Only a finished entry can be approved.");
    tx.insert(costItems)
      .values({
        id: costId,
        orgId: actor.orgId,
        projectId: entry.projectId,
        budgetLineId: null,
        costCode: entry.costCode,
        amountCents,
        vendorName: worker?.name || "Crew",
        memo: entry.note ? `Labor · ${entry.note}` : "Labor",
        source: "labor",
        aiExtracted: 0,
        documentId: null,
        createdAt: stamp,
        updatedAt: stamp,
        createdBy: actor.userId,
      })
      .run();
    tx.insert(timeApprovals)
      .values({
        id: id("tap"),
        orgId: actor.orgId,
        entryId: entry.id,
        rateCents: rate,
        minutes,
        amountCents,
        costItemId: costId,
        status: "active",
        reason: null,
        createdAt: stamp,
        createdBy: actor.userId,
      })
      .run();
    tx.insert(activities)
      .values({
        id: id("act"),
        orgId: actor.orgId,
        entityType: "project",
        entityId: entry.projectId,
        type: "cost",
        actorType: "user",
        actorId: actor.userId,
        summary: `Approved labor for ${worker?.name || "a teammate"}.`,
        payloadJson: null,
        createdAt: stamp,
      })
      .run();
    record(tx, actor, entry.id, "approved", snapshot(entry), { ...snapshot(entry), status: "approved" }, null, stamp);
  });
  return { costId, amountCents, rateCents: rate, minutes };
}

export function approveEntries(actor: Actor, entryIds: string[], now = Date.now()) {
  assertOffice(actor);
  const posted: string[] = [];
  const seen = new Set<string>();
  for (const entryId of entryIds) {
    if (!entryId || seen.has(entryId)) continue;
    seen.add(entryId);
    const entry = requireEntry(officeOrThrow(actor), actor.orgId, entryId);
    if (entry.status === "approved") continue;
    if (entry.status !== "pending") throw new ServiceError("Only a finished entry can be approved.");
    approveTime(actor, entryId, now);
    posted.push(entryId);
  }
  return { posted };
}

export type TimeEditInput = {
  projectId: string;
  costCode: string;
  clockInAt: string;
  clockOutAt?: string | null;
  breakMinutes?: number;
  note?: string | null;
  reason: string;
};

export function saveAndApprove(actor: Actor, entryId: string, input: TimeEditInput, now = Date.now()) {
  editTime(actor, entryId, input);
  return approveTime(actor, entryId, now);
}

export type TimeUndo =
  | { kind: "approve"; ids: string[] }
  | { kind: "edit"; entryId: string; before: TimeEditInput; reopen: boolean };

export function undoTime(actor: Actor, payload: TimeUndo) {
  assertOffice(actor);
  if (payload.kind === "approve") {
    for (const entryId of payload.ids) {
      const entry = requireEntry(officeOrThrow(actor), actor.orgId, entryId);
      if (entry.status === "approved") reopenTime(actor, entryId, "Undo approval");
    }
    return;
  }
  if (payload.reopen) {
    const entry = requireEntry(officeOrThrow(actor), actor.orgId, payload.entryId);
    if (entry.status === "approved") reopenTime(actor, payload.entryId, "Undo approval");
  }
  editTime(actor, payload.entryId, { ...payload.before, reason: "Undo edit" });
}

export function reopenTime(actor: Actor, entryId: string, reason: string) {
  assertOffice(actor);
  const why = requireReason(reason);
  const db = officeOrThrow(actor);
  const entry = requireEntry(db, actor.orgId, entryId);
  if (entry.status !== "approved") throw new ServiceError("Only approved time can be reopened.");
  const stamp = nowIso();
  db.transaction((tx) => {
    const active = tx
      .select()
      .from(timeApprovals)
      .where(and(eq(timeApprovals.entryId, entry.id), eq(timeApprovals.orgId, actor.orgId), eq(timeApprovals.status, "active")))
      .all();
    for (const approval of active) {
      if (approval.costItemId) {
        tx.delete(costItems)
          .where(and(eq(costItems.id, approval.costItemId), eq(costItems.orgId, actor.orgId)))
          .run();
      }
      tx.update(timeApprovals)
        .set({ status: "voided", reason: why })
        .where(eq(timeApprovals.id, approval.id))
        .run();
    }
    tx.update(timeEntries)
      .set({ status: "pending", updatedAt: stamp })
      .where(and(eq(timeEntries.id, entry.id), eq(timeEntries.orgId, actor.orgId)))
      .run();
    record(tx, actor, entry.id, "reopened", snapshot(entry), { ...snapshot(entry), status: "pending" }, why, stamp);
  });
}

export function voidTime(actor: Actor, entryId: string, reason: string, now = Date.now()) {
  assertOffice(actor);
  const why = requireReason(reason);
  const db = officeOrThrow(actor);
  const entry = requireEntry(db, actor.orgId, entryId);
  if (entry.status === "void") throw new ServiceError("That time is already void.");
  const stamp = new Date(now).toISOString();
  db.transaction((tx) => {
    if (entry.status === "approved") {
      const active = tx
        .select()
        .from(timeApprovals)
        .where(and(eq(timeApprovals.entryId, entry.id), eq(timeApprovals.orgId, actor.orgId), eq(timeApprovals.status, "active")))
        .all();
      for (const approval of active) {
        if (approval.costItemId) {
          tx.delete(costItems).where(and(eq(costItems.id, approval.costItemId), eq(costItems.orgId, actor.orgId))).run();
        }
        tx.update(timeApprovals).set({ status: "voided", reason: why }).where(eq(timeApprovals.id, approval.id)).run();
      }
    }
    const clockOutAt = entry.clockOutAt ?? stamp;
    tx.update(timeEntries)
      .set({ status: "void", clockOutAt, breakStartedAt: null, updatedAt: stamp })
      .where(and(eq(timeEntries.id, entry.id), eq(timeEntries.orgId, actor.orgId)))
      .run();
    record(tx, actor, entry.id, "voided", snapshot(entry), { ...snapshot(entry), status: "void", clockOutAt }, why, stamp);
  });
}

export function setHourlyCost(actor: Actor, userId: string | null, hourlyCostCents: number) {
  assertOffice(actor);
  if (!Number.isInteger(hourlyCostCents) || hourlyCostCents <= 0) throw new ServiceError("Enter an hourly cost greater than zero.");
  if (hourlyCostCents > MAX_HOURLY_CENTS) throw new ServiceError("Hourly cost must be $500 or less.");
  const db = officeOrThrow(actor);
  const key = userId ?? DEFAULT_RATE_USER;
  if (key) requireMember(db, actor.orgId, key);
  const stamp = nowIso();
  const existing = db
    .select()
    .from(laborRates)
    .where(and(eq(laborRates.orgId, actor.orgId), eq(laborRates.userId, key)))
    .get();
  if (existing) {
    db.update(laborRates)
      .set({ hourlyCostCents, updatedAt: stamp, updatedBy: actor.userId })
      .where(eq(laborRates.id, existing.id))
      .run();
    return;
  }
  db.insert(laborRates)
    .values({ id: id("rate"), orgId: actor.orgId, userId: key, hourlyCostCents, updatedAt: stamp, updatedBy: actor.userId })
    .run();
}

export function updateWorkCalendar(actor: Actor, input: { timeZone: string; weekStartsOn: number; workdays?: number[] }) {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("Only an owner or admin can change the workweek.");
  if (!isValidTimeZone(input.timeZone)) throw new ServiceError("Pick a time zone.");
  if (!Number.isInteger(input.weekStartsOn) || input.weekStartsOn < 0 || input.weekStartsOn > 6) {
    throw new ServiceError("Pick the day the week starts.");
  }
  let workdaysMask: number | null = null;
  if (input.workdays) {
    if (input.workdays.length === 0 || input.workdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new ServiceError("Pick at least one workday.");
    }
    workdaysMask = input.workdays.reduce((mask, day) => mask | (1 << day), 0);
  }
  const db = officeOrThrow(actor);
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  if (!org) throw new ServiceError("Company not found.");
  const before = { timeZone: org.timeZone, weekStartsOn: org.weekStartsOn, workdaysMask: org.workdaysMask };
  const after = { timeZone: input.timeZone, weekStartsOn: input.weekStartsOn, workdaysMask: workdaysMask ?? org.workdaysMask };
  if (before.timeZone === after.timeZone && before.weekStartsOn === after.weekStartsOn && before.workdaysMask === after.workdaysMask) return;
  const stamp = nowIso();
  db.transaction((tx) => {
    tx.update(organizations)
      .set({ timeZone: after.timeZone, weekStartsOn: after.weekStartsOn, workdaysMask: after.workdaysMask, updatedAt: stamp })
      .where(eq(organizations.id, actor.orgId))
      .run();
    tx.insert(activities)
      .values({
        id: id("act"),
        orgId: actor.orgId,
        entityType: "organization",
        entityId: actor.orgId,
        type: "calendar",
        actorType: "user",
        actorId: actor.userId,
        summary: `Workweek set to ${weekdayName(after.weekStartsOn)} in ${after.timeZone}. Stored clock times were not moved.`,
        payloadJson: JSON.stringify({ before, after }),
        createdAt: stamp,
      })
      .run();
  });
}

export function defaultHourlyCost(orgId: string): number | null {
  const db = officeDb(orgId);
  if (!db) return null;
  return db.select().from(laborRates).where(and(eq(laborRates.orgId, orgId), eq(laborRates.userId, DEFAULT_RATE_USER))).get()?.hourlyCostCents ?? null;
}

export function approvedHoursCsv(actor: Actor, from: string, to: string): string {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("Only an owner or admin can export payroll hours.");
  const start = dateStart(from);
  const end = dateStart(to);
  if (start == null || end == null || from > to) throw new ServiceError("Pick a start and end date.");
  const db = officeOrThrow(actor);
  const zone = calendarForOrg(actor.orgId).timeZone;
  const rows = db
    .select({ entry: timeEntries, name: users.name, email: users.email })
    .from(timeEntries)
    .innerJoin(users, eq(users.id, timeEntries.userId))
    .where(and(eq(timeEntries.orgId, actor.orgId), eq(timeEntries.status, "approved")))
    .all()
    .filter((row) => {
      const day = localDay(Date.parse(row.entry.clockInAt), zone);
      return day >= from && day <= to;
    });
  const totals = new Map<string, { date: string; name: string; email: string; minutes: number }>();
  for (const row of rows) {
    const date = localDay(Date.parse(row.entry.clockInAt), zone);
    const key = `${date}|${row.entry.userId}`;
    const current = totals.get(key) ?? { date, name: row.name, email: row.email, minutes: 0 };
    current.minutes += workedMinutes(row.entry);
    totals.set(key, current);
  }
  const lines = [...totals.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
    .map((row) => [row.date, csv(row.name), csv(row.email), (row.minutes / 60).toFixed(2)].join(","));
  return ["date,name,email,hours", ...lines].join("\n");
}

export function timeBoard(actor: Actor, now = Date.now()) {
  const db = officeOrThrow(actor);
  const jobs = db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const codes = [
    ...new Set(
      db
        .select({ code: priceBookItems.code })
        .from(priceBookItems)
        .where(eq(priceBookItems.orgId, actor.orgId))
        .all()
        .map((row) => row.code),
    ),
  ].sort();
  const calendar = calendarForOrg(actor.orgId);
  const mine = db.select().from(timeEntries).where(and(eq(timeEntries.orgId, actor.orgId), eq(timeEntries.userId, actor.userId))).all();
  const names = new Map(jobs.map((job) => [job.id, job.name]));
  const selfFlags = detectTimeFlags(mine, now, calendar);
  const week = localWeek(now, calendar);
  const today = localDay(now, calendar.timeZone);
  const countable = mine.filter((entry) => entry.status !== "void");
  const open = mine.find((entry) => entry.status === "open" || entry.status === "break") ?? null;
  const base = {
    jobs,
    codes,
    open,
    timeZone: calendar.timeZone,
    weekStartsOn: calendar.weekStartsOn,
    todayMinutes: countable.filter((entry) => localDay(Date.parse(entry.clockInAt), calendar.timeZone) === today).reduce((sum, entry) => sum + workedMinutes(entry, now), 0),
    weekMinutes: countable
      .filter((entry) => {
        const start = Date.parse(entry.clockInAt);
        return start >= week.start && start < week.end;
      })
      .reduce((sum, entry) => sum + workedMinutes(entry, now), 0),
    entries: mine
      .slice()
      .sort((a, b) => b.clockInAt.localeCompare(a.clockInAt))
      .slice(0, 20)
      .map((entry) => toPublic(entry, names, selfFlags)),
    flags: selfFlags,
  };
  if (!canManageMoney(actor.role as Role)) return { ...base, office: null };
  const all = db.select().from(timeEntries).where(eq(timeEntries.orgId, actor.orgId)).all();
  const people = db
    .select({ userId: users.id, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const personName = new Map(people.map((person) => [person.userId, person.name]));
  const flags = detectTimeFlags(all, now, calendar);
  const rates = db.select().from(laborRates).where(eq(laborRates.orgId, actor.orgId)).all();
  const defaultHourlyCostCents = rates.find((rate) => rate.userId === DEFAULT_RATE_USER)?.hourlyCostCents ?? null;
  return {
    ...base,
    flags,
    office: {
      clockedIn: all
        .filter((entry) => entry.status === "open" || entry.status === "break")
        .map((entry) => ({
          entryId: entry.id,
          name: personName.get(entry.userId) || "Teammate",
          projectName: names.get(entry.projectId) || "Job",
          costCode: entry.costCode,
          since: entry.clockInAt,
          onBreak: entry.status === "break",
        })),
      pending: all
        .filter((entry) => entry.status === "pending")
        .sort((a, b) => b.clockInAt.localeCompare(a.clockInAt))
        .map((entry) => ({ ...toPublic(entry, names, flags), name: personName.get(entry.userId) || "Teammate" })),
      approved: all
        .filter((entry) => entry.status === "approved")
        .sort((a, b) => b.clockInAt.localeCompare(a.clockInAt))
        .slice(0, 12)
        .map((entry) => {
          const approval = db
            .select()
            .from(timeApprovals)
            .where(and(eq(timeApprovals.entryId, entry.id), eq(timeApprovals.status, "active")))
            .get();
          return {
            ...toPublic(entry, names, flags),
            name: personName.get(entry.userId) || "Teammate",
            amountCents: approval?.amountCents ?? null,
            rateCents: approval?.rateCents ?? null,
          };
        }),
      rates: people.map((person) => {
        const personal = rates.find((rate) => rate.userId === person.userId);
        return {
          userId: person.userId,
          name: person.name,
          hourlyCostCents: personal?.hourlyCostCents ?? defaultHourlyCostCents,
          usesDefault: !personal,
        };
      }),
      defaultHourlyCostCents,
      members: people.map((person) => ({ userId: person.userId, name: person.name })),
    },
  };
}

export type WeekGrid = {
  days: string[];
  range: string;
  rows: { userId: string; name: string; hours: number[]; total: number; status: string }[];
  totalHours: number;
  overtimeHours: number;
  laborCents: number;
  pendingCount: number;
};

export function weekGrid(actor: Actor, now = Date.now()): WeekGrid {
  const db = officeOrThrow(actor);
  const calendar = calendarForOrg(actor.orgId);
  const days = reviewDays("week", localDay(now, calendar.timeZone), calendar.weekStartsOn);
  const manage = canManageMoney(actor.role as Role);
  const entries = db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, actor.orgId), manage ? undefined : eq(timeEntries.userId, actor.userId)))
    .all();
  const people = manage
    ? db
        .select({ userId: users.id, name: users.name })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.orgId, actor.orgId))
        .all()
        .sort((a, b) => a.name.localeCompare(b.name))
    : [{ userId: actor.userId, name: actor.name }];
  const grid = aggregateWeek(entries, people, days, calendar, now);
  const laborCents = manage ? approvedLaborCents(db, actor.orgId, entries, days, calendar.timeZone) : 0;
  return {
    days,
    range: rangeLabel(days),
    rows: grid.rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      hours: row.days.map((day) => day.hours),
      total: row.totalHours,
      status: row.status,
    })),
    totalHours: grid.totalHours,
    overtimeHours: grid.overtimeHours,
    laborCents,
    pendingCount: new Set(grid.pendingIds).size,
  };
}

function approvedLaborCents(db: Writer, orgId: string, entries: Entry[], days: string[], timeZone: string) {
  const inRange = new Set(entries.filter((entry) => days.includes(localDay(Date.parse(entry.clockInAt), timeZone))).map((entry) => entry.id));
  return db
    .select()
    .from(timeApprovals)
    .where(and(eq(timeApprovals.orgId, orgId), eq(timeApprovals.status, "active")))
    .all()
    .filter((row) => inRange.has(row.entryId))
    .reduce((sum, row) => sum + row.amountCents, 0);
}

export type ReviewEntry = {
  id: string;
  userId: string;
  projectId: string;
  projectName: string;
  costCode: string;
  status: string;
  clockInAt: string;
  clockOutAt: string | null;
  clockInLocal: string;
  clockOutLocal: string;
  breakMinutes: number;
  note: string | null;
  minutes: number;
  hoursLabel: string;
  day: string;
  dayLabel: string;
  inLabel: string;
  outLabel: string;
  flags: string[];
  locked: boolean;
};

export type TimeReview = {
  view: ReviewView;
  range: string;
  dayHeaders: { key: string; label: string }[];
  prevHref: string;
  nextHref: string;
  dayHref: string;
  weekHref: string;
  periodHref: string;
  stepLabel: string;
  rows: {
    userId: string;
    name: string;
    initials: string;
    hours: { day: string; hours: number; tone: "danger" | null }[];
    total: number;
    totalTone: "warning" | null;
    status: "Submitted" | "Approved" | "—";
  }[];
  totalHours: number;
  overtimeHours: number;
  laborCents: number;
  pendingCount: number;
  pendingIds: string[];
  onSite: { entryId: string; userId: string; name: string; initials: string; projectName: string; costCode: string; inLabel: string; elapsed: string; forgotten: boolean }[];
  entries: ReviewEntry[];
  jobs: { id: string; name: string }[];
  codes: string[];
  timeZone: string;
};

export function timeReview(actor: Actor, input: { view?: string | null; on?: string | null } = {}, now = Date.now()): TimeReview {
  assertOffice(actor);
  const db = officeOrThrow(actor);
  const calendar = calendarForOrg(actor.orgId);
  const view = reviewView(input.view);
  const today = localDay(now, calendar.timeZone);
  const anchor = input.on && /^\d{4}-\d{2}-\d{2}$/.test(input.on) ? input.on : today;
  const days = reviewDays(view, anchor, calendar.weekStartsOn);
  const href = (nextView: ReviewView, day: string) => `/time?view=${nextView}&on=${day}`;
  const entries = db.select().from(timeEntries).where(eq(timeEntries.orgId, actor.orgId)).all();
  const people = db
    .select({ userId: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const names = new Map(
    db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.orgId, actor.orgId))
      .all()
      .map((job) => [job.id, job.name]),
  );
  const jobs = [...names.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const codes = [
    ...new Set(
      db
        .select({ code: priceBookItems.code })
        .from(priceBookItems)
        .where(eq(priceBookItems.orgId, actor.orgId))
        .all()
        .map((row) => row.code),
    ),
  ].sort();
  const flags = detectTimeFlags(entries, now, calendar);
  const danger = new Set(flags.filter((flag) => flag.kind === "overlap" || flag.kind === "open_long").flatMap((flag) => flag.entryIds));
  const grid = aggregateWeek(entries, people, days, calendar, now);
  const daySet = new Set(days);
  const visible = entries.filter((entry) => entry.status !== "void" && daySet.has(localDay(Date.parse(entry.clockInAt), calendar.timeZone)));
  const personName = new Map(people.map((person) => [person.userId, person.name]));
  const clock = (iso: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: calendar.timeZone }).format(new Date(iso));
  const rows = grid.rows
    .filter((row) => row.totalMinutes > 0)
    .map((row) => ({
      userId: row.userId,
      name: row.name,
      initials: initials(row.name),
      hours: row.days.map((day) => ({
        day: day.day,
        hours: day.hours,
        tone: visible.some((entry) => entry.userId === row.userId && danger.has(entry.id) && localDay(Date.parse(entry.clockInAt), calendar.timeZone) === day.day)
          ? ("danger" as const)
          : null,
      })),
      total: row.totalHours,
      totalTone: row.overtimeMinutes > 0 ? ("warning" as const) : null,
      status: row.status,
    }));
  const reviewEntries: ReviewEntry[] = visible
    .slice()
    .sort((a, b) => a.clockInAt.localeCompare(b.clockInAt))
    .map((entry) => {
      const day = localDay(Date.parse(entry.clockInAt), calendar.timeZone);
      const minutes = workedMinutes(entry, now);
      return {
        id: entry.id,
        userId: entry.userId,
        projectId: entry.projectId,
        projectName: names.get(entry.projectId) || "Job",
        costCode: entry.costCode,
        status: entry.status,
        clockInAt: entry.clockInAt,
        clockOutAt: entry.clockOutAt,
        clockInLocal: formatLocalInput(entry.clockInAt, calendar.timeZone),
        clockOutLocal: entry.clockOutAt ? formatLocalInput(entry.clockOutAt, calendar.timeZone) : "",
        breakMinutes: entry.breakMinutes,
        note: entry.note,
        minutes,
        hoursLabel: (minutes / 60).toFixed(1),
        day,
        dayLabel: dayHeading(day),
        inLabel: clock(entry.clockInAt),
        outLabel: entry.clockOutAt ? clock(entry.clockOutAt) : "—",
        flags: flags.filter((flag) => flag.entryIds.includes(entry.id)).map((flag) => flag.kind),
        locked: entry.status === "approved" || entry.status === "open" || entry.status === "break",
      };
    });
  return {
    view,
    range: rangeLabel(days),
    dayHeaders: days.map((day) => ({ key: day, label: dayHeading(day) })),
    prevHref: href(view, shiftAnchor(view, anchor, calendar.weekStartsOn, -1)),
    nextHref: href(view, shiftAnchor(view, anchor, calendar.weekStartsOn, 1)),
    dayHref: href("day", anchor),
    weekHref: href("week", anchor),
    periodHref: href("period", anchor),
    stepLabel: view === "day" ? "day" : view === "period" ? "pay period" : "week",
    rows,
    totalHours: grid.totalHours,
    overtimeHours: grid.overtimeHours,
    laborCents: approvedLaborCents(db, actor.orgId, entries, days, calendar.timeZone),
    pendingCount: new Set(grid.pendingIds).size,
    pendingIds: [...new Set(grid.pendingIds)],
    onSite: entries
      .filter((entry) => entry.status === "open" || entry.status === "break")
      .map((entry) => {
        const minutes = Math.max(0, Math.round((now - Date.parse(entry.clockInAt)) / 60_000));
        const hours = Math.floor(minutes / 60);
        const forgotten = hours > 12;
        return {
          entryId: entry.id,
          userId: entry.userId,
          name: personName.get(entry.userId) || "Teammate",
          initials: initials(personName.get(entry.userId) || "Teammate"),
          projectName: names.get(entry.projectId) || "Job",
          costCode: entry.costCode,
          inLabel: clock(entry.clockInAt),
          elapsed: forgotten ? `Open ${hours}h` : `${hours}h ${minutes % 60}m`,
          forgotten,
        };
      }),
    entries: reviewEntries,
    jobs,
    codes,
    timeZone: calendar.timeZone,
  };
}

function initials(name: string) {
  const parts = name.split(" ").filter(Boolean);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function toPublic(entry: Entry, names: Map<string, string>, flags: TimeFlag[]): PublicEntry {
  return {
    id: entry.id,
    userId: entry.userId,
    projectId: entry.projectId,
    projectName: names.get(entry.projectId) || "Job",
    costCode: entry.costCode,
    status: entry.status,
    clockInAt: entry.clockInAt,
    clockOutAt: entry.clockOutAt,
    breakMinutes: entry.breakMinutes,
    note: entry.note,
    minutes: workedMinutes(entry),
    flags: flags.filter((flag) => flag.entryIds.includes(entry.id)).map((flag) => flag.kind),
  };
}

function hourlyCostFor(db: Writer, orgId: string, userId: string): number | null {
  const personal = db.select().from(laborRates).where(and(eq(laborRates.orgId, orgId), eq(laborRates.userId, userId))).get();
  if (personal) return personal.hourlyCostCents;
  return db.select().from(laborRates).where(and(eq(laborRates.orgId, orgId), eq(laborRates.userId, DEFAULT_RATE_USER))).get()?.hourlyCostCents ?? null;
}

function finishOpen(entry: Entry, stamp: string, now: number) {
  let breakMinutes = entry.breakMinutes;
  if (entry.status === "break" && entry.breakStartedAt) {
    breakMinutes += Math.max(0, Math.round((now - Date.parse(entry.breakStartedAt)) / 60_000));
  }
  return { status: "pending" as const, clockOutAt: stamp, breakMinutes, breakStartedAt: null };
}

function snapshot(entry: { status: string; projectId: string; costCode: string; clockInAt: string; clockOutAt: string | null; breakMinutes: number; note?: string | null }) {
  return {
    status: entry.status,
    projectId: entry.projectId,
    costCode: entry.costCode,
    clockInAt: entry.clockInAt,
    clockOutAt: entry.clockOutAt,
    breakMinutes: entry.breakMinutes,
    note: entry.note ?? null,
  };
}

function record(
  tx: Writer,
  actor: Actor,
  entryId: string,
  type: string,
  before: unknown,
  after: unknown,
  reason: string | null,
  stamp: string,
) {
  tx.insert(timeEntryEvents)
    .values({
      id: id("tev"),
      orgId: actor.orgId,
      entryId,
      actorId: actor.userId,
      type,
      reason,
      beforeJson: before == null ? null : JSON.stringify(before),
      afterJson: JSON.stringify(after),
      createdAt: stamp,
    })
    .run();
}

function openFor(db: Writer, orgId: string, userId: string) {
  return db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.userId, userId), inArray(timeEntries.status, ["open", "break"])))
    .get();
}

function requireEntry(db: Writer, orgId: string, entryId: string) {
  const entry = db.select().from(timeEntries).where(and(eq(timeEntries.id, entryId), eq(timeEntries.orgId, orgId))).get();
  if (!entry) throw new ServiceError("Time entry not found.");
  return entry;
}

function requireProject(db: Writer, orgId: string, projectId: string) {
  const project = db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  return project.id;
}

function requireMember(db: Writer, orgId: string, userId: string) {
  const member = db.select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId))).get();
  if (!member) throw new ServiceError("That person is not on this company.");
}

function requireCode(value: string) {
  const code = value.trim().toUpperCase();
  if (!code || code.length > 40) throw new ServiceError("Pick a cost code.");
  return code;
}

function requireWhen(value: string, timeZone: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new ServiceError("Enter a valid time.");
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) throw new ServiceError("Enter a valid time.");
    return date.toISOString();
  }
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new ServiceError("Enter a valid time.");
  const utc = zonedTimeToUtc(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0), timeZone);
  return new Date(utc).toISOString();
}

function requireBreak(minutes: number, clockInAt: string, clockOutAt: string) {
  const span = Math.round((Date.parse(clockOutAt) - Date.parse(clockInAt)) / 60_000);
  if (span <= 0) throw new ServiceError("Clock-out has to be after clock-in.");
  const breakMinutes = Math.round(minutes);
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes >= span) throw new ServiceError("Break must be shorter than the shift.");
  return breakMinutes;
}

function requireReason(value: string) {
  const reason = value.trim().replace(/\s+/g, " ");
  if (reason.length < 3 || reason.length > 200) throw new ServiceError("Add a short reason.");
  return reason;
}

function cleanNote(value: string | null | undefined) {
  const note = (value ?? "").trim().replace(/\s+/g, " ");
  if (!note) return null;
  if (note.length > 500) throw new ServiceError("Keep the note under 500 characters.");
  return note;
}

function pair(lat: string | null | undefined, lng: string | null | undefined) {
  const latitude = coord(lat, 90);
  const longitude = coord(lng, 180);
  if (latitude == null || longitude == null) return { lat: null, lng: null };
  return { lat: latitude, lng: longitude };
}

function coord(value: string | null | undefined, max: number) {
  if (value == null || value.trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < -max || number > max) return null;
  return Math.round(number * 1_000_000);
}

function dateStart(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(time) ? null : time;
}

function csv(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function assertClock(actor: Actor) {
  if (!canAddFieldNotes(actor.role as Role)) throw new ServiceError("Viewers cannot clock in.");
}

function assertOffice(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Only the office can review time.");
}

function officeOrThrow(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

/** Reads that must not run for a field user. Used by tests to prove the board omits rates. */
export function readableRates(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) return null;
  return getDb().select().from(laborRates).where(eq(laborRates.orgId, actor.orgId)).all();
}
