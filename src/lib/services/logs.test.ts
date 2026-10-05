import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getRlsDb, getSqlite, useDatabaseFile, usePostgresMemory } from "@/lib/db/client";
import { withOfficeClaim } from "@/lib/db/rls-context";
import { dailyLogEvents, dailyLogs, users } from "@/lib/db/schema";
import { askCopilot, authenticate } from "@/lib/services/read";
import {
  clientDailyLogs,
  crewForLog,
  jobLogAnswer,
  lookupWeather,
  missingDailyLogs,
  myDay,
  openDailyLog,
  publishDailyLog,
  saveDailyLog,
  setLogVisibility,
  utcDay,
  voidDailyLog,
} from "@/lib/services/logs";

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

describe("daily logs", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("keeps one log per person per day, refuses the future, and snapshots edits", () => {
    expect(lookupWeather()).toBeNull();
    const dana = actor("dana@rivera.demo");
    const maya = actor("maya@rivera.demo");
    const today = utcDay();
    const again = openDailyLog(dana, "proj_okonkwo", today);
    expect(again.id).toBe("log_ok_draft");
    expect(() => openDailyLog(dana, "proj_okonkwo", utcDay(Date.now() + 3 * 86_400_000))).toThrow(/future/);
    expect(() => publishDailyLog(dana, again.id, { notes: "   " })).toThrow(/note before publishing/);
    publishDailyLog(dana, again.id, {
      notes: "Set the niche and waited on the curb.",
      delayCause: "Inspector held the rough-in",
      delayHours: "1",
      safetyNote: "Cones at the curb",
      weatherSky: "Clear",
      weatherHighF: "70",
      weatherLowF: "52",
    });
    saveDailyLog(maya, again.id, { notes: "Set the niche and waited on the curb. Grout tomorrow." });
    const events = getDb().select().from(dailyLogEvents).where(eq(dailyLogEvents.logId, again.id)).all();
    const snapshots = events.map((event) => `${event.beforeJson ?? ""}\n${event.afterJson ?? ""}`).join("\n");
    expect(events.some((event) => event.type === "published" && event.actorId === "user_dana")).toBe(true);
    expect(events.some((event) => event.type === "edited" && event.actorId === "user_maya")).toBe(true);
    expect(snapshots).toContain("Set the niche");
    expect(snapshots).not.toContain("rateCents");
    expect(snapshots).not.toContain("5200");
    setLogVisibility(maya, again.id, "client");
    expect(() => saveDailyLog(dana, again.id, { notes: "Field rewrite" })).toThrow(/office owns this log/);
    expect(() => setLogVisibility(dana, again.id, "internal")).toThrow(/office can change/);
    const shared = clientDailyLogs("proj_okonkwo");
    const fresh = shared.find((log) => log.id === again.id);
    expect(fresh?.notes).toContain("Grout tomorrow");
    expect(JSON.stringify(fresh)).not.toContain("Inspector");
    expect(JSON.stringify(fresh)).not.toContain("Cones");
    expect(JSON.stringify(fresh)).not.toContain("Dana");
    expect(JSON.stringify(shared)).not.toContain("delayCause");
    expect(JSON.stringify(shared)).not.toContain("safetyNote");
    expect(JSON.stringify(shared)).not.toContain("5200");
    expect(clientDailyLogs("proj_brooks")).toEqual([]);
    expect(shared.some((log) => log.notes.includes("kept the niche dry"))).toBe(true);
    const day = myDay(dana);
    expect(JSON.stringify(day)).not.toContain("5200");
    expect(JSON.stringify(day)).not.toContain("hourly");
    expect(day.open?.projectId).toBe("proj_okonkwo");
  });

  it("counts unapproved punches without rates and nudges a job with no published log", () => {
    const yesterday = utcDay(Date.now() - 86_400_000);
    const crew = crewForLog("org_rivera", "proj_chen", yesterday);
    expect(crew.headcount).toBe(1);
    expect(crew.minutes).toBe(120);
    expect(crew.includesUnapproved).toBe(true);
    expect(JSON.stringify(crew)).not.toMatch(/cents|rate|\$/);
    const missing = missingDailyLogs("org_rivera");
    expect(missing.some((row) => row.projectId === "proj_chen")).toBe(true);
    expect(missing.some((row) => row.projectId === "proj_okonkwo")).toBe(false);
    const maya = actor("maya@rivera.demo");
    const answer = askCopilot(maya.orgId, "what happened on Okonkwo yesterday?");
    expect(answer.tool).toBe("job_log");
    expect(answer.answer).toContain("kept the niche dry");
    expect(answer.rows.some((row) => row.detail.includes("log_ok_yday") && row.amountCents == null)).toBe(true);
    expect(answer.answer).not.toContain("Wet floor");
    expect(jobLogAnswer(maya.orgId, "what happened on a missing job yesterday?").answer).toMatch(/No job matches/);
    const jordan = actor("jordan@northline.demo");
    const riley = actor("riley@rivera.demo");
    expect(() => openDailyLog(jordan, "proj_okonkwo", utcDay())).toThrow(/Job not found/);
    expect(() => openDailyLog(riley, "proj_okonkwo", utcDay())).toThrow(/Viewers cannot/);
    const source = readFileSync(path.join(process.cwd(), "supabase", "rls.sql"), "utf8");
    expect(source).toContain("daily_logs_scope");
    expect(source).toContain("visibility = 'internal'");
    const voided = openDailyLog(maya, "proj_chen", yesterday);
    voidDailyLog(maya, voided.id, "Opened the wrong day");
    expect(getDb().select().from(dailyLogs).where(eq(dailyLogs.id, voided.id)).get()?.status).toBe("void");
    const replacement = openDailyLog(maya, "proj_chen", yesterday);
    expect(replacement.id).not.toBe(voided.id);
  });
});

