import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { bills, vendorCreditApplications } from "@/lib/db/schema";
import { nowIso } from "@/lib/ids";
import { authenticate } from "@/lib/services/read";
import { listInbox } from "@/lib/services/comments";
import { markNecRequested, necAttention, necCsv, necReport, saveVendorTax, vendorTaxForm } from "@/lib/services/nec1099";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("1099 vendor report", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("keeps the tax tables on the money policy", () => {
    const sql = readFileSync("supabase/rls.sql", "utf8");
    const money = sql.slice(sql.lastIndexOf("foreach tbl in array array["));
    expect(money).toContain("'vendor_tax'");
    expect(money).toContain("'nec_w9_requests'");
    expect(sql).toContain("'vendor_tax'");
  });

  it("rolls 2026 payments, exemptions, cards, and W-9s", () => {
    const maya = actor("maya@rivera.demo");
    const report = necReport(maya, 2026);
    expect(report.thresholdCents).toBe(200_000);
    const row = (id: string) => report.rows.find((item) => item.contactId === id);
    const harborPaid = getDb().select().from(bills).where(eq(bills.id, "bill_harbor_paid")).get();
    const harborExtra = harborPaid?.paidAt?.startsWith("2026") ? 48_000 : 0;
    expect(row("c_harbor")).toMatchObject({ box1Cents: 252_000 + harborExtra, over: true, w9: "on_file", exempt: false, tinMask: "••••6789" });
    expect(row("c_casa")).toMatchObject({ box1Cents: 320_000, over: true, w9: "on_file", tinMask: "••••7890" });
    expect(row("c_brighton")).toMatchObject({ box1Cents: 250_000, over: true, w9: "missing", tinMask: "••••8901" });
    const summit = getDb().select().from(bills).where(eq(bills.id, "bill_dz_summit")).get();
    if (summit?.paidAt?.startsWith("2026")) {
      expect(row("c_summit")).toMatchObject({ box1Cents: 125_000, over: false, exempt: false });
    }
    expect(row("c_mill")).toMatchObject({ box1Cents: 0, paidCents: 400_000, exempt: true, over: false });
    expect(row("c_slab")).toMatchObject({ box1Cents: 0, cardCents: 350_000, paidCents: 350_000, over: false });
    expect(report.needs.map((item) => item.contactId)).toEqual(["c_brighton"]);
    expect(JSON.stringify(report)).not.toContain("12-3456789");
    expect(JSON.stringify(report)).not.toContain("34-5678901");
    expect(necReport(actor("jordan@northline.demo"), 2026).rows).toEqual([]);
    expect(() => necReport(actor("dana@rivera.demo"), 2026)).toThrow(/cannot see/);
    expect(vendorTaxForm(actor("dana@rivera.demo"), "c_harbor")).toBeNull();
    expect(vendorTaxForm(maya, "c_harbor")?.tinMask).toBe("••••6789");
    expect(JSON.stringify(vendorTaxForm(maya, "c_harbor"))).not.toContain("12-3456789");
  });

  it("puts the full TIN only on an owner or admin CSV", () => {
    const owner = necCsv(actor("maya@rivera.demo"), 2026);
    const admin = necCsv(actor("sam@rivera.demo"), 2026);
    expect(owner.split("\n")[0]).toBe("Year,Legal name,TIN,Address,Box 1");
    expect(owner).toContain("12-3456789");
    expect(owner).toContain("23-4567890");
    expect(owner).toContain("34-5678901");
    expect(owner).toContain("2500.00");
    expect(owner).not.toContain("56-7890123");
    expect(owner).not.toContain("67-8901234");
    expect(admin).toContain("12-3456789");
    const office = necCsv(actor("luis@rivera.demo"), 2026);
    const viewer = necCsv(actor("riley@rivera.demo"), 2026);
    expect(office).toContain("Harbor Plumbing LLC");
    expect(office).not.toContain("12-3456789");
    expect(office).not.toMatch(/\d{2}-\d{7}/);
    expect(viewer).not.toMatch(/\d{2}-\d{7}/);
    expect(() => necCsv(actor("dana@rivera.demo"), 2026)).toThrow(/cannot see/);
  });

  it("nets an applied vendor credit and keeps a corporation off the filing list", () => {
    const maya = actor("maya@rivera.demo");
    getDb()
      .insert(vendorCreditApplications)
      .values({ id: "vca_nec_test", orgId: "org_rivera", creditId: "vc_nec", billId: "bill_nec_casa", amountCents: 20_000, createdAt: nowIso(), createdBy: "user_maya" })
      .run();
    expect(necReport(maya, 2026).rows.find((row) => row.contactId === "c_casa")?.box1Cents).toBe(300_000);
    getDb().delete(vendorCreditApplications).where(eq(vendorCreditApplications.id, "vca_nec_test")).run();
    expect(necCsv(maya, 2026)).not.toContain("Mill & Co");
    expect(necCsv(maya, 2026)).not.toContain("Slab House");
  });

  it("marks a W-9 requested without taking an attorney off the list, and hides the chase outside filing season", () => {
    const maya = actor("maya@rivera.demo");
    markNecRequested(maya, "c_brighton", 2026);
    const asked = necReport(maya, 2026);
    expect(asked.needs.find((row) => row.contactId === "c_brighton")?.requested).toBe(true);
    expect(() => markNecRequested(actor("riley@rivera.demo"), "c_brighton", 2026)).toThrow(/office/);
    saveVendorTax(maya, "c_brighton", { legalName: "Brighton Electric", taxClass: "attorney", exempt: true, tin: "" });
    expect(necReport(maya, 2026).rows.find((row) => row.contactId === "c_brighton")?.exempt).toBe(false);
    saveVendorTax(maya, "c_brighton", { legalName: "Brighton Electric", taxClass: "c_corp", exempt: false, tin: "" });
    expect(necReport(maya, 2026).needs.some((row) => row.contactId === "c_brighton")).toBe(false);
    saveVendorTax(maya, "c_brighton", { legalName: "Brighton Electric", taxClass: "sole_prop", exempt: false, tin: "" });
    expect(necAttention("org_rivera", "2026-10-15")).toEqual({ count: 0, href: null });
    expect(necAttention("org_rivera", "2026-12-01").count).toBe(1);
    expect(necAttention("org_rivera", "2027-01-31").href).toBe("/reports/nec?year=2026");
    expect(necAttention("org_rivera", "2027-02-01")).toEqual({ count: 0, href: null });
    expect(listInbox(maya, "all").some((row) => row.snippet.includes("1099"))).toBe(false);
  });
});
