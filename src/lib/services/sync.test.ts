import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getRlsDb, getSqlite, useDatabaseFile, usePostgresMemory } from "@/lib/db/client";
import { withOfficeClaim } from "@/lib/db/rls-context";
import { dailyLogs, memberships, projects, syncEvents, timeAnomalies, timeEntries, users } from "@/lib/db/schema";
import type { OfflineEvent } from "@/lib/offline/event";
import { actorFromIds, authenticate } from "@/lib/services/read";
import { openDailyLog, publishDailyLog } from "@/lib/services/logs";
import { applyOfflineBatch, listTimeAnomalies, syncResponse, syncTestHooks } from "@/lib/services/sync";
import { calendarForOrg, clockOut } from "@/lib/services/time";
import { localDay, localWeek, zonedTimeToUtc } from "@/lib/time/calendar";

const DANA = "66666666-6666-4666-8666-666666666666";
const MAYA = "11111111-1111-4111-8111-111111111111";
const JORDAN = "22222222-2222-4222-8222-222222222222";

function clearSupabaseEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

function ensureOut() {
  const dana = actor("dana@rivera.demo");
  try {
    clockOut(dana, { note: "test reset" }, Date.now());
  } catch {
    // Already clocked out.
  }
}

function event(overrides: Partial<OfflineEvent> & Pick<OfflineEvent, "kind" | "capturedAt">): OfflineEvent {
  return {
    clientEventId: randomUUID(),
    seq: 1,
    orgId: "org_rivera",
    userId: "user_dana",
    projectId: "proj_okonkwo",
    costCode: "TILE-SHOWER",
    note: null,
    lat: null,
    lng: null,
    log: null,
    ...overrides,
  };
}

