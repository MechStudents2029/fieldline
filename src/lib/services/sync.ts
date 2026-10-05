import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import { dailyLogs, priceBookItems, projects, syncEvents, timeAnomalies, timeEntries } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { offlineEventSchema, type OfflineEvent, type SyncResult } from "@/lib/offline/event";
import { clockFlag, sortOldestFirst, type ClockFlag } from "@/lib/offline/replay";
import { canAddFieldNotes, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import { openDailyLog, saveDailyLog, type LogInput } from "@/lib/services/logs";
import type { Actor } from "@/lib/services/read";
import { calendarForOrg, clockIn, clockOut, endBreak, startBreak, switchJob } from "@/lib/services/time";
import { localDay } from "@/lib/time/calendar";

const envelope = z.object({
  events: z.array(z.unknown()).max(50),
});

const DETAILS: Record<string, string> = {
  future: "The phone clock is ahead of the server. The punch time is the time on the phone.",
  stale: "The punch is older than 7 days. The office needs to review it.",
  clock_drift: "The phone clock was more than 2 minutes off the server. The punch time is the time on the phone.",
  out_without_in: "Clock-out arrived with no open punch.",
  overlap: "This clock-in overlapped a punch that was already open.",
  locked: "This punch falls inside time the office already approved.",
  missing_job: "That job was archived or deleted before the punch synced.",
  missing_code: "That cost code was removed from the price book before the punch synced.",
  published_log: "A published log already exists for that day, so the offline draft was not applied.",
  invalid: "This offline item could not be read.",
  wrong_user: "This punch belongs to a different sign-in.",
  sign_in: "Sign in again to sync these punches.",
};

/** Test seam for an unexpected failure in the middle of a batch. */
export const syncTestHooks: { beforeApply: ((clientEventId: string) => void) | null } = { beforeApply: null };

export function listTimeAnomalies(orgId: string) {
  return getDb()
    .select()
    .from(timeAnomalies)
    .where(and(eq(timeAnomalies.orgId, orgId), isNull(timeAnomalies.resolvedAt)))
    .all()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function syncResponse(actor: Actor | null, body: unknown, serverNow = Date.now()) {
  if (!actor || !canAddFieldNotes(actor.role as Role)) {
    return { status: 401 as const, body: { error: "Sign in again to sync these punches.", results: [] as SyncResult[] } };
  }
  const parsed = envelope.safeParse(body);
  if (!parsed.success) {
    return { status: 400 as const, body: { error: "Could not read the sync.", results: [] as SyncResult[] } };
  }
  return { status: 200 as const, body: { results: applyOfflineBatch(actor, parsed.data.events, serverNow) } };
}

export function applyOfflineBatch(actor: Actor, rawEvents: unknown[], serverNow = Date.now()): SyncResult[] {
  const ordered = [...rawEvents].sort((a, b) => capturedOf(a).localeCompare(capturedOf(b)) || seqOf(a) - seqOf(b));
  const results: SyncResult[] = [];
  for (const raw of ordered) {
    const clientEventId = idOf(raw);
    try {
      const parsed = offlineEventSchema.safeParse(raw);
      if (!parsed.success) {
        results.push(errorResult(clientEventId, "Could not read this punch. It stays on the phone."));
        continue;
      }
      results.push(applyOfflineEvent(actor, parsed.data, serverNow));
    } catch {
      results.push(errorResult(clientEventId, "Could not save this punch. It stays on the phone."));
    }
  }
  return results;
}

function applyOfflineEvent(actor: Actor, event: OfflineEvent, serverNow: number): SyncResult {
  if (event.orgId !== actor.orgId || event.userId !== actor.userId) {
    return result(event.clientEventId, "wrong_user", "wrong_user", null, null);
  }
  if (!canAddFieldNotes(actor.role as Role)) {
    return result(event.clientEventId, "sign_in", "sign_in", null, null);
  }
  const db = officeDb(actor.orgId);
  if (!db) return result(event.clientEventId, "sign_in", "sign_in", null, null);
  const existing = db.select().from(syncEvents).where(eq(syncEvents.clientEventId, event.clientEventId)).get();
  if (existing) {
    if (existing.orgId !== actor.orgId || existing.userId !== actor.userId) {
      return result(event.clientEventId, "wrong_user", "wrong_user", null, null);
    }
    return JSON.parse(existing.resultJson) as SyncResult;
  }
  syncTestHooks.beforeApply?.(event.clientEventId);
  const capturedMs = Date.parse(event.capturedAt);
  if (!Number.isFinite(capturedMs)) return remember(db, actor, event, result(event.clientEventId, "needs_review", "invalid", null, null), serverNow);
  const flag = clockFlag(capturedMs, serverNow);
  if (event.kind === "log_draft") return applyLog(actor, db, event, flag, serverNow);
  return applyPunch(actor, db, event, flag, capturedMs, serverNow);
}

function applyPunch(
  actor: Actor,
  db: NonNullable<ReturnType<typeof officeDb>>,
  event: OfflineEvent,
  flag: ClockFlag,
  capturedMs: number,
  serverNow: number,
): SyncResult {
  const jobProblem = event.kind === "clock_in" || event.kind === "switch" ? jobAndCode(db, actor.orgId, event) : null;
  if (jobProblem) return remember(db, actor, event, result(event.clientEventId, "needs_review", jobProblem, null, null), serverNow);
  if (insideLocked(db, actor.orgId, actor.userId, event.capturedAt)) {
    return remember(db, actor, event, result(event.clientEventId, "needs_review", "locked", null, null), serverNow);
  }
  try {
    const entryId = runPunch(actor, event, capturedMs);
    stamp(db, actor, entryId, event, flag, serverNow, event.kind === "clock_in" || event.kind === "switch");
    if (flag) {
      const saved = result(event.clientEventId, "needs_review", flag, entryId, null);
      writeAnomaly(db, actor, event, flag, saved.detail, entryId, null, serverNow);
      return remember(db, actor, event, saved, serverNow);
    }
    return remember(db, actor, event, { ...result(event.clientEventId, "applied", null, entryId, null), detail: "Synced." }, serverNow);
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    const kind = sequenceKind(error.message);
    return remember(db, actor, event, result(event.clientEventId, "needs_review", kind, null, null), serverNow);
  }
}

function applyLog(
  actor: Actor,
  db: NonNullable<ReturnType<typeof officeDb>>,
  event: OfflineEvent,
  flag: ClockFlag,
  serverNow: number,
): SyncResult {
  const projectId = event.projectId ?? "";
  const jobProblem = jobAndCode(db, actor.orgId, { ...event, kind: "clock_in", costCode: "SKIP" }, true);
  if (jobProblem === "missing_job") {
    return remember(db, actor, event, result(event.clientEventId, "needs_review", "missing_job", null, null), serverNow);
  }
  const zone = calendarForOrg(actor.orgId).timeZone;
  const day = localDay(Date.parse(event.capturedAt), zone);
  if (flag === "future" || day > localDay(serverNow, zone)) {
    return remember(db, actor, event, result(event.clientEventId, "needs_review", "future", null, null), serverNow);
  }
  const existing = db
    .select()
    .from(dailyLogs)
    .where(and(eq(dailyLogs.orgId, actor.orgId), eq(dailyLogs.projectId, projectId), eq(dailyLogs.authorId, actor.userId), eq(dailyLogs.logDate, day)))
    .all()
    .find((row) => row.status !== "void");
  if (existing?.status === "published") {
    return remember(db, actor, event, result(event.clientEventId, "needs_review", "published_log", null, existing.id), serverNow);
  }
  try {
    const opened = openDailyLog(actor, projectId, day, Date.parse(event.capturedAt));
    saveDailyLog(actor, opened.id, logInput(event));
    if (flag) {
      const saved = result(event.clientEventId, "needs_review", flag, null, opened.id);
      writeAnomaly(db, actor, event, flag, saved.detail, null, opened.id, serverNow);
      return remember(db, actor, event, saved, serverNow);
    }
    return remember(db, actor, event, { ...result(event.clientEventId, "applied", null, null, opened.id), detail: "Draft synced." }, serverNow);
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    return remember(db, actor, event, result(event.clientEventId, "needs_review", "invalid", null, null), serverNow);
  }
}

function runPunch(actor: Actor, event: OfflineEvent, capturedMs: number): string | null {
  if (event.kind === "clock_in") {
    const created = clockIn(
      actor,
      { projectId: event.projectId ?? "", costCode: event.costCode ?? "", lat: event.lat, lng: event.lng },
      capturedMs,
    );
    return created.entryId;
  }
  if (event.kind === "switch") {
    const created = switchJob(actor, { projectId: event.projectId ?? "", costCode: event.costCode ?? "" }, capturedMs);
    return created.entryId;
  }
  if (event.kind === "break_start") {
    startBreak(actor, capturedMs);
    return openId(actor);
  }
  if (event.kind === "break_end") {
    endBreak(actor, capturedMs);
    return openId(actor);
  }
  clockOut(actor, { note: event.note, lat: event.lat, lng: event.lng }, capturedMs);
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const closed = db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, actor.orgId), eq(timeEntries.userId, actor.userId), eq(timeEntries.clockOutAt, new Date(capturedMs).toISOString())))
    .all()
    .sort((a, b) => b.id.localeCompare(a.id))[0];
  return closed?.id ?? null;
}

