import { and, eq, inArray } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  activities,
  costItems,
  laborRates,
  memberships,
  priceBookItems,
  projects,
  timeApprovals,
  timeEntries,
  timeEntryEvents,
  users,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
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

/** Monday 00:00 UTC through the following Monday. */
export function weekBoundsUtc(now = Date.now()): { start: number; end: number } {
  const date = new Date(now);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset);
  return { start, end: start + 7 * 86_400_000 };
}

export function detectTimeFlags(
  entries: { id: string; userId: string; status: string; clockInAt: string; clockOutAt: string | null; breakMinutes: number; breakStartedAt: string | null }[],
  now = Date.now(),
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
  const week = weekBoundsUtc(now);
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
  const clockInAt = requireWhen(input.clockInAt);
  const clockOutAt = requireWhen(input.clockOutAt);
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
  const clockInAt = requireWhen(input.clockInAt);
  const open = entry.status === "open" || entry.status === "break";
  const clockOutAt = open ? null : requireWhen(input.clockOutAt || "");
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

export function defaultHourlyCost(orgId: string): number | null {
  const db = officeDb(orgId);
  if (!db) return null;
  return db.select().from(laborRates).where(and(eq(laborRates.orgId, orgId), eq(laborRates.userId, DEFAULT_RATE_USER))).get()?.hourlyCostCents ?? null;
}

export function approvedHoursCsv(actor: Actor, from: string, to: string): string {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("Only an owner or admin can export payroll hours.");
  const start = dateStart(from);
  const end = dateStart(to);
  if (start == null || end == null || end < start) throw new ServiceError("Pick a start and end date.");
  const db = officeOrThrow(actor);
  const rows = db
    .select({ entry: timeEntries, name: users.name, email: users.email })
    .from(timeEntries)
    .innerJoin(users, eq(users.id, timeEntries.userId))
    .where(and(eq(timeEntries.orgId, actor.orgId), eq(timeEntries.status, "approved")))
    .all()
    .filter((row) => {
      const day = row.entry.clockInAt.slice(0, 10);
      return day >= from && day <= to;
    });
  const totals = new Map<string, { date: string; name: string; email: string; minutes: number }>();
  for (const row of rows) {
    const date = row.entry.clockInAt.slice(0, 10);
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
  const mine = db.select().from(timeEntries).where(and(eq(timeEntries.orgId, actor.orgId), eq(timeEntries.userId, actor.userId))).all();
  const names = new Map(jobs.map((job) => [job.id, job.name]));
  const selfFlags = detectTimeFlags(mine, now);
  const week = weekBoundsUtc(now);
  const today = new Date(now).toISOString().slice(0, 10);
  const countable = mine.filter((entry) => entry.status !== "void");
  const open = mine.find((entry) => entry.status === "open" || entry.status === "break") ?? null;
  const base = {
    jobs,
    codes,
    open,
    todayMinutes: countable.filter((entry) => entry.clockInAt.slice(0, 10) === today).reduce((sum, entry) => sum + workedMinutes(entry, now), 0),
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
  const flags = detectTimeFlags(all, now);
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

function requireWhen(value: string) {
  const date = new Date(value);
  if (!value.trim() || Number.isNaN(date.getTime())) throw new ServiceError("Enter a valid time.");
  return date.toISOString();
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
