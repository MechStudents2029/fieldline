import { addDays } from "@/lib/agreements/cadence";
import { windowsOverlap, type TimeWindow } from "@/lib/dispatch/assign";
import { localDay } from "@/lib/time/calendar";

/** 15 minutes through 12 hours, on a 15-minute step. */
export const DURATION_MIN = 15;
export const DURATION_MAX = 12 * 60;
export const INTERVALS = [15, 30, 60] as const;
export const BOOK_HORIZON = 14;

export type Hours = { startMin: number; endMin: number };
/** inherit uses the company window. null is closed that day. */
export type TechHours = Hours | "inherit" | null;

export type BusySpan = { userId: string; startMin: number; endMin: number };

export type Slot = { startMin: number; endMin: number; userIds: string[] };

export function assertDuration(minutes: number): number {
  if (!Number.isInteger(minutes) || minutes < DURATION_MIN || minutes > DURATION_MAX || minutes % DURATION_MIN !== 0) {
    throw new Error("Duration is 15 minutes to 12 hours.");
  }
  return minutes;
}

export function assertInterval(minutes: number): number {
  if (!(INTERVALS as readonly number[]).includes(minutes)) throw new Error("Interval is 15, 30, or 60.");
  return minutes;
}

export function assertBuffer(minutes: number): number {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 120 || minutes % DURATION_MIN !== 0) {
    throw new Error("Buffer is 0 to 120 minutes.");
  }
  return minutes;
}

export function assertHours(startMin: number, endMin: number): Hours {
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin < 0 || endMin > 24 * 60 || endMin - startMin < DURATION_MIN) {
    throw new Error("Hours need a start and a later end.");
  }
  return { startMin, endMin };
}

export function durationLabel(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

export function addClock(day: string, minute: number, delta: number): { day: string; minute: number } {
  const total = minute + delta;
  const dayShift = Math.floor(total / (24 * 60));
  const next = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return { day: addDays(day, dayShift), minute: next };
}

export function zonedNow(timeZone: string, instant = Date.now()): { day: string; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const clock = (hour === 24 ? 0 : hour) * 60 + minute;
  return { day: localDay(instant, timeZone), minute: clock };
}

function resolved(company: Hours | null, hours: TechHours): Hours | null {
  if (hours === "inherit") return company;
  return hours;
}

function blocked(span: BusySpan, bufferMin: number): TimeWindow {
  return { startMin: span.startMin - bufferMin, endMin: span.endMin + bufferMin };
}

/**
 * Slots where at least one tech is free for the whole duration.
 * Buffer widens each existing appointment. Touching that edge is free.
 * The assignee is the first id in ascending order when several are free.
 */
export function daySlots(input: {
  durationMin: number;
  intervalMin: number;
  bufferMin: number;
  company: Hours | null;
  techs: { id: string; hours: TechHours }[];
  busy: BusySpan[];
  off: string[];
  notBeforeMin: number;
}): Slot[] {
  const duration = assertDuration(input.durationMin);
  const interval = assertInterval(input.intervalMin);
  const buffer = assertBuffer(input.bufferMin);
  const off = new Set(input.off);
  const byStart = new Map<number, string[]>();
  for (const tech of input.techs) {
    if (off.has(tech.id)) continue;
    const hours = resolved(input.company, tech.hours);
    if (!hours) continue;
    const mine = input.busy.filter((span) => span.userId === tech.id).map((span) => blocked(span, buffer));
    for (let start = hours.startMin; start + duration <= hours.endMin; start += interval) {
      if (start < input.notBeforeMin) continue;
      const slot: TimeWindow = { startMin: start, endMin: start + duration };
      if (mine.some((span) => windowsOverlap(slot, span))) continue;
      const list = byStart.get(start) ?? [];
      list.push(tech.id);
      byStart.set(start, list);
    }
  }
  return [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([startMin, userIds]) => ({ startMin, endMin: startMin + duration, userIds: [...userIds].sort() }));
}

/** First free tech in ascending id order. Documented so a second free tech does not shuffle. */
export function pickAssignee(userIds: string[]): string {
  const id = [...userIds].sort()[0];
  if (!id) throw new Error("Nobody is free.");
  return id;
}
