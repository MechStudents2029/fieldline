import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  costItems,
  laborRates,
  memberships,
  organizations,
  projects,
  timeApprovals,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { canManageMoney, canManageSettings, type Role } from "@/lib/permissions";
import { lockedCostMessage } from "@/lib/services/cost-plus";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { calendarForOrg, workedMinutes } from "@/lib/services/time";
import { localDay, localWeek, zonedTimeToUtc } from "@/lib/time/calendar";
import {
  OT_DEFAULTS,
  isNonJob,
  isShiftType,
  laborMoney,
  splitWeek,
  type OtRules,
  type PunchSplit,
  type ShiftType,
} from "@/lib/time/overtime";

type Writer = Pick<AppDatabase, "insert" | "select" | "update" | "delete">;
type Entry = typeof timeEntries.$inferSelect;
type Approval = typeof timeApprovals.$inferSelect;

export type PostedLabor = {
  entryId: string;
  costId: string | null;
  amountCents: number;
  rateCents: number;
  minutes: number;
  baseCents: number;
  premiumCents: number;
  burdenCents: number;
};

export function otRulesFor(db: Writer, orgId: string): OtRules {
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) return { ...OT_DEFAULTS };
  return {
    enabled: org.otEnabled === 1,
    dailyOtMinutes: org.otDailyMinutes,
    weeklyOtMinutes: org.otWeeklyMinutes > 0 ? org.otWeeklyMinutes : OT_DEFAULTS.weeklyOtMinutes,
    dailyDtMinutes: org.dtDailyMinutes,
    otDaysMask: org.otDaysMask,
    otMultiplierBps: org.otMultiplierBps > 0 ? org.otMultiplierBps : OT_DEFAULTS.otMultiplierBps,
    dtMultiplierBps: org.dtMultiplierBps > 0 ? org.dtMultiplierBps : OT_DEFAULTS.dtMultiplierBps,
    burdenBps: Math.max(0, org.burdenBps),
    nonjobCountsTowardOt: org.nonjobCountsOt === 1,
  };
}

export function burdenBpsFor(db: Writer, orgId: string, userId: string, rules: OtRules): number {
  const personal = db.select().from(laborRates).where(and(eq(laborRates.orgId, orgId), eq(laborRates.userId, userId))).get();
  if (personal?.burdenBps != null) return Math.max(0, personal.burdenBps);
  return rules.burdenBps;
}

export function hourlyCostFor(db: Writer, orgId: string, userId: string): number | null {
  const personal = db.select().from(laborRates).where(and(eq(laborRates.orgId, orgId), eq(laborRates.userId, userId))).get();
  if (personal) return personal.hourlyCostCents;
  return db.select().from(laborRates).where(and(eq(laborRates.orgId, orgId), eq(laborRates.userId, ""))).get()?.hourlyCostCents ?? null;
}

