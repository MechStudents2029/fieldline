import { describe, expect, it } from "vitest";
import { achFeeCents, cardFeeCents, lineAmounts, lineInputError, marginBps, parseMoneyToCents, positiveMoneyError, scheduleAmounts } from "@/lib/money";

describe("money", () => {
  it("rounds line cost and markup to cents", () => {
    const amounts = lineAmounts(240_000, 1200, 3500);
    expect(amounts.cost).toBe(288_000);
    expect(amounts.price).toBe(388_800);
  });

  it("puts rounding remainder on the last draw", () => {
    const parts = scheduleAmounts(100, [
      { type: "deposit", label: "Deposit", bps: 4000 },
      { type: "progress", label: "Progress", bps: 4000 },
      { type: "final", label: "Final", bps: 2000 },
    ]);
    expect(parts.reduce((sum, part) => sum + part.amountCents, 0)).toBe(100);
  });

  it("caps ACH fees at $5", () => {
    expect(achFeeCents(100_000)).toBe(500);
    expect(achFeeCents(10_000)).toBe(80);
    expect(cardFeeCents(10_000)).toBe(320);
  });

  it("computes margin basis points", () => {
    expect(marginBps(8_600_000, 7_400_000)).toBe(1395);
    expect(marginBps(0, 10)).toBeNull();
  });

  it("rejects negative, extra-precision, and overflowing money", () => {
    expect(parseMoneyToCents("1,234.50")).toBe(123_450);
    expect(parseMoneyToCents("-5")).toBeNull();
    expect(parseMoneyToCents("10.999")).toBeNull();
    expect(parseMoneyToCents("20000000")).toBeNull();
    expect(lineInputError({ qty: -1 })).toMatch(/Quantity/);
    expect(lineInputError({ unitCostCents: -1 })).toMatch(/Unit cost/);
    expect(lineInputError({ markupBps: 60_000 })).toMatch(/Markup/);
    expect(positiveMoneyError(0)).toMatch(/greater than zero/);
    expect(() => lineAmounts(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 3500)).toThrow(/too large/);
  });
});
