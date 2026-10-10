import { describe, expect, it } from "vitest";
import { billableLaborCents, costPlusTotals, markupForCode, markupOnCost, presentCostLines, priceCost } from "@/lib/invoice/cost-plus";

describe("cost-plus markup", () => {
  it("rounds half cents up and drops anything under half", () => {
    expect(markupOnCost(1, 5000)).toBe(1);
    expect(markupOnCost(1, 4999)).toBe(0);
    expect(markupOnCost(100, 333)).toBe(3);
    expect(markupOnCost(3, 3333)).toBe(1);
    expect(priceCost(125_000, 1500)).toEqual({ costCents: 125_000, markupBps: 1500, markupCents: 18_750, priceCents: 143_750 });
  });

  it("uses a cost-code override instead of the job markup", () => {
    const overrides = [
      { costCode: "CAB-BOX", markupBps: 1500 },
      { costCode: "PLB-ROUGH", markupBps: 2500 },
    ];
    expect(markupForCode(2000, overrides, "CAB-BOX")).toBe(1500);
    expect(markupForCode(2000, overrides, "GC-SUPER")).toBe(2000);
    const rows = [
      { costCents: 80_000, markupBps: markupForCode(2000, overrides, "PLB-ROUGH") },
      { costCents: 45_000, markupBps: markupForCode(2000, overrides, "CAB-BOX") },
    ];
    expect(costPlusTotals(rows, 0)).toMatchObject({ costCents: 125_000, markupCents: 26_750, priceCents: 151_750, taxCents: 0, totalCents: 151_750 });
  });

  it("taxes the marked-up price", () => {
    const totals = costPlusTotals([{ costCents: 188_550, markupBps: 0 }], 875);
    expect(totals.taxCents).toBe(16_498);
    expect(totals.totalCents).toBe(205_048);
    const mixed = costPlusTotals(
      [
        { costCents: 80_000, markupBps: 2000 },
        { costCents: 45_000, markupBps: 1500 },
        { costCents: 34_000, markupBps: 2000 },
      ],
      875,
    );
    expect(mixed).toMatchObject({ costCents: 159_000, markupCents: 29_550, priceCents: 188_550, taxCents: 16_498, totalCents: 205_048 });
  });

  it("rounds labor to the cent", () => {
    expect(billableLaborCents(240, 8500)).toBe(34_000);
    expect(billableLaborCents(1, 30)).toBe(1);
    expect(billableLaborCents(1, 29)).toBe(0);
  });

  it("bakes markup into the line or shows it once", () => {
    const rows = [
      { costCode: "CAB-BOX", label: "Mill & Co", costCents: 45_000, markupBps: 1500, markupCents: 6_750, priceCents: 51_750 },
      { costCode: "CAB-BOX", label: "Cabinet boxes", costCents: 10_000, markupBps: 1500, markupCents: 1_500, priceCents: 11_500 },
      { costCode: "PLB-ROUGH", label: "Supply lines", costCents: 80_000, markupBps: 2000, markupCents: 16_000, priceCents: 96_000 },
    ];
    expect(presentCostLines(rows, "grouped", "baked")).toEqual([
      { description: "CAB-BOX", amountCents: 63_250 },
      { description: "PLB-ROUGH", amountCents: 96_000 },
    ]);
    expect(presentCostLines(rows, "itemized", "separate")).toEqual([
      { description: "Mill & Co", amountCents: 45_000 },
      { description: "Cabinet boxes", amountCents: 10_000 },
      { description: "Supply lines", amountCents: 80_000 },
      { description: "Markup", amountCents: 24_250 },
    ]);
  });
});
