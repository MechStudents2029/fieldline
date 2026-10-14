import { describe, expect, it } from "vitest";
import { assertApplySlice, cashDueCents, memoRemainingCents, memoStatusAfter } from "@/lib/credits/client-memo";

describe("client credit memo math", () => {
  it("keeps the contract and only spends the memo that is left", () => {
    expect(cashDueCents(10_000, 2_500)).toBe(7_500);
    expect(memoRemainingCents(10_000, 2_500, "partial")).toBe(7_500);
    expect(memoRemainingCents(10_000, 0, "draft")).toBe(0);
    expect(memoRemainingCents(10_000, 0, "void")).toBe(0);
    expect(memoStatusAfter(10_000, 0)).toBe("ready");
    expect(memoStatusAfter(10_000, 2_500)).toBe("partial");
    expect(memoStatusAfter(10_000, 10_000)).toBe("applied");
    expect(() => assertApplySlice(2_500, 9_000, 2_501)).toThrow(/memo left/);
    expect(() => assertApplySlice(9_000, 2_500, 2_501)).toThrow(/invoice balance/);
    expect(() => assertApplySlice(9_000, 9_000, 0)).toThrow(/positive/);
  });
});