function stamp(
  db: NonNullable<ReturnType<typeof officeDb>>,
  actor: Actor,
  entryId: string | null,
  event: OfflineEvent,
  flag: ClockFlag,
  serverNow: number,
  setClientId: boolean,
) {
  if (!entryId) return;
  const syncedAt = new Date(serverNow).toISOString();
  db.update(timeEntries)
    .set({
      source: "offline",
      syncedAt,
      anomaly: flag,
      ...(setClientId ? { clientEventId: event.clientEventId } : {}),
      ...(event.kind === "clock_in" && event.note ? { note: event.note } : {}),
      updatedAt: syncedAt,
    })
    .where(and(eq(timeEntries.id, entryId), eq(timeEntries.orgId, actor.orgId)))
    .run();
}

function openId(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  return (
    db
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, actor.orgId), eq(timeEntries.userId, actor.userId), eq(timeEntries.status, "open")))
      .get()?.id ??
    db
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, actor.orgId), eq(timeEntries.userId, actor.userId), eq(timeEntries.status, "break")))
      .get()?.id ??
    null
  );
}

function jobAndCode(
  db: NonNullable<ReturnType<typeof officeDb>>,
  orgId: string,
  event: OfflineEvent,
  jobOnly = false,
): "missing_job" | "missing_code" | null {
  const project = db
    .select({ id: projects.id, status: projects.status })
    .from(projects)
    .where(and(eq(projects.id, event.projectId ?? ""), eq(projects.orgId, orgId)))
    .get();
  if (!project || project.status === "cancelled") return "missing_job";
  if (jobOnly) return null;
  const code = (event.costCode ?? "").trim().toUpperCase();
  if (!code) return "missing_code";
  const item = db
    .select({ id: priceBookItems.id })
    .from(priceBookItems)
    .where(and(eq(priceBookItems.orgId, orgId), eq(priceBookItems.code, code)))
    .get();
  if (!item) return "missing_code";
  return null;
}

