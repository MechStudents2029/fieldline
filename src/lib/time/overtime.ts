/** Split approved minutes into regular, overtime, and double time. Integer minutes only. */

export const SHIFT_TYPES = ["regular", "pto", "holiday", "sick", "training"] as const;
export type ShiftType = (typeof SHIFT_TYPES)[number];

export type OtRules = {
  enabled: boolean;
  /** Null means no daily overtime threshold. */
  dailyOtMinutes: number | null;
  weeklyOtMinutes: number;
  /** Null means no daily double-time threshold. */
  dailyDtMinutes: number | null;
  /** Bit 0 is Sunday, same as the company workweek. */
  otDaysMask: number;
  /** 15000 = 1.50×. The premium is the part above 1×. */
  otMultiplierBps: number;
  dtMultiplierBps: number;
  burdenBps: number;
  /** When false (the default), non-job minutes are paid and ignored by the thresholds. */
  nonjobCountsTowardOt: boolean;
};

export const OT_DEFAULTS: OtRules = {
  enabled: false,
  dailyOtMinutes: null,
  weeklyOtMinutes: 40 * 60,
  dailyDtMinutes: null,
  otDaysMask: 0,
  otMultiplierBps: 15_000,
  dtMultiplierBps: 20_000,
  burdenBps: 0,
  nonjobCountsTowardOt: false,
};

export type FrozenSplit = {
  regularMinutes: number;
  otMinutes: number;
  dtMinutes: number;
  nonjobMinutes: number;
};

/** Punches must already be in clock-in order. A minute is classified once. */
export type SplitPunch = {
  id: string;
  /** Local calendar day of clock-in, YYYY-MM-DD. Midnight-crossing shifts stay on this day. */
  localDay: string;
  minutes: number;
  shiftType: ShiftType;
  /** Invoiced punches keep this split and still consume the daily and weekly buckets. */
  frozen?: FrozenSplit;
};

export type PunchSplit = {
  id: string;
  regularMinutes: number;
  otMinutes: number;
  dtMinutes: number;
  nonjobMinutes: number;
};

export type LaborMoney = {
  baseCents: number;
  premiumCents: number;
  burdenCents: number;
  totalCents: number;
};

const DAY_MS = 86_400_000;

export function isShiftType(value: string): value is ShiftType {
  return (SHIFT_TYPES as readonly string[]).includes(value);
}

export function isNonJob(shiftType: ShiftType): boolean {
  return shiftType !== "regular";
}

