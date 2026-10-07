import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, bills, purchaseOrders, vendorPortals } from "@/lib/db/schema";
import { createPurchaseOrder, issuePurchaseOrder, voidPurchaseOrder } from "@/lib/services/purchase-orders";
import { verifyPunch } from "@/lib/services/punch";
import { authenticate, portalByToken } from "@/lib/services/read";
import { ServiceError } from "@/lib/services/errors";
import {
  acceptVendorPo,
  declineVendorPo,
  markVendorPunch,
  rotateVendorPortal,
  setVendorCompliance,
  submitVendorBill,
  vendorBillQueue,
  vendorCertificateQueue,
  vendorFileAllowed,
  vendorMoneyHiddenFrom,
  vendorOffice,
  vendorPortal,
} from "@/lib/services/vendor-portal";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>");
const ip = "198.51.100.10";

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

describe("vendor portal", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("names the portal tables in the Postgres policy list", () => {
    const sql = readFileSync("supabase/rls.sql", "utf8");
    for (const table of ["vendor_portals", "vendor_certificates", "vendor_portal_attempts"]) {
      expect(sql).toContain(`'${table}'`);
    }
    const start = sql.lastIndexOf("foreach tbl in array array[");
    expect(sql.slice(start, sql.indexOf("end loop", start))).not.toContain("vendor_portals");
  });

  it("seeds Harbor with a hashed link, an open PO, a day, a punch item, and a certificate due inside 30 days", () => {
    const row = getDb().select().from(vendorPortals).where(eq(vendorPortals.contactId, "c_harbor")).get();
    expect(row?.tokenHash).toHaveLength(64);
    expect(row?.tokenHash).not.toContain(DEMO_HARBOR_PORTAL_TOKEN);
    const home = vendorPortal(DEMO_HARBOR_PORTAL_TOKEN);
    expect(home?.vendorName).toBe("Harbor Plumbing");
    expect(home?.openPos).toBe(1);
    expect(home?.commitmentCents).toBe(250_000);
    expect(home?.billedCents).toBe(150_000);
    expect(home?.paidCents).toBe(0);
    expect(home?.orders.map((order) => order.number)).toEqual(["PO-1044"]);
    expect(home?.orders[0]?.response).toBe("issued");
    expect(home?.schedule.map((row) => row.title)).toEqual(["Set the valve"]);
    expect(home?.schedule[0]?.address).toContain("901 Mandana");
    expect(home?.punch.map((row) => row.title)).toEqual(["Replace the escutcheon"]);
    expect(home?.certificates.find((row) => row.type === "general_liability")?.state).toBe("expiring");
    expect(home?.certificates.find((row) => row.type === "workers_comp")?.state).toBe("missing");
    expect(vendorCertificateQueue("org_rivera")).toEqual({ count: 1, href: "/contacts/c_harbor" });
    expect(vendorBillQueue("org_rivera")).toEqual({ count: 0, href: null });
    expect(vendorCertificateQueue("org_northline")).toEqual({ count: 0, href: null });
    const text = JSON.stringify(home);
    expect(text).not.toContain("Amara");
    expect(text).not.toContain("Dana");
    expect(text).not.toContain("4620000");
    expect(text).not.toContain("margin");
  });

  it("keeps another vendor, another company, field, and the homeowner off Harbor's amounts", () => {
    expect(vendorPortal("demo_portal_okonkwo")).toBeNull();
    expect(vendorPortal("not-a-token")).toBeNull();
    const casa = rotateVendorPortal(actor("maya@rivera.demo"), "c_casa");
    const north = rotateVendorPortal(actor("jordan@northline.demo"), "c_north_supply");
    expect(vendorPortal(casa)?.orders.map((order) => order.number)).not.toContain("PO-1044");
    expect(vendorPortal(north)?.orders).toEqual([]);
    expect(JSON.stringify(vendorPortal(north))).not.toContain("Okonkwo");
    expect(vendorOffice(actor("jordan@northline.demo"), "c_harbor")).toBeNull();
    expect(() => rotateVendorPortal(actor("jordan@northline.demo"), "c_harbor")).toThrow(ServiceError);
    expect(() => rotateVendorPortal(actor("dana@rivera.demo"), "c_harbor")).toThrow(/cannot create/);
    expect(() => rotateVendorPortal(actor("riley@rivera.demo"), "c_harbor")).toThrow(/cannot create/);
    const field = vendorOffice(actor("dana@rivera.demo"), "c_harbor");
    expect(field?.showMoney).toBe(false);
    expect(JSON.stringify(field)).not.toContain("amountCents");
    expect(JSON.stringify(field)).not.toContain("250000");
    expect(vendorMoneyHiddenFrom("field")).toBe(true);
    expect(vendorMoneyHiddenFrom("owner")).toBe(false);
    expect(JSON.stringify(portalByToken("demo_portal_okonkwo"))).not.toContain("PO-1044");
    const summit = rotateVendorPortal(actor("luis@rivera.demo"), "c_summit");
    const again = rotateVendorPortal(actor("luis@rivera.demo"), "c_summit");
    expect(vendorPortal(summit)).toBeNull();
    expect(vendorPortal(again)?.vendorName).toBe("Summit Lumber");
    const stored = getDb().select().from(vendorPortals).where(eq(vendorPortals.contactId, "c_summit")).get();
    expect(stored?.tokenHash).not.toContain(again);
  });

  it("accepts an issued PO, saves a portal bill as a draft, and hides draft or void orders", () => {
    const maya = actor("maya@rivera.demo");
    const draft = createPurchaseOrder(maya, {
      projectId: "proj_okonkwo",
      vendorContactId: "c_harbor",
      lines: [{ costCode: "PLB-SHOWER", amountCents: 10_000 }],
    });
    expect(vendorPortal(DEMO_HARBOR_PORTAL_TOKEN)?.orders.map((order) => order.number)).not.toContain(draft.number);
    issuePurchaseOrder(maya, draft.id);
    voidPurchaseOrder(maya, draft.id, "Wrong scope");
    expect(vendorPortal(DEMO_HARBOR_PORTAL_TOKEN)?.orders.map((order) => order.number)).toEqual(["PO-1044"]);
    expect(() => submitVendorBill({ token: DEMO_HARBOR_PORTAL_TOKEN, ip, purchaseOrderId: "po_ok_harbor", billNumber: "HP-900", billDate: "2026-10-07", dueDate: "2026-10-07", lines: [{ costCode: "PLB-SHOWER", amountCents: 10_000 }] })).toThrow(/Accept/);
    acceptVendorPo({ token: DEMO_HARBOR_PORTAL_TOKEN, purchaseOrderId: "po_ok_harbor", name: "Pete Alvarez", ip });
    expect(vendorPortal(DEMO_HARBOR_PORTAL_TOKEN)?.orders[0]?.response).toBe("accepted");
    expect(() => acceptVendorPo({ token: DEMO_HARBOR_PORTAL_TOKEN, purchaseOrderId: draft.id, name: "Pete Alvarez", ip })).toThrow(/not found/);
    const over = submitVendorBill({
      token: DEMO_HARBOR_PORTAL_TOKEN,
      ip,
      purchaseOrderId: "po_ok_harbor",
      billNumber: "HP-900",
      billDate: "2026-10-07",
      dueDate: "2026-10-21",
      lines: [{ costCode: "PLB-SHOWER", amountCents: 400_000 }],
      file: { filename: "bill.png", bytes: png },
    });
    expect(over.warning).toMatch(/past PO-1044/);
    const saved = getDb().select().from(bills).where(eq(bills.id, over.id)).get();
    expect(saved).toMatchObject({ status: "draft", portalSubmitted: 1, amountCents: 400_000 });
    expect(() => submitVendorBill({ token: DEMO_HARBOR_PORTAL_TOKEN, ip, purchaseOrderId: "po_ok_harbor", billNumber: "HP-441", billDate: "2026-10-07", dueDate: "2026-10-07", lines: [{ costCode: "PLB-SHOWER", amountCents: 100 }] })).toThrow(/already on file/);
    expect(vendorBillQueue("org_rivera").count).toBe(1);
    expect(getDb().select().from(auditLogs).where(and(eq(auditLogs.action, "vendor.po.accept"), eq(auditLogs.entityId, "po_ok_harbor"))).get()).toBeTruthy();
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.action, "vendor.bill")).get()?.actorId).toBeNull();
  });

  it("lets the vendor mark punch done and leaves verification to the office", () => {
    expect(() => markVendorPunch({ token: DEMO_HARBOR_PORTAL_TOKEN, ip, itemId: "punch_ok_curb" })).toThrow(/not found/);
    expect(() => markVendorPunch({ token: DEMO_HARBOR_PORTAL_TOKEN, ip, itemId: "punch_ok_esc", photo: { filename: "x.svg", bytes: svg } })).toThrow(/JPEG/);
    markVendorPunch({ token: DEMO_HARBOR_PORTAL_TOKEN, ip, itemId: "punch_ok_esc", photo: { filename: "esc.png", bytes: png } });
    expect(vendorPortal(DEMO_HARBOR_PORTAL_TOKEN)?.punch[0]?.status).toBe("done");
    verifyPunch(actor("maya@rivera.demo"), "punch_ok_esc");
    expect(vendorPortal(DEMO_HARBOR_PORTAL_TOKEN)?.punch[0]?.status).toBe("verified");
    const home = vendorPortal(DEMO_HARBOR_PORTAL_TOKEN);
    const photoId = getDb().select().from(bills).where(eq(bills.billNumber, "HP-900")).get()?.documentId;
    expect(photoId && vendorFileAllowed(DEMO_HARBOR_PORTAL_TOKEN, photoId)).toBe(true);
    expect(vendorFileAllowed(rotateVendorPortal(actor("maya@rivera.demo"), "c_casa"), photoId || "")).toBe(false);
    expect(JSON.stringify(home)).not.toContain("Check the ledger");
  });

  it("warns or blocks a new purchase order from the company certificate setting", () => {
    const maya = actor("maya@rivera.demo");
    setVendorCompliance(maya, "block", ["general_liability", "workers_comp"]);
    const blocked = createPurchaseOrder(maya, {
      projectId: "proj_chen",
      vendorContactId: "c_harbor",
      lines: [{ costCode: "PLB-TOILET", amountCents: 20_000 }],
    });
    expect(() => issuePurchaseOrder(maya, blocked.id)).toThrow(/Workers comp missing/);
    expect(getDb().select().from(purchaseOrders).where(eq(purchaseOrders.id, blocked.id)).get()?.status).toBe("draft");
    setVendorCompliance(maya, "warn", ["general_liability", "workers_comp"]);
    expect(issuePurchaseOrder(maya, blocked.id).warning).toBe("Workers comp missing");
    expect(() => setVendorCompliance(actor("luis@rivera.demo"), "block", ["workers_comp"])).toThrow(/owner or admin/);
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.action, "vendor.compliance")).all().length).toBeGreaterThan(0);
  });

  it("rate-limits portal writes", () => {
    const maya = actor("maya@rivera.demo");
    const created = createPurchaseOrder(maya, {
      projectId: "proj_chen",
      vendorContactId: "c_harbor",
      lines: [{ costCode: "PLB-TOILET", amountCents: 5_000 }],
    });
    issuePurchaseOrder(maya, created.id);
    const limitIp = "203.0.113.80";
    for (let n = 0; n < 8; n += 1) {
      declineVendorPo({ token: DEMO_HARBOR_PORTAL_TOKEN, purchaseOrderId: created.id, reason: "No crew", ip: limitIp });
    }
    expect(() => declineVendorPo({ token: DEMO_HARBOR_PORTAL_TOKEN, purchaseOrderId: created.id, reason: "No crew", ip: limitIp })).toThrow(/Too many/);
  });
});