function insideLocked(db: NonNullable<ReturnType<typeof officeDb>>, orgId: string, userId: string, capturedAt: string) {
  const when = Date.parse(capturedAt);
  const rows = db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.userId, userId), eq(timeEntries.status, "approved")))
    .all();
  return rows.some((entry) => {
    if (!entry.clockOutAt) return false;
    return Date.parse(entry.clockInAt) <= when && when <= Date.parse(entry.clockOutAt);
  });
}

function sequenceKind(message: string): string {
  if (message.includes("already clocked in") || message.includes("already on that job")) return "overlap";
  if (message.includes("not clocked in") || message.includes("Clock in before") || message.includes("not on a break")) return "out_without_in";
  return "invalid";
}

function writeAnomaly(
  db: NonNullable<ReturnType<typeof officeDb>>,
  actor: Actor,
  event: OfflineEvent,
  kind: string,
  detail: string,
  entryId: string | null,
  logId: string | null,
  serverNow: number,
) {
  db.insert(timeAnomalies)
    .values({
      id: id("tan"),
      orgId: actor.orgId,
      userId: actor.userId,
      clientEventId: event.clientEventId,
      kind,
      detail,
      capturedAt: event.capturedAt,
      projectId: event.projectId ?? null,
      costCode: event.costCode ?? null,
      entryId,
      logId,
      resolvedAt: null,
      createdAt: new Date(serverNow).toISOString(),
    })
    .run();
}