/** Reprice every approved punch in this person's workweek. Invoiced punches keep their posted cents. */
export function syncApprovedWeek(tx: Writer, actor: Actor, userId: string, anchorIso: string, stamp: string): PostedLabor[] {
  const rules = otRulesFor(tx, actor.orgId);
  const calendar = calendarForOrg(actor.orgId);
  const week = localWeek(Date.parse(anchorIso), calendar);
  const rate = hourlyCostFor(tx, actor.orgId, userId);
  const burden = burdenBpsFor(tx, actor.orgId, userId, rules);
  const entries = tx
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, actor.orgId), eq(timeEntries.userId, userId), eq(timeEntries.status, "approved")))
    .all()
    .filter((entry) => {
      const day = localDay(Date.parse(entry.clockInAt), calendar.timeZone);
      return day >= week.startDay && day < addIsoDay(week.startDay, 7);
    })
    .sort((a, b) => a.clockInAt.localeCompare(b.clockInAt) || a.id.localeCompare(b.id));
  const approvals = new Map<string, Approval>();
  for (const row of tx
    .select()
    .from(timeApprovals)
    .where(and(eq(timeApprovals.orgId, actor.orgId), eq(timeApprovals.status, "active")))
    .all()) {
    if (entries.some((entry) => entry.id === row.entryId)) approvals.set(row.entryId, row);
  }
  const worker = tx.select().from(users).where(eq(users.id, userId)).get();
  const punches = entries.map((entry) => {
    const locked = lockedCostMessage(tx, actor.orgId, "time", entry.id);
    const approval = approvals.get(entry.id);
    const shiftType = shiftOf(entry.shiftType);
    return {
      id: entry.id,
      localDay: localDay(Date.parse(entry.clockInAt), calendar.timeZone),
      minutes: workedMinutes(entry, Date.parse(stamp) || Date.now()),
      shiftType,
      frozen: locked && approval ? frozenSplit(approval) : undefined,
    };
  });
  const splits = splitWeek(punches, rules);
  const posted: PostedLabor[] = [];
  entries.forEach((entry, index) => {
    const split = splits[index];
    if (!split) return;
    const locked = Boolean(punches[index]?.frozen);
    if (locked) {
      const approval = approvals.get(entry.id);
      if (approval) {
        posted.push({
          entryId: entry.id,
          costId: approval.costItemId,
          amountCents: approval.amountCents,
          rateCents: approval.rateCents,
          minutes: approval.minutes,
          baseCents: approval.baseCents,
          premiumCents: approval.premiumCents,
          burdenCents: approval.burdenCents,
        });
      }
      return;
    }
    const job = !isNonJob(shiftOf(entry.shiftType));
    if (job && (rate == null || rate <= 0)) throw new ServiceError("Set an hourly cost before approving.");
    const priced = job && rate != null ? laborMoney(split, rate, rules, burden) : { baseCents: 0, premiumCents: 0, burdenCents: 0, totalCents: 0 };
    const result = writePost(tx, actor, entry, approvals.get(entry.id), split, priced, rate ?? 0, worker?.name || "Crew", stamp);
    if (result.premiumCents > 0 || result.burdenCents > 0) {
      const previous = approvals.get(entry.id);
      if (!previous || previous.premiumCents !== result.premiumCents || previous.burdenCents !== result.burdenCents) {
        tx.insert(auditLogs)
          .values({
            id: id("aud"),
            orgId: actor.orgId,
            actorId: actor.userId,
            action: "time.premium",
            entityType: "time_entry",
            entityId: entry.id,
            payloadJson: JSON.stringify({
              baseCents: result.baseCents,
              premiumCents: result.premiumCents,
              burdenCents: result.burdenCents,
              regularMinutes: split.regularMinutes,
              otMinutes: split.otMinutes,
              dtMinutes: split.dtMinutes,
            }),
            ip: null,
            createdAt: stamp,
          })
          .run();
      }
    }
    posted.push(result);
  });
  return posted;
}

export function repriceWeek(actor: Actor, userId: string, anchorIso: string, now = Date.now()) {
  assertOffice(actor);
  const db = officeOrThrow(actor);
  const stamp = new Date(now).toISOString();
  return db.transaction((tx) => syncApprovedWeek(tx, actor, userId, anchorIso, stamp));
}

export type OtSettingsInput = {
  enabled: boolean;
  dailyHours: number | null;
  weeklyHours: number;
  doubleHours: number | null;
  otMultiplier: number;
  dtMultiplier: number;
  burdenPercent: number;
  otDays: number[];
  nonjobCountsTowardOt: boolean;
  burdenByUser: { userId: string; percent: number | null }[];
};

