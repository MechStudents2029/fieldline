import { describe, expect, it } from "vitest";
import { assignOption, assertOptionBand, chooseOption, nextOptionName, optionFigures, optionName, optionTotals, withRecommended } from "@/lib/estimate/options";

const line = (cost: number, markup = 5000) => ({
  id: `li_${cost}`,
  billing: "included" as const,
  qtyMilli: 1000,
  unitCostCents: cost,
  markupBps: markup,
});

describe("proposal options", () => {
  it("prices each option in cents and leaves a single scope alone", () => {
    expect(optionTotals([line(400_000)], 0, 4000)).toEqual({
      costCents: 400_000,
      priceCents: 600_000,
      taxCents: 0,
      totalCents: 600_000,
      marginBps: 3333,
      depositCents: 240_000,
    });
    expect(optionTotals([line(800_000), { ...line(100_000), id: "allow", billing: "allowance" }, { ...line(50_000), id: "opt", billing: "optional" }], 0, 4000).totalCents).toBe(1_350_000);
    expect(optionTotals([line(100)], 0, 4000).totalCents).toBe(optionTotals([line(100)], 0, 4000).priceCents);
    expect(() => assertOptionBand(1)).toThrow(/2 to 4/);
    expect(() => assertOptionBand(5)).toThrow(/2 to 4/);
    expect(() => assertOptionBand(2)).not.toThrow();
    expect(() => optionName("  ")).toThrow(/Name the option/);
    expect(nextOptionName(["Good", "Better"])).toBe("Best");
    expect(withRecommended([{ id: "a", recommended: true }, { id: "b", recommended: false }], "b").map((row) => row.recommended)).toEqual([false, true]);
    expect(withRecommended([{ id: "a", recommended: true }, { id: "b", recommended: false }], null).every((row) => !row.recommended)).toBe(true);
  });

  it("chooses one option, declines the rest, and blocks a paid switch", () => {
    const open = [
      { id: "good", status: "open" as const, total: 600_000 },
      { id: "better", status: "open" as const, total: 1_350_000 },
      { id: "best", status: "open" as const, total: 2_100_000 },
    ];
    const chosen = chooseOption(open, "better");
    expect(chosen.map((row) => row.status)).toEqual(["declined", "chosen", "declined"]);
    expect(chosen.map((row) => row.total)).toEqual([600_000, 1_350_000, 2_100_000]);
    expect(() => chooseOption(chosen, "best")).toThrow(/already chosen/);
    expect(() => chooseOption(open, "missing")).toThrow(/not on this proposal/);
    const switched = assignOption(chosen, "best", { depositPaidCents: 0, reason: "Client asked for glass" });
    expect(switched.find((row) => row.status === "chosen")?.id).toBe("best");
    expect(switched.filter((row) => row.status === "declined")).toHaveLength(2);
    expect(() => assignOption(chosen, "good", { depositPaidCents: 1, reason: "Too late" })).toThrow(/deposit is already paid/);
    expect(() => assignOption(chosen, "good", { depositPaidCents: 0, reason: " " })).toThrow(/Add a reason/);
  });

  it("counts tier wins and the average with and without options", () => {
    const figures = optionFigures([
      {
        id: "p1",
        status: "signed",
        totalCents: 1_350_000,
        href: "/leads/a",
        options: [
          { name: "Good", status: "declined" },
          { name: "Better", status: "chosen" },
          { name: "Best", status: "declined" },
        ],
      },
      { id: "p2", status: "signed", totalCents: 200_000, href: "/jobs/b", options: null },
      { id: "p3", status: "signed", totalCents: 400_000, href: "/jobs/c", options: null },
      { id: "p4", status: "sent", totalCents: 9_000_000, href: "/leads/d", options: null },
    ]);
    expect(figures.find((row) => row.set === "Better")).toMatchObject({ wins: 1, shareBps: 10_000, amountCents: 1_350_000 });
    expect(figures.find((row) => row.set === "Good")).toMatchObject({ wins: 0, shareBps: 0, amountCents: 0 });
    expect(figures.find((row) => row.set === "With options")).toMatchObject({ wins: 1, amountCents: 1_350_000, amountInTotal: false });
    expect(figures.find((row) => row.set === "Without options")).toMatchObject({ wins: 2, amountCents: 300_000 });
  });
});
