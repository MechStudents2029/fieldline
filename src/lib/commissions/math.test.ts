import { describe, expect, it } from "vitest";
import {
  assertSplits,
  basisAmount,
  earnSlices,
  milestoneTakes,
  percentToBps,
  priorSold,
  resolveRate,
  sliceDelta,
  type JobFacts,
  type PlanRate,
  type SplitShare,
} from "@/lib/commissions/math";

const thirds: PlanRate["milestones"] = [
  { kind: "deposit", shareBps: 3000 },
  { kind: "start", shareBps: 4000 },
  { kind: "completion", shareBps: 3000 },
];

function plan(partial: Partial<PlanRate> = {}): PlanRate {
  return {
    basis: "contract",
    rateBps: 500,
    overrides: [],
    milestones: thirds,
    ...partial,
  };
}

function facts(partial: Partial<JobFacts> = {}): JobFacts {
  return {
    soldCents: 100_000,
    jobCostCents: null,
    collectedCents: 0,
    started: false,
    complete: false,
    projectType: null,
    ...partial,
  };
}

function split(partial: Partial<SplitShare> & { userId: string }): SplitShare {
  return { mode: "percent", shareBps: 10_000, shareCents: 0, ...partial };
}

describe("commission math", () => {
  it("parses a rate and refuses a share past 100%", () => {
    expect(percentToBps("5")).toBe(500);
    expect(percentToBps("5.5")).toBe(550);
    expect(percentToBps("100")).toBe(10_000);
    expect(percentToBps("100.1")).toBeNull();
    expect(percentToBps("-1")).toBeNull();
  });

  it("uses the project-type rate and falls back when job cost is missing", () => {
    const card = plan({
      basis: "gross_profit",
      rateBps: 1000,
      overrides: [{ projectType: "Bath remodel", basis: null, rateBps: 600 }],
    });
    expect(resolveRate(card, "Bath remodel")).toEqual({ basis: "gross_profit", rateBps: 600 });
    expect(resolveRate(card, "Deck")).toEqual({ basis: "gross_profit", rateBps: 1000 });
    expect(basisAmount("gross_profit", 100_000, 40_000)).toEqual({ cents: 60_000, fallback: false });
    expect(basisAmount("gross_profit", 100_000, null)).toEqual({ cents: 100_000, fallback: true });
    expect(basisAmount("gross_profit", 50_000, 80_000)).toEqual({ cents: 0, fallback: false });
    expect(basisAmount("contract", 80_000, 10_000)).toEqual({ cents: 80_000, fallback: false });
  });

  it("keeps the unassigned remainder and refuses splits over 100%", () => {
    const plans = new Map([["maya", plan()], ["luis", plan({ rateBps: 800 })]]);
    const earned = earnSlices(
      plans,
      [split({ userId: "maya", shareBps: 6000 }), split({ userId: "luis", shareBps: 2500 })],
      facts({ collectedCents: 100_000, complete: true }),
    );
    expect(earned.remainderBps).toBe(1500);
    expect(earned.slices.find((slice) => slice.userId === "maya" && slice.milestone === "deposit")?.basisCents).toBe(60_000);
    expect(() => assertSplits([split({ userId: "maya", shareBps: 6000 }), split({ userId: "luis", shareBps: 5000 })])).toThrow(/100%/);
    expect(() => assertSplits([split({ userId: "maya" }), split({ userId: "maya", shareBps: 0 })])).toThrow(/twice/);
  });

  it("treats a fixed share as cents of that person's basis", () => {
    const plans = new Map([["maya", plan()]]);
    const earned = earnSlices(plans, [split({ userId: "maya", mode: "fixed", shareBps: 0, shareCents: 40_000 })], facts({ collectedCents: 100_000, complete: true }));
    expect(earned.remainderCents).toBe(60_000);
    expect(earned.slices[0]?.basisCents).toBe(40_000);
    expect(earned.slices.reduce((sum, slice) => sum + slice.earnedCents, 0)).toBe(2_000);
    const capped = earnSlices(plans, [split({ userId: "maya", mode: "fixed", shareBps: 0, shareCents: 150_000 })], facts({ collectedCents: 100_000, complete: true }));
    expect(capped.capped).toBe(true);
    expect(capped.slices[0]?.basisCents).toBe(100_000);
  });

  it("fills deposit from collected cash and holds later milestones until their gate opens", () => {
    expect(milestoneTakes(thirds, facts({ collectedCents: 50_000 }))).toEqual({ deposit: 3000, start: 0, completion: 0 });
    expect(milestoneTakes(thirds, facts({ collectedCents: 50_000, started: true }))).toEqual({ deposit: 3000, start: 2000, completion: 0 });
    expect(milestoneTakes(thirds, facts({ collectedCents: 100_000 }))).toEqual({ deposit: 3000, start: 0, completion: 3000 });
    expect(milestoneTakes(thirds, facts({ collectedCents: 80_000, complete: true }))).toEqual({ deposit: 3000, start: 4000, completion: 1000 });
  });

  it("earns the rate on the person's share and shows the change-order delta", () => {
    const plans = new Map([["maya", plan()]]);
    const before = earnSlices(plans, [split({ userId: "maya" })], facts({ collectedCents: 80_000, started: true }));
    const after = earnSlices(plans, [split({ userId: "maya" })], facts({ soldCents: 120_000, collectedCents: 80_000, started: true }));
    const beforeEarned = before.slices.reduce((sum, slice) => sum + slice.earnedCents, 0);
    const afterEarned = after.slices.reduce((sum, slice) => sum + slice.earnedCents, 0);
    expect(beforeEarned).toBe(3_500);
    expect(afterEarned).toBe(4_000);
    const delta = sliceDelta(after.slices, before.slices);
    expect([...delta.values()].reduce((sum, value) => sum + value, 0)).toBe(500);
    expect(priorSold(120_000, 20_000)).toBe(100_000);
  });

  it("does not earn twice for the same facts", () => {
    const plans = new Map([["maya", plan({ basis: "gross_profit", rateBps: 1000 })]]);
    const job = facts({ jobCostCents: 40_000, collectedCents: 100_000, started: true, complete: true, projectType: "Bath remodel" });
    const first = earnSlices(plans, [split({ userId: "maya", shareBps: 5000 })], job);
    const second = earnSlices(plans, [split({ userId: "maya", shareBps: 5000 })], job);
    expect(second).toEqual(first);
    expect(first.slices.reduce((sum, slice) => sum + slice.earnedCents, 0)).toBe(3_000);
  });
});
