import { addCalendarDays, localDay } from "@/lib/time/calendar";

export type DayRange = { start: string; end: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive local days. The default window is today and the six days before it. */
export function defaultRange(now: number, timeZone: string): DayRange {
  const end = localDay(now, timeZone);
  return { start: addCalendarDays(end, -6), end };
}

/** The seven local days after a range ends. */
export function nextWeekRange(end: string): DayRange {
  return { start: addCalendarDays(end, 1), end: addCalendarDays(end, 7) };
}

export function inRange(day: string, start: string, end: string): boolean {
  return DAY.test(day) && day >= start && day <= end;
}

export function daysInRange(start: string, end: string): string[] {
  if (!DAY.test(start) || !DAY.test(end) || start > end) return [];
  const days: string[] = [];
  let cursor = start;
  while (cursor <= end && days.length < 400) {
    days.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return days;
}

export function parseRange(start: string, end: string): DayRange {
  const cleanStart = start.trim();
  const cleanEnd = end.trim();
  if (!DAY.test(cleanStart) || !DAY.test(cleanEnd) || cleanStart > cleanEnd) {
    throw new Error("Choose a start and end date.");
  }
  if (daysInRange(cleanStart, cleanEnd).length > 31) {
    throw new Error("Use a shorter range.");
  }
  return { start: cleanStart, end: cleanEnd };
}
