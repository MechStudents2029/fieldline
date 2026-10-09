import { describe, expect, it } from "vitest";
import { evaluateFormula, formulaCaption, formulaHint, referencedNames } from "@/lib/estimate/formula";

const floor = (valueMilli: number) => [{ name: "Floor", valueMilli }];
const both = [
  { name: "Floor", valueMilli: 240_000 },
  { name: "Walls", valueMilli: 410_000 },
];

function qty(expr: string, measurements: { name: string; valueMilli: number }[], wasteBps = 0, roundToMilli: number | null = null) {
  return evaluateFormula({ expr, wasteBps, roundToMilli, measurements });
}

describe("quantity formulas", () => {
  it("respects precedence and parentheses", () => {
    expect(qty("2 + 3 * 4", [])).toBe(14_000);
    expect(qty("(2 + 3) * 4", [])).toBe(20_000);
    expect(qty("8 / 2 / 2", [])).toBe(2_000);
    expect(qty("Floor * 2 + 10", floor(240_000))).toBe(490_000);
    expect(qty("(Floor + Walls) / 2", both)).toBe(325_000);
  });

  it("rejects division by zero, unknown names, and a bad expression", () => {
    expect(() => qty("1 / 0", [])).toThrow("Can't divide by zero.");
    expect(() => qty("Floor / (1 - 1)", floor(240_000))).toThrow("Can't divide by zero.");
    expect(() => qty("Nope", floor(240_000))).toThrow("Unknown measurement Nope.");
    expect(() => qty("Floor *", floor(240_000))).toThrow("Check the formula.");
    expect(() => qty("", [])).toThrow("Check the formula.");
    expect(referencedNames("Floor + Walls * 2")).toEqual(["Floor", "Walls"]);
  });

  it("applies waste, then rounds the quantity up", () => {
    expect(qty("Floor", floor(240_000), 1000)).toBe(264_000);
    expect(qty("Floor", floor(218_000), 1000, 10_000)).toBe(240_000);
    expect(qty("Walls", [{ name: "Walls", valueMilli: 410_000 }], 1000, 32_000)).toBe(480_000);
    expect(qty("Base", [{ name: "Base", valueMilli: 62_000 }], 1000)).toBe(68_200);
    expect(qty("Floor * 1.10", floor(100_000), 0, 10_000)).toBe(110_000);
    expect(formulaCaption("Walls", 1000, 32_000)).toBe("Walls x 1.10, round up to 32");
    expect(formulaCaption("Floor * 1.10", 0, 10_000)).toBe("Floor x 1.10, round up to 10");
    expect(
      formulaHint({
        expr: "Walls",
        wasteBps: 1000,
        roundToMilli: 32_000,
        measurements: [{ name: "Walls", valueMilli: 410_000 }],
        unit: "sf",
      }),
    ).toBe("410 sf × 1.10 → 451, rounded to 480 (15 × 32 sf)");
    expect(
      formulaHint({
        expr: "Walls",
        wasteBps: 1000,
        roundToMilli: null,
        measurements: [{ name: "Walls", valueMilli: 410_000 }],
        unit: "sf",
      }),
    ).toBe("410 sf × 1.10 → 451");
  });
});
