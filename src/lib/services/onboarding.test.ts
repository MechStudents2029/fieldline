import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { actorFromAuthUser } from "@/lib/auth/membership";
import { registerCompany } from "@/lib/auth/signup";
import { getDb, getRlsDb, getSqlite, useDatabaseFile, usePostgresMemory } from "@/lib/db/client";
import { withOfficeClaim } from "@/lib/db/rls-context";
import { contacts, memberships, organizations, pipelineStages, priceBookItems, users } from "@/lib/db/schema";
import { starterCodes } from "@/lib/db/starter";
import { setupChecklist } from "@/lib/onboarding/checklist";
import { resetSignupRateLimit } from "@/lib/security";
import {
  addStarterPriceBook,
  createCompany,
  setSetupDismissed,
  setupFacts,
} from "@/lib/services/onboarding";
import { listContacts, listInvoices, listLoginChoices, listPriceBook, listProjects, listTesterFeedback } from "@/lib/services/read";
import { createLeadFromText, generateEstimate, updateOrgSettings } from "@/lib/services/write";
import type { SignupFields } from "@/lib/security";

const JORDAN = "22222222-2222-4222-8222-222222222222";
const NEW_OWNER = "44444444-4444-4444-8444-444444444444";
const CONFIRM_ID = "55555555-5555-4555-8555-555555555555";

function fields(over: Partial<SignupFields> = {}): SignupFields {
  return {
    ownerName: "Avery Cole",
    email: `avery-${Math.random().toString(16).slice(2)}@example.com`,
    password: "fieldline-test",
    companyName: "Cole Kitchens",
    trade: "remodel",
    state: "CA",
    starter: true,
    ...over,
  };
}

function clearSupabaseEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

describe("checklist derivation", () => {
  it("follows license, book, lead, estimate, and a sent proposal", () => {
    const empty = setupChecklist({
      licenseNumber: null,
      priceBookCount: 0,
      leadCount: 0,
      estimateCount: 0,
      sentProposalCount: 0,
      stripeTestKey: false,
      teamInvited: false,
      firstLeadId: null,
      firstEstimateId: null,
      dismissed: false,
    });
    expect(empty.find((step) => step.id === "license")?.done).toBe(false);
    expect(empty.find((step) => step.id === "lead")?.href).toBe("/leads/new");
    expect(empty.find((step) => step.id === "proposal")?.detail).toMatch(/Nothing sends on its own/);
    expect(empty.find((step) => step.id === "stripe")?.optional).toBe(true);
    expect(empty.find((step) => step.id === "team")?.optional).toBe(true);
    expect(empty.find((step) => step.id === "team")?.done).toBe(false);
    expect(empty.find((step) => step.id === "stripe")?.done).toBe(false);

    const moved = setupChecklist({
      licenseNumber: "CSLB 123",
      priceBookCount: 4,
      leadCount: 1,
      estimateCount: 1,
      sentProposalCount: 0,
      stripeTestKey: true,
      teamInvited: true,
      firstLeadId: "lead_1",
      firstEstimateId: "est_1",
      dismissed: false,
    });
    expect(moved.find((step) => step.id === "license")?.done).toBe(true);
    expect(moved.find((step) => step.id === "book")?.done).toBe(true);
    expect(moved.find((step) => step.id === "lead")?.done).toBe(true);
    expect(moved.find((step) => step.id === "estimate")?.done).toBe(true);
    expect(moved.find((step) => step.id === "estimate")?.href).toBe("/estimates/est_1");
    expect(moved.find((step) => step.id === "proposal")?.done).toBe(false);
    expect(moved.find((step) => step.id === "stripe")?.done).toBe(true);
    expect(moved.find((step) => step.id === "team")?.done).toBe(true);
  });
});

