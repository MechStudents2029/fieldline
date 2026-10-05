import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getRlsDb, getSqlite, useDatabaseFile, usePostgresMemory } from "@/lib/db/client";
import { withOfficeClaim } from "@/lib/db/rls-context";
import { billEvents, billLines, bills, costItems, organizations, projects, users } from "@/lib/db/schema";
import {
  approveBill,
  billDetail,
  billsAttention,
  confirmBillRead,
  createBill,
  listBills,
  markBillPaid,
  projectBills,
  unapproveBill,
  vendorBillSummaries,
  voidBill,
} from "@/lib/services/bills";
import { authenticate, projectDetail } from "@/lib/services/read";

const MAYA = "11111111-1111-4111-8111-111111111111";
const JORDAN = "22222222-2222-4222-8222-222222222222";
const DANA = "66666666-6666-4666-8666-666666666666";

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

function actual(projectId: string) {
  return getDb()
    .select()
    .from(costItems)
    .where(eq(costItems.projectId, projectId))
    .all()
    .reduce((sum, row) => sum + row.amountCents, 0);
}

function input(overrides: Partial<Parameters<typeof createBill>[1]> = {}) {
  return {
    projectId: "proj_chen",
    vendorContactId: "c_harbor",
    billNumber: "HP-NEW-1",
    billDate: "2026-10-01",
    dueDate: "2026-10-20",
    lines: [{ costCode: "PLB-TOILET", amountCents: 200_000, description: "Valve" }],
    ...overrides,
  };
}

