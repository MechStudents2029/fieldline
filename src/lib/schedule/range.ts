import { addCalendarDays, localDayBounds, localWeek, type WorkCalendar } from "@/lib/time/calendar";

export type ScheduleSpan = 7 | 14;

export type ScheduleWindow = {
  startDay: string;
  endDay: string;
  days: string[];
  start: number;
  end: number;
};

/** Company workweek, or two of them, as calendar dates. End is the exclusive instant after the last day. */
export function scheduleWindow(anchorMs: number, calendar: WorkCalendar, span: ScheduleSpan): ScheduleWindow {
  const length = span === 14 ? 14 : 7;
  const week = localWeek(anchorMs, calendar);
  const days = Array.from({ length }, (_, index) => addCalendarDays(week.startDay, index));
  const start = localDayBounds(days[0]!, calendar.timeZone).start;
  const end = localDayBounds(days[days.length - 1]!, calendar.timeZone).end;
  return { startDay: days[0]!, endDay: days[days.length - 1]!, days, start, end };
}

export function inclusiveDays(startDate: string, endDate: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) return [];
  const days: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate && days.length < 366) {
    days.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return days;
}

/** Keep the same number of calendar days, starting on nextStart. */
export function shiftSpan(startDate: string, endDate: string, nextStart: string): { startDate: string; endDate: string } {
  const count = Math.max(1, inclusiveDays(startDate, endDate).length);
  return { startDate: nextStart, endDate: addCalendarDays(nextStart, count - 1) };
}