export function overtimeBoard(actor: Actor) {
  if (!canManageSettings(actor.role as Role)) return null;
  const db = officeOrThrow(actor);
  const rules = otRulesFor(db, actor.orgId);
  const rates = db.select().from(laborRates).where(eq(laborRates.orgId, actor.orgId)).all();
  const people = db
    .select({ userId: memberships.userId, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((person) => ({
      userId: person.userId,
      name: person.name,
      burdenPercent: rates.find((rate) => rate.userId === person.userId)?.burdenBps,
    }));
  return { rules, people };
}

export function saveOvertimeSettings(actor: Actor, input: OtSettingsInput) {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("Only an owner or admin can change overtime.");
  const daily = hoursToMinutes(input.dailyHours, "Daily overtime");
  const weekly = hoursToMinutes(input.weeklyHours, "Weekly overtime");
  const doubleTime = hoursToMinutes(input.doubleHours, "Double time");
  if (weekly == null || weekly <= 0) throw new ServiceError("Set the weekly overtime hours.");
  if (daily != null && doubleTime != null && doubleTime <= daily) throw new ServiceError("Double time starts after daily overtime.");
  const otMultiplierBps = multiplierBps(input.otMultiplier, "Overtime multiplier");
  const dtMultiplierBps = multiplierBps(input.dtMultiplier, "Double time multiplier");
  const burdenBps = percentBps(input.burdenPercent, "Burden");
  if (input.otDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new ServiceError("Pick overtime days.");
  const otDaysMask = input.otDays.reduce((mask, day) => mask | (1 << day), 0);
  const db = officeOrThrow(actor);
  const before = otRulesFor(db, actor.orgId);
  const stamp = new Date().toISOString();
  db.transaction((tx) => {
    tx.update(organizations)
      .set({
        otEnabled: input.enabled ? 1 : 0,
        otDailyMinutes: daily,
        otWeeklyMinutes: weekly,
        dtDailyMinutes: doubleTime,
        otDaysMask,
        otMultiplierBps,
        dtMultiplierBps,
        burdenBps,
        nonjobCountsOt: input.nonjobCountsTowardOt ? 1 : 0,
        updatedAt: stamp,
      })
      .where(eq(organizations.id, actor.orgId))
      .run();
    for (const row of input.burdenByUser) {
      writeBurden(tx, actor, row.userId, row.percent == null ? null : percentBps(row.percent, "Burden"), stamp);
    }
    tx.insert(auditLogs)
      .values({
        id: id("aud"),
        orgId: actor.orgId,
        actorId: actor.userId,
        action: "time.ot_settings",
        entityType: "organization",
        entityId: actor.orgId,
        payloadJson: JSON.stringify({
          before,
          after: {
            enabled: input.enabled,
            dailyOtMinutes: daily,
            weeklyOtMinutes: weekly,
            dailyDtMinutes: doubleTime,
            otDaysMask,
            otMultiplierBps,
            dtMultiplierBps,
            burdenBps,
            nonjobCountsTowardOt: input.nonjobCountsTowardOt,
          },
        }),
        ip: null,
        createdAt: stamp,
      })
      .run();
  });
}

export function addNonJobShift(actor: Actor, input: { userId: string; day: string; hours: number; shiftType: string }, now = Date.now()) {
  assertOffice(actor);
  if (!isShiftType(input.shiftType) || input.shiftType === "regular") throw new ServiceError("Pick a non-job shift.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) throw new ServiceError("Pick a day.");
  const hours = Number(input.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new ServiceError("Enter the hours.");
  const minutes = Math.round(hours * 60);
  if (minutes <= 0) throw new ServiceError("Enter the hours.");
  const db = officeOrThrow(actor);
  const person = db.select().from(memberships).where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, input.userId))).get();
  if (!person) throw new ServiceError("That person is not on this company.");
  const calendar = calendarForOrg(actor.orgId);
  const [year, month, date] = input.day.split("-").map(Number);
  const clockIn = new Date(zonedTimeToUtc(year, month, date, 8, 0, 0, calendar.timeZone)).toISOString();
  const clockOut = new Date(Date.parse(clockIn) + minutes * 60_000).toISOString();
  const stamp = new Date(now).toISOString();
  const entryId = id("time");
  db.transaction((tx) => {
    tx.insert(timeEntries)
      .values({
        id: entryId,
        orgId: actor.orgId,
        userId: input.userId,
        projectId: "",
        costCode: input.shiftType.toUpperCase(),
        shiftType: input.shiftType,
        status: "approved",
        clockInAt: clockIn,
        clockOutAt: clockOut,
        breakMinutes: 0,
        breakStartedAt: null,
        note: null,
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
    syncApprovedWeek(tx, actor, input.userId, clockIn, stamp);
    tx.insert(auditLogs)
      .values({
        id: id("aud"),
        orgId: actor.orgId,
        actorId: actor.userId,
        action: "time.nonjob",
        entityType: "time_entry",
        entityId: entryId,
        payloadJson: JSON.stringify({ shiftType: input.shiftType, day: input.day, minutes }),
        ip: null,
        createdAt: stamp,
      })
      .run();
  });
  return { entryId };
}

export function setBillLaborBurden(actor: Actor, projectId: string, enabled: boolean) {
  assertOffice(actor);
  const db = officeOrThrow(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  db.update(projects)
    .set({ billLaborBurden: enabled ? 1 : 0, updatedAt: new Date().toISOString() })
    .where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId)))
    .run();
}

function writeBurden(tx: Writer, actor: Actor, userId: string, burdenBps: number | null, stamp: string) {
  const person = tx.select().from(memberships).where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, userId))).get();
  if (!person) return;
  const existing = tx.select().from(laborRates).where(and(eq(laborRates.orgId, actor.orgId), eq(laborRates.userId, userId))).get();
  const company = tx.select().from(laborRates).where(and(eq(laborRates.orgId, actor.orgId), eq(laborRates.userId, ""))).get();
  if (existing) {
    tx.update(laborRates).set({ burdenBps, updatedAt: stamp, updatedBy: actor.userId }).where(eq(laborRates.id, existing.id)).run();
    return;
  }
  if (burdenBps == null) return;
  if (!company) throw new ServiceError("Set a company hourly cost first.");
  tx.insert(laborRates)
    .values({
      id: id("rate"),
      orgId: actor.orgId,
      userId,
      hourlyCostCents: company.hourlyCostCents,
      burdenBps,
      updatedAt: stamp,
      updatedBy: actor.userId,
    })
    .run();
}

