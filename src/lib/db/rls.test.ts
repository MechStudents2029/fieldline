import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getRlsDb, getSqlite, useDatabaseFile, usePostgresMemory } from "@/lib/db/client";
import { currentOrgIds, resolveReadConnection } from "@/lib/db/office";
import { withOfficeClaim } from "@/lib/db/rls-context";
import { contacts, tasks, users } from "@/lib/db/schema";
import { authenticate, estimateDetail, invoiceByPayToken, leadDetail, listContacts, listInvoices, listPriceBook, listProjects, listTasks, pipelineBoard } from "@/lib/services/read";
import { createTask } from "@/lib/services/write";
import { authUserIdFromClaims } from "@/lib/supabase/claims";
import { supabaseAnonKey, supabaseAuthConfigured } from "@/lib/supabase/env";

const MAYA = "11111111-1111-4111-8111-111111111111";
const JORDAN = "22222222-2222-4222-8222-222222222222";

function supabaseEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-public-test";
}

function clearSupabaseEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

describe("office RLS path", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
    getDb().update(users).set({ authUserId: MAYA }).where(eq(users.id, "user_maya")).run();
    getDb().update(users).set({ authUserId: JORDAN }).where(eq(users.id, "user_jordan")).run();
  });

  afterAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("keeps the demo owner connection when Supabase env is unset", () => {
    clearSupabaseEnv();
    expect(supabaseAuthConfigured()).toBe(false);
    expect(resolveReadConnection({ purpose: "office", supabaseConfigured: false, authUserId: JORDAN, dialect: "postgres" })).toBe("owner");
    const rows = withOfficeClaim(JORDAN, () => listContacts("org_rivera"));
    expect(rows.some((contact) => contact.id === "c_vasquez")).toBe(true);
    expect(listProjects("org_rivera").length).toBeGreaterThan(0);
  });

  it("hides another company when a verified claim is present", () => {
    supabaseEnv();
    expect(currentOrgIds(JORDAN)).toEqual(["org_northline"]);
    expect(currentOrgIds(MAYA)).toEqual(["org_rivera"]);
    const blocked = withOfficeClaim(JORDAN, () => ({
      contacts: listContacts("org_rivera"),
      invoices: listInvoices("org_rivera"),
      projects: listProjects("org_rivera"),
      board: pipelineBoard("org_rivera"),
    }));
    expect(blocked.contacts).toEqual([]);
    expect(blocked.invoices).toEqual([]);
    expect(blocked.projects).toEqual([]);
    expect(blocked.board.cards).toEqual([]);
    const own = withOfficeClaim(JORDAN, () => listContacts("org_northline"));
    expect(own.some((contact) => contact.id === "c_north_ada")).toBe(true);
    expect(own.some((contact) => contact.id === "c_vasquez")).toBe(false);
    expect(withOfficeClaim(JORDAN, () => invoiceByPayToken("demo_pay_chen_deposit"))?.invoice.orgId).toBe("org_rivera");
    clearSupabaseEnv();
  });

  it("reads a job file and writes a task through getDb when Supabase is unset", () => {
    clearSupabaseEnv();
    const lead = withOfficeClaim(JORDAN, () => leadDetail("org_rivera", "lead_vasquez"));
    expect(lead?.lead.id).toBe("lead_vasquez");
    const maya = authenticate("maya@rivera.demo", "demo");
    expect(maya).not.toBeNull();
    withOfficeClaim(JORDAN, () => createTask(maya!, { title: "Demo task stays on the owner connection", relatedType: "lead", relatedId: "lead_vasquez" }));
    expect(listTasks("org_rivera").some((task) => task.title === "Demo task stays on the owner connection")).toBe(true);
  });

  it("hides a job detail and refuses an office write under another company's claim", () => {
    supabaseEnv();
    const hidden = withOfficeClaim(JORDAN, () => ({
      lead: leadDetail("org_rivera", "lead_vasquez"),
      estimate: estimateDetail("org_rivera", "est_briggs"),
      book: listPriceBook("org_rivera"),
    }));
    expect(hidden.lead).toBeNull();
    expect(hidden.estimate).toBeNull();
    expect(hidden.book).toEqual([]);
    const maya = authenticate("maya@rivera.demo", "demo");
    expect(maya?.orgId).toBe("org_rivera");
    expect(() =>
      withOfficeClaim(JORDAN, () => createTask(maya!, { title: "Cross-org task", relatedType: "lead", relatedId: "lead_vasquez" })),
    ).toThrow(/signed-in account/);
    expect(listTasks("org_rivera").some((task) => task.title === "Cross-org task")).toBe(false);
    expect(withOfficeClaim(MAYA, () => leadDetail("org_rivera", "lead_vasquez"))?.lead.id).toBe("lead_vasquez");
    const source = readFileSync("src/lib/services/write.ts", "utf8");
    for (const name of ["markProposalViewed", "signProposal", "declineProposal", "payInvoice", "approveChangeOrder", "scanFollowUps", "addPortalMessage"]) {
      const start = source.indexOf(`function ${name}`);
      const next = source.indexOf("\nexport ", start + 1);
      const body = source.slice(start, next === -1 ? undefined : next);
      expect(body).toContain("getDb()");
      expect(body).not.toContain("staffDb");
    }
    expect(source.slice(source.indexOf("function createTask"), source.indexOf("function completeTask"))).toContain("staffDb");
    clearSupabaseEnv();
  });

  it("refuses a public service-role JWT and ignores getSession-style anon claims", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const service = `${header}.${Buffer.from(JSON.stringify({ role: "service_role", sub: MAYA })).toString("base64url")}.sig`;
    const anon = `${header}.${Buffer.from(JSON.stringify({ role: "anon", sub: MAYA })).toString("base64url")}.sig`;
    expect(supabaseAnonKey({ NEXT_PUBLIC_SUPABASE_ANON_KEY: service })).toBeUndefined();
    expect(supabaseAuthConfigured({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: service })).toBe(false);
    expect(authUserIdFromClaims({ role: "service_role", sub: MAYA })).toBeNull();
    expect(authUserIdFromClaims({ role: "anon", sub: MAYA })).toBeNull();
    expect(authUserIdFromClaims({ role: "authenticated", sub: JORDAN })).toBe(JORDAN);
    expect(supabaseAnonKey({ NEXT_PUBLIC_SUPABASE_ANON_KEY: anon })).toBe(anon);
    expect(resolveReadConnection({ purpose: "privileged", supabaseConfigured: true, authUserId: JORDAN, dialect: "postgres" })).toBe("owner");
    expect(resolveReadConnection({ purpose: "office", supabaseConfigured: true, authUserId: JORDAN, dialect: "postgres" })).toBe("rls");
    expect(resolveReadConnection({ purpose: "office", supabaseConfigured: true, authUserId: JORDAN, dialect: "sqlite" })).toBe("owner");
    for (const file of ["src/app/api/cron/follow-ups/route.ts", "src/lib/payments/apply.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("getDb");
      expect(source).not.toContain("officeDb");
      expect(source).not.toContain("getRlsDb");
    }
  });
});

