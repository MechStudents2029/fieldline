import { addCalendarDays, localDay, type WorkCalendar } from "@/lib/time/calendar";

export const WEEK_MINUTES = 40 * 60;

export type ReviewView = "day" | "week" | "period";

export type GridEntry = {
  id: string;
  userId: string;
  status: string;
  clockInAt: string;
  clockOutAt: string | null;
  breakMinutes: number;
};

export type GridPerson = { userId: string; name: string };

export type DayHours = { day: string; minutes: number; hours: number };

export type PersonRow = {
  userId: string;
  name: string;
  days: DayHours[];
  totalMinutes: number;
  totalHours: number;
  overtimeMinutes: number;
  status: "Submitted" | "Approved" | "—";
};

export type WeekAggregate = {
  days: string[];
  rows: PersonRow[];
  totalHours: number;
  overtimeHours: number;
  pendingIds: string[];
};

export function reviewView(value: string | null | undefined): ReviewView {
  if (value === "day" || value === "period") return value;
  return "week";
}

export function weekStartDay(day: string, weekStartsOn: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  const startDow = ((weekStartsOn % 7) + 7) % 7;
  return addCalendarDays(day, -((weekday - startDow + 7) % 7));
}

export function periodStartDay(day: string, weekStartsOn: number): string {
  const start = weekStartDay(day, weekStartsOn);
  const epoch = weekStartDay("2020-01-06", weekStartsOn);
  const weeks = Math.round((Date.parse(`${start}T12:00:00Z`) - Date.parse(`${epoch}T12:00:00Z`)) / (7 * 86_400_000));
  return weeks % 2 === 0 ? start : addCalendarDays(start, -7);
}

export function reviewDays(view: ReviewView, anchorDay: string, weekStartsOn: number): string[] {
  if (view === "day") return [anchorDay];
  if (view === "week") {
    const start = weekStartDay(anchorDay, weekStartsOn);
    return Array.from({ length: 7 }, (_, index) => addCalendarDays(start, index));
  }
  const start = periodStartDay(anchorDay, weekStartsOn);
  return Array.from({ length: 14 }, (_, index) => addCalendarDays(start, index));
}

export function shiftAnchor(view: ReviewView, anchorDay: string, weekStartsOn: number, direction: -1 | 1): string {
  if (view === "day") return addCalendarDays(anchorDay, direction);
  if (view === "week") return addCalendarDays(weekStartDay(anchorDay, weekStartsOn), direction * 7);
  return addCalendarDays(periodStartDay(anchorDay, weekStartsOn), direction * 14);
}

export function rangeLabel(days: string[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return "";
  if (first === last) {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${first}T12:00:00Z`));
  }
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt.format(new Date(`${first}T12:00:00Z`))} – ${fmt.format(new Date(`${last}T12:00:00Z`))}`;
}

export function dayHeading(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date);
  const dateNum = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" }).format(date);
  return `${weekday} ${dateNum}`;
}

/** Hours past 40 in each workweek, summed. Display only. Not a wage. */
export function hoursOver40(weekMinutes: number[]): number {
  const extra = weekMinutes.reduce((sum, minutes) => sum + Math.max(0, minutes - WEEK_MINUTES), 0);
  return extra / 60;
}

export function entryMinutes(entry: GridEntry, now = Date.now()): number {
  const start = Date.parse(entry.clockInAt);
  const end = entry.clockOutAt ? Date.parse(entry.clockOutAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  const breakMs = Math.max(0, entry.breakMinutes) * 60_000;
  return Math.max(0, Math.round((end - start - breakMs) / 60_000));
}

export function aggregateWeek(
  entries: GridEntry[],
  people: GridPerson[],
  days: string[],
  calendar: WorkCalendar,
  now = Date.now(),
): WeekAggregate {
  const daySet = new Set(days);
  const countable = entries.filter((entry) => entry.status !== "void");
  const pendingIds = countable
    .filter((entry) => entry.status === "pending" && daySet.has(localDay(Date.parse(entry.clockInAt), calendar.timeZone)))
    .map((entry) => entry.id);
  const rows = people.map((person) => {
    const mine = countable.filter((entry) => entry.userId === person.userId);
    const byDay = new Map<string, number>();
    for (const day of days) byDay.set(day, 0);
    const weekBuckets = new Map<string, number>();
    for (const entry of mine) {
      const day = localDay(Date.parse(entry.clockInAt), calendar.timeZone);
      if (!daySet.has(day)) continue;
      const minutes = entryMinutes(entry, now);
      byDay.set(day, (byDay.get(day) ?? 0) + minutes);
      const bucket = weekStartDay(day, calendar.weekStartsOn);
      weekBuckets.set(bucket, (weekBuckets.get(bucket) ?? 0) + minutes);
    }
    const inView = mine.filter((entry) => daySet.has(localDay(Date.parse(entry.clockInAt), calendar.timeZone)));
    const rowStatus: PersonRow["status"] = inView.some((entry) => entry.status === "pending")
      ? "Submitted"
      : inView.some((entry) => entry.status === "approved")
        ? "Approved"
        : "—";
    const dayCells = days.map((day) => {
      const minutes = byDay.get(day) ?? 0;
      return { day, minutes, hours: minutes / 60 };
    });
    const totalMinutes = dayCells.reduce((sum, cell) => sum + cell.minutes, 0);
    const overtimeMinutes = [...weekBuckets.values()].reduce((sum, minutes) => sum + Math.max(0, minutes - WEEK_MINUTES), 0);
    return {
      userId: person.userId,
      name: person.name,
      days: dayCells,
      totalMinutes,
      totalHours: totalMinutes / 60,
      overtimeMinutes,
      status: rowStatus,
    };
  });
  const overtimeHours = rows.reduce((sum, row) => sum + row.overtimeMinutes, 0) / 60;
  return {
    days,
    rows,
    totalHours: rows.reduce((sum, row) => sum + row.totalHours, 0),
    overtimeHours,
    pendingIds,
  };
}
