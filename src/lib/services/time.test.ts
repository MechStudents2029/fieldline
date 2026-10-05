import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getRlsDb, getSqlite, useDatabaseFile, usePostgresMemory } from "@/lib/db/client";
import { withOfficeClaim } from "@/lib/db/rls-context";
import { activities, costItems, laborRates, timeApprovals, timeEntries, timeEntryEvents, users } from "@/lib/db/schema";
import { authenticate } from "@/lib/services/read";
import {
  approvedHoursCsv,
  approveTime,
  clockIn,
  clockOut,
  detectTimeFlags,
  editTime,
  endBreak,
  laborCostCents,
  readableRates,
  reopenTime,
  setHourlyCost,
  startBreak,
  switchJob,
  timeBoard,
  voidTime,
  addManualTime,
  weekBoundsUtc,
} from "@/lib/services/time";

const DANA = "66666666-6666-4666-8666-666666666666";
const MAYA = "11111111-1111-4111-8111-111111111111";
const JORDAN = "22222222-2222-4222-8222-222222222222";
const HOUR = 60 * 60 * 1000;

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

function jobCost(projectId: string) {
  return getDb()
    .select()
    .from(costItems)
    .where(eq(costItems.projectId, projectId))
    .all()
    .reduce((sum, row) => sum + row.amountCents, 0);
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

describe("time tracking", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("prices labor as rounded cents and flags long, overlapping, and over-40 weeks", () => {
    expect(laborCostCents(450, 5200)).toBe(39_000);
    expect(laborCostCents(120, 5200)).toBe(10_400);
    const now = Date.UTC(2026, 9, 7, 15);
    const week = weekBoundsUtc(now);
    expect(new Date(week.start).getUTCDay()).toBe(1);
    const monday = week.start + HOUR;
    const flags = detectTimeFlags(
      [
        { id: "long", userId: "u1", status: "open", clockInAt: iso(now - 13 * HOUR), clockOutAt: null, breakMinutes: 0, breakStartedAt: null },
        { id: "a", userId: "u2", status: "pending", clockInAt: iso(now - 5 * HOUR), clockOutAt: iso(now - HOUR), breakMinutes: 0, breakStartedAt: null },
        { id: "b", userId: "u2", status: "pending", clockInAt: iso(now - 4 * HOUR), clockOutAt: iso(now - 3 * HOUR), breakMinutes: 0, breakStartedAt: null },
        { id: "c", userId: "u2", status: "pending", clockInAt: iso(now - 3.5 * HOUR), clockOutAt: iso(now - 2 * HOUR), breakMinutes: 0, breakStartedAt: null },
        { id: "touch", userId: "u2", status: "pending", clockInAt: iso(now - HOUR), clockOutAt: iso(now - 30 * 60 * 1000), breakMinutes: 0, breakStartedAt: null },
        { id: "ot", userId: "u3", status: "pending", clockInAt: iso(monday), clockOutAt: iso(monday + 41 * HOUR), breakMinutes: 0, breakStartedAt: null },
        { id: "voided", userId: "u4", status: "void", clockInAt: iso(monday), clockOutAt: iso(monday + 50 * HOUR), breakMinutes: 0, breakStartedAt: null },
      ],
      now,
    );
    expect(flags.find((flag) => flag.kind === "open_long")?.entryIds).toEqual(["long"]);
    const overlaps = flags.filter((flag) => flag.kind === "overlap" && flag.userId === "u2");
    expect(overlaps.map((flag) => flag.entryIds.join("+")).sort()).toEqual(["a+b", "a+c"]);
    expect(flags.some((flag) => flag.kind === "overtime" && flag.userId === "u3")).toBe(true);
    expect(flags.some((flag) => flag.userId === "u4")).toBe(false);
    expect(flags.find((flag) => flag.kind === "overtime")?.detail).toMatch(/not a wage calculation/);
  });

  it("keeps rates off the field board and blocks the wrong role or company", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const luis = actor("luis@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const jordan = actor("jordan@northline.demo");
    const field = timeBoard(dana);
    expect(field.office).toBeNull();
    expect(readableRates(dana)).toBeNull();
    expect(JSON.stringify(field)).not.toContain("5200");
    expect(JSON.stringify(field)).not.toContain("hourly");
    expect(timeBoard(maya).office?.defaultHourlyCostCents).toBe(4500);
    expect(() => clockIn(riley, { projectId: "proj_okonkwo", costCode: "TILE-SHOWER" })).toThrow(/Viewers cannot clock in/);
    expect(() => clockIn(jordan, { projectId: "proj_okonkwo", costCode: "TILE-SHOWER" })).toThrow(/Job not found/);
    expect(() => approveTime(dana, "time_ok_overlap")).toThrow(/office can review/);
    expect(() =>
      editTime(maya, "time_ok_tile", {
        projectId: "proj_okonkwo",
        costCode: "TILE-SHOWER",
        clockInAt: "2026-10-04T12:00:00.000Z",
        clockOutAt: "2026-10-04T14:00:00.000Z",
        reason: "Tried to edit a locked punch",
      }),
    ).toThrow(/Reopen this entry/);
    expect(() => approvedHoursCsv(dana, "2026-10-01", "2026-10-07")).toThrow(/owner or admin/);
    expect(() => approvedHoursCsv(luis, "2026-10-01", "2026-10-07")).toThrow(/owner or admin/);
    const seeded = getDb().select().from(timeEntries).where(eq(timeEntries.id, "time_ok_tile")).get();
    expect(seeded?.status).toBe("approved");
    const day = seeded!.clockInAt.slice(0, 10);
    const csv = approvedHoursCsv(maya, day, day);
    expect(csv.split("\n")[0]).toBe("date,name,email,hours");
    expect(csv).toContain("Dana Cho,dana@rivera.demo,7.50");
    expect(csv).not.toContain("5200");
    expect(csv.toLowerCase()).not.toContain("rate");
    const source = readFileSync(path.join(process.cwd(), "supabase", "rls.sql"), "utf8");
    expect(source).toContain("labor_rates");
    expect(source).toContain("time_approvals");
    expect(source).toContain("time_entries_scope");
    expect(source).toContain("current_user_id");
  });

  it("posts approved labor at the approval snapshot, then locks it until reopen", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const start = Date.UTC(2026, 9, 6, 15);
    clockOut(dana, { note: "Closed the forgotten punch" }, start);
    const before = jobCost("proj_okonkwo");
    const clocked = clockIn(dana, { projectId: "proj_okonkwo", costCode: "tile-shower", lat: "37.7994", lng: "-122.247" }, start + HOUR);
    const row = getDb().select().from(timeEntries).where(eq(timeEntries.id, clocked.entryId)).get();
    expect(row?.clockInLatE6).toBe(37_799_400);
    expect(row?.clockInLngE6).toBe(-122_247_000);
    startBreak(dana, start + 2 * HOUR);
    endBreak(dana, start + 2 * HOUR + 15 * 60 * 1000);
    switchJob(dana, { projectId: "proj_okonkwo", costCode: "PLB-SHOWER" }, start + 3 * HOUR);
    const switched = getDb().select().from(timeEntries).where(eq(timeEntries.id, clocked.entryId)).get();
    expect(switched?.status).toBe("pending");
    expect(switched?.breakMinutes).toBe(15);
    expect(jobCost("proj_okonkwo")).toBe(before);
    const posted = approveTime(maya, clocked.entryId, start + 4 * HOUR);
    expect(posted).toMatchObject({ minutes: 105, rateCents: 5200, amountCents: 9100 });
    expect(jobCost("proj_okonkwo")).toBe(before + 9100);
    const cost = getDb().select().from(costItems).where(eq(costItems.id, posted.costId)).get();
    expect(cost?.source).toBe("labor");
    expect(cost?.costCode).toBe("TILE-SHOWER");
    expect(cost?.vendorName).toBe("Dana Cho");
    const activity = getDb()
      .select()
      .from(activities)
      .where(and(eq(activities.entityId, "proj_okonkwo"), eq(activities.type, "cost")))
      .all()
      .find((item) => item.summary === "Approved labor for Dana Cho.");
    expect(activity?.payloadJson).toBeNull();
    setHourlyCost(maya, "user_dana", 6000);
    expect(getDb().select().from(timeApprovals).where(eq(timeApprovals.entryId, clocked.entryId)).get()?.amountCents).toBe(9100);
    expect(() =>
      editTime(maya, clocked.entryId, {
        projectId: "proj_okonkwo",
        costCode: "TILE-SHOWER",
        clockInAt: iso(start + HOUR),
        clockOutAt: iso(start + 2 * HOUR),
        breakMinutes: 0,
        reason: "Still locked",
      }),
    ).toThrow(/Reopen this entry/);
    reopenTime(maya, clocked.entryId, "Hours were short");
    expect(getDb().select().from(costItems).where(eq(costItems.id, posted.costId)).get()).toBeUndefined();
    expect(getDb().select().from(timeApprovals).where(eq(timeApprovals.entryId, clocked.entryId)).get()?.status).toBe("voided");
    expect(getDb().select().from(timeEntries).where(eq(timeEntries.id, clocked.entryId)).get()?.status).toBe("pending");
    expect(jobCost("proj_okonkwo")).toBe(before);
    editTime(maya, clocked.entryId, {
      projectId: "proj_okonkwo",
      costCode: "TILE-SHOWER",
      clockInAt: iso(start + HOUR),
      clockOutAt: iso(start + 3 * HOUR),
      breakMinutes: 0,
      note: "Niche only",
      reason: "Dropped the break",
    });
    const again = approveTime(maya, clocked.entryId, start + 4 * HOUR);
    expect(again).toMatchObject({ minutes: 120, rateCents: 6000, amountCents: 12_000 });
    expect(jobCost("proj_okonkwo")).toBe(before + 12_000);
    const history = getDb().select().from(timeEntryEvents).where(eq(timeEntryEvents.entryId, clocked.entryId)).all();
    const snapshots = history.map((event) => `${event.beforeJson ?? ""}\n${event.afterJson ?? ""}`).join("\n");
    expect(history.some((event) => event.reason === "Hours were short")).toBe(true);
    expect(history.some((event) => event.reason === "Dropped the break")).toBe(true);
    expect(snapshots).not.toContain("rateCents");
    expect(snapshots).not.toContain("5200");
    expect(snapshots).not.toContain("6000");
    expect(snapshots).not.toContain("12000");
    setHourlyCost(maya, "user_dana", 5200);
  });

  it("voids a punch instead of deleting it and refuses approval without a rate", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const open = getDb()
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, "user_dana"), eq(timeEntries.status, "open")))
      .all();
    if (open.length > 0) clockOut(dana, {}, Date.UTC(2026, 9, 6, 20));
    const manual = addManualTime(maya, {
      userId: "user_dana",
      projectId: "proj_okonkwo",
      costCode: "GC-SUPER",
      clockInAt: "2026-10-03T15:00:00.000Z",
      clockOutAt: "2026-10-03T16:00:00.000Z",
      reason: "Dana forgot Friday",
    });
    voidTime(maya, manual.entryId, "Entered twice");
    const kept = getDb().select().from(timeEntries).where(eq(timeEntries.id, manual.entryId)).get();
    expect(kept?.status).toBe("void");
    expect(() =>
      editTime(maya, manual.entryId, {
        projectId: "proj_okonkwo",
        costCode: "GC-SUPER",
        clockInAt: "2026-10-03T15:00:00.000Z",
        clockOutAt: "2026-10-03T16:00:00.000Z",
        reason: "Too late",
      }),
    ).toThrow(/Voided time stays/);
    const saved = getDb().select().from(laborRates).where(eq(laborRates.orgId, "org_rivera")).all();
    getDb().delete(laborRates).where(eq(laborRates.orgId, "org_rivera")).run();
    const bare = addManualTime(maya, {
      userId: "user_luis",
      projectId: "proj_okonkwo",
      costCode: "GC-SUPER",
      clockInAt: "2026-10-03T12:00:00.000Z",
      clockOutAt: "2026-10-03T13:00:00.000Z",
      reason: "Office covered the walkthrough",
    });
    expect(() => approveTime(maya, bare.entryId)).toThrow(/hourly cost/);
    expect(jobCost("proj_okonkwo")).toBeGreaterThan(0);
    const costBefore = jobCost("proj_okonkwo");
    getDb().insert(laborRates).values(saved).run();
    expect(jobCost("proj_okonkwo")).toBe(costBefore);
    const zero = clockIn(dana, { projectId: "proj_okonkwo", costCode: "TILE-SHOWER" }, Date.UTC(2026, 9, 6, 21));
    clockOut(dana, {}, Date.UTC(2026, 9, 6, 21));
    expect(() => approveTime(maya, zero.entryId)).toThrow(/no time/);
  });
});

