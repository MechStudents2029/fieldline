import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, bills, lienWaivers, organizations } from "@/lib/db/schema";
import { approveBill, createBill, markBillPaid } from "@/lib/services/bills";
import { authenticate } from "@/lib/services/read";
import { orgSubmittals } from "@/lib/services/submittals";
import { defaultSubmittalList } from "@/lib/submittals/format";
import {
  billWaiverPanel,
  billsCsv,
  lienSettings,
  outstandingWaivers,
  requestUnconditional,
  requestWaiver,
  requestWaivers,
  signVendorWaiver,
  uploadPaperWaiver,
  vendorPortalWaivers,
  waiverBadges,
  waiverPrint,
  waiverQueue,
  waiverTextFrozen,
} from "@/lib/services/waivers";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function setMode(mode: string) {
  getDb().update(organizations).set({ lienWaiverMode: mode }).where(eq(organizations.id, "org_rivera")).run();
}

describe("lien waivers", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("seeds a signed Harbor waiver, an open request, and a paid bill with none", () => {
    const maya = actor("maya@rivera.demo");
    const badges = new Map(waiverBadges(maya).map((row) => [row.billId, row.state]));
    expect(badges.get("bill_harbor_paid")).toBe("signed");
    expect(badges.get("bill_ok_harbor_req")).toBe("requested");
    expect(badges.get("bill_dz_summit")).toBe("missing");
    const signed = getDb().select().from(lienWaivers).where(eq(lienWaivers.id, "lw_harbor_paid")).get();
    expect(signed?.signedText).toBe(signed?.body);
    expect(signed?.body).toContain("Harbor Plumbing");
    expect(signed?.body).not.toContain("{amount}");
    expect(lienSettings(maya)?.mode).toBe("warn");
    expect(lienSettings(maya)?.note).toBe("Templates, not legal advice.");
    const open = defaultSubmittalList(orgSubmittals(maya, {}), {});
    expect(open.map((row) => row.title)).toEqual(expect.arrayContaining(["Shower valve cut sheet", "Tile sample"]));
    expect(open).toHaveLength(2);
  });

  it("keeps a signed waiver's text fixed", () => {
    const before = getDb().select().from(lienWaivers).where(eq(lienWaivers.id, "lw_harbor_req")).get();
    expect(before?.status).toBe("requested");
    const signed = signVendorWaiver({ token: DEMO_HARBOR_PORTAL_TOKEN, waiverId: "lw_harbor_req", name: "Pete Alvarez", ip: "127.0.0.1" });
    expect(signed.signedText).toBe(before?.body);
    const row = getDb().select().from(lienWaivers).where(eq(lienWaivers.id, "lw_harbor_req")).get();
    expect(waiverTextFrozen(before?.body ?? "", row?.body ?? "", row?.signedText ?? null)).toBe(true);
    expect(row?.signedName).toBe("Pete Alvarez");
    expect(() => signVendorWaiver({ token: DEMO_HARBOR_PORTAL_TOKEN, waiverId: "lw_harbor_req", name: "Someone Else", ip: "127.0.0.2" })).toThrow(/already signed/);
    const again = getDb().select().from(lienWaivers).where(eq(lienWaivers.id, "lw_harbor_req")).get();
    expect(again?.signedText).toBe(before?.body);
    expect(again?.signedName).toBe("Pete Alvarez");
    const audit = getDb().select().from(auditLogs).where(eq(auditLogs.entityId, "lw_harbor_req")).all();
    expect(audit.some((entry) => entry.action === "waiver.sign" && entry.entityType === "waiver")).toBe(true);
  });

  it("lets the office file a paper waiver without rewriting the text", () => {
    const maya = actor("maya@rivera.demo");
    const created = createBill(maya, {
      projectId: "proj_chen",
      vendorContactId: "c_summit",
      billNumber: "SL-PAPER",
      billDate: "2026-10-02",
      dueDate: "2026-10-20",
      lines: [{ costCode: "DECK-BOARD", amountCents: 10_000, description: "Paper" }],
    });
    approveBill(maya, created.id);
    const requested = requestWaiver(maya, created.id, { type: "conditional_progress" });
    const body = getDb().select().from(lienWaivers).where(eq(lienWaivers.id, requested.id)).get()?.body ?? "";
    uploadPaperWaiver(maya, requested.id, { filename: "waiver.png", bytes: png });
    const row = getDb().select().from(lienWaivers).where(eq(lienWaivers.id, requested.id)).get();
    expect(row?.status).toBe("signed");
    expect(row?.body).toBe(body);
    expect(row?.signedText).toBe(body);
    expect(row?.signedName).toBe("Maya Rivera");
    expect(row?.documentId).toBeTruthy();
    expect(getDb().select().from(auditLogs).all().some((entry) => entry.action === "waiver.upload" && entry.entityId === requested.id)).toBe(true);
  });

  it("follows Off, Warn, and Block when the waiver is unsigned", () => {
    const maya = actor("maya@rivera.demo");
    const make = (number: string) => {
      const bill = createBill(maya, {
        projectId: "proj_chen",
        vendorContactId: "c_summit",
        billNumber: number,
        billDate: "2026-10-02",
        dueDate: "2026-10-20",
        lines: [{ costCode: "DECK-BOARD", amountCents: 11_000, description: number }],
      });
      approveBill(maya, bill.id);
      return bill.id;
    };
    setMode("off");
    const off = markBillPaid(maya, make("SL-OFF"), { paidOn: "2026-10-04", method: "check", reference: "1" });
    expect(off.warning).toBeNull();
    setMode("warn");
    const warn = markBillPaid(maya, make("SL-WARN"), { paidOn: "2026-10-04", method: "check", reference: "2" });
    expect(warn.warning).toBe("Lien waiver is not signed.");
    const blockedId = make("SL-BLOCK");
    setMode("block");
    expect(() => markBillPaid(maya, blockedId, { paidOn: "2026-10-04", method: "check", reference: "3" })).toThrow(/not signed/);
    expect(getDb().select().from(bills).where(eq(bills.id, blockedId)).get()?.status).toBe("approved");
    setMode("warn");
  });

  it("hides waivers from another vendor, another company, field, and the client portal", () => {
    const harbor = vendorPortalWaivers(DEMO_HARBOR_PORTAL_TOKEN);
    expect(harbor?.some((row) => row.billNumber === "SL-1904")).toBe(false);
    expect(harbor?.every((row) => row.job.includes("Okonkwo") || row.billNumber.startsWith("HP-"))).toBe(true);
    expect(vendorPortalWaivers("demo_portal_okonkwo")).toBeNull();
    const dana = actor("dana@rivera.demo");
    expect(waiverBadges(dana)).toEqual([]);
    expect(waiverPrint(dana, "lw_harbor_paid")).toBeNull();
    expect(billWaiverPanel(dana, "bill_harbor_paid")).toBeNull();
    expect(outstandingWaivers(dana, "c_harbor")).toEqual([]);
    expect(waiverQueue(dana).count).toBe(0);
    expect(billsCsv(dana)).toBeNull();
    const jordan = actor("jordan@northline.demo");
    expect(waiverPrint(jordan, "lw_harbor_paid")).toBeNull();
    expect(billWaiverPanel(jordan, "bill_harbor_paid")).toBeNull();
    expect(() => requestWaiver(jordan, "bill_ok_harbor", { type: "conditional_progress" })).toThrow(/not found|cannot/);
  });

  it("requests a waiver on several bills at once", () => {
    const maya = actor("maya@rivera.demo");
    const first = createBill(maya, {
      projectId: "proj_chen",
      vendorContactId: "c_casa",
      billNumber: "CT-B1",
      billDate: "2026-10-03",
      dueDate: "2026-10-18",
      lines: [{ costCode: "TILE-SHOWER", amountCents: 4_000, description: "One" }],
    });
    const second = createBill(maya, {
      projectId: "proj_chen",
      vendorContactId: "c_casa",
      billNumber: "CT-B2",
      billDate: "2026-10-03",
      dueDate: "2026-10-18",
      lines: [{ costCode: "TILE-SHOWER", amountCents: 5_000, description: "Two" }],
    });
    approveBill(maya, first.id);
    approveBill(maya, second.id);
    const bulk = requestWaivers(maya, [first.id, second.id, first.id], "conditional_final");
    expect(bulk.count).toBe(2);
    const rows = getDb().select().from(lienWaivers).all().filter((row) => row.billId === first.id || row.billId === second.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "requested" && row.amountCents > 0 && row.throughDate === "2026-10-03")).toBe(true);
    expect(getDb().select().from(auditLogs).all().filter((entry) => entry.action === "waiver.request").length).toBeGreaterThanOrEqual(2);
    const paid = markBillPaid(maya, first.id, { paidOn: "2026-10-05", method: "ach", reference: "9" });
    expect(paid.warning).toBeTruthy();
    const offer = billWaiverPanel(maya, first.id)?.offer;
    expect(offer?.type).toBe("unconditional_progress");
    requestUnconditional(maya, first.id);
    expect(billWaiverPanel(maya, first.id)?.lines.some((row) => row.type === "unconditional_progress" && row.status === "requested")).toBe(true);
    const csv = billsCsv(maya) ?? "";
    expect(csv.split("\n")[0]).toContain("Waiver");
    expect(csv).toContain("Signed");
    expect(csv).toContain("Missing");
    expect(waiverQueue(maya).count).toBeGreaterThan(0);
    expect(outstandingWaivers(maya, "c_casa").length).toBeGreaterThan(0);
  });
});
