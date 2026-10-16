import { addCalendarDays } from "@/lib/time/calendar";
import { isWorkday, type WorkdayCalendar } from "@/lib/schedule/workdays";
import { DEFAULT_DAY_MINUTES } from "@/lib/workload/hours";

export const FULL_DAY_MINUTES = DEFAULT_DAY_MINUTES;
export const TIME_OFF_KINDS = ["vacation", "sick", "personal", "unpaid"] as const;
export const TIME_OFF_STATUSES = ["pending", "approved", "declined", "cancelled"] as const;

export type TimeOffKind = (typeof TIME_OFF_KINDS)[number];
export type TimeOffStatus = (typeof TIME_OFF_STATUSES)[number];

const PAID = new Set<TimeOffKind>(["vacation", "sick", "personal"]);

export function isTimeOffKind(value: string): value is TimeOffKind {
  return (TIME_OFF_KINDS as readonly string[]).includes(value);
}

export function isPaidKind(kind: TimeOffKind): boolean {
  return PAID.has(kind);
}

/** Workdays in the range. Weekends and company days off are left out. */
export function expandOffDays(start: string, end: string, dayMinutes: number, calendar: WorkdayCalendar): { day: string; minutes: number }[] {
  if (end < start || dayMinutes <= 0) return [];
  const rows: { day: string; minutes: number }[] = [];
  let cursor = start;
  for (let guard = 0; guard < 400 && cursor <= end; guard += 1) {
    if (isWorkday(cursor, calendar)) rows.push({ day: cursor, minutes: dayMinutes });
    cursor = addCalendarDays(cursor, 1);
  }
  return rows;
}

/** Paid kinds count as payroll hours. Unpaid is out and posts 0. */
export function payrollMinutes(kind: TimeOffKind, dayMinutes: number): number {
  return isPaidKind(kind) ? dayMinutes : 0;
}

/** Approved time off reduces capacity on a workday, paid or unpaid. */
export function capacityOffMinutes(dayMinutes: number): number {
  return dayMinutes > 0 ? dayMinutes : 0;
}

export function conflictDays(offDays: string[], start: string, end: string): string[] {
  const from = start <= end ? start : end;
  const to = start <= end ? end : start;
  return offDays.filter((day) => day >= from && day <= to).sort();
}

export function outWarning(names: string[]): string | null {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return null;
  if (unique.length === 1) return `${unique[0]} is out`;
  return `${unique.join(", ")} are out`;
}

/** Null allowance means the yearly hours are off. Remaining can go below zero. */
export function allowanceRemaining(allowanceMinutes: number | null, usedPaidMinutes: number): { used: number; remaining: number } | null {
  if (allowanceMinutes == null) return null;
  return { used: usedPaidMinutes, remaining: allowanceMinutes - usedPaidMinutes };
}
