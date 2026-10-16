import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { auditLogs, memberships, timeEntries, timeOffDays, timeOffRequests, users } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canAddFieldNotes, canEditCrm, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { calendarForOrg } from "@/lib/services/time";
import { workCalendarFor } from "@/lib/services/work-calendar";
import { syncApprovedWeek } from "@/lib/time/post";
import { addCalendarDays, localDay, localWeek, zonedTimeToUtc } from "@/lib/time/calendar";
import { hoursNumber } from "@/lib/workload/hours";
import {
  FULL_DAY_MINUTES,
  allowanceRemaining,
  capacityOffMinutes,
  conflictDays,
  expandOffDays,
  isPaidKind,
  isTimeOffKind,
  outWarning,
  payrollMinutes,
  type TimeOffKind,
} from "@/lib/time-off/request";

const KIND_LABEL: Record<TimeOffKind, string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  unpaid: "Unpaid",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
};

export type TimeOffQuery = {
  userId?: string;
  status?: string;
  from?: string;
  to?: string;
};

export type TimeOffRow = {
  id: string;
  userId: string;
  name: string;
  startOn: string;
  endOn: string;
  dayMinutes: number;
  hours: string;
  kind: string;
  kindLabel: string;
  status: string;
  statusLabel: string;
  note: string;
  decisionReason: string;
  decidedAt: string | null;
  decidedByName: string | null;
  allowanceLabel: string | null;
};

function roleOf(actor: Actor): Role {
  return actor.role as Role;
}

function cleanDay(value: string, label: string): string {
  const day = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || addCalendarDays(day, 0) !== day) throw new ServiceError(`Enter a ${label} date.`);
  return day;
}

function dayMinutesOf(raw: string): number {
  const text = raw.trim();
  if (!text) return FULL_DAY_MINUTES;
  const hours = Number(text);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new ServiceError("Enter the hours.");
  const minutes = Math.round(hours * 60);
  if (minutes <= 0 || minutes > 24 * 60) throw new ServiceError("Enter the hours.");
  return minutes;
}

