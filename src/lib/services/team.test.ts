import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { hashInviteToken } from "@/lib/auth/invite-token";
import { getDb, getRlsDb, getSqlite, useDatabaseFile, usePostgresMemory } from "@/lib/db/client";
import { withOfficeClaim } from "@/lib/db/rls-context";
import { activities, invoices, memberships, projects, teamInvites, users } from "@/lib/db/schema";
import { proxy } from "@/proxy";
import { resetAcceptRateLimit } from "@/lib/security";
import { addStarterPriceBook, createCompany, setupFacts } from "@/lib/services/onboarding";
import { authenticate, projectDetail } from "@/lib/services/read";
import {
  ACCEPT_LIMIT,
  INVITE_EMAIL,
  INVITE_INVALID,
  acceptExistingAccount,
  acceptNewAccount,
  changeMemberRole,
  createInvite,
  previewInvite,
  removeMember,
  revokeInvite,
} from "@/lib/services/team";
import { addCost, createTask, generateEstimate, issueNextInvoice, sendProposal } from "@/lib/services/write";

const NOW = Date.UTC(2026, 9, 5, 15);
const DAY = 24 * 60 * 60 * 1000;
const DANA = "66666666-6666-4666-8666-666666666666";
const MAYA = "11111111-1111-4111-8111-111111111111";

function tokenFrom(url: string) {
  return url.split("/invite/")[1] || "";
}

function clearSupabaseEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

