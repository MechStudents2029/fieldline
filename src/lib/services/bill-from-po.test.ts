import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { bills } from "@/lib/db/schema";
import { billFromPo } from "@/lib/bills/from-po";
import { createBill } from "@/lib/services/bills";
import { purchaseOrderDetail } from "@/lib/services/purchase-orders";
import { authenticate } from "@/lib/services/read";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("seeded purchase order bill", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("shows Okonkwo retainage lines with billed and remaining", () => {
    const detail = purchaseOrderDetail("org_rivera", "po_ok_retain", "owner");
    expect(detail?.lines.find((line) => line.costCode === "PLB-SHOWER")).toMatchObject({
      amountCents: 500_000,
      billedCents: 300_000,
      remainingCents: 200_000,
    });
    expect(detail?.bills.map((bill) => bill.billNumber).sort()).toEqual(["HP-510", "HP-511"]);
    expect(billFromPo(detail?.lines ?? [], 1000)).toMatchObject({
      amountCents: 200_000,
      retainageCents: 20_000,
      netCents: 180_000,
    });
  });

  it("keeps retainage and warns when the bill is past the remainder", () => {
    const maya = actor("maya@rivera.demo");
    const saved = createBill(maya, {
      projectId: "proj_okonkwo",
      vendorContactId: "c_harbor",
      purchaseOrderId: "po_ok_retain",
      billNumber: "HP-OVER-PO",
      billDate: "2026-10-09",
      dueDate: "2026-10-20",
      lines: [{ costCode: "PLB-SHOWER", description: "Extra", amountCents: 250_000 }],
    });
    expect(saved.warning).toMatch(/past PO-1055/);
    expect(saved.warning).toMatch(/\$500\.00 over on PLB-SHOWER/);
    expect(getDb().select().from(bills).where(eq(bills.id, saved.id)).get()).toMatchObject({
      retainageCents: 25_000,
      amountCents: 250_000,
      status: "draft",
    });
  });
});
