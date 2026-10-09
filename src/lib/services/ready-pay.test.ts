import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { bills, costItems, organizations } from "@/lib/db/schema";
import { approveBill, createBill, listBills, markBillPaid, markBillsPaid } from "@/lib/services/bills";
import { createPurchaseOrder, issuePurchaseOrder } from "@/lib/services/purchase-orders";
import { payNotes, poRetainage, readyToPay, releaseRetainage, retainageHeldOnClosed } from "@/lib/services/pay-ready";
import { authenticate, portalByToken } from "@/lib/services/read";
import { billsCsv } from "@/lib/services/waivers";
import { vendorPortal } from "@/lib/services/vendor-portal";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";

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

describe("ready to pay and vendor retainage", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("keeps Harbor bills off other portals and off field", () => {
    const home = vendorPortal(DEMO_HARBOR_PORTAL_TOKEN);
    expect(home?.bills.some((bill) => bill.number === "HP-510")).toBe(true);
    expect(home?.bills.some((bill) => bill.number === "SL-1904")).toBe(false);
    expect(home?.bills.find((bill) => bill.number === "HP-510")).toMatchObject({ retainedCents: 20_000, paidCents: 0, releasedCents: 0 });
    expect(JSON.stringify(home)).not.toContain("SL-1904");
    expect(listBills("org_rivera", "field")).toEqual([]);
    expect(JSON.stringify(portalByToken("demo_portal_okonkwo"))).not.toContain("HP-510");
    expect(vendorPortal("not-a-token")).toBeNull();
    const csv = billsCsv(actor("maya@rivera.demo")) ?? "";
    expect(csv.split("\n")[0]).toBe("Bill,Vendor,Job,Status,Amount,Retained,Net,Released,Waiver");
    expect(csv).toContain("HP-510");
    expect(csv).toContain("$1,800.00");
    expect(billsCsv(actor("dana@rivera.demo"))).toBeNull();
  });

  it("marks the ready bill, refuses the unsigned one in block, and releases retainage once", () => {
    const maya = actor("maya@rivera.demo");
    expect(readyToPay("org_rivera", "owner")).toMatchObject({ count: 1, cents: 180_000, href: "/bills?ready=1" });
    expect(readyToPay("org_rivera", "field")).toMatchObject({ count: 0, cents: 0, href: null });
    expect(payNotes("org_rivera").get("bill_ok_ret_ready")?.ready).toBe(true);
    expect(payNotes("org_rivera").get("bill_ok_ret_blocked")).toMatchObject({ ready: false, reason: "Waiver unsigned", payError: null });
    expect(retainageHeldOnClosed("org_rivera", "owner").cents).toBe(0);
    getDb().update(organizations).set({ lienWaiverMode: "block" }).where(eq(organizations.id, "org_rivera")).run();
    expect(payNotes("org_rivera").get("bill_ok_ret_blocked")?.payError).toMatch(/not signed/);
    expect(() =>
      markBillsPaid(maya, ["bill_ok_ret_ready", "bill_ok_ret_blocked"], { paidOn: "2026-10-09", method: "check", reference: "5100" }),
    ).toThrow(/not signed/);
    expect(getDb().select().from(bills).where(eq(bills.id, "bill_ok_ret_ready")).get()?.status).toBe("approved");
    expect(getDb().select().from(bills).where(eq(bills.id, "bill_ok_ret_blocked")).get()?.status).toBe("approved");
    expect(() => markBillPaid(maya, "bill_ok_ret_blocked", { paidOn: "2026-10-09", method: "check", reference: "5110" })).toThrow(/not signed/);
    getDb().update(organizations).set({ lienWaiverMode: "warn" }).where(eq(organizations.id, "org_rivera")).run();
    const costs = getDb().select().from(costItems).where(eq(costItems.projectId, "proj_okonkwo")).all().length;
    const paid = markBillsPaid(maya, ["bill_ok_ret_ready"], { paidOn: "2026-10-09", method: "check", reference: "5101" });
    expect(paid.ids).toEqual(["bill_ok_ret_ready"]);
    expect(getDb().select().from(bills).where(eq(bills.id, "bill_ok_ret_ready")).get()?.status).toBe("paid");
    expect(poRetainage("org_rivera", "po_ok_retain")).toMatchObject({ bps: 1000, retainedCents: 20_000, heldCents: 20_000, releasedCents: 0, canRelease: true });
    const released = releaseRetainage(maya, "po_ok_retain");
    expect(released).toMatchObject({ number: "PO-1055-R", amountCents: 20_000 });
    const release = getDb().select().from(bills).where(eq(bills.id, released.id)).get();
    expect(release).toMatchObject({ kind: "release", amountCents: 20_000, retainageCents: 0, status: "approved" });
    expect(getDb().select().from(costItems).where(eq(costItems.projectId, "proj_okonkwo")).all()).toHaveLength(costs);
    expect(poRetainage("org_rivera", "po_ok_retain")?.heldCents).toBe(0);
    expect(() => releaseRetainage(maya, "po_ok_retain")).toThrow(/already released/);
    getDb().update(bills).set({ retainageCents: 12_500 }).where(eq(bills.id, "bill_dz_summit")).run();
    expect(retainageHeldOnClosed("org_rivera", "owner").cents).toBe(12_500);
    expect(retainageHeldOnClosed("org_rivera", "field").cents).toBe(0);
  });

  it("refuses a bill that is over the purchase order", () => {
    const maya = actor("maya@rivera.demo");
    getDb().update(organizations).set({ lienWaiverMode: "off" }).where(eq(organizations.id, "org_rivera")).run();
    const po = createPurchaseOrder(maya, {
      projectId: "proj_chen",
      vendorContactId: "c_summit",
      lines: [{ costCode: "DECK-BOARD", amountCents: 10_000 }],
    });
    issuePurchaseOrder(maya, po.id);
    const first = createBill(maya, {
      projectId: "proj_chen",
      vendorContactId: "c_summit",
      purchaseOrderId: po.id,
      billNumber: "SL-OVER-1",
      billDate: "2026-10-01",
      dueDate: "2026-10-20",
      lines: [{ costCode: "DECK-BOARD", amountCents: 6_000 }],
    });
    const second = createBill(maya, {
      projectId: "proj_chen",
      vendorContactId: "c_summit",
      purchaseOrderId: po.id,
      billNumber: "SL-OVER-2",
      billDate: "2026-10-02",
      dueDate: "2026-10-20",
      lines: [{ costCode: "DECK-BOARD", amountCents: 6_000 }],
    });
    approveBill(maya, first.id);
    approveBill(maya, second.id);
    expect(payNotes("org_rivera").get(second.id)?.reason).toBe("Over PO");
    expect(() => markBillPaid(maya, second.id, { paidOn: "2026-10-09", method: "check", reference: "9" })).toThrow(/purchase order/);
    expect(getDb().select().from(bills).where(eq(bills.id, second.id)).get()?.status).toBe("approved");
  });
});