describe("team invites", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
    resetAcceptRateLimit();
  });

  it("stores a hash, expires by role, and leaves the token out of the activity log", () => {
    const maya = authenticate("maya@rivera.demo", "demo");
    expect(maya).not.toBeNull();
    const field = createInvite(maya!, { email: "Casey.Field@example.com", role: "field" }, NOW);
    const admin = createInvite(maya!, { email: "pat.admin@example.com", role: "admin" }, NOW);
    const office = createInvite(maya!, { email: "lee.office@example.com", role: "estimator" }, NOW);
    const token = tokenFrom(field.url);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(admin.expiresAt) - NOW).toBe(48 * 60 * 60 * 1000);
    expect(Date.parse(field.expiresAt) - NOW).toBe(7 * DAY);
    expect(Date.parse(office.expiresAt) - NOW).toBe(7 * DAY);
    const row = getDb().select().from(teamInvites).where(eq(teamInvites.email, "casey.field@example.com")).get();
    expect(row?.tokenHash).toBe(hashInviteToken(token));
    expect(row?.tokenHash).not.toContain(token);
    expect(row?.status).toBe("pending");
    const stored = JSON.stringify(getDb().select().from(teamInvites).all());
    expect(stored).not.toContain(token);
    const log = getDb().select().from(activities).where(eq(activities.entityType, "membership")).all();
    expect(log.some((item) => item.type === "invited" && item.summary.includes("casey.field@example.com"))).toBe(true);
    expect(JSON.stringify(log)).not.toContain(token);
    expect(field.url.startsWith("http://127.0.0.1:3847/invite/")).toBe(true);
    const source = readFileSync(path.join(process.cwd(), "supabase", "rls.sql"), "utf8");
    expect(source).toContain("team_invites");
    expect(source).toContain("can_see_money");
  });

  it("previews without consuming, then accepts once", () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    const invite = createInvite(maya, { email: "once.field@example.com", role: "field" }, NOW);
    const token = tokenFrom(invite.url);
    const preview = previewInvite(token, { now: NOW });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.preview.companyName).toBe("Rivera Remodeling & Trade");
    expect(preview.preview.roleLabel).toBe("Field");
    expect(preview.preview.inviterName).toBe("Maya Rivera");
    expect(getDb().select().from(teamInvites).where(eq(teamInvites.email, "once.field@example.com")).get()?.status).toBe("pending");
    const joined = acceptNewAccount(token, { name: "Once Field", password: "fieldline-test" }, { now: NOW });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.actor.role).toBe("field");
    expect(joined.actor.orgId).toBe(maya.orgId);
    const again = acceptExistingAccount(token, { userId: joined.actor.userId }, { now: NOW });
    expect(again).toEqual({ ok: false, error: INVITE_INVALID });
    expect(again.ok === false && again.error.includes(token)).toBe(false);
  });

  it("revokes the earlier pending invite when the same email is invited again", () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    const first = createInvite(maya, { email: "reissue@example.com", role: "field" }, NOW);
    const second = createInvite(maya, { email: "reissue@example.com", role: "estimator" }, NOW + 1000);
    expect(previewInvite(tokenFrom(first.url), { now: NOW + 1000 })).toEqual({ ok: false, error: INVITE_INVALID });
    const preview = previewInvite(tokenFrom(second.url), { now: NOW + 1000 });
    expect(preview.ok).toBe(true);
    if (preview.ok) expect(preview.preview.roleLabel).toBe("Office");
    const rows = getDb().select().from(teamInvites).where(eq(teamInvites.email, "reissue@example.com")).all();
    expect(rows.filter((row) => row.status === "revoked")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "pending")).toHaveLength(1);
  });

  it("uses one error for expired, revoked, and wrong-company links", () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    const expired = createInvite(maya, { email: "expired.field@example.com", role: "field" }, NOW);
    const revoked = createInvite(maya, { email: "revoked.field@example.com", role: "field" }, NOW);
    const revokedRow = getDb().select().from(teamInvites).where(eq(teamInvites.email, "revoked.field@example.com")).get()!;
    revokeInvite(maya, revokedRow.id);
    const wrongOrg = acceptNewAccount(tokenFrom(expired.url), { name: "Nope", password: "fieldline-test", orgId: "org_northline" }, { now: NOW });
    const late = previewInvite(tokenFrom(expired.url), { now: NOW + 8 * DAY });
    const dead = previewInvite(tokenFrom(revoked.url), { now: NOW });
    expect(wrongOrg).toEqual({ ok: false, error: INVITE_INVALID });
    expect(late).toEqual({ ok: false, error: INVITE_INVALID });
    expect(dead).toEqual({ ok: false, error: INVITE_INVALID });
    expect(getDb().select().from(teamInvites).where(eq(teamInvites.email, "expired.field@example.com")).get()?.status).toBe("pending");
  });

  it("refuses a different email and leaves the invite pending", () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    const jordan = authenticate("jordan@northline.demo", "demo")!;
    const invite = createInvite(maya, { email: "right.person@example.com", role: "field" }, NOW);
    const refused = acceptExistingAccount(tokenFrom(invite.url), { userId: jordan.userId }, { now: NOW });
    expect(refused).toEqual({ ok: false, error: INVITE_EMAIL });
    expect(getDb().select().from(teamInvites).where(eq(teamInvites.email, "right.person@example.com")).get()?.status).toBe("pending");
  });

  it("keeps the last owner and lets a second owner step down", () => {
    const created = createCompany({
      ownerName: "Avery Cole",
      email: "avery.owner@cole.example",
      password: "fieldline-test",
      companyName: "Cole Kitchens",
      trade: "remodel",
      state: "CA",
      starter: false,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const owner = created.actor;
    expect(setupFacts(owner.orgId)?.teamInvited).toBe(false);
    expect(() => removeMember(owner, owner.userId)).toThrow(/at least one owner/);
    expect(() => changeMemberRole(owner, owner.userId, "field")).toThrow(/at least one owner/);
    const invite = createInvite(owner, { email: "second.owner@cole.example", role: "field" }, NOW);
    expect(setupFacts(owner.orgId)?.teamInvited).toBe(true);
    const joined = acceptNewAccount(tokenFrom(invite.url), { name: "Second Owner", password: "fieldline-test" }, { now: NOW });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    changeMemberRole(owner, joined.actor.userId, "owner");
    changeMemberRole(owner, owner.userId, "admin");
    const owners = getDb().select().from(memberships).where(eq(memberships.orgId, owner.orgId)).all().filter((row) => row.role === "owner");
    expect(owners).toHaveLength(1);
    expect(owners[0]?.userId).toBe(joined.actor.userId);
    const log = JSON.stringify(getDb().select().from(activities).where(eq(activities.orgId, owner.orgId)).all());
    expect(log).toContain("accepted");
    expect(log).toContain("role_changed");
    expect(log).not.toContain(tokenFrom(invite.url));
  });

  it("lets an admin invite field and blocks admin grants", () => {
    const sam = authenticate("sam@rivera.demo", "demo")!;
    expect(() => createInvite(sam, { email: "not.admin@example.com", role: "admin" })).toThrow(/owner can invite an admin/);
    expect(() => changeMemberRole(sam, "user_dana", "admin")).toThrow(/owner can grant/);
    expect(() => removeMember(sam, "user_maya")).toThrow(/owner can remove/);
    const invite = createInvite(sam, { email: "crew.lead@example.com", role: "field" }, NOW);
    expect(invite.role).toBe("field");
  });

  it("hides money routes from the field role and still allows a task", async () => {
    const dana = authenticate("dana@rivera.demo", "demo")!;
    await expect(sendProposal(dana, "est_missing")).rejects.toThrow(/cannot change prices/);
    await expect(generateEstimate(dana, "lead_vasquez")).rejects.toThrow(/cannot change prices/);
    expect(() => issueNextInvoice(dana, "proj_okonkwo")).toThrow(/cannot change prices/);
    expect(() => addCost(dana, "proj_okonkwo", { amountCents: 1000, vendorName: "Casa Tile", source: "expense" })).toThrow(/cannot change prices/);
    expect(() => addStarterPriceBook(dana, "remodel")).toThrow(/owner or admin/);
    expect(() => createInvite(dana, { email: "nope@example.com", role: "field" })).toThrow(/owner or admin/);
    createTask(dana, { title: "Photograph the tile", relatedType: "project", relatedId: "proj_okonkwo" });
    const detail = projectDetail(dana.orgId, "proj_okonkwo", "field");
    expect(detail?.financials).toBeNull();
    expect(detail?.project.contractValueCents).toBe(0);
    expect(detail?.invoices).toEqual([]);
    expect(detail?.project.name).toBe("Okonkwo primary bath");
  });

  it("rate-limits accept attempts and sets no-referrer on the invite path", async () => {
    resetAcceptRateLimit();
    const maya = authenticate("maya@rivera.demo", "demo")!;
    const invite = createInvite(maya, { email: "limited@example.com", role: "field" }, NOW);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      previewInvite("not-a-valid-invite-token-padding-xxxx", { ip: "198.51.100.20", now: NOW });
    }
    expect(previewInvite(tokenFrom(invite.url), { ip: "198.51.100.20", now: NOW })).toEqual({ ok: false, error: ACCEPT_LIMIT });
    const response = await proxy(new NextRequest("http://127.0.0.1:3847/invite/abc"));
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    const other = await proxy(new NextRequest("http://127.0.0.1:3847/login"));
    expect(other.headers.get("Referrer-Policy")).toBeNull();
    const env = process.env as { NODE_ENV?: string; APP_URL?: string };
    const previous = env.NODE_ENV;
    const appUrl = env.APP_URL;
    env.NODE_ENV = "production";
    delete env.APP_URL;
    try {
      expect(() => createInvite(maya, { email: "needs-url@example.com", role: "field" }, NOW)).toThrow(/APP_URL/);
    } finally {
      env.NODE_ENV = previous;
      if (appUrl === undefined) delete env.APP_URL;
      else env.APP_URL = appUrl;
    }
  });
});

