import { addCalendarDays } from "@/lib/time/calendar";
import { shiftSpan } from "@/lib/schedule/range";

export type GanttZoom = "week" | "month" | "quarter";

export function cleanZoom(value: string | undefined | null): GanttZoom | null {
  if (value === "week" || value === "month" || value === "quarter") return value;
  return null;
}

export function dayWidth(zoom: GanttZoom): number {
  if (zoom === "week") return 28;
  if (zoom === "month") return 12;
  return 6;
}

/** Drag a bar by whole calendar days. The length stays the same. */
export function moveBar(start: string, end: string, deltaDays: number): { startDate: string; endDate: string } {
  if (!deltaDays) return { startDate: start, endDate: end };
  return shiftSpan(start, end, addCalendarDays(start, deltaDays));
}

/** Drag the finish. The start stays. A bar is at least one day and at most 62. */
export function resizeBar(start: string, end: string, deltaDays: number): { startDate: string; endDate: string } {
  const next = addCalendarDays(end, deltaDays);
  if (next < start) return { startDate: start, endDate: start };
  const cap = addCalendarDays(start, 61);
  return { startDate: start, endDate: next > cap ? cap : next };
}

export function dayHeading(date: string, zoom: GanttZoom, weekStartsOn = 1): string {
  const stamp = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(stamp.getTime())) return "";
  if (zoom === "quarter") {
    if (stamp.getUTCDate() !== 1) return "";
    return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(stamp);
  }
  if (zoom === "month") {
    const start = ((weekStartsOn % 7) + 7) % 7;
    if (stamp.getUTCDay() !== start) return "";
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(stamp);
  }
  return String(stamp.getUTCDate());
}