function writePost(
  tx: Writer,
  actor: Actor,
  entry: Entry,
  approval: Approval | undefined,
  split: PunchSplit,
  priced: { baseCents: number; premiumCents: number; burdenCents: number; totalCents: number },
  rate: number,
  vendorName: string,
  stamp: string,
): PostedLabor {
  const job = !isNonJob(shiftOf(entry.shiftType));
  const costItemId = job ? putCost(tx, actor, entry, approval?.costItemId ?? null, priced.baseCents, "labor", "Labor", vendorName, stamp) : null;
  const premiumCostItemId = job
    ? putCost(tx, actor, entry, approval?.premiumCostItemId ?? null, priced.premiumCents, "labor_premium", "OT premium", vendorName, stamp)
    : null;
  const burdenCostItemId = job
    ? putCost(tx, actor, entry, approval?.burdenCostItemId ?? null, priced.burdenCents, "labor_burden", "Burden", vendorName, stamp)
    : null;
  const minutes = split.regularMinutes + split.otMinutes + split.dtMinutes + split.nonjobMinutes;
  const values = {
    rateCents: rate,
    minutes,
    amountCents: priced.totalCents,
    costItemId,
    regularMinutes: split.regularMinutes,
    otMinutes: split.otMinutes,
    dtMinutes: split.dtMinutes,
    nonjobMinutes: split.nonjobMinutes,
    baseCents: priced.baseCents,
    premiumCents: priced.premiumCents,
    burdenCents: priced.burdenCents,
    premiumCostItemId,
    burdenCostItemId,
  };
  if (approval) {
    tx.update(timeApprovals).set(values).where(eq(timeApprovals.id, approval.id)).run();
  } else {
    tx.insert(timeApprovals)
      .values({
        id: id("tap"),
        orgId: actor.orgId,
        entryId: entry.id,
        ...values,
        status: "active",
        reason: null,
        createdAt: stamp,
        createdBy: actor.userId,
      })
      .run();
  }
    return { entryId: entry.id, costId: costItemId, amountCents: priced.totalCents, rateCents: rate, minutes, baseCents: priced.baseCents, premiumCents: priced.premiumCents, burdenCents: priced.burdenCents };
}

function putCost(
  tx: Writer,
  actor: Actor,
  entry: Entry,
  existingId: string | null,
  amountCents: number,
  source: string,
  memo: string,
  vendorName: string,
  stamp: string,
): string | null {
  if (amountCents <= 0 || !entry.projectId) {
    if (existingId) tx.delete(costItems).where(and(eq(costItems.id, existingId), eq(costItems.orgId, actor.orgId))).run();
    return null;
  }
  if (existingId) {
    tx.update(costItems)
      .set({ amountCents, memo, source, costCode: entry.costCode, vendorName, updatedAt: stamp })
      .where(and(eq(costItems.id, existingId), eq(costItems.orgId, actor.orgId)))
      .run();
    return existingId;
  }
  const costId = id("cost");
  tx.insert(costItems)
    .values({
      id: costId,
      orgId: actor.orgId,
      projectId: entry.projectId,
      budgetLineId: null,
      costCode: entry.costCode,
      amountCents,
      vendorName,
      memo,
      source,
      aiExtracted: 0,
      documentId: null,
      createdAt: stamp,
      updatedAt: stamp,
      createdBy: actor.userId,
    })
    .run();
  return costId;
}

function frozenSplit(approval: Approval): { regularMinutes: number; otMinutes: number; dtMinutes: number; nonjobMinutes: number } {
  const parts = approval.regularMinutes + approval.otMinutes + approval.dtMinutes + approval.nonjobMinutes;
  if (parts > 0) {
    return {
      regularMinutes: approval.regularMinutes,
      otMinutes: approval.otMinutes,
      dtMinutes: approval.dtMinutes,
      nonjobMinutes: approval.nonjobMinutes,
    };
  }
  return { regularMinutes: approval.minutes, otMinutes: 0, dtMinutes: 0, nonjobMinutes: 0 };
}

function shiftOf(value: string | null | undefined): ShiftType {
  return value && isShiftType(value) ? value : "regular";
}

function hoursToMinutes(hours: number | null, label: string): number | null {
  if (hours == null || Number.isNaN(hours)) return null;
  if (!Number.isFinite(hours) || hours < 0 || hours > 168) throw new ServiceError(`${label} must be between 0 and 168 hours.`);
  return Math.round(hours * 60);
}

function multiplierBps(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 1 || value > 3) throw new ServiceError(`${label} must be from 1.0 to 3.0.`);
  return Math.round(value * 10_000);
}

function percentBps(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new ServiceError(`${label} must be from 0 to 100.`);
  return Math.round(value * 100);
}

function addIsoDay(day: string, count: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date) + count * 86_400_000).toISOString().slice(0, 10);
}

function assertOffice(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Only the office can review time.");
}

function officeOrThrow(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}