function bound(value: string, max: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function audit(orgId: string, actorId: string, action: string, entityId: string, payload: unknown) {
  getDb()
    .insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "time_off",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function namesFor(orgId: string): Map<string, string> {
  return new Map(
    getDb()
      .select({ id: users.id, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgId))
      .all()
      .map((row) => [row.id, row.name]),
  );
}

function memberOrThrow(orgId: string, userId: string) {
  const row = getDb()
    .select()
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .get();
  if (!row) throw new ServiceError("That person is not on this company.");
  return row;
}

function requestOrThrow(orgId: string, requestId: string) {
  const row = getDb()
    .select()
    .from(timeOffRequests)
    .where(and(eq(timeOffRequests.orgId, orgId), eq(timeOffRequests.id, requestId)))
    .get();
  if (!row) throw new ServiceError("That request is not in your company.");
  return row;
}

function clockOn(day: string, minutes: number, timeZone: string): { clockIn: string; clockOut: string } {
  const [year, month, date] = day.split("-").map(Number);
  const clockIn = new Date(zonedTimeToUtc(year, month, date, 8, 0, 0, timeZone)).toISOString();
  const clockOut = new Date(Date.parse(clockIn) + minutes * 60_000).toISOString();
  return { clockIn, clockOut };
}

function taken(orgId: string, userId: string, days: string[]): boolean {
  if (days.length === 0) return false;
  const approved = getDb()
    .select({ day: timeOffDays.day })
    .from(timeOffDays)
    .innerJoin(timeOffRequests, eq(timeOffRequests.id, timeOffDays.requestId))
    .where(and(eq(timeOffDays.orgId, orgId), eq(timeOffRequests.orgId, orgId), eq(timeOffRequests.userId, userId), eq(timeOffRequests.status, "approved")))
    .all()
    .map((row) => row.day);
  return conflictDays(approved, days[0]!, days[days.length - 1]!).some((day) => days.includes(day));
}

function payrollHours(kind: TimeOffKind, dayMinutes: number, days: { minutes: number }[]): string {
  const minutes = days.reduce((sum, day) => sum + payrollMinutes(kind, day.minutes || dayMinutes), 0);
  return hoursNumber(minutes);
}

export function requestTimeOff(actor: Actor, input: { startOn: string; endOn: string; hours?: string; kind: string; note?: string }) {
  if (!canAddFieldNotes(roleOf(actor))) throw new ServiceError("Your role cannot request time off.");
  if (!isTimeOffKind(input.kind)) throw new ServiceError("Pick a type.");
  const startOn = cleanDay(input.startOn, "start");
  const endOn = cleanDay(input.endOn, "end");
  if (endOn < startOn) throw new ServiceError("End is on or after the start.");
  if (addCalendarDays(startOn, 366) < endOn) throw new ServiceError("Pick a shorter range.");
  const dayMinutes = dayMinutesOf(input.hours ?? "");
  const calendar = workCalendarFor(actor.orgId);
  const days = expandOffDays(startOn, endOn, dayMinutes, calendar);
  if (days.length === 0) throw new ServiceError("Pick a workday.");
  const stamp = nowIso();
  const requestId = id("toff");
  getDb()
    .insert(timeOffRequests)
    .values({
      id: requestId,
      orgId: actor.orgId,
      userId: actor.userId,
      startOn,
      endOn,
      dayMinutes,
      kind: input.kind,
      status: "pending",
      note: bound(input.note ?? "", 500),
      decisionReason: "",
      decidedAt: null,
      decidedBy: null,
      createdAt: stamp,
      updatedAt: stamp,
      createdBy: actor.userId,
    })
    .run();
  audit(actor.orgId, actor.userId, "timeoff.request", requestId, { kind: input.kind, startOn, endOn, dayMinutes });
  return requestId;
}

export function cancelTimeOff(actor: Actor, requestId: string) {
  const row = requestOrThrow(actor.orgId, requestId);
  if (row.userId !== actor.userId) throw new ServiceError("You can cancel your own request.");
  if (row.status !== "pending") throw new ServiceError("Only a pending request can be cancelled.");
  const stamp = nowIso();
  getDb()
    .update(timeOffRequests)
    .set({ status: "cancelled", decidedAt: stamp, decidedBy: actor.userId, updatedAt: stamp })
    .where(and(eq(timeOffRequests.orgId, actor.orgId), eq(timeOffRequests.id, row.id)))
    .run();
  audit(actor.orgId, actor.userId, "timeoff.cancel", row.id, { status: "cancelled" });
}

export function approveTimeOff(actor: Actor, requestId: string, reason = "") {
  if (!canEditCrm(roleOf(actor))) throw new ServiceError("Your role cannot approve time off.");
  const row = requestOrThrow(actor.orgId, requestId);
  if (row.status !== "pending") throw new ServiceError("Only a pending request can be approved.");
  if (!isTimeOffKind(row.kind)) throw new ServiceError("Pick a type.");
  const calendar = workCalendarFor(actor.orgId);
  const days = expandOffDays(row.startOn, row.endOn, row.dayMinutes, calendar);
  if (days.length === 0) throw new ServiceError("Pick a workday.");
  if (taken(actor.orgId, row.userId, days.map((day) => day.day))) throw new ServiceError("That day is already off.");
  const paid = isPaidKind(row.kind);
  const zone = calendarForOrg(actor.orgId);
  const stamp = nowIso();
  const db = getDb();
  db.transaction((tx) => {
    tx.update(timeOffRequests)
      .set({
        status: "approved",
        decisionReason: bound(reason, 500),
        decidedAt: stamp,
        decidedBy: actor.userId,
        updatedAt: stamp,
      })
      .where(and(eq(timeOffRequests.orgId, actor.orgId), eq(timeOffRequests.id, row.id)))
      .run();
    const anchors: string[] = [];
    for (const day of days) {
      let entryId: string | null = null;
      if (paid) {
        const clock = clockOn(day.day, day.minutes, zone.timeZone);
        entryId = id("time");
        tx.insert(timeEntries)
          .values({
            id: entryId,
            orgId: actor.orgId,
            userId: row.userId,
            projectId: "",
            costCode: "PTO",
            shiftType: "pto",
            status: "approved",
            clockInAt: clock.clockIn,
            clockOutAt: clock.clockOut,
            breakMinutes: 0,
            breakStartedAt: null,
            note: row.note || null,
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
        anchors.push(clock.clockIn);
      }
      tx.insert(timeOffDays)
        .values({
          id: id("toffd"),
          orgId: actor.orgId,
          requestId: row.id,
          day: day.day,
          minutes: capacityOffMinutes(day.minutes),
          entryId,
        })
        .run();
    }
    const seen = new Set<string>();
    for (const anchor of anchors) {
      const week = localWeek(Date.parse(anchor), zone).startDay;
      if (seen.has(week)) continue;
      seen.add(week);
      syncApprovedWeek(tx, actor, row.userId, anchor, stamp);
    }
  });
  audit(actor.orgId, actor.userId, "timeoff.approve", row.id, { status: "approved", kind: row.kind });
}

export function declineTimeOff(actor: Actor, requestId: string, reason: string) {
  if (!canEditCrm(roleOf(actor))) throw new ServiceError("Your role cannot approve time off.");
  const why = bound(reason, 500);
  if (!why) throw new ServiceError("Enter a reason.");
  const row = requestOrThrow(actor.orgId, requestId);
  if (row.status !== "pending") throw new ServiceError("Only a pending request can be declined.");
  const stamp = nowIso();
  getDb()
    .update(timeOffRequests)
    .set({ status: "declined", decisionReason: why, decidedAt: stamp, decidedBy: actor.userId, updatedAt: stamp })
    .where(and(eq(timeOffRequests.orgId, actor.orgId), eq(timeOffRequests.id, row.id)))
    .run();
  audit(actor.orgId, actor.userId, "timeoff.decline", row.id, { status: "declined" });
}

function visible(actor: Actor, query: TimeOffQuery) {
  const office = canEditCrm(roleOf(actor));
  let rows = getDb()
    .select()
    .from(timeOffRequests)
    .where(eq(timeOffRequests.orgId, actor.orgId))
    .all();
  if (!office) rows = rows.filter((row) => row.userId === actor.userId);
  if (query.userId) rows = rows.filter((row) => row.userId === query.userId);
  if (query.status) rows = rows.filter((row) => row.status === query.status);
  if (query.from) rows = rows.filter((row) => row.endOn >= query.from!);
  if (query.to) rows = rows.filter((row) => row.startOn <= query.to!);
  return rows.sort((a, b) => b.startOn.localeCompare(a.startOn) || a.id.localeCompare(b.id));
}

function hoursFor(orgId: string, row: { id: string; kind: string; dayMinutes: number; startOn: string; endOn: string; status: string }): string {
  if (!isTimeOffKind(row.kind)) return "0";
  if (row.status === "approved") {
    const stored = getDb()
      .select()
      .from(timeOffDays)
      .where(and(eq(timeOffDays.orgId, orgId), eq(timeOffDays.requestId, row.id)))
      .all();
    return payrollHours(row.kind, row.dayMinutes, stored);
  }
  const days = expandOffDays(row.startOn, row.endOn, row.dayMinutes, workCalendarFor(orgId));
  return payrollHours(row.kind, row.dayMinutes, days);
}

function allowanceLabel(orgId: string, userId: string, allowanceMinutes: number | null): string | null {
  const left = allowanceRemaining(allowanceMinutes, usedPaidMinutes(orgId, userId));
  if (!left) return null;
  return `${hoursNumber(left.used)} used · ${hoursNumber(left.remaining)} left`;
}

function usedPaidMinutes(orgId: string, userId: string): number {
  const year = localDay(Date.now(), calendarForOrg(orgId).timeZone).slice(0, 4);
  return getDb()
    .select({ minutes: timeOffDays.minutes, kind: timeOffRequests.kind, day: timeOffDays.day })
    .from(timeOffDays)
    .innerJoin(timeOffRequests, eq(timeOffRequests.id, timeOffDays.requestId))
    .where(and(eq(timeOffDays.orgId, orgId), eq(timeOffRequests.orgId, orgId), eq(timeOffRequests.userId, userId), eq(timeOffRequests.status, "approved")))
    .all()
    .filter((row) => row.day.startsWith(year) && isTimeOffKind(row.kind) && isPaidKind(row.kind))
    .reduce((sum, row) => sum + payrollMinutes(row.kind as TimeOffKind, row.minutes), 0);
}

export function listTimeOff(actor: Actor, query: TimeOffQuery = {}): TimeOffRow[] {
  const names = namesFor(actor.orgId);
  const allowance = new Map(
    getDb()
      .select({ userId: memberships.userId, minutes: memberships.ptoAllowanceMinutes })
      .from(memberships)
      .where(eq(memberships.orgId, actor.orgId))
      .all()
      .map((row) => [row.userId, row.minutes]),
  );
  return visible(actor, query).map((row) => ({
    id: row.id,
    userId: row.userId,
    name: names.get(row.userId) || "Crew",
    startOn: row.startOn,
    endOn: row.endOn,
    dayMinutes: row.dayMinutes,
    hours: hoursFor(actor.orgId, row),
    kind: row.kind,
    kindLabel: isTimeOffKind(row.kind) ? KIND_LABEL[row.kind] : row.kind,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status] || row.status,
    note: row.note,
    decisionReason: row.decisionReason,
    decidedAt: row.decidedAt,
    decidedByName: row.decidedBy ? names.get(row.decidedBy) || "" : null,
    allowanceLabel: allowanceLabel(actor.orgId, row.userId, allowance.get(row.userId) ?? null),
  }));
}

export function timeOffPeople(actor: Actor): { id: string; name: string }[] {
  const names = namesFor(actor.orgId);
  if (!canEditCrm(roleOf(actor))) return [{ id: actor.userId, name: names.get(actor.userId) || "You" }];
  return [...names.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function timeOffCsv(actor: Actor, query: TimeOffQuery = {}): string {
  const lines = ["person,status,kind,start,end,hours,note"];
  for (const row of listTimeOff(actor, query)) {
    lines.push([csvCell(row.name), row.status, row.kind, row.startOn, row.endOn, row.hours, csvCell(row.note)].join(","));
  }
  return lines.join("\n");
}

export function timeOffAttention(actor: Actor): { count: number; href: string | null } {
  if (!canEditCrm(roleOf(actor))) return { count: 0, href: null };
  const count = getDb()
    .select()
    .from(timeOffRequests)
    .where(and(eq(timeOffRequests.orgId, actor.orgId), eq(timeOffRequests.status, "pending")))
    .all().length;
  return { count, href: count > 0 ? "/time-off?status=pending" : null };
}

export function approvedOffDays(orgId: string, from: string, to: string): { userId: string; day: string }[] {
  return getDb()
    .select({ userId: timeOffRequests.userId, day: timeOffDays.day })
    .from(timeOffDays)
    .innerJoin(timeOffRequests, eq(timeOffRequests.id, timeOffDays.requestId))
    .where(and(eq(timeOffDays.orgId, orgId), eq(timeOffRequests.orgId, orgId), eq(timeOffRequests.status, "approved")))
    .all()
    .filter((row) => row.day >= from && row.day <= to);
}

export function timeOffWarning(actor: Actor, userIds: string[], start: string, end: string): string | null {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const from = start <= end ? start : end;
  const to = start <= end ? end : start;
  const names = namesFor(actor.orgId);
  const hits = approvedOffDays(actor.orgId, from, to).filter((row) => ids.includes(row.userId));
  return outWarning(hits.map((row) => names.get(row.userId) || "Crew"));
}

export function setPtoAllowance(actor: Actor, userId: string, hours: string) {
  if (!canEditCrm(roleOf(actor))) throw new ServiceError("Your role cannot set time off.");
  memberOrThrow(actor.orgId, userId);
  const text = hours.trim();
  let minutes: number | null = null;
  if (text) {
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0 || value > 2000) throw new ServiceError("Enter the hours.");
    minutes = Math.round(value * 60);
  }
  getDb()
    .update(memberships)
    .set({ ptoAllowanceMinutes: minutes })
    .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, userId)))
    .run();
}

export function allowanceFor(actor: Actor, userId: string): { used: number; remaining: number } | null {
  if (!canEditCrm(roleOf(actor)) && actor.userId !== userId) return null;
  const row = memberOrThrow(actor.orgId, userId);
  return allowanceRemaining(row.ptoAllowanceMinutes, usedPaidMinutes(actor.orgId, userId));
}

export function timeOffAudit(orgId: string, requestId: string) {
  return getDb()
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.orgId, orgId), eq(auditLogs.entityType, "time_off"), eq(auditLogs.entityId, requestId)))
    .all();
}
