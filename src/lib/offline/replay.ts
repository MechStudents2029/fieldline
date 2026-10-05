import { SYNC_BATCH_LIMIT, type OfflineEvent, type SyncResult } from "@/lib/offline/event";

export const DRIFT_MS = 2 * 60 * 1000;
export const STALE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_BACKOFF_MS = 5 * 60 * 1000;

export type ClockFlag = "future" | "stale" | "clock_drift" | null;

/** Future wins, then a capture older than 7 days, then a clock more than 2 minutes off. */
export function clockFlag(capturedMs: number, serverNow: number): ClockFlag {
  if (!Number.isFinite(capturedMs) || !Number.isFinite(serverNow)) return "future";
  if (capturedMs > serverNow) return "future";
  if (serverNow - capturedMs > STALE_MS) return "stale";
  if (Math.abs(serverNow - capturedMs) > DRIFT_MS) return "clock_drift";
  return null;
}

export function backoffMs(attempt: number): number {
  const n = Math.max(0, Math.floor(attempt));
  const delay = 2 ** Math.min(n, 16) * 1000;
  return Math.min(MAX_BACKOFF_MS, delay);
}

export function sortOldestFirst<T extends { capturedAt: string; seq?: number }>(events: T[]): T[] {
  return [...events].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || (a.seq ?? 0) - (b.seq ?? 0));
}

export function batchSlice<T extends { capturedAt: string; seq?: number }>(events: T[]): T[] {
  return sortOldestFirst(events).slice(0, SYNC_BATCH_LIMIT);
}

export type ShiftSnapshot = {
  projectId: string;
  projectName: string;
  costCode: string;
  status: "open" | "break";
  clockInAt: string;
} | null;

/** Replay pending punches on top of the last server shift so the phone can show the next button. */
export function projectShift(
  base: ShiftSnapshot,
  events: Pick<OfflineEvent, "kind" | "capturedAt" | "seq" | "projectId" | "costCode" | "syncStatus">[],
  names: ReadonlyMap<string, string>,
): ShiftSnapshot {
  let current = base;
  for (const event of sortOldestFirst(events)) {
    if (event.syncStatus === "needs_review" || event.syncStatus === "wrong_user") continue;
    if (event.kind === "clock_in" && event.projectId && event.costCode) {
      current = {
        projectId: event.projectId,
        projectName: names.get(event.projectId) ?? "Job",
        costCode: event.costCode,
        status: "open",
        clockInAt: event.capturedAt,
      };
    } else if (event.kind === "clock_out") {
      current = null;
    } else if (event.kind === "break_start" && current) {
      current = { ...current, status: "break" };
    } else if (event.kind === "break_end" && current) {
      current = { ...current, status: "open" };
    } else if (event.kind === "switch" && current && event.projectId && event.costCode) {
      current = {
        ...current,
        projectId: event.projectId,
        projectName: names.get(event.projectId) ?? "Job",
        costCode: event.costCode,
        status: "open",
        clockInAt: event.capturedAt,
      };
    }
  }
  return current;
}

export function pendingSyncCount(events: { syncStatus?: string; kind: string }[]): number {
  return events.filter((event) => event.syncStatus !== "needs_review" && event.syncStatus !== "wrong_user").length;
}

/** Applied rows leave the phone. Review rows stay visible and are not sent again. */
export function keepAfterSync(result: Pick<SyncResult, "status">): "drop" | "review" | "keep" | "signin" {
  if (result.status === "applied") return "drop";
  if (result.status === "needs_review") return "review";
  if (result.status === "sign_in") return "signin";
  return "keep";
}

export function sameScope(event: { orgId: string; userId: string }, scope: { orgId: string; userId: string }): boolean {
  return event.orgId === scope.orgId && event.userId === scope.userId;
}
