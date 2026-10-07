import { addCalendarDays } from "@/lib/time/calendar";

/** Bit 0 is Sunday through bit 6 Saturday. 62 is Monday–Friday. */
export const DEFAULT_WORKDAY_MASK = 62;

export function weekdayOf(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, date ?? 1)).getUTCDay();
}

export function isWorkday(day: string, mask = DEFAULT_WORKDAY_MASK): boolean {
  return (mask & (1 << weekdayOf(day))) !== 0;
}

export function snapWorkday(day: string, mask = DEFAULT_WORKDAY_MASK, direction: 1 | -1 = 1): string {
  let cursor = day;
  for (let guard = 0; guard < 14; guard += 1) {
    if (isWorkday(cursor, mask)) return cursor;
    cursor = addCalendarDays(cursor, direction);
  }
  throw new Error("No workday in range.");
}

/** Move `count` workdays. Zero snaps forward onto a workday. Positive counts workdays after `day`. */
export function addWorkdays(day: string, count: number, mask = DEFAULT_WORKDAY_MASK): string {
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
export function workdayOffset(anchor: string, day: string, mask = DEFAULT_WORKDAY_MASK): number {
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
export function dateFromOffset(anchor: string, offset: number, mask = DEFAULT_WORKDAY_MASK): string {
  const start = snapWorkday(anchor, mask, 1);
  if (offset === 0) return start;
  return addWorkdays(start, offset, mask);
}

/** Inclusive workday count. A weekend-only span is 0. */
export function inclusiveWorkdays(start: string, end: string, mask = DEFAULT_WORKDAY_MASK): number {
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
export function endFromDuration(start: string, duration: number, mask = DEFAULT_WORKDAY_MASK): string {
  const snapped = snapWorkday(start, mask, 1);
  const days = Math.max(1, duration);
  if (days === 1) return snapped;
  return addWorkdays(snapped, days - 1, mask);
}