describe("vendor bills", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  afterAll(() => {
    clearSupabaseEnv();
  });

  it("posts an approved bill once, reverses it on unapprove and void, and feeds the budget warning", () => {
    const maya = actor("maya@rivera.demo");
    const before = actual("proj_chen");
    const over = createBill(maya, input());
    expect(actual("proj_chen")).toBe(before);
    expect(projectDetail("org_rivera", "proj_chen", "owner")!.financials!.byCode.find((row) => row.code === "PLB-TOILET")?.suggestDraft).toBeFalsy();
    approveBill(maya, over.id);
    approveBill(maya, over.id);
    expect(actual("proj_chen")).toBe(before + 200_000);
    const posted = getDb().select().from(billLines).where(eq(billLines.billId, over.id)).all();
    expect(posted.filter((line) => line.costItemId)).toHaveLength(1);
    const chen = projectDetail("org_rivera", "proj_chen", "owner")!;
    expect(chen.financials!.byCode.find((row) => row.code === "PLB-TOILET")).toMatchObject({ level: "over", suggestDraft: true });
    const watch = createBill(
      maya,
      input({
        billNumber: "HP-WATCH",
        lines: [{ costCode: "GC-SUPER", amountCents: 152_000, description: "Supervision" }],
      }),
    );
    approveBill(maya, watch.id);
    expect(projectDetail("org_rivera", "proj_chen", "owner")!.financials!.byCode.find((row) => row.code === "GC-SUPER")).toMatchObject({
      level: "watch",
      suggestDraft: false,
    });
    unapproveBill(maya, over.id, "Wrong valve");
    expect(actual("proj_chen")).toBe(before + 152_000);
    expect(getDb().select().from(billLines).where(eq(billLines.billId, over.id)).get()?.costItemId).toBeNull();
    expect(projectDetail("org_rivera", "proj_chen", "owner")!.financials!.byCode.find((row) => row.code === "PLB-TOILET")?.suggestDraft).toBe(false);
    const events = getDb().select().from(billEvents).where(eq(billEvents.billId, over.id)).all().map((row) => row.type);
    expect(events).toContain("unapproved");
    approveBill(maya, over.id);
    expect(actual("proj_chen")).toBe(before + 352_000);
    const costCount = getDb().select().from(costItems).where(eq(costItems.projectId, "proj_chen")).all().length;
    markBillPaid(maya, over.id, { paidOn: "2026-10-04", method: "check", reference: "1008" });
    expect(getDb().select().from(costItems).where(eq(costItems.projectId, "proj_chen")).all()).toHaveLength(costCount);
    expect(getDb().select().from(bills).where(eq(bills.id, over.id)).get()?.status).toBe("paid");
    voidBill(maya, over.id, "Duplicate of the shop ticket");
    expect(actual("proj_chen")).toBe(before + 152_000);
    expect(getDb().select().from(billEvents).where(and(eq(billEvents.billId, over.id), eq(billEvents.type, "voided"))).get()?.reason).toMatch(/Duplicate/);
    voidBill(maya, watch.id, "Not our invoice");
    expect(actual("proj_chen")).toBe(before);
  });

  it("flags the same vendor and bill number before save, including after a void", () => {
    const maya = actor("maya@rivera.demo");
    expect(() => createBill(maya, input({ billNumber: "hp-441", projectId: "proj_okonkwo" }))).toThrow(/already has bill HP-441/);
    const first = createBill(maya, input({ billNumber: "dup-9", vendorContactId: "c_summit" }));
    expect(() => createBill(maya, input({ billNumber: "DUP-9", vendorContactId: "c_summit" }))).toThrow(/already has bill DUP-9/);
    expect(createBill(maya, input({ billNumber: "DUP-9", vendorContactId: "c_harbor" })).id).toBeTruthy();
    voidBill(maya, first.id, "Entered twice");
    expect(createBill(maya, input({ billNumber: "DUP-9", vendorContactId: "c_summit" })).id).toBeTruthy();
    getDb().insert(projects).values({
      id: "proj_north_bill",
      orgId: "org_northline",
      leadId: null,
      proposalId: null,
      contactId: "c_north_ada",
      name: "Ada panel",
      status: "active",
      address: "3 Virginia St",
      contractValueCents: 100_000,
      originalContractCents: 100_000,
      startDate: null,
      endDate: null,
      portalToken: "demo_portal_north_bill",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      createdBy: "user_jordan",
    }).run();
    const jordan = actor("jordan@northline.demo");
    expect(
      createBill(jordan, input({ projectId: "proj_north_bill", vendorContactId: "c_north_supply", billNumber: "HP-441" })).id,
    ).toBeTruthy();
  });

  it("marks overdue from the company time zone", () => {
    const maya = actor("maya@rivera.demo");
    const bill = createBill(maya, input({ billNumber: "ZONE-1", dueDate: "2026-10-05", lines: [{ costCode: "PLB-TOILET", amountCents: 1_000 }] }));
    approveBill(maya, bill.id);
    const instant = Date.parse("2026-10-06T04:30:00.000Z");
    expect(billsAttention("org_rivera", "owner", instant).overdue.some((row) => row.id === bill.id)).toBe(true);
    getDb().update(organizations).set({ timeZone: "America/Los_Angeles" }).where(eq(organizations.id, "org_rivera")).run();
    const west = billsAttention("org_rivera", "owner", instant);
    expect(west.overdue.some((row) => row.id === bill.id)).toBe(false);
    expect(west.upcoming.some((row) => row.id === bill.id)).toBe(true);
    getDb().update(organizations).set({ timeZone: "America/New_York" }).where(eq(organizations.id, "org_rivera")).run();
    const seeded = billsAttention("org_rivera", "owner");
    expect(seeded.overdue.some((row) => row.billNumber === "BE-77")).toBe(true);
    expect(seeded.upcoming.some((row) => row.billNumber === "HP-441")).toBe(true);
    expect(seeded.overdue.some((row) => row.billNumber === "SL-1904")).toBe(false);
    expect(seeded.overdue.some((row) => row.billNumber === "CT-2208")).toBe(false);
  });

  it("hides bills from field, blocks viewers from writing, and misses another company", () => {
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const maya = actor("maya@rivera.demo");
    expect(listBills("org_rivera", "field")).toEqual([]);
    expect(projectBills("org_rivera", "proj_okonkwo", "field")).toEqual([]);
    expect(billDetail("org_rivera", "bill_ok_harbor", "field")).toBeNull();
    expect(vendorBillSummaries("org_rivera", "field")).toEqual([]);
    expect(() => createBill(dana, input({ billNumber: "FIELD-1" }))).toThrow(/office/);
    expect(listBills("org_rivera", "viewer").some((row) => row.billNumber === "HP-441")).toBe(true);
    expect(() => createBill(riley, input({ billNumber: "VIEW-1" }))).toThrow(/office/);
    const low = createBill(maya, input({ billNumber: "LOW-1", lowConfidence: true, lines: [{ costCode: "PLB-TOILET", amountCents: 2_000 }] }));
    expect(() => approveBill(maya, low.id)).toThrow(/stays a draft/);
    confirmBillRead(maya, low.id);
    approveBill(maya, low.id);
    expect(getDb().select().from(costItems).where(eq(costItems.memo, "Bill LOW-1")).get()?.amountCents).toBe(2_000);
    const harbor = vendorBillSummaries("org_rivera", "owner").find((row) => row.contactId === "c_harbor");
    expect(harbor?.outstandingCents).toBeGreaterThan(0);
    expect(harbor?.codes.some((code) => code.code === "PLB-SHOWER" && code.budgetCents > 0)).toBe(true);
    expect(readFileSync(path.join(process.cwd(), "src/app/portal/[token]/page.tsx"), "utf8")).not.toContain("listBills");
    expect(readFileSync(path.join(process.cwd(), "supabase/rls.sql"), "utf8")).toContain("'bill_lines'");
    expect(readFileSync(path.join(process.cwd(), "supabase/rls.sql"), "utf8")).toContain("'bill_events'");
    getDb().update(users).set({ authUserId: JORDAN }).where(eq(users.id, "user_jordan")).run();
    getDb().update(users).set({ authUserId: MAYA }).where(eq(users.id, "user_maya")).run();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-public-test";
    expect(withOfficeClaim(JORDAN, () => listBills("org_rivera", "owner"))).toEqual([]);
    expect(withOfficeClaim(JORDAN, () => billDetail("org_rivera", "bill_ok_harbor", "owner"))).toBeNull();
    expect(withOfficeClaim(JORDAN, () => vendorBillSummaries("org_rivera", "owner"))).toEqual([]);
    expect(() => withOfficeClaim(JORDAN, () => createBill(maya, input({ billNumber: "LEAK-1" })))).toThrow(/signed-in account/);
    expect(getDb().select().from(bills).where(eq(bills.billNumber, "LEAK-1")).get()).toBeUndefined();
    expect(withOfficeClaim(MAYA, () => billDetail("org_rivera", "bill_ok_harbor", "owner"))?.bill.billNumber).toBe("HP-441");
    clearSupabaseEnv();
  });
});

