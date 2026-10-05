import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getRlsDb, getSqlite, useDatabaseFile, usePostgresMemory } from "@/lib/db/client";
import { withOfficeClaim } from "@/lib/db/rls-context";
import { organizations, purchaseOrderEvents, purchaseOrders, users } from "@/lib/db/schema";
import { approveBill, createBill } from "@/lib/services/bills";
import { vendorBillSummaries } from "@/lib/services/bills";
import {
  closePurchaseOrder,
  createPurchaseOrder,
  issuePurchaseOrder,
  listPurchaseOrders,
  purchaseOrderDetail,
  savePurchaseOrder,
  stalePurchaseOrders,
  voidPurchaseOrder,
} from "@/lib/services/purchase-orders";
import { authenticate, projectDetail } from "@/lib/services/read";
import { createChangeOrder } from "@/lib/services/write";

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

function po(overrides: Partial<Parameters<typeof createPurchaseOrder>[1]> = {}) {
  return {
    projectId: "proj_chen",
    vendorContactId: "c_harbor",
    scope: "Remaining plumbing",
    lines: [{ costCode: "PLB-TOILET", amountCents: 100_000, description: "Fixture" }],
    ...overrides,
  };
}

function bill(purchaseOrderId: string, amountCents: number, billNumber: string, costCode = "PLB-TOILET") {
  return {
    projectId: "proj_chen",
    vendorContactId: "c_harbor",
    billNumber,
    billDate: "2026-10-01",
    dueDate: "2026-10-20",
    purchaseOrderId,
    lines: [{ costCode, amountCents, description: "Against the order" }],
  };
}

function code(projectId: string, costCode: string) {
  return projectDetail("org_rivera", projectId, "owner")?.financials?.byCode.find((row) => row.code === costCode);
}