describe("offline sync", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
    clockOut(actor("dana@rivera.demo"), { note: "Closed the seed punch" }, Date.now() - 60_000);
  });

  it("keeps the capture time, replays once, and lands on the company local day", () => {
    const parked = getDb().select().from(timeEntries).where(eq(timeEntries.userId, "user_dana")).all();
    parked.forEach((row, index) => {
      const start = Date.parse("2026-09-01T12:00:00.000Z") + index * 3_600_000;
      getDb()
        .update(timeEntries)
        .set({
          clockInAt: new Date(start).toISOString(),
          clockOutAt: new Date(start + 60_000).toISOString(),
          status: row.status === "open" ? "pending" : row.status,
          updatedAt: new Date(start).toISOString(),
        })
        .where(eq(timeEntries.id, row.id))
        .run();
    });
    const dana = actor("dana@rivera.demo");
    const serverNow = Date.parse("2026-10-05T18:00:30.000Z");
    const clockInAt = "2026-10-05T18:00:00.000Z";
    const breakAt = "2026-10-05T18:00:05.000Z";
    const backAt = "2026-10-05T18:00:10.000Z";
    const switchAt = "2026-10-05T18:00:15.000Z";
    const clockOutAt = "2026-10-05T18:00:20.000Z";
    const first = event({ kind: "clock_in", capturedAt: clockInAt, seq: 1, note: "On site", lat: "37.7994", lng: "-122.247" });
    const batch = [
      first,
      event({ kind: "break_start", capturedAt: breakAt, seq: 2, projectId: null, costCode: null }),
      event({ kind: "break_end", capturedAt: backAt, seq: 3, projectId: null, costCode: null }),
      event({ kind: "switch", capturedAt: switchAt, seq: 4, costCode: "PLB-SHOWER" }),
      event({ kind: "clock_out", capturedAt: clockOutAt, seq: 5, note: "Offline niche set", projectId: null, costCode: null }),
    ];
    const results = syncResponse(dana, { events: [...batch].reverse() }, serverNow);
    expect(results.status).toBe(200);
    expect(results.body.results.map((row) => row.status)).toEqual(["applied", "applied", "applied", "applied", "applied"]);
    const again = applyOfflineBatch(dana, batch, serverNow + 5_000);
    expect(again.map((row) => row.clientEventId)).toEqual(results.body.results.map((row) => row.clientEventId));
    expect(getDb().select().from(syncEvents).all()).toHaveLength(5);
    const opened = getDb().select().from(timeEntries).where(eq(timeEntries.clientEventId, first.clientEventId)).get();
    expect(opened?.clockInAt).toBe(clockInAt);
    expect(opened?.syncedAt).toBe(new Date(serverNow).toISOString());
    expect(opened?.source).toBe("offline");
    expect(opened?.anomaly).toBeNull();
    expect(opened?.clockInLatE6).toBe(37_799_400);
    expect(opened?.status).toBe("pending");
    const calendar = calendarForOrg("org_rivera");
    expect(localDay(Date.parse(opened!.clockInAt), calendar.timeZone)).toBe("2026-10-05");
    const week = localWeek(Date.parse(opened!.clockInAt), calendar);
    expect(week.startDay).toBe("2026-10-05");
    expect(week.end).toBeGreaterThan(week.start);
    const closed = getDb().select().from(timeEntries).where(eq(timeEntries.note, "Offline niche set")).all();
    expect(closed).toHaveLength(1);
    expect(closed[0]?.clockOutAt).toBe(clockOutAt);
    expect(closed[0]?.clockInAt).toBe(switchAt);
    expect(JSON.stringify(results.body)).not.toContain("5200");
    expect(JSON.stringify(results.body).toLowerCase()).not.toContain("hourly");
  });

  it("flags drift, future, and stale punches without dropping them", () => {
    ensureOut();
    const dana = actor("dana@rivera.demo");
    const serverNow = Date.parse("2026-10-05T20:00:00.000Z");
    const drifted = event({ kind: "clock_in", capturedAt: new Date(serverNow - 3 * 60 * 1000).toISOString(), seq: 1 });
    const future = event({ kind: "clock_out", capturedAt: new Date(serverNow + 60_000).toISOString(), seq: 2, projectId: null, costCode: null });
    const staleIn = event({ kind: "clock_in", capturedAt: new Date(serverNow - 8 * 24 * 60 * 60 * 1000).toISOString(), seq: 1, projectId: "proj_chen" });
    const driftResult = applyOfflineBatch(dana, [drifted], serverNow)[0];
    expect(driftResult?.status).toBe("needs_review");
    expect(driftResult?.anomaly).toBe("clock_drift");
    const row = getDb().select().from(timeEntries).where(eq(timeEntries.clientEventId, drifted.clientEventId)).get();
    expect(row?.clockInAt).toBe(drifted.capturedAt);
    expect(row?.syncedAt).toBe(new Date(serverNow).toISOString());
    expect(row?.anomaly).toBe("clock_drift");
    const futureResult = applyOfflineBatch(dana, [future], serverNow)[0];
    expect(futureResult?.anomaly).toBe("future");
    const futureRow = getDb().select().from(timeEntries).where(eq(timeEntries.clockOutAt, future.capturedAt)).get();
    expect(futureRow?.clockOutAt).toBe(future.capturedAt);
    const staleResult = applyOfflineBatch(dana, [staleIn], serverNow)[0];
    expect(staleResult?.anomaly).toBe("stale");
    expect(getDb().select().from(timeEntries).where(eq(timeEntries.clientEventId, staleIn.clientEventId)).get()?.clockInAt).toBe(staleIn.capturedAt);
    clockOut(dana, { note: "Close stale" }, serverNow - 1_000);
    expect(listTimeAnomalies("org_rivera").some((row) => row.kind === "clock_drift")).toBe(true);
    expect(listTimeAnomalies("org_northline")).toHaveLength(0);
  });

  it("stores sequence, locked, missing job, and missing cost code for the office", () => {
    ensureOut();
    const dana = actor("dana@rivera.demo");
    const serverNow = Date.now();
    const orphan = event({
      kind: "clock_out",
      capturedAt: new Date(serverNow - 10_000).toISOString(),
      seq: 1,
      projectId: null,
      costCode: null,
      note: "Orphan clock-out",
    });
    expect(applyOfflineBatch(dana, [orphan], serverNow)[0]?.anomaly).toBe("out_without_in");
    expect(getDb().select().from(timeEntries).where(eq(timeEntries.note, "Orphan clock-out")).all()).toHaveLength(0);
    const first = event({ kind: "clock_in", capturedAt: new Date(serverNow - 9_000).toISOString(), seq: 1 });
    const second = event({ kind: "clock_in", capturedAt: new Date(serverNow - 8_000).toISOString(), seq: 2 });
    const overlap = applyOfflineBatch(dana, [first, second], serverNow);
    expect(overlap[0]?.status).toBe("applied");
    expect(overlap[1]?.anomaly).toBe("overlap");
    expect(getDb().select().from(timeEntries).where(eq(timeEntries.clientEventId, second.clientEventId)).get()).toBeUndefined();
    clockOut(dana, { note: "Close overlap" }, serverNow - 7_000);
    const approved = getDb().select().from(timeEntries).where(eq(timeEntries.id, "time_ok_tile")).get();
    const lockedAt = new Date(Date.parse(approved!.clockInAt) + 60_000).toISOString();
    const locked = event({ kind: "clock_in", capturedAt: lockedAt, seq: 1 });
    expect(applyOfflineBatch(dana, [locked], serverNow)[0]?.anomaly).toBe("locked");
    expect(getDb().select().from(timeEntries).where(eq(timeEntries.clientEventId, locked.clientEventId)).get()).toBeUndefined();
    const missing = event({ kind: "clock_in", capturedAt: new Date(serverNow - 6_000).toISOString(), seq: 1, projectId: "proj_missing" });
    expect(applyOfflineBatch(dana, [missing], serverNow)[0]?.anomaly).toBe("missing_job");
    const brooks = getDb().select().from(projects).where(eq(projects.id, "proj_brooks")).get();
    getDb().update(projects).set({ status: "cancelled" }).where(eq(projects.id, "proj_brooks")).run();
    const archived = event({ kind: "clock_in", capturedAt: new Date(serverNow - 5_000).toISOString(), seq: 1, projectId: "proj_brooks" });
    expect(applyOfflineBatch(dana, [archived], serverNow)[0]?.anomaly).toBe("missing_job");
    getDb().update(projects).set({ status: brooks?.status ?? "active" }).where(eq(projects.id, "proj_brooks")).run();
    const code = event({ kind: "clock_in", capturedAt: new Date(serverNow - 4_000).toISOString(), seq: 1, costCode: "GONE-CODE" });
    expect(applyOfflineBatch(dana, [code], serverNow)[0]?.anomaly).toBe("missing_code");
    const kinds = listTimeAnomalies("org_rivera").map((row) => row.kind);
    expect(kinds).toEqual(expect.arrayContaining(["out_without_in", "overlap", "locked", "missing_job", "missing_code"]));
  });

  it("keeps a reused client id from matching or blocking another person", () => {
    ensureOut();
    const dana = actor("dana@rivera.demo");
    const sam = actor("sam@rivera.demo");
    const jordan = actor("jordan@northline.demo");
    const shared = randomUUID();
    const serverNow = Date.now();
    const danaEvent = event({
      clientEventId: shared,
      kind: "clock_in",
      capturedAt: new Date(serverNow - 9_000).toISOString(),
      projectId: "proj_chen",
      costCode: "GC-SUPER",
    });
    const first = applyOfflineBatch(dana, [danaEvent], serverNow)[0];
    expect(first?.status).toBe("applied");
    const samEvent = event({
      clientEventId: shared,
      kind: "clock_in",
      capturedAt: new Date(serverNow - 8_000).toISOString(),
      userId: "user_sam",
      projectId: "proj_chen",
      costCode: "GC-SUPER",
    });
    const second = applyOfflineBatch(sam, [samEvent], serverNow)[0];
    expect(second?.status).toBe("applied");
    expect(second?.entryId).toBeTruthy();
    expect(second?.entryId).not.toBe(first?.entryId);
    const jordanEvent = event({
      clientEventId: shared,
      kind: "clock_in",
      capturedAt: new Date(serverNow - 7_000).toISOString(),
      orgId: "org_northline",
      userId: "user_jordan",
      projectId: "proj_okonkwo",
      costCode: "GC-SUPER",
    });
    const third = applyOfflineBatch(jordan, [jordanEvent], serverNow)[0];
    expect(third?.status).toBe("needs_review");
    expect(third?.anomaly).toBe("missing_job");
    expect(third?.entryId).toBeNull();
    expect(JSON.stringify(third)).not.toContain(first?.entryId ?? "no-entry");
    const rows = getDb().select().from(syncEvents).where(eq(syncEvents.clientEventId, shared)).all();
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.userId).sort()).toEqual(["user_dana", "user_jordan", "user_sam"]);
    const replay = applyOfflineBatch(dana, [danaEvent], serverNow + 1_000)[0];
    expect(replay?.entryId).toBe(first?.entryId);
    expect(replay?.detail).not.toContain(String(third?.detail));
    expect(applyOfflineBatch(jordan, [jordanEvent], serverNow + 1_000)[0]).toEqual(third);
    expect(getDb().select().from(timeEntries).where(eq(timeEntries.clientEventId, shared)).all()).toHaveLength(2);
    clockOut(dana, { note: "Close shared id" }, serverNow - 500);
    clockOut(sam, { note: "Close shared id" }, serverNow - 400);
  });

  it("keeps the queue when the role is revoked or the session is gone, and refuses another user", () => {
    ensureOut();
    const serverNow = Date.now();
    const pending = event({ kind: "clock_in", capturedAt: new Date(serverNow - 3_000).toISOString(), seq: 1, projectId: "proj_chen", costCode: "GC-SUPER" });
    getDb().update(memberships).set({ role: "viewer" }).where(eq(memberships.userId, "user_dana")).run();
    const viewer = actor("dana@rivera.demo");
    const blocked = syncResponse(viewer, { events: [pending] }, serverNow);
    expect(blocked.status).toBe(401);
    expect(blocked.body.error).toMatch(/Sign in again/);
    expect(getDb().select().from(syncEvents).where(eq(syncEvents.clientEventId, pending.clientEventId)).get()).toBeUndefined();
    getDb().update(memberships).set({ role: "field" }).where(eq(memberships.userId, "user_dana")).run();
    const membership = getDb().select().from(memberships).where(eq(memberships.userId, "user_dana")).get()!;
    getDb().delete(memberships).where(eq(memberships.id, membership.id)).run();
    expect(actorFromIds("user_dana", "org_rivera")).toBeNull();
    expect(syncResponse(null, { events: [pending] }, serverNow).status).toBe(401);
    getDb().insert(memberships).values(membership).run();
    const dana = actor("dana@rivera.demo");
    const other = event({
      kind: "clock_in",
      capturedAt: new Date(serverNow - 2_000).toISOString(),
      seq: 1,
      orgId: "org_northline",
      userId: "user_jordan",
      projectId: "proj_okonkwo",
    });
    expect(applyOfflineBatch(dana, [other], serverNow)[0]?.status).toBe("wrong_user");
    expect(getDb().select().from(syncEvents).where(eq(syncEvents.clientEventId, other.clientEventId)).get()).toBeUndefined();
    expect(getDb().select().from(timeEntries).where(eq(timeEntries.userId, "user_jordan")).all().every((row) => row.orgId !== "org_rivera" || row.clientEventId == null)).toBe(true);
    const applied = syncResponse(dana, { events: [pending] }, serverNow);
    expect(applied.status).toBe(200);
    expect(applied.body.results[0]?.status).toBe("applied");
    clockOut(dana, { note: "Close restored" }, serverNow - 1_000);
  });

  it("applies the rest of a batch when one punch fails, then accepts a retry", () => {
    ensureOut();
    const dana = actor("dana@rivera.demo");
    const serverNow = Date.now();
    const good = event({ kind: "clock_in", capturedAt: new Date(serverNow - 20_000).toISOString(), seq: 1, projectId: "proj_diaz", costCode: "GC-SUPER" });
    const bad = { clientEventId: "not-a-uuid", kind: "clock_out", capturedAt: new Date(serverNow - 19_000).toISOString() };
    const exploded = event({ kind: "clock_out", capturedAt: new Date(serverNow - 18_000).toISOString(), seq: 3, note: "Should retry", projectId: null, costCode: null });
    syncTestHooks.beforeApply = (clientEventId) => {
      if (clientEventId === exploded.clientEventId) throw new Error("disk");
    };
    const results = applyOfflineBatch(dana, [bad, exploded, good], serverNow);
    syncTestHooks.beforeApply = null;
    expect(results.find((row) => row.clientEventId === good.clientEventId)?.status).toBe("applied");
    expect(results.find((row) => row.clientEventId === "not-a-uuid")?.status).toBe("error");
    expect(results.find((row) => row.clientEventId === exploded.clientEventId)?.status).toBe("error");
    expect(getDb().select().from(syncEvents).where(eq(syncEvents.clientEventId, exploded.clientEventId)).get()).toBeUndefined();
    expect(getDb().select().from(timeEntries).where(eq(timeEntries.clientEventId, good.clientEventId)).get()?.clockInAt).toBe(good.capturedAt);
    const retry = applyOfflineBatch(dana, [exploded, good], serverNow + 1_000);
    expect(retry.find((row) => row.clientEventId === exploded.clientEventId)?.status).toBe("applied");
    expect(retry.find((row) => row.clientEventId === good.clientEventId)?.status).toBe("applied");
    expect(getDb().select().from(timeEntries).where(eq(timeEntries.clientEventId, good.clientEventId)).all()).toHaveLength(1);
    expect(getDb().select().from(timeEntries).where(eq(timeEntries.note, "Should retry")).all()).toHaveLength(1);
  });

  it("saves a log draft on the capture day's company date and does not publish or overwrite", () => {
    const dana = actor("dana@rivera.demo");
    const capturedMs = zonedTimeToUtc(2026, 3, 15, 23, 0, 0, "America/New_York");
    const capturedAt = new Date(capturedMs).toISOString();
    const serverNow = capturedMs + 30_000;
    expect(localDay(capturedMs, "America/New_York")).toBe("2026-03-15");
    expect(capturedAt.slice(0, 10)).toBe("2026-03-16");
    const draft = event({
      kind: "log_draft",
      capturedAt,
      seq: 1,
      projectId: "proj_chen",
      costCode: null,
      log: { notes: "Hung the cabinet boxes after the signal dropped.", plannedNext: "Doors tomorrow" },
    });
    const saved = applyOfflineBatch(dana, [draft], serverNow)[0];
    expect(saved?.status).toBe("applied");
    const log = getDb().select().from(dailyLogs).where(eq(dailyLogs.id, saved!.logId!)).get();
    expect(log?.status).toBe("draft");
    expect(log?.logDate).toBe("2026-03-15");
    expect(log?.notes).toContain("cabinet boxes");
    expect(log?.publishedAt).toBeNull();
    const replay = applyOfflineBatch(dana, [draft], serverNow + 10_000)[0];
    expect(replay).toEqual(saved);
    expect(getDb().select().from(dailyLogs).where(and(eq(dailyLogs.projectId, "proj_chen"), eq(dailyLogs.logDate, "2026-03-15"))).all()).toHaveLength(1);
    const published = event({
      kind: "log_draft",
      capturedAt,
      seq: 2,
      projectId: "proj_okonkwo",
      costCode: null,
      log: { notes: "This should not replace the published log." },
    });
    const created = openDailyLog(dana, "proj_okonkwo", "2026-03-15", capturedMs);
    publishDailyLog(dana, created.id, { notes: "Published already." }, serverNow);
    const before = getDb().select().from(dailyLogs).where(eq(dailyLogs.id, created.id)).get();
    expect(applyOfflineBatch(dana, [published], serverNow)[0]?.anomaly).toBe("published_log");
    const after = getDb().select().from(dailyLogs).where(eq(dailyLogs.id, before!.id)).get();
    expect(after?.notes).toBe(before?.notes);
    expect(after?.status).toBe("published");
    const source = readFileSync(path.join(process.cwd(), "supabase", "rls.sql"), "utf8");
    expect(source).toContain("sync_events_scope");
    expect(source).toContain("time_anomalies_scope");
    expect(readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8")).toContain('"/api/"');
  });
});