describe("vendor bills under postgres", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    usePostgresMemory();
  }, 60_000);

  afterAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("posts on postgres and hides the rows from field and another company", () => {
    const maya = actor("maya@rivera.demo");
    const before = actual("proj_chen");
    const created = createBill(maya, input({ billNumber: "PG-1", lines: [{ costCode: "PLB-TOILET", amountCents: 4_000, description: "Postgres" }] }));
    approveBill(maya, created.id);
    expect(actual("proj_chen")).toBe(before + 4_000);
    voidBill(maya, created.id, "Postgres reversal");
    expect(actual("proj_chen")).toBe(before);
    const kept = createBill(maya, input({ billNumber: "PG-KEEP", lines: [{ costCode: "GC-SUPER", amountCents: 3_000 }] }));
    approveBill(maya, kept.id);
    getDb().update(users).set({ authUserId: DANA }).where(eq(users.id, "user_dana")).run();
    getDb().update(users).set({ authUserId: MAYA }).where(eq(users.id, "user_maya")).run();
    getDb().update(users).set({ authUserId: JORDAN }).where(eq(users.id, "user_jordan")).run();
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
      grant select, insert, update, delete on public.bills to authenticated;
      grant select, insert, update, delete on public.bill_lines to authenticated;
      grant select, insert, update, delete on public.bill_events to authenticated;
      alter table public.bills enable row level security;
      alter table public.bills force row level security;
      alter table public.bill_lines enable row level security;
      alter table public.bill_lines force row level security;
      alter table public.bill_events enable row level security;
      alter table public.bill_events force row level security;
      drop policy if exists bills_money on public.bills;
      drop policy if exists bill_lines_money on public.bill_lines;
      drop policy if exists bill_events_money on public.bill_events;
      create policy bills_money on public.bills for all to authenticated using (org_id in (select public.current_org_ids()) and public.can_see_money(org_id)) with check (org_id in (select public.current_org_ids()) and public.can_see_money(org_id));
      create policy bill_lines_money on public.bill_lines for all to authenticated using (org_id in (select public.current_org_ids()) and public.can_see_money(org_id)) with check (org_id in (select public.current_org_ids()) and public.can_see_money(org_id));
      create policy bill_events_money on public.bill_events for all to authenticated using (org_id in (select public.current_org_ids()) and public.can_see_money(org_id)) with check (org_id in (select public.current_org_ids()) and public.can_see_money(org_id));
    `);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-public-test";
    const fieldRows = withOfficeClaim(DANA, () => getRlsDb().select().from(bills).all());
    const ownerRows = withOfficeClaim(MAYA, () => getRlsDb().select().from(bills).all());
    const jordanRows = withOfficeClaim(JORDAN, () => getRlsDb().select().from(bills).all());
    expect(fieldRows).toEqual([]);
    expect(ownerRows.some((row) => row.billNumber === "PG-KEEP")).toBe(true);
    expect(jordanRows.some((row) => row.orgId === "org_rivera")).toBe(false);
    clearSupabaseEnv();
  });
});