describe("purchase orders", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  afterAll(() => {
    clearSupabaseEnv();
  });

  it("shows the seeded Okonkwo order as partly billed", () => {
    const row = code("proj_okonkwo", "PLB-SHOWER");
    expect(row).toMatchObject({
      budgetCents: 520_000,
      actualCents: 430_000,
      committedOpenCents: 250_000,
      projectedCents: 680_000,
      costToCompleteCents: 250_000,
      varianceCents: -160_000,
      level: "over",
      suggestDraft: true,
    });
    const harbor = vendorBillSummaries("org_rivera", "owner").find((item) => item.contactId === "c_harbor");
    expect(harbor).toMatchObject({ committedCents: 400_000, openBalanceCents: 250_000 });
    expect(stalePurchaseOrders("org_rivera", "owner").some((order) => order.number === "PO-1044")).toBe(false);
  });

  it("drops open commitment when a linked bill is approved, and warns without blocking an overbill", () => {
    const maya = actor("maya@rivera.demo");
    const created = createPurchaseOrder(maya, po());
    expect(created.number).toMatch(/^PO-\d+$/);
    expect(purchaseOrderDetail("org_rivera", created.id, "owner")?.po.openCents).toBe(0);
    issuePurchaseOrder(maya, created.id);
    expect(purchaseOrderDetail("org_rivera", created.id, "owner")?.po).toMatchObject({ status: "issued", openCents: 100_000 });
    const draft = createBill(maya, bill(created.id, 40_000, "PO-PART"));
    expect(draft.warning).toBeNull();
    expect(purchaseOrderDetail("org_rivera", created.id, "owner")?.po.openCents).toBe(100_000);
    approveBill(maya, draft.id);
    expect(purchaseOrderDetail("org_rivera", created.id, "owner")?.po.openCents).toBe(60_000);
    expect(code("proj_chen", "PLB-TOILET")).toMatchObject({
      committedOpenCents: 60_000,
      actualCents: 40_000,
      projectedCents: 190_000,
      varianceCents: 0,
    });

    const overPo = createPurchaseOrder(maya, po({ lines: [{ costCode: "BATH-VANITY", amountCents: 100_000 }] }));
    issuePurchaseOrder(maya, overPo.id);
    const over = createBill(maya, bill(overPo.id, 120_000, "PO-OVER", "BATH-VANITY"));
    expect(over.warning).toMatch(/past PO-/);
    expect(over.warning).toMatch(/BATH-VANITY/);
    approveBill(maya, over.id);
    expect(purchaseOrderDetail("org_rivera", overPo.id, "owner")?.po.openCents).toBe(0);
    expect(code("proj_chen", "BATH-VANITY")?.actualCents).toBe(120_000);
  });

  it("releases commitment when an order is voided or closed with a balance left", () => {
    const maya = actor("maya@rivera.demo");
    const voided = createPurchaseOrder(maya, po({ lines: [{ costCode: "DEMO-GUT", amountCents: 50_000 }] }));
    issuePurchaseOrder(maya, voided.id);
    expect(purchaseOrderDetail("org_rivera", voided.id, "owner")?.po.openCents).toBe(50_000);
    voidPurchaseOrder(maya, voided.id, "Wrong vendor");
    expect(purchaseOrderDetail("org_rivera", voided.id, "owner")?.po).toMatchObject({ status: "void", openCents: 0 });
    expect(code("proj_chen", "DEMO-GUT")?.committedOpenCents).toBe(0);
    const again = createPurchaseOrder(maya, po({ lines: [{ costCode: "DEMO-GUT", amountCents: 1_000 }] }));
    expect(again.number).not.toBe(voided.number);

    const closed = createPurchaseOrder(maya, po({ lines: [{ costCode: "GC-SUPER", amountCents: 100_000 }] }));
    issuePurchaseOrder(maya, closed.id);
    const partial = createBill(maya, bill(closed.id, 40_000, "PO-CLOSE", "GC-SUPER"));
    approveBill(maya, partial.id);
    expect(purchaseOrderDetail("org_rivera", closed.id, "owner")?.po.openCents).toBe(60_000);
    closePurchaseOrder(maya, closed.id);
    expect(purchaseOrderDetail("org_rivera", closed.id, "owner")?.po).toMatchObject({ status: "closed", openCents: 0 });
    expect(code("proj_chen", "GC-SUPER")?.committedOpenCents).toBe(0);
    expect(code("proj_chen", "GC-SUPER")?.actualCents).toBe(40_000);
  });

  it("keeps a history row when an issued order is revised", () => {
    const maya = actor("maya@rivera.demo");
    const created = createPurchaseOrder(
      maya,
      po({ projectId: "proj_okonkwo", lines: [{ costCode: "DEMO-GUT", amountCents: 10_000, description: "Haul" }] }),
    );
    issuePurchaseOrder(maya, created.id);
    savePurchaseOrder(maya, created.id, po({ projectId: "proj_okonkwo", scope: "Smaller haul", lines: [{ costCode: "DEMO-GUT", amountCents: 8_000 }] }));
    const detail = purchaseOrderDetail("org_rivera", created.id, "owner");
    expect(detail?.po.openCents).toBe(8_000);
    expect(detail?.events.some((event) => event.type === "revised")).toBe(true);
    const revised = getDb().select().from(purchaseOrderEvents).where(eq(purchaseOrderEvents.purchaseOrderId, created.id)).all().find((event) => event.type === "revised");
    expect(revised?.beforeJson).toMatch(/10000/);
    expect(revised?.afterJson).toMatch(/8000/);
    expect(() =>
      savePurchaseOrder(maya, created.id, po({ projectId: "proj_chen", lines: [{ costCode: "DEMO-GUT", amountCents: 8_000 }] })),
    ).toThrow(/job and vendor/);
  });

  it("suggests one change-order draft for a commitment overrun and does not suggest it again", () => {
    const maya = actor("maya@rivera.demo");
    const created = createPurchaseOrder(maya, po({ lines: [{ costCode: "TILE-FLR", amountCents: 400_000 }] }));
    issuePurchaseOrder(maya, created.id);
    const before = code("proj_chen", "TILE-FLR");
    expect(before).toMatchObject({ level: "over", suggestDraft: true, overageCents: 60_000 });
    createChangeOrder(maya, "proj_chen", {
      title: "Tile commitment",
      description: "Cover the open purchase order.",
      name: "Tile",
      qty: 1,
      unit: "ea",
      unitCostCents: before!.draftCostCents,
      markupBps: 3500,
      costCode: "TILE-FLR",
    });
    expect(code("proj_chen", "TILE-FLR")).toMatchObject({ level: "over", covered: true, suggestDraft: false });
    createChangeOrder(maya, "proj_chen", {
      title: "Tile commitment again",
      description: "Should not be required.",
      name: "Tile again",
      qty: 1,
      unit: "ea",
      unitCostCents: 60_000,
      markupBps: 3500,
      costCode: "TILE-FLR",
    });
    expect(code("proj_chen", "TILE-FLR")?.suggestDraft).toBe(false);
  });

  it("lists an issued order with no bill after 30 company-local days", () => {
    const maya = actor("maya@rivera.demo");
    const created = createPurchaseOrder(maya, po({ projectId: "proj_okonkwo", lines: [{ costCode: "BATH-VANITY", amountCents: 5_000 }] }));
    issuePurchaseOrder(maya, created.id);
    getDb().update(purchaseOrders).set({ issuedAt: "2026-09-06T15:00:00.000Z" }).where(eq(purchaseOrders.id, created.id)).run();
    const instant = Date.parse("2026-10-06T04:30:00.000Z");
    expect(stalePurchaseOrders("org_rivera", "owner", instant).some((order) => order.id === created.id)).toBe(true);
    getDb().update(organizations).set({ timeZone: "America/Los_Angeles" }).where(eq(organizations.id, "org_rivera")).run();
    expect(stalePurchaseOrders("org_rivera", "owner", instant).some((order) => order.id === created.id)).toBe(false);
    getDb().update(organizations).set({ timeZone: "America/New_York" }).where(eq(organizations.id, "org_rivera")).run();
    expect(stalePurchaseOrders("org_rivera", "owner", instant).some((order) => order.id === created.id)).toBe(true);
    const draft = createBill(maya, { ...bill(created.id, 1_000, "PO-STALE", "BATH-VANITY"), projectId: "proj_okonkwo" });
    expect(stalePurchaseOrders("org_rivera", "owner", instant).some((order) => order.id === created.id)).toBe(false);
    expect(draft.id).toBeTruthy();
  });

  it("hides purchase orders from field and another company", () => {
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const maya = actor("maya@rivera.demo");
    expect(listPurchaseOrders("org_rivera", "field")).toEqual([]);
    expect(purchaseOrderDetail("org_rivera", "po_ok_harbor", "field")).toBeNull();
    expect(() => createPurchaseOrder(dana, po())).toThrow(/office/);
    expect(listPurchaseOrders("org_rivera", "viewer").some((order) => order.number === "PO-1044")).toBe(true);
    expect(() => createPurchaseOrder(riley, po())).toThrow(/office/);
    expect(readFileSync(path.join(process.cwd(), "src/app/portal/[token]/page.tsx"), "utf8")).not.toContain("listPurchaseOrders");
    expect(readFileSync(path.join(process.cwd(), "supabase/rls.sql"), "utf8")).toContain("'purchase_orders'");
    expect(readFileSync(path.join(process.cwd(), "supabase/rls.sql"), "utf8")).toContain("'purchase_order_lines'");
    expect(readFileSync(path.join(process.cwd(), "supabase/rls.sql"), "utf8")).toContain("'purchase_order_events'");
    getDb().update(users).set({ authUserId: JORDAN }).where(eq(users.id, "user_jordan")).run();
    getDb().update(users).set({ authUserId: MAYA }).where(eq(users.id, "user_maya")).run();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-public-test";
    expect(withOfficeClaim(JORDAN, () => listPurchaseOrders("org_rivera", "owner"))).toEqual([]);
    expect(withOfficeClaim(JORDAN, () => purchaseOrderDetail("org_rivera", "po_ok_harbor", "owner"))).toBeNull();
    expect(() => withOfficeClaim(JORDAN, () => createPurchaseOrder(maya, po({ lines: [{ costCode: "DEMO-GUT", amountCents: 2_000 }] })))).toThrow(/signed-in account/);
    expect(withOfficeClaim(MAYA, () => purchaseOrderDetail("org_rivera", "po_ok_harbor", "owner"))?.po.number).toBe("PO-1044");
    clearSupabaseEnv();
  });
});

