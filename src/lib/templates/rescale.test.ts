import { describe, expect, it } from "vitest";
import { percentsFromAmounts, rescalePercents } from "@/lib/templates/rescale";

describe("draw rescale", () => {
  it("makes uneven percents add up to the cent", () => {
    const amounts = rescalePercents(100, [3334, 3333, 3333]);
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(100);
    expect(rescalePercents(1, [5000, 5000])).toEqual([1, 0]);
    expect(rescalePercents(2_590_000, [3000, 3000, 2000, 2000]).reduce((sum, amount) => sum + amount, 0)).toBe(2_590_000);
  });

  it("turns fixed amounts into percents that add to 100%", () => {
    const bps = percentsFromAmounts([1, 1, 1]);
    expect(bps.reduce((sum, part) => sum + part, 0)).toBe(10000);
    expect(rescalePercents(10, bps).reduce((sum, amount) => sum + amount, 0)).toBe(10);
  });
});
