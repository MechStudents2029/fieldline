import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { bills, costItems, notifications, vendorCredits } from "@/lib/db/schema";
import { markBillPaid } from "@/lib/services/bills";
import { authenticate } from "@/lib/services/read";
import { ServiceError } from "@/lib/services/errors";
import { respondPortalCredit, vendorPortal } from "@/lib/services/vendor-portal";
import {
  createCreditFromPunch,
  createCreditFromReceipt,
  listVendorCredits,
  planBillApplications,
  voidCredit,
} from "@/lib/services/vendor-credits";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(email);
  return user;
}

describe("vendor credits", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("prices a short receipt once, lets the office apply part of a credit, and blocks the rest", () => {
    const maya = actor("maya@rivera.demo");
    const first = createCreditFromReceipt(maya, "rcp_ok_partial");
    expect(first.existing).toBe(true);
    expect(first.number).toBe("BC-1044");
    const again = createCreditFromReceipt(maya, "rcp_ok_partial", { another: true, reason: "Second pallet" });
    expect(again.existing).toBe(false);
    expect(again.amountCents).toBe(250_000);
    const paid = markBillPaid(maya, "bill_ok_ret_ready", {
      paidOn: "2026-10-09",
      method: "check",
      reference: "5102",
      applications: [{ creditId: again.id, amountCents: 100_000 }],
    });
    expect(paid).toMatchObject({ appliedCents: 100_000, netPaidCents: 80_000 });
    const harbor = getDb().select().from(bills).where(eq(bills.id, "bill_ok_harbor")).get();
    expect(harbor).toBeTruthy();
    expect(() => planBillApplications("org_rivera", harbor!, [{ creditId: again.id, amountCents: 200_000 }])).toThrow(ServiceError);
    expect(getDb().select().from(vendorCredits).where(eq(vendorCredits.id, "vc_short")).get()?.status).not.toBe("void");
  });

  it("lets field propose a draft without posting cost, and voiding an issued credit reverses the cost", () => {
    const dana = actor("dana@rivera.demo");
    const maya = actor("maya@rivera.demo");
    const prior = getDb().select().from(costItems).where(eq(costItems.projectId, "proj_okonkwo")).all().length;
    const draft = createCreditFromPunch(dana, "punch_ok_esc", { another: true, reason: "Escutcheon again" });
    expect(draft.status).toBe("draft");
    expect(draft.amountCents).toBe(0);
    expect(getDb().select().from(costItems).where(eq(costItems.projectId, "proj_okonkwo")).all()).toHaveLength(prior);
    expect(listVendorCredits(dana).some((row) => row.id === draft.id)).toBe(true);
    expect(listVendorCredits(dana).some((row) => row.number === "BC-1044")).toBe(false);
    const issued = createCreditFromPunch(maya, "punch_ok_esc", { another: true, reason: "Escutcheon labor", amountCents: 4_000 });
    expect(issued.status).toBe("issued");
    expect(getDb().select().from(costItems).where(and(eq(costItems.source, "vendor_credit"), eq(costItems.memo, issued.number))).get()?.amountCents).toBe(-4_000);
    voidCredit(maya, issued.id, "Waived");
    expect(getDb().select().from(costItems).where(eq(costItems.memo, issued.number)).get()).toBeUndefined();
    expect(getDb().select().from(vendorCredits).where(eq(vendorCredits.id, issued.id)).get()?.status).toBe("void");
  });

  it("records a vendor dispute in the office inbox", () => {
    const home = vendorPortal(DEMO_HARBOR_PORTAL_TOKEN);
    expect(home?.credits.some((row) => row.number === "BC-1045")).toBe(true);
    const credit = home?.credits.find((row) => row.number === "BC-1045");
    expect(credit).toBeTruthy();
    respondPortalCredit(DEMO_HARBOR_PORTAL_TOKEN, credit!.id, "dispute", "The escutcheon was already cracked.");
    const maya = actor("maya@rivera.demo");
    const inbox = getDb().select().from(notifications).where(eq(notifications.userId, maya.userId)).all();
    expect(inbox.some((row) => row.kind === "dispute" && row.snippet.includes("BC-1045"))).toBe(true);
    expect(() => respondPortalCredit(DEMO_HARBOR_PORTAL_TOKEN, "vc_dispute", "dispute", "Not our job")).toThrow(ServiceError);
  });
});
