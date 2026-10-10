import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { invoiceCosts, invoices } from "@/lib/db/schema";
import { authenticate } from "@/lib/services/read";
import { voidBilling } from "@/lib/services/draws";
import { agedCostPlus, costPlusBoard, createCostInvoice, openCostInvoice } from "@/lib/services/cost-plus";
import { unapproveBill } from "@/lib/services/bills";
import { reopenTime } from "@/lib/services/time";
import { localDay } from "@/lib/time/calendar";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("cost-plus invoices", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("prices the seeded job with the cabinet override and hides rates from the field", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    expect(costPlusBoard(dana, "proj_ellis")).toBeNull();
    const board = costPlusBoard(maya, "proj_ellis");
    expect(board).not.toBeNull();
    const blob = JSON.stringify(costPlusBoard(dana, "proj_ellis"));
    expect(blob).not.toContain("8500");
    expect(blob).not.toContain("markupBps");
    const cab = board!.codes.find((code) => code.costCode === "CAB-BOX");
    expect(cab?.markupBps).toBe(1500);
    const plumbing = board!.costs.find((cost) => cost.sourceId === "bln_ellis_plb");
    expect(plumbing).toMatchObject({ state: "billed", invoiceNumber: "RR-1070", markupBps: 2000, priceCents: 96_000 });
    const cabinets = board!.costs.find((cost) => cost.sourceId === "bln_ellis_cab");
    expect(cabinets).toMatchObject({ state: "unbilled", markupBps: 1500, markupCents: 18_750 });
    const labor = board!.costs.find((cost) => cost.kind === "time");
    expect(labor?.billRateCents).toBe(8500);
    expect(labor?.costCents).toBe(34_000);
    expect(JSON.stringify(board)).not.toContain("stays internal");
    expect(JSON.stringify(board)).not.toContain("private note");
    const today = localDay(Date.now(), "America/New_York");
    expect(agedCostPlus("org_rivera", today).count).toBe(1);
  });

  it("refuses a second invoice for the same cost and returns it when the invoice is void", () => {
    const maya = actor("maya@rivera.demo");
    expect(() => createCostInvoice(maya, "proj_ellis", { keys: ["bill:bln_ellis_plb"], presentAs: "grouped", markupDisplay: "baked" })).toThrow(/already on an invoice/);
    expect(() => unapproveBill(maya, "bill_ellis_plb", "Need a correction")).toThrow(/RR-1070/);
    expect(() => reopenTime(maya, "time_ellis_labor", "Wrong job")).toThrow(/RR-1070/);
    const created = createCostInvoice(maya, "proj_ellis", { keys: ["bill:bln_ellis_cab"], presentAs: "itemized", markupDisplay: "separate" });
    const invoice = getDb().select().from(invoices).where(eq(invoices.id, created.invoiceId)).get();
    expect(invoice?.status).toBe("draft");
    expect(invoice?.markupDisplay).toBe("separate");
    expect(invoice?.taxCents).toBeGreaterThan(0);
    expect(invoice?.totalCents).toBe(invoice!.subtotalCents + invoice!.taxCents);
    const linked = getDb().select().from(invoiceCosts).where(eq(invoiceCosts.invoiceId, created.invoiceId)).all();
    expect(linked).toHaveLength(1);
    expect(() => createCostInvoice(maya, "proj_ellis", { keys: ["bill:bln_ellis_cab"], presentAs: "grouped", markupDisplay: "baked" })).toThrow(/already on an invoice/);
    voidBilling(maya, created.invoiceId);
    const after = costPlusBoard(maya, "proj_ellis");
    expect(after?.costs.find((cost) => cost.sourceId === "bln_ellis_cab")?.state).toBe("unbilled");
    expect(getDb().select().from(invoiceCosts).where(eq(invoiceCosts.invoiceId, created.invoiceId)).all()).toHaveLength(0);
    const again = createCostInvoice(maya, "proj_ellis", { keys: ["bill:bln_ellis_cab"], presentAs: "grouped", markupDisplay: "baked" });
    openCostInvoice(maya, again.invoiceId);
    expect(getDb().select().from(invoices).where(eq(invoices.id, again.invoiceId)).get()?.status).toBe("open");
  });
});