export function weekdayOf(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

export function addDays(day: string, count: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date) + count * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Precedence, with no minute in two buckets:
 * 1. Non-job stays non-job. It counts toward thresholds only when that setting is on.
 * 2. A designated overtime day is overtime, unless it is past the daily double-time line.
 * 3. Minutes past the daily double-time line are double time.
 * 4. Minutes past the daily overtime line are overtime.
 * 5. Minutes past the weekly line are overtime.
 * 6. Everything else is regular.
 * Daily and weekly counters include minutes already classified, so a later minute can hit the weekly line,
 * but a minute already taken by a higher rule is not classified again.
 * Overtime off: every job minute is regular. Burden is applied later, not here.
 */
export function splitWeek(punches: SplitPunch[], rules: OtRules): PunchSplit[] {
  const dayCounted = new Map<string, number>();
  let weekCounted = 0;
  return punches.map((punch) => {
    if (punch.frozen) {
      const frozen = clampFrozen(punch.frozen);
      const job = frozen.regularMinutes + frozen.otMinutes + frozen.dtMinutes;
      const countsNonjob = rules.nonjobCountsTowardOt ? frozen.nonjobMinutes : 0;
      addCounted(dayCounted, punch.localDay, job + countsNonjob);
      weekCounted += job + countsNonjob;
      return { id: punch.id, ...frozen };
    }
    const minutes = Math.max(0, Math.trunc(punch.minutes));
    const nonjob = isNonJob(punch.shiftType);
    let regularMinutes = 0;
    let otMinutes = 0;
    let dtMinutes = 0;
    let nonjobMinutes = 0;
    for (let offset = 0; offset < minutes; offset += 1) {
      const counts = !nonjob || rules.nonjobCountsTowardOt;
      if (!counts) {
        nonjobMinutes += 1;
        continue;
      }
      const dayIndex = dayCounted.get(punch.localDay) ?? 0;
      const weekIndex = weekCounted;
      const kind = classifyMinute(punch, rules, nonjob, dayIndex, weekIndex);
      if (kind === "dt") dtMinutes += 1;
      else if (kind === "ot") otMinutes += 1;
      else if (kind === "nonjob") nonjobMinutes += 1;
      else regularMinutes += 1;
      dayCounted.set(punch.localDay, dayIndex + 1);
      weekCounted += 1;
    }
    return { id: punch.id, regularMinutes, otMinutes, dtMinutes, nonjobMinutes };
  });
}

function classifyMinute(punch: SplitPunch, rules: OtRules, nonjob: boolean, dayIndex: number, weekIndex: number): "regular" | "ot" | "dt" | "nonjob" {
  if (nonjob) return "nonjob";
  if (!rules.enabled) return "regular";
  const otDay = (rules.otDaysMask & (1 << weekdayOf(punch.localDay))) !== 0;
  const pastDt = rules.dailyDtMinutes != null && dayIndex >= rules.dailyDtMinutes;
  if (otDay) return pastDt ? "dt" : "ot";
  if (pastDt) return "dt";
  if (rules.dailyOtMinutes != null && dayIndex >= rules.dailyOtMinutes) return "ot";
  if (weekIndex >= rules.weeklyOtMinutes) return "ot";
  return "regular";
}

function clampFrozen(frozen: FrozenSplit): FrozenSplit {
  return {
    regularMinutes: Math.max(0, Math.trunc(frozen.regularMinutes)),
    otMinutes: Math.max(0, Math.trunc(frozen.otMinutes)),
    dtMinutes: Math.max(0, Math.trunc(frozen.dtMinutes)),
    nonjobMinutes: Math.max(0, Math.trunc(frozen.nonjobMinutes)),
  };
}

function addCounted(dayCounted: Map<string, number>, day: string, minutes: number) {
  if (minutes <= 0) return;
  dayCounted.set(day, (dayCounted.get(day) ?? 0) + minutes);
}

/** Base is 1× on job minutes. Premium is the multiplier above 1×. Burden is a percent of base + premium. */
export function laborMoney(split: PunchSplit, hourlyCostCents: number, rules: Pick<OtRules, "otMultiplierBps" | "dtMultiplierBps" | "burdenBps">, burdenBps = rules.burdenBps): LaborMoney {
  const rate = Math.max(0, Math.trunc(hourlyCostCents));
  const jobMinutes = split.regularMinutes + split.otMinutes + split.dtMinutes;
  const baseCents = rate > 0 ? Math.round((jobMinutes * rate) / 60) : 0;
  const otPremium = premiumCents(split.otMinutes, rate, rules.otMultiplierBps);
  const dtPremium = premiumCents(split.dtMinutes, rate, rules.dtMultiplierBps);
  const premiumCentsTotal = otPremium + dtPremium;
  const burden = burdenCents(baseCents + premiumCentsTotal, burdenBps);
  return {
    baseCents,
    premiumCents: premiumCentsTotal,
    burdenCents: burden,
    totalCents: baseCents + premiumCentsTotal + burden,
  };
}

export function premiumCents(minutes: number, hourlyCostCents: number, multiplierBps: number): number {
  const extra = Math.trunc(multiplierBps) - 10_000;
  if (minutes <= 0 || hourlyCostCents <= 0 || extra <= 0) return 0;
  return Math.round((minutes * hourlyCostCents * extra) / 60 / 10_000);
}

export function burdenCents(baseAndPremium: number, burdenBps: number): number {
  if (baseAndPremium <= 0 || burdenBps <= 0) return 0;
  return Math.round((baseAndPremium * Math.trunc(burdenBps)) / 10_000);
}

export const PLANNED_DAY_MINUTES = 8 * 60;

export type OtWatchPerson = {
  userId: string;
  name: string;
  /** Minutes already counted toward this week's threshold, on or before today. */
  countedMinutes: number;
  /** Local days in the horizon this person is assigned on the schedule. */
  assignmentDays: string[];
};

/** Someone under the weekly line whose next two workdays of assignments would cross it. */
export function projectedWeeklyOt(
  rules: OtRules,
  today: string,
  weekStart: string,
  workdaysMask: number,
  people: OtWatchPerson[],
): { userId: string; name: string; countedMinutes: number; projectedMinutes: number }[] {
  if (!rules.enabled) return [];
  const weekEnd = addDays(weekStart, 7);
  const horizon = nextWorkdays(today, weekEnd, workdaysMask, 2);
  if (horizon.length === 0) return [];
  const horizonSet = new Set(horizon);
  const rows = [];
  for (const person of people) {
    const counted = Math.max(0, Math.trunc(person.countedMinutes));
    if (counted >= rules.weeklyOtMinutes) continue;
    const days = new Set(person.assignmentDays.filter((day) => horizonSet.has(day)));
    if (days.size === 0) continue;
    const projected = counted + days.size * PLANNED_DAY_MINUTES;
    if (projected < rules.weeklyOtMinutes) continue;
    rows.push({ userId: person.userId, name: person.name, countedMinutes: counted, projectedMinutes: projected });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function nextWorkdays(today: string, weekEnd: string, workdaysMask: number, count: number): string[] {
  const days: string[] = [];
  let cursor = today;
  for (let step = 0; step < 7 && days.length < count && cursor < weekEnd; step += 1) {
    if ((workdaysMask & (1 << weekdayOf(cursor))) !== 0) days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}
