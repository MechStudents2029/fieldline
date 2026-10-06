import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getRlsDb, getSqlite, useDatabaseFile, usePostgresMemory } from "@/lib/db/client";
import { withOfficeClaim } from "@/lib/db/rls-context";
import { calendarFeeds, projects, scheduleItems, users } from "@/lib/db/schema";
import { authenticate } from "@/lib/services/read";
import {
  jobSchedule,
  memberAssignments,
  moveScheduleItem,
  rotateCalendarFeed,
  saveScheduleItem,
  scheduleBoard,
  scheduleFeedIcs,
} from "@/lib/services/schedule";
import { localDay } from "@/lib/time/calendar";

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

const input = {
  projectId: "proj_chen",
  title: "Measure the niche",
  startDate: "2026-10-08",
  endDate: "2026-10-08",
  startTime: null,
  status: "planned" as const,
  note: null,
  assigneeIds: ["user_sam"],
};

describe("schedule", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("shows the seeded overlap for this company only", () => {
    const board = scheduleBoard(actor("maya@rivera.demo"), {});
    expect(board.counts.items).toBeGreaterThan(0);
    expect(board.counts.conflicts).toBeGreaterThan(0);
    const dana = board.rows.find((row) => row.name === "Dana Cho");
    expect(dana?.cells.some((cell) => cell.items.some((item) => item.conflict && item.jobName === "Chen powder room"))).toBe(true);
    expect(scheduleBoard(actor("jordan@northline.demo"), {}).counts.items).toBe(0);
    expect(jobSchedule(actor("jordan@northline.demo"), "proj_okonkwo")).toEqual([]);
    const sql = readFileSync("supabase/rls.sql", "utf8");
    for (const table of ["schedule_items", "schedule_assignees", "calendar_feeds"]) {
      expect(sql).toContain(`'${table}'`);
    }
  });

  it("lets the office save and move, and refuses field, viewer, and another company's job", () => {
    expect(() => saveScheduleItem(actor("dana@rivera.demo"), input)).toThrow(/view the schedule/);
    expect(() => moveScheduleItem(actor("riley@rivera.demo"), "sch_ok_tile", { startDate: "2026-10-08", endDate: "2026-10-08", assigneeId: "user_riley" })).toThrow(/view the schedule/);
    const maya = actor("maya@rivera.demo");
    expect(() => saveScheduleItem(maya, { ...input, projectId: "proj_missing" })).toThrow(/not in your company/);
    const saved = saveScheduleItem(maya, input);
    moveScheduleItem(maya, saved, { startDate: "2026-10-09", endDate: "2026-10-09", assigneeId: "user_luis" });
    const board = scheduleBoard(maya, { on: "2026-10-09" });
    const luis = board.rows.find((row) => row.name === "Luis Ortega");
    expect(luis?.cells.some((cell) => cell.items.some((item) => item.title === "Measure the niche"))).toBe(true);
    saveScheduleItem(maya, {
      ...input,
      title: "Overlap on purpose",
      projectId: "proj_brooks",
      startDate: localDay(Date.now(), "America/New_York"),
      endDate: localDay(Date.now(), "America/New_York"),
      assigneeIds: ["user_dana"],
    });
    expect(scheduleBoard(maya, {}).counts.conflicts).toBeGreaterThan(0);
  });

  it("serves one person's calendar and drops the link when it is replaced", () => {
    const dana = actor("dana@rivera.demo");
    const token = rotateCalendarFeed(dana);
    const body = scheduleFeedIcs(token);
    expect(body).toContain("DTSTART;VALUE=DATE:");
    expect(body).toContain("Okonkwo primary bath: Tile shower");
    expect(body).not.toContain("Client walk");
    const stored = getDb().select().from(calendarFeeds).where(eq(calendarFeeds.userId, "user_dana")).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).not.toContain(token);
    expect(stored[0]?.orgId).toBe("org_rivera");
    const next = rotateCalendarFeed(dana);
    expect(scheduleFeedIcs(token)).toBeNull();
    expect(scheduleFeedIcs(next)).toContain("Okonkwo primary bath: Tile shower");
    expect(scheduleFeedIcs("not-a-real-token-value")).toBeNull();
    const plan = memberAssignments(dana);
    expect(plan.tomorrow.some((item) => item.jobName === "Okonkwo primary bath")).toBe(true);
    expect(plan.today.some((item) => item.title === "Client walk")).toBe(false);
    const source = readFileSync("src/lib/services/schedule.ts", "utf8");
    const feed = source.slice(source.indexOf("export function scheduleFeedIcs"));
    expect(feed).toContain("getDb()");
    expect(feed).not.toContain("officeDb");
    expect(feed).toContain("feed.userId");
    expect(readFileSync("src/app/feed/[token]/route.ts", "utf8")).not.toContain("officeDb");
  });
});

describe("schedule under postgres RLS", () => {
  beforeAll(() => {
    usePostgresMemory();
    clearSupabaseEnv();
  }, 60_000);

  afterAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("hides another company's items", () => {
    getDb().update(users).set({ authUserId: DANA }).where(eq(users.id, "user_dana")).run();
    getDb().update(users).set({ authUserId: MAYA }).where(eq(users.id, "user_maya")).run();
    getDb().update(users).set({ authUserId: JORDAN }).where(eq(users.id, "user_jordan")).run();
    getSqlite().exec(`
      create schema if not exists auth;
      create or replace function auth.uid() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', '') $$;
      create or replace function public.current_org_ids() returns setof text language sql stable security definer set search_path = public as $$ select m.org_id from public.memberships m join public.users u on u.id = m.user_id where u.auth_user_id = auth.uid() $$;
    `);
    try {
      getSqlite().exec("create role authenticated nologin");
    } catch {
      // Already created in this database.
    }
    getSqlite().exec(`
      grant usage on schema public to authenticated;
      grant execute on function public.current_org_ids() to authenticated;
      grant execute on function auth.uid() to authenticated;
      grant select on public.schedule_items to authenticated;
      alter table public.schedule_items enable row level security;
      alter table public.schedule_items force row level security;
      drop policy if exists schedule_items_member on public.schedule_items;
      create policy schedule_items_member on public.schedule_items for select to authenticated using (org_id in (select public.current_org_ids()));
    `);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-public-test";
    const jordanRows = withOfficeClaim(JORDAN, () => getRlsDb().select({ id: scheduleItems.id, orgId: scheduleItems.orgId }).from(scheduleItems).all());
    const mayaRows = withOfficeClaim(MAYA, () => getRlsDb().select({ id: scheduleItems.id, orgId: scheduleItems.orgId }).from(scheduleItems).all());
    expect(jordanRows).toEqual([]);
    expect(mayaRows.length).toBeGreaterThan(0);
    expect(mayaRows.every((row) => row.orgId === "org_rivera")).toBe(true);
    expect(getDb().select({ id: projects.id }).from(projects).where(eq(projects.id, "proj_okonkwo")).get()?.id).toBe("proj_okonkwo");
    clearSupabaseEnv();
  });
});