describe("postgres authenticated role", () => {
  beforeAll(() => {
    usePostgresMemory();
  }, 60_000);

  afterAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("returns only the claim's company when the query has no org filter", () => {
    getDb().update(users).set({ authUserId: MAYA }).where(eq(users.id, "user_maya")).run();
    getDb().update(users).set({ authUserId: JORDAN }).where(eq(users.id, "user_jordan")).run();
    getSqlite().exec(`
      create schema if not exists auth;
      create or replace function auth.uid() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', '') $$;
      create or replace function public.current_org_ids() returns setof text language sql stable security definer set search_path = public as $$ select m.org_id from public.memberships m join public.users u on u.id = m.user_id where u.auth_user_id = auth.uid() $$;
      create role authenticated nologin;
      grant usage on schema public to authenticated;
      grant select on public.contacts to authenticated;
      grant execute on function public.current_org_ids() to authenticated;
      grant execute on function auth.uid() to authenticated;
      alter table public.contacts enable row level security;
      alter table public.contacts force row level security;
      create policy contacts_member on public.contacts for select to authenticated using (org_id in (select public.current_org_ids()));
    `);
    supabaseEnv();
    const rows = withOfficeClaim(JORDAN, () => getRlsDb().select({ id: contacts.id, orgId: contacts.orgId }).from(contacts).all());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.orgId === "org_northline")).toBe(true);
    expect(rows.some((row) => row.id === "c_vasquez")).toBe(false);
    clearSupabaseEnv();
  });

  it("rejects a task insert for another company under the authenticated role", () => {
    getDb().update(users).set({ authUserId: MAYA }).where(eq(users.id, "user_maya")).run();
    getDb().update(users).set({ authUserId: JORDAN }).where(eq(users.id, "user_jordan")).run();
    try {
      getSqlite().exec("create role authenticated nologin");
    } catch {
      // The select test already created the role.
    }
    getSqlite().exec(`
      create schema if not exists auth;
      create or replace function auth.uid() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', '') $$;
      create or replace function public.current_org_ids() returns setof text language sql stable security definer set search_path = public as $$ select m.org_id from public.memberships m join public.users u on u.id = m.user_id where u.auth_user_id = auth.uid() $$;
      grant usage on schema public to authenticated;
      grant select, insert, update, delete on public.tasks to authenticated;
      grant execute on function public.current_org_ids() to authenticated;
      grant execute on function auth.uid() to authenticated;
      alter table public.tasks enable row level security;
      alter table public.tasks force row level security;
      drop policy if exists tasks_member on public.tasks;
      create policy tasks_member on public.tasks for all to authenticated using (org_id in (select public.current_org_ids())) with check (org_id in (select public.current_org_ids()));
    `);
    supabaseEnv();
    const stamp = "2026-10-04T00:00:00.000Z";
    expect(() =>
      withOfficeClaim(JORDAN, () =>
        getRlsDb()
          .insert(tasks)
          .values({ id: "task_rls_rivera", orgId: "org_rivera", title: "Nope", status: "open", createdAt: stamp, updatedAt: stamp })
          .run(),
      ),
    ).toThrow();
    withOfficeClaim(JORDAN, () =>
      getRlsDb()
        .insert(tasks)
        .values({ id: "task_rls_north", orgId: "org_northline", title: "Northline task", status: "open", createdAt: stamp, updatedAt: stamp })
        .run(),
    );
    const rows = withOfficeClaim(JORDAN, () => getRlsDb().select({ id: tasks.id, orgId: tasks.orgId }).from(tasks).all());
    expect(rows.some((row) => row.id === "task_rls_north")).toBe(true);
    expect(rows.some((row) => row.id === "task_rls_rivera")).toBe(false);
    expect(rows.every((row) => row.orgId === "org_northline")).toBe(true);
    clearSupabaseEnv();
  });
});