describe("offline sync under postgres RLS", () => {
  beforeAll(() => {
    usePostgresMemory();
    clearSupabaseEnv();
  }, 60_000);

  afterAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("lets a field member read their anomaly and hides another company", () => {
    const dana = actor("dana@rivera.demo");
    const serverNow = Date.now();
    const missing = event({ kind: "clock_in", capturedAt: new Date(serverNow - 4_000).toISOString(), projectId: "proj_missing" });
    expect(applyOfflineBatch(dana, [missing], serverNow)[0]?.anomaly).toBe("missing_job");
    getDb().update(users).set({ authUserId: DANA }).where(eq(users.id, "user_dana")).run();
    getDb().update(users).set({ authUserId: MAYA }).where(eq(users.id, "user_maya")).run();
    getDb().update(users).set({ authUserId: JORDAN }).where(eq(users.id, "user_jordan")).run();
    getSqlite().exec(`
      create schema if not exists auth;
      create or replace function auth.uid() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', '') $$;
      create or replace function public.current_org_ids() returns setof text language sql stable security definer set search_path = public as $$ select m.org_id from public.memberships m join public.users u on u.id = m.user_id where u.auth_user_id = auth.uid() $$;
      create or replace function public.can_see_money(target_org text) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.memberships m join public.users u on u.id = m.user_id where u.auth_user_id = auth.uid() and m.org_id = target_org and m.role is distinct from 'field') $$;
      create or replace function public.current_user_id() returns text language sql stable security definer set search_path = public as $$ select u.id from public.users u where u.auth_user_id = auth.uid() limit 1 $$;
    `);
    try {
      getSqlite().exec("create role authenticated nologin");
    } catch {
      // Already created in this database.
    }
    getSqlite().exec(`
      grant usage on schema public to authenticated;
      grant execute on function public.current_org_ids() to authenticated;
      grant execute on function public.can_see_money(text) to authenticated;
      grant execute on function public.current_user_id() to authenticated;
      grant execute on function auth.uid() to authenticated;
      grant select, insert, update, delete on public.time_anomalies to authenticated;
      alter table public.time_anomalies enable row level security;
      alter table public.time_anomalies force row level security;
      drop policy if exists time_anomalies_scope on public.time_anomalies;
      create policy time_anomalies_scope on public.time_anomalies for all to authenticated
        using (org_id in (select public.current_org_ids()) and (public.can_see_money(org_id) or user_id = public.current_user_id()))
        with check (org_id in (select public.current_org_ids()) and (public.can_see_money(org_id) or user_id = public.current_user_id()));
    `);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-public-test";
    const fieldRows = withOfficeClaim(DANA, () => getRlsDb().select().from(timeAnomalies).all());
    const ownerRows = withOfficeClaim(MAYA, () => getRlsDb().select().from(timeAnomalies).all());
    const jordanRows = withOfficeClaim(JORDAN, () => getRlsDb().select().from(timeAnomalies).all());
    expect(fieldRows.some((row) => row.clientEventId === missing.clientEventId)).toBe(true);
    expect(fieldRows.every((row) => row.userId === "user_dana" && row.orgId === "org_rivera")).toBe(true);
    expect(ownerRows.some((row) => row.clientEventId === missing.clientEventId)).toBe(true);
    expect(jordanRows.some((row) => row.orgId === "org_rivera")).toBe(false);
    clearSupabaseEnv();
  });
});
