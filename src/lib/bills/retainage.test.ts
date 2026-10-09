import { describe, expect, it } from "vitest";
import { heldCents, netPayableCents, releaseAmountCents, resolveRetainageBps, retainedCents } from "@/lib/bills/retainage";

describe("vendor retainage", () => {
  it("rounds to the cent and never releases more than is held", () => {
    expect(retainedCents(1001, 1000)).toBe(100);
    expect(retainedCents(1005, 1000)).toBe(101);
    expect(retainedCents(200_000, 1000)).toBe(20_000);
    expect(retainedCents(100_000, 1000)).toBe(10_000);
    expect(netPayableCents(200_000, 20_000, "standard")).toBe(180_000);
    expect(netPayableCents(20_000, 0, "release")).toBe(20_000);
    expect(heldCents(20_000, 0)).toBe(20_000);
    expect(heldCents(20_000, 20_000)).toBe(0);
    expect(heldCents(0, 20_000)).toBe(0);
    expect(releaseAmountCents(20_000, 20_000)).toBe(20_000);
    expect(() => releaseAmountCents(20_000, 20_001)).toThrow(/exceed/);
    expect(() => releaseAmountCents(0, 1)).toThrow(/held/);
  });

  it("uses the vendor percent, then the company percent, otherwise zero", () => {
    expect(resolveRetainageBps(1000, 500)).toBe(1000);
    expect(resolveRetainageBps(null, 500)).toBe(500);
    expect(resolveRetainageBps(undefined, undefined)).toBe(0);
    expect(resolveRetainageBps(20_000, 0)).toBe(10_000);
  });
});
