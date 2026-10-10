import { addCalendarDays } from "@/lib/time/calendar";
import { inclusiveWorkdays, isWorkday, type WorkdayCalendar } from "@/lib/schedule/workdays";

export const PERMIT_TYPES = ["building", "electrical", "plumbing", "mechanical", "other"] as const;
export const PERMIT_STATUSES = ["not_applied", "applied", "issued", "expired", "closed"] as const;
export const INSPECTION_RESULTS = ["pending", "passed", "failed", "partial", "cancelled"] as const;
export const GATE_MODES = ["off", "warn", "block"] as const;

export type PermitType = (typeof PERMIT_TYPES)[number];
export type PermitStatus = (typeof PERMIT_STATUSES)[number];
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];
export type GateMode = (typeof GATE_MODES)[number];

const OPEN_RESULTS = new Set(["pending", "failed", "partial"]);

export function permitTypeLabel(type: string): string {
  if (type === "building") return "Building";
  if (type === "electrical") return "Electrical";
  if (type === "plumbing") return "Plumbing";
  if (type === "mechanical") return "Mechanical";
  if (type === "other") return "Other";
  return type;
}

export function permitStatusLabel(status: string): string {
  if (status === "not_applied") return "Not applied";
  if (status === "applied") return "Applied";
  if (status === "issued") return "Issued";
  if (status === "expired") return "Expired";
  if (status === "closed") return "Closed";
  return status;
}

export function inspectionResultLabel(result: string): string {
  if (result === "pending") return "Pending";
  if (result === "passed") return "Passed";
  if (result === "failed") return "Failed";
  if (result === "partial") return "Partial";
  if (result === "cancelled") return "Cancelled";
  return result;
}

export function gateMode(value: string | null | undefined): GateMode {
  if (value === "off" || value === "block" || value === "warn") return value;
  return "warn";
}

export function isPermitType(value: string): value is PermitType {
  return (PERMIT_TYPES as readonly string[]).includes(value);
}

export function isPermitStatus(value: string): value is PermitStatus {
  return (PERMIT_STATUSES as readonly string[]).includes(value);
}

export function isInspectionResult(value: string): value is InspectionResult {
  return (INSPECTION_RESULTS as readonly string[]).includes(value);
}

/** A failed, partial, or pending inspection still holds the items it gates. */
export function gateDecision(input: {
  mode: GateMode;
  name: string | null;
  scheduledOn: string | null;
  previous: { startDate: string; status: string };
  next: { startDate: string; status: string };
}): { action: "allow" | "warn" | "block"; reason: string | null } {
  if (input.mode === "off" || !input.name) return { action: "allow", reason: null };
  const started = (input.next.status === "confirmed" || input.next.status === "done") && input.next.status !== input.previous.status;
  const draggedBefore = input.next.startDate !== input.previous.startDate && (input.scheduledOn == null || input.next.startDate < input.scheduledOn);
  if (!started && !draggedBefore) return { action: "allow", reason: null };
  return { action: input.mode, reason: `${input.name} has not passed.` };
}

/** Workdays from today through `day`, using the company calendar. Today itself counts when it is a workday. */
export function inNextWorkdays(today: string, day: string, calendar: number | WorkdayCalendar, count: number): boolean {
  if (!day || day < today || !isWorkday(day, calendar)) return false;
  const span = inclusiveWorkdays(today, day, calendar);
  return span >= 1 && span <= count;
}

export function permitExpiring(today: string, expiresOn: string | null, status: string): boolean {
  if (!expiresOn || status === "closed" || status === "expired") return false;
  return expiresOn >= today && expiresOn <= addCalendarDays(today, 30);
}

export function latestByRoot<T extends { rootId: string; attempt: number }>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const current = best.get(row.rootId);
    if (!current || row.attempt > current.attempt) best.set(row.rootId, row);
  }
  return [...best.values()];
}

export function inspectionStillOpen(result: string): boolean {
  return OPEN_RESULTS.has(result);
}