describe("purchase orders under postgres", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    usePostgresMemory();
  }, 60_000);

  afterAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("commits on postgres and hides the rows from field and another company", () => {
    const maya = actor("maya@rivera.demo");
    const created = createPurchaseOrder(maya, po({ lines: [{ costCode: "PLB-TOILET", amountCents: 50_000 }] }));
    issuePurchaseOrder(maya, created.id);
    const linked = createBill(maya, bill(created.id, 20_000, "PG-PO"));
    approveBill(maya, linked.id);
    expect(purchaseOrderDetail("org_rivera", created.id, "owner")?.po.openCents).toBe(30_000);
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
      grant select, insert, update, delete on public.purchase_orders to authenticated;
      grant select, insert, update, delete on public.purchase_order_lines to authenticated;
      grant select, insert, update, delete on public.purchase_order_events to authenticated;
      alter table public.purchase_orders enable row level security;
      alter table public.purchase_orders force row level security;
      alter table public.purchase_order_lines enable row level security;
      alter table public.purchase_order_lines force row level security;
      alter table public.purchase_order_events enable row level security;
      alter table public.purchase_order_events force row level security;
      drop policy if exists purchase_orders_money on public.purchase_orders;
      drop policy if exists purchase_order_lines_money on public.purchase_order_lines;
      drop policy if exists purchase_order_events_money on public.purchase_order_events;
      create policy purchase_orders_money on public.purchase_orders for all to authenticated using (org_id in (select public.current_org_ids()) and public.can_see_money(org_id)) with check (org_id in (select public.current_org_ids()) and public.can_see_money(org_id));
      create policy purchase_order_lines_money on public.purchase_order_lines for all to authenticated using (org_id in (select public.current_org_ids()) and public.can_see_money(org_id)) with check (org_id in (select public.current_org_ids()) and public.can_see_money(org_id));
      create policy purchase_order_events_money on public.purchase_order_events for all to authenticated using (org_id in (select public.current_org_ids()) and public.can_see_money(org_id)) with check (org_id in (select public.current_org_ids()) and public.can_see_money(org_id));
    `);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-public-test";
    const fieldRows = withOfficeClaim(DANA, () => getRlsDb().select().from(purchaseOrders).all());
    const ownerRows = withOfficeClaim(MAYA, () => getRlsDb().select().from(purchaseOrders).all());
    const jordanRows = withOfficeClaim(JORDAN, () => getRlsDb().select().from(purchaseOrders).all());
    expect(fieldRows).toEqual([]);
    expect(ownerRows.some((row) => row.id === created.id)).toBe(true);
    expect(jordanRows.some((row) => row.orgId === "org_rivera")).toBe(false);
    clearSupabaseEnv();
  });
});