describe("daily logs under postgres RLS", () => {
  beforeAll(() => {
    usePostgresMemory();
    clearSupabaseEnv();
  }, 60_000);

  afterAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("hides another company and blocks a field member from sharing a log", () => {
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
      grant select, insert, update, delete on public.daily_logs to authenticated;
      alter table public.daily_logs enable row level security;
      alter table public.daily_logs force row level security;
      drop policy if exists daily_logs_scope on public.daily_logs;
      create policy daily_logs_scope on public.daily_logs for all to authenticated
        using (org_id in (select public.current_org_ids()))
        with check (org_id in (select public.current_org_ids()) and (public.can_see_money(org_id) or (author_id = public.current_user_id() and visibility = 'internal')));
    `);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-public-test";
    const fieldRows = withOfficeClaim(DANA, () => getRlsDb().select({ id: dailyLogs.id, orgId: dailyLogs.orgId }).from(dailyLogs).all());
    const ownerRows = withOfficeClaim(MAYA, () => getRlsDb().select({ id: dailyLogs.id }).from(dailyLogs).all());
    const jordanRows = withOfficeClaim(JORDAN, () => getRlsDb().select({ id: dailyLogs.id, orgId: dailyLogs.orgId }).from(dailyLogs).all());
    expect(fieldRows.length).toBeGreaterThan(0);
    expect(fieldRows.every((row) => row.orgId === "org_rivera")).toBe(true);
    expect(ownerRows.some((row) => row.id === "log_ok_yday")).toBe(true);
    expect(jordanRows.some((row) => row.id === "log_ok_yday")).toBe(false);
    expect(() =>
      withOfficeClaim(DANA, () =>
        getRlsDb().update(dailyLogs).set({ visibility: "client" }).where(eq(dailyLogs.id, "log_ok_draft")).run(),
      ),
    ).toThrow();
    clearSupabaseEnv();
  });
});