describe("new company", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  beforeEach(() => {
    resetSignupRateLimit();
    clearSupabaseEnv();
  });

  afterAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("creates an owner, a pipeline, and a starter book without Rivera rows", async () => {
    const riveraIds = new Set(listPriceBook("org_rivera").map((item) => item.id));
    expect(riveraIds.has("pb_cab-base")).toBe(true);
    const created = createCompany(fields({ email: "avery@cole.example" }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const { actor } = created;
    expect(actor.role).toBe("owner");
    expect(actor.orgName).toBe("Cole Kitchens");
    expect(actor.orgId).not.toBe("org_rivera");
    const members = getDb().select().from(memberships).where(eq(memberships.orgId, actor.orgId)).all();
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe("owner");
    const stages = getDb().select().from(pipelineStages).where(eq(pipelineStages.orgId, actor.orgId)).all();
    expect(stages.map((stage) => stage.name).sort()).toEqual(
      ["Contacted", "Estimate sent", "Lost", "Negotiation", "New", "Site visit", "Won"].sort(),
    );
    const book = listPriceBook(actor.orgId);
    expect(book.map((item) => item.code).sort()).toEqual([...starterCodes("remodel")].sort());
    expect(book.every((item) => item.orgId === actor.orgId)).toBe(true);
    expect(book.every((item) => item.vendor?.includes("Starter — edit your prices"))).toBe(true);
    expect(book.some((item) => riveraIds.has(item.id))).toBe(false);
    expect(listContacts(actor.orgId)).toEqual([]);
    expect(listProjects(actor.orgId)).toEqual([]);
    expect(listInvoices(actor.orgId)).toEqual([]);
    expect(listTesterFeedback(actor.orgId)).toEqual([]);
    expect(listContacts("org_rivera").some((contact) => contact.id === "c_vasquez")).toBe(true);
    expect(listLoginChoices().some((person) => person.email === "avery@cole.example")).toBe(false);
    expect(listLoginChoices().some((person) => person.email === "maya@rivera.demo")).toBe(true);

    const before = setupFacts(actor.orgId);
    expect(before?.leadCount).toBe(0);
    expect(before?.priceBookCount).toBe(starterCodes("remodel").length);
    expect(setupChecklist(before!).find((step) => step.id === "license")?.done).toBe(false);
    expect(setupChecklist(before!).find((step) => step.id === "book")?.done).toBe(true);

    const lead = createLeadFromText(
      actor,
      "Avery Cole, avery.client@example.com, 180 sq ft kitchen gut, new cabinets, quartz, 12 linear ft of base cabinets. Relocate the sink. Paint. Recessed lights.",
    );
    await generateEstimate(actor, lead.leadId);
    const after = setupFacts(actor.orgId);
    expect(after?.leadCount).toBe(1);
    expect(after?.estimateCount).toBe(1);
    expect(after?.sentProposalCount).toBe(0);
    expect(setupChecklist(after!).find((step) => step.id === "lead")?.done).toBe(true);
    expect(setupChecklist(after!).find((step) => step.id === "estimate")?.done).toBe(true);
    expect(setupChecklist(after!).find((step) => step.id === "proposal")?.done).toBe(false);

    updateOrgSettings(actor, { marginAlertBps: 2000, defaultMarkupBps: 3500, cardEnabled: true, licenseNumber: "CSLB 123" });
    expect(setupFacts(actor.orgId)?.licenseNumber).toBe("CSLB 123");
    setSetupDismissed(actor, true);
    expect(setupFacts(actor.orgId)?.dismissed).toBe(true);
    setSetupDismissed(actor, false);
    expect(setupFacts(actor.orgId)?.dismissed).toBe(false);
    expect(createCompany(fields({ email: "avery@cole.example", companyName: "Second Try" })).ok).toBe(false);
  });

  it("can add a deck book later and refuses a second copy", () => {
    const created = createCompany(fields({ email: "deck@example.com", trade: "deck", starter: false, companyName: "Cole Decks" }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(listPriceBook(created.actor.orgId)).toEqual([]);
    addStarterPriceBook(created.actor, "deck");
    const book = listPriceBook(created.actor.orgId);
    expect(book.map((item) => item.code).sort()).toEqual([...starterCodes("deck")].sort());
    expect(book.every((item) => item.orgId === created.actor.orgId)).toBe(true);
    expect(() => addStarterPriceBook(created.actor, "deck")).toThrow(/already has a price book/);
  });

  it("blocks another company when Supabase Auth is on", () => {
    const created = createCompany({ ...fields({ email: "isolated@example.com", companyName: "Isolated Co" }), authUserId: NEW_OWNER });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    getDb().update(users).set({ authUserId: JORDAN }).where(eq(users.id, "user_jordan")).run();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-public-test";
    expect(withOfficeClaim(JORDAN, () => listPriceBook(created.actor.orgId))).toEqual([]);
    expect(withOfficeClaim(JORDAN, () => listContacts(created.actor.orgId))).toEqual([]);
    expect(withOfficeClaim(NEW_OWNER, () => listContacts("org_rivera"))).toEqual([]);
    expect(withOfficeClaim(NEW_OWNER, () => listPriceBook(created.actor.orgId)).every((item) => item.orgId === created.actor.orgId)).toBe(true);
    expect(() => withOfficeClaim(JORDAN, () => setSetupDismissed(created.actor, true))).toThrow(/signed-in account/);
    expect(getDb().select().from(organizations).where(eq(organizations.id, created.actor.orgId)).get()?.setupDismissedAt ?? null).toBeNull();
    clearSupabaseEnv();
  });

  it("keeps the company when Supabase still needs an email confirmation", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-public-test";
    let called = false;
    const result = await registerCompany(fields({ email: "confirm@example.com", companyName: "Confirm Co" }), {
      env: process.env,
      ip: "203.0.113.50",
      auth: {
        async signInWithPassword() {
          return { ok: false, error: "unused" };
        },
        async signOut() {},
        async signUp() {
          called = true;
          return { ok: true, userId: CONFIRM_ID, email: "confirm@example.com", confirmed: false };
        },
      },
    });
    expect(called).toBe(true);
    expect(result.status).toBe("confirm");
    const actor = actorFromAuthUser(CONFIRM_ID, "confirm@example.com");
    expect(actor?.role).toBe("owner");
    expect(actor?.orgName).toBe("Confirm Co");
    expect(listContacts(actor!.orgId)).toEqual([]);
    clearSupabaseEnv();
  });

  it("stops a burst of new companies from one address", async () => {
    const ip = "198.51.100.20";
    for (let index = 0; index < 5; index += 1) {
      const result = await registerCompany(fields({ email: `burst-${index}@example.com`, companyName: `Burst ${index}` }), {
        env: {},
        ip,
      });
      expect(result.status).toBe("signed-in");
    }
    const blocked = await registerCompany(fields({ email: "burst-blocked@example.com" }), { env: {}, ip });
    expect(blocked.status).toBe("error");
    if (blocked.status === "error") expect(blocked.error).toMatch(/Too many/);
  });
});

describe("new company postgres RLS", () => {
  beforeAll(() => {
    usePostgresMemory();
  }, 60_000);

  afterAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("returns only the signed-in company from price book and contacts", () => {
    const created = createCompany({
      ...fields({ email: "rls-owner@example.com", companyName: "RLS Kitchens" }),
      authUserId: NEW_OWNER,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    getDb().update(users).set({ authUserId: JORDAN }).where(eq(users.id, "user_jordan")).run();
    getSqlite().exec(`
      create schema if not exists auth;
      create or replace function auth.uid() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', '') $$;
      create or replace function public.current_org_ids() returns setof text language sql stable security definer set search_path = public as $$ select m.org_id from public.memberships m join public.users u on u.id = m.user_id where u.auth_user_id = auth.uid() $$;
      create role authenticated nologin;
      grant usage on schema public to authenticated;
      grant select on public.price_book_items to authenticated;
      grant select on public.contacts to authenticated;
      grant execute on function public.current_org_ids() to authenticated;
      grant execute on function auth.uid() to authenticated;
      alter table public.price_book_items enable row level security;
      alter table public.price_book_items force row level security;
      alter table public.contacts enable row level security;
      alter table public.contacts force row level security;
      create policy price_book_member on public.price_book_items for select to authenticated using (org_id in (select public.current_org_ids()));
      create policy contacts_member on public.contacts for select to authenticated using (org_id in (select public.current_org_ids()));
    `);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-public-test";
    const ownBook = withOfficeClaim(NEW_OWNER, () =>
      getRlsDb().select({ orgId: priceBookItems.orgId, code: priceBookItems.code }).from(priceBookItems).all(),
    );
    expect(ownBook.length).toBe(starterCodes("remodel").length);
    expect(ownBook.every((row) => row.orgId === created.actor.orgId)).toBe(true);
    const jordanBook = withOfficeClaim(JORDAN, () => getRlsDb().select({ orgId: priceBookItems.orgId }).from(priceBookItems).all());
    expect(jordanBook.length).toBeGreaterThan(0);
    expect(jordanBook.every((row) => row.orgId === "org_northline")).toBe(true);
    const ownContacts = withOfficeClaim(NEW_OWNER, () => getRlsDb().select({ id: contacts.id, orgId: contacts.orgId }).from(contacts).all());
    expect(ownContacts).toEqual([]);
    const jordanContacts = withOfficeClaim(JORDAN, () => getRlsDb().select({ id: contacts.id, orgId: contacts.orgId }).from(contacts).all());
    expect(jordanContacts.some((row) => row.orgId === "org_northline")).toBe(true);
    expect(jordanContacts.some((row) => row.id === "c_vasquez" || row.orgId === created.actor.orgId)).toBe(false);
    expect(withOfficeClaim(JORDAN, () => listPriceBook(created.actor.orgId))).toEqual([]);
    clearSupabaseEnv();
  });
});