describe("time under postgres RLS", () => {
  beforeAll(() => {
    usePostgresMemory();
    clearSupabaseEnv();
  }, 60_000);

  afterAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("shows a field member only their punches and hides rates and posted labor", () => {
    getDb().update(users).set({ authUserId: DANA }).where(eq(users.id, "user_dana")).run();
    getDb().update(users).set({ authUserId: MAYA }).where(eq(users.id, "user_maya")).run();
    getDb().update(users).set({ authUserId: JORDAN }).where(eq(users.id, "user_jordan")).run();
    getDb()
      .insert(timeEntries)
      .values({
        id: "time_rls_maya",
        orgId: "org_rivera",
        userId: "user_maya",
        projectId: "proj_okonkwo",
        costCode: "GC-SUPER",
        status: "pending",
        clockInAt: "2026-10-04T15:00:00.000Z",
        clockOutAt: "2026-10-04T16:00:00.000Z",
        breakMinutes: 0,
        breakStartedAt: null,
        note: null,
        clockInLatE6: null,
        clockInLngE6: null,
        clockOutLatE6: null,
        clockOutLngE6: null,
        source: "manual",
        createdAt: "2026-10-04T16:00:00.000Z",
        updatedAt: "2026-10-04T16:00:00.000Z",
        createdBy: "user_maya",
      })
      .run();
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
      grant select on public.time_entries to authenticated;
      grant select on public.labor_rates to authenticated;
      grant select on public.time_approvals to authenticated;
      alter table public.time_entries enable row level security;
      alter table public.time_entries force row level security;
      alter table public.labor_rates enable row level security;
      alter table public.labor_rates force row level security;
      alter table public.time_approvals enable row level security;
      alter table public.time_approvals force row level security;
      drop policy if exists time_entries_scope on public.time_entries;
      drop policy if exists labor_rates_money on public.labor_rates;
      drop policy if exists time_approvals_money on public.time_approvals;
      create policy time_entries_scope on public.time_entries for select to authenticated using (org_id in (select public.current_org_ids()) and (public.can_see_money(org_id) or user_id = public.current_user_id()));
      create policy labor_rates_money on public.labor_rates for select to authenticated using (org_id in (select public.current_org_ids()) and public.can_see_money(org_id));
      create policy time_approvals_money on public.time_approvals for select to authenticated using (org_id in (select public.current_org_ids()) and public.can_see_money(org_id));
    `);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-public-test";
    const fieldEntries = withOfficeClaim(DANA, () => getRlsDb().select({ id: timeEntries.id, userId: timeEntries.userId }).from(timeEntries).all());
    const fieldRates = withOfficeClaim(DANA, () => getRlsDb().select({ id: laborRates.id }).from(laborRates).all());
    const fieldApprovals = withOfficeClaim(DANA, () => getRlsDb().select({ id: timeApprovals.id }).from(timeApprovals).all());
    const ownerEntries = withOfficeClaim(MAYA, () => getRlsDb().select({ id: timeEntries.id }).from(timeEntries).all());
    const ownerRates = withOfficeClaim(MAYA, () => getRlsDb().select({ id: laborRates.id }).from(laborRates).all());
    const jordanEntries = withOfficeClaim(JORDAN, () => getRlsDb().select({ id: timeEntries.id, orgId: timeEntries.orgId }).from(timeEntries).all());
    expect(fieldEntries.length).toBeGreaterThan(0);
    expect(fieldEntries.every((row) => row.userId === "user_dana")).toBe(true);
    expect(fieldEntries.some((row) => row.id === "time_rls_maya")).toBe(false);
    expect(fieldRates).toEqual([]);
    expect(fieldApprovals).toEqual([]);
    expect(ownerEntries.some((row) => row.id === "time_rls_maya")).toBe(true);
    expect(ownerEntries.some((row) => row.id === "time_ok_tile")).toBe(true);
    expect(ownerRates.length).toBeGreaterThan(0);
    expect(jordanEntries.every((row) => row.orgId === "org_northline")).toBe(true);
    expect(jordanEntries.some((row) => row.id === "time_ok_tile")).toBe(false);
    clearSupabaseEnv();
  });
});
