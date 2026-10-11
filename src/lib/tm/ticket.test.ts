import { describe, expect, it } from "vitest";
import { taxCents } from "@/lib/money";
import { lineCharge, nextTicketStatus, ticketTotals, unitPriceFromMarkup } from "@/lib/tm/ticket";

describe("T&M ticket totals", () => {
  it("rounds each line to the cent and taxes the price the way cost-plus does", () => {
    const labor = lineCharge({ qtyMilli: 1500, unitCostCents: 5200, unitPriceCents: 8500 });
    expect(labor).toEqual({ costCents: 7800, priceCents: 12750, markupCents: 4950 });
    const material = lineCharge({
      qtyMilli: 4000,
      unitCostCents: 2400,
      unitPriceCents: unitPriceFromMarkup(2400, 3500),
    });
    expect(material.costCents).toBe(9600);
    expect(material.priceCents).toBe(12960);
    const totals = ticketTotals(
      [
        { qtyMilli: 1500, unitCostCents: 5200, unitPriceCents: 8500 },
        { qtyMilli: 4000, unitCostCents: 2400, unitPriceCents: 3240 },
      ],
      875,
    );
    expect(totals.priceCents).toBe(25710);
    expect(totals.taxCents).toBe(taxCents(25710, 875));
    expect(totals.totalCents).toBe(totals.priceCents + totals.taxCents);
    expect(totals.markupCents).toBe(totals.priceCents - totals.costCents);
    expect(ticketTotals([], 0)).toMatchObject({ costCents: 0, priceCents: 0, taxCents: 0, totalCents: 0, marginBps: 0 });
  });

  it("rejects a bad quantity, price, or tax rate", () => {
    expect(() => lineCharge({ qtyMilli: -1, unitCostCents: 1, unitPriceCents: 1 })).toThrow(/Quantity/);
    expect(() => lineCharge({ qtyMilli: 1000, unitCostCents: -1, unitPriceCents: 1 })).toThrow(/Unit cost/);
    expect(() => unitPriceFromMarkup(100, 50_001)).toThrow(/Markup/);
    expect(() => ticketTotals([], 10001)).toThrow(/Tax/);
  });
});

describe("T&M ticket status", () => {
  it("walks draft to review, verified, billed, and back", () => {
    expect(nextTicketStatus("draft", "company")).toBe("ready");
    expect(nextTicketStatus("ready", "company")).toBeNull();
    expect(nextTicketStatus("draft", "client")).toBe("verified");
    expect(nextTicketStatus("ready", "client")).toBe("verified");
    expect(nextTicketStatus("verified", "client")).toBeNull();
    expect(nextTicketStatus("verified", "bill")).toBe("billed");
    expect(nextTicketStatus("ready", "bill")).toBeNull();
    expect(nextTicketStatus("draft", "void")).toBe("void");
    expect(nextTicketStatus("verified", "void")).toBe("void");
    expect(nextTicketStatus("billed", "void")).toBeNull();
    expect(nextTicketStatus("billed", "restore")).toBe("verified");
    expect(nextTicketStatus("verified", "restore")).toBeNull();
    expect(nextTicketStatus("void", "client")).toBeNull();
  });
});
