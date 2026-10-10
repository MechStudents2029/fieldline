import { addCalendarDays } from "@/lib/time/calendar";

/** Bit 0 is Sunday through bit 6 Saturday. 62 is Monday–Friday. */
export const DEFAULT_WORKDAY_MASK = 62;

/** A dated exception. Yearly rows match the month and day in later years. Later rows win. */
export type WorkException = {
  kind: "off" | "work";
  start: string;
  end: string;
  yearly: boolean;
};

export type WorkdayCalendar = {
  mask: number;
  exceptions: WorkException[];
};

export function weekdayOf(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, date ?? 1)).getUTCDay();
}

function asCalendar(calendar: number | WorkdayCalendar): WorkdayCalendar {
  if (typeof calendar === "number") return { mask: calendar, exceptions: [] };
  return calendar;
}

function covers(day: string, exception: WorkException): boolean {
  if (!exception.yearly) return day >= exception.start && day <= exception.end;
  const monthDay = day.slice(5);
  const start = exception.start.slice(5);
  const end = exception.end.slice(5);
  if (start <= end) return monthDay >= start && monthDay <= end;
  return monthDay >= start || monthDay <= end;
}

export function isWorkday(day: string, calendar: number | WorkdayCalendar = DEFAULT_WORKDAY_MASK): boolean {
  const spec = asCalendar(calendar);
  let work = (spec.mask & (1 << weekdayOf(day))) !== 0;
  for (const exception of spec.exceptions) {
    if (covers(day, exception)) work = exception.kind === "work";
  }
  return work;
}

export function snapWorkday(day: string, mask: number | WorkdayCalendar = DEFAULT_WORKDAY_MASK, direction: 1 | -1 = 1): string {
  let cursor = day;
  for (let guard = 0; guard < 14; guard += 1) {
    if (isWorkday(cursor, mask)) return cursor;
    cursor = addCalendarDays(cursor, direction);
  }
  throw new Error("No workday in range.");
}

/** Move `count` workdays. Zero snaps forward onto a workday. Positive counts workdays after `day`. */
export function addWorkdays(day: string, count: number, mask: number | WorkdayCalendar = DEFAULT_WORKDAY_MASK): string {
  if (!Number.isInteger(count)) throw new Error("Workday count must be a whole number.");
  if (count === 0) return snapWorkday(day, mask, 1);
  const step = count > 0 ? 1 : -1;
  let left = Math.abs(count);
  let cursor = day;
  for (let guard = 0; guard < 3700 && left > 0; guard += 1) {
    cursor = addCalendarDays(cursor, step);
    if (isWorkday(cursor, mask)) left -= 1;
  }
  if (left > 0) throw new Error("Workday span is too long.");
  return cursor;
}

/** Workdays from the anchor workday to `day`. The anchor snaps forward. A non-workday snaps toward the anchor. */
export function workdayOffset(anchor: string, day: string, mask: number | WorkdayCalendar = DEFAULT_WORKDAY_MASK): number {
  const start = snapWorkday(anchor, mask, 1);
  const target = day === start ? start : day > start ? snapWorkday(day, mask, 1) : snapWorkday(day, mask, -1);
  if (target === start) return 0;
  const step = target > start ? 1 : -1;
  let count = 0;
  let cursor = start;
  for (let guard = 0; guard < 3700 && cursor !== target; guard += 1) {
    cursor = addCalendarDays(cursor, step);
    if (isWorkday(cursor, mask)) count += step;
  }
  return count;
}

/** Offset 0 is the anchor workday. Offset 1 is the next workday. */
export function dateFromOffset(anchor: string, offset: number, mask: number | WorkdayCalendar = DEFAULT_WORKDAY_MASK): string {
  const start = snapWorkday(anchor, mask, 1);
  if (offset === 0) return start;
  return addWorkdays(start, offset, mask);
}

/** Inclusive workday count. A weekend-only span is 0. */
export function inclusiveWorkdays(start: string, end: string, mask: number | WorkdayCalendar = DEFAULT_WORKDAY_MASK): number {
  if (end < start) return 0;
  let count = 0;
  let cursor = start;
  for (let guard = 0; guard < 400 && cursor <= end; guard += 1) {
    if (isWorkday(cursor, mask)) count += 1;
    cursor = addCalendarDays(cursor, 1);
  }
  return count;
}

/** Inclusive duration. A one-workday item ends on its start. */
export function endFromDuration(start: string, duration: number, mask: number | WorkdayCalendar = DEFAULT_WORKDAY_MASK): string {
  const snapped = snapWorkday(start, mask, 1);
  const days = Math.max(1, duration);
  if (days === 1) return snapped;
  return addWorkdays(snapped, days - 1, mask);
}
