import { describe, expect, it } from "vitest";
import { lineAmounts } from "@/lib/money";
import { rollupCostCodes } from "@/lib/margin/category";
import {
  changeOrderPrefill,
  choiceAmounts,
  commitmentCents,
  formatSelectionDelta,
  withSelectionCost,
  withoutSelectionCost,
} from "@/lib/selections/money";

describe("selection allowance math", () => {
  it("scales by quantity and splits overage from credit", () => {
    const doubled = choiceAmounts({
      qtyMilli: 2000,
      unitPriceCents: 10_000,
      unitCostCents: 6_000,
      allowancePriceCents: 15_000,
      allowanceCostCents: 8_000,
    });
    expect(doubled.extendedPriceCents).toBe(20_000);
    expect(doubled.extendedCostCents).toBe(12_000);
    expect(doubled.differenceCents).toBe(5_000);
    expect(doubled.overageCents).toBe(5_000);
    expect(doubled.creditCents).toBe(0);

    const under = choiceAmounts({
      qtyMilli: 1000,
      unitPriceCents: 140_000,
      unitCostCents: 90_000,
      allowancePriceCents: 180_000,
      allowanceCostCents: 120_000,
    });
    expect(under.differenceCents).toBe(-40_000);
    expect(under.overageCents).toBe(0);
    expect(under.creditCents).toBe(40_000);
    expect(formatSelectionDelta(under.differenceCents)).toBe("−$400");

    const at = choiceAmounts({
      qtyMilli: 1000,
      unitPriceCents: 180_000,
      unitCostCents: 120_000,
      allowancePriceCents: 180_000,
    });
    expect(at.differenceCents).toBe(0);
    expect(formatSelectionDelta(0)).toBe("included");

    const over = choiceAmounts({
      qtyMilli: 1000,
      unitPriceCents: 240_000,
      unitCostCents: 165_000,
      allowancePriceCents: 180_000,
      allowanceCostCents: 120_000,
    });
    expect(over.overageCents).toBe(60_000);
    expect(formatSelectionDelta(over.differenceCents)).toBe("+$600");

    const unlinked = choiceAmounts({
      qtyMilli: 1000,
      unitPriceCents: 18_000,
      unitCostCents: 9_000,
      allowancePriceCents: null,
    });
    expect(unlinked.differenceCents).toBe(18_000);
    expect(commitmentCents(false, unlinked.extendedCostCents)).toBeNull();
    expect(commitmentCents(true, over.extendedCostCents)).toBe(165_000);
  });

  it("rolls the chosen cost into the allowance code and takes it back on reset", () => {
    const budget = [{ costCode: "TILE-FLR", budgetCostCents: 120_000 }];
    const before = rollupCostCodes(budget, []);
    expect(before.find((row) => row.code === "TILE-FLR")?.actualCents).toBe(0);
    const posted = withSelectionCost([], { id: "cost_sel", costCode: "TILE-FLR", amountCents: 165_000 });
    const after = rollupCostCodes(budget, posted.map((row) => ({ costCode: row.costCode, amountCents: row.amountCents })));
    expect(after.find((row) => row.code === "TILE-FLR")?.actualCents).toBe(165_000);
    const reverted = withoutSelectionCost(posted, "cost_sel");
    const reset = rollupCostCodes(budget, reverted.map((row) => ({ costCode: row.costCode, amountCents: row.amountCents })));
    expect(reset.find((row) => row.code === "TILE-FLR")?.actualCents).toBe(0);
  });

  it("prefills a draft for an overage or an unlinked price, and never for a credit", () => {
    const over = changeOrderPrefill({
      linked: true,
      extendedPriceCents: 240_000,
      extendedCostCents: 165_000,
      allowancePriceCents: 180_000,
      allowanceCostCents: 120_000,
    });
    expect(over?.priceCents).toBe(60_000);
    expect(over?.qty).toBe(1);
    expect(lineAmounts(1000, over!.unitCostCents, over!.markupBps).price).toBe(60_000);

    const qty = changeOrderPrefill({
      linked: true,
      extendedPriceCents: 20_000,
      extendedCostCents: 12_000,
      allowancePriceCents: 15_000,
      allowanceCostCents: 8_000,
    });
    expect(qty?.priceCents).toBe(5_000);
    expect(lineAmounts(1000, qty!.unitCostCents, qty!.markupBps).price).toBe(5_000);

    expect(
      changeOrderPrefill({
        linked: true,
        extendedPriceCents: 140_000,
        extendedCostCents: 90_000,
        allowancePriceCents: 180_000,
        allowanceCostCents: 120_000,
      }),
    ).toBeNull();
    expect(
      changeOrderPrefill({
        linked: true,
        extendedPriceCents: 180_000,
        extendedCostCents: 120_000,
        allowancePriceCents: 180_000,
        allowanceCostCents: 120_000,
      }),
    ).toBeNull();

    const loose = changeOrderPrefill({
      linked: false,
      extendedPriceCents: 18_000,
      extendedCostCents: 9_000,
      allowancePriceCents: null,
      allowanceCostCents: null,
    });
    expect(loose?.priceCents).toBe(18_000);
    expect(lineAmounts(1000, loose!.unitCostCents, loose!.markupBps).price).toBe(18_000);
  });
});