describe("field money under postgres RLS", () => {
  beforeAll(() => {
    usePostgresMemory();
    clearSupabaseEnv();
  }, 60_000);

  afterAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("hides invoices from a field member and still shows the job", () => {
    getDb().update(users).set({ authUserId: DANA }).where(eq(users.id, "user_dana")).run();
    getDb().update(users).set({ authUserId: MAYA }).where(eq(users.id, "user_maya")).run();
    getSqlite().exec(`
      create schema if not exists auth;
      create or replace function auth.uid() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', '') $$;
      create or replace function public.current_org_ids() returns setof text language sql stable security definer set search_path = public as $$ select m.org_id from public.memberships m join public.users u on u.id = m.user_id where u.auth_user_id = auth.uid() $$;
      create or replace function public.can_see_money(target_org text) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.memberships m join public.users u on u.id = m.user_id where u.auth_user_id = auth.uid() and m.org_id = target_org and m.role is distinct from 'field') $$;
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
      grant execute on function auth.uid() to authenticated;
      grant select on public.invoices to authenticated;
      grant select on public.projects to authenticated;
      alter table public.invoices enable row level security;
      alter table public.invoices force row level security;
      alter table public.projects enable row level security;
      alter table public.projects force row level security;
      drop policy if exists invoices_money on public.invoices;
      drop policy if exists projects_member on public.projects;
      create policy invoices_money on public.invoices for select to authenticated using (org_id in (select public.current_org_ids()) and public.can_see_money(org_id));
      create policy projects_member on public.projects for select to authenticated using (org_id in (select public.current_org_ids()));
    `);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-public-test";
    const fieldInvoices = withOfficeClaim(DANA, () => getRlsDb().select({ id: invoices.id }).from(invoices).all());
    const fieldProjects = withOfficeClaim(DANA, () => getRlsDb().select({ id: projects.id }).from(projects).all());
    const ownerInvoices = withOfficeClaim(MAYA, () => getRlsDb().select({ id: invoices.id }).from(invoices).all());
    expect(fieldInvoices).toEqual([]);
    expect(fieldProjects.some((row) => row.id === "proj_okonkwo")).toBe(true);
    expect(ownerInvoices.length).toBeGreaterThan(0);
    clearSupabaseEnv();
  });
});