function remember(
  db: NonNullable<ReturnType<typeof officeDb>>,
  actor: Actor,
  event: OfflineEvent,
  value: SyncResult,
  serverNow: number,
): SyncResult {
  if (value.status === "wrong_user" || value.status === "sign_in" || value.status === "error") return value;
  if (value.anomaly && value.anomaly !== "clock_drift" && value.anomaly !== "future" && value.anomaly !== "stale") {
    const already = db.select().from(timeAnomalies).where(eq(timeAnomalies.clientEventId, event.clientEventId)).get();
    if (!already) writeAnomaly(db, actor, event, value.anomaly, value.detail, value.entryId, value.logId, serverNow);
  }
  db.insert(syncEvents)
    .values({
      clientEventId: event.clientEventId,
      orgId: actor.orgId,
      userId: actor.userId,
      kind: event.kind,
      capturedAt: event.capturedAt,
      status: value.status,
      resultJson: JSON.stringify(value),
      createdAt: new Date(serverNow).toISOString(),
    })
    .run();
  return value;
}

function result(clientEventId: string, status: SyncResult["status"], anomaly: string | null, entryId: string | null, logId: string | null): SyncResult {
  return {
    clientEventId,
    status,
    anomaly,
    detail: anomaly ? (DETAILS[anomaly] ?? DETAILS.invalid) : "Synced.",
    entryId,
    logId,
  };
}

function errorResult(clientEventId: string, detail: string): SyncResult {
  return { clientEventId, status: "error", anomaly: null, detail, entryId: null, logId: null };
}

function idOf(raw: unknown) {
  if (raw && typeof raw === "object" && "clientEventId" in raw && typeof raw.clientEventId === "string") return raw.clientEventId;
  return "";
}

function capturedOf(raw: unknown) {
  if (raw && typeof raw === "object" && "capturedAt" in raw && typeof raw.capturedAt === "string") return raw.capturedAt;
  return "";
}

function seqOf(raw: unknown) {
  if (raw && typeof raw === "object" && "seq" in raw && typeof raw.seq === "number") return raw.seq;
  return 0;
}

export function orderedCapture(events: OfflineEvent[]) {
  return sortOldestFirst(events);
}

function logInput(event: OfflineEvent): LogInput {
  const log = event.log ?? {};
  return {
    notes: log.notes,
    plannedNext: log.plannedNext,
    weatherSky: log.weatherSky,
    weatherHighF: log.weatherHighF,
    weatherLowF: log.weatherLowF,
    weatherLostHours: log.weatherLostHours,
    weatherImpact: log.weatherImpact,
    delayCause: log.delayCause,
    delayHours: log.delayHours,
    deliveries: log.deliveries,
    visitors: log.visitors,
    safetyNote: log.safetyNote,
  };
}
