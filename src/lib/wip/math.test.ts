import { describe, expect, it } from "vitest";
import {
  costToCompleteCents,
  earnedRevenueCents,
  grossProfitBps,
  grossProfitCents,
  invoiceBilledCents,
  jobFigures,
  overUnderCents,
  percentCompleteBps,
  projectedCostCents,
  sumFigures,
} from "@/lib/wip/math";

describe("WIP math", () => {
  it("takes the highest of revised budget, committed plus actual, and actual", () => {
    expect(projectedCostCents({ revisedBudgetCents: 100, committedOpenCents: 50, actualCents: 40 })).toBe(100);
    expect(projectedCostCents({ revisedBudgetCents: 100, committedOpenCents: 50, actualCents: 80 })).toBe(130);
    expect(projectedCostCents({ revisedBudgetCents: 10, committedOpenCents: 0, actualCents: 50 })).toBe(50);
    expect(projectedCostCents({ revisedBudgetCents: 0, committedOpenCents: 0, actualCents: 0 })).toBe(0);
  });

  it("caps percent complete at 100% and returns 0 when projected cost is 0", () => {
    expect(percentCompleteBps(0, 0)).toBe(0);
    expect(percentCompleteBps(50, 0)).toBe(0);
    expect(percentCompleteBps(0, 100)).toBe(0);
    expect(percentCompleteBps(1, 3)).toBe(3333);
    expect(percentCompleteBps(200, 100)).toBe(10_000);
  });

  it("earns contract times percent complete and stops at the contract", () => {
    expect(earnedRevenueCents(100, 1, 3)).toBe(33);
    expect(earnedRevenueCents(500, 200, 100)).toBe(500);
    expect(earnedRevenueCents(500, 40, 0)).toBe(0);
    expect(earnedRevenueCents(0, 40, 100)).toBe(0);
  });

  it("signs over and under billing and profit from the contract", () => {
    expect(overUnderCents(800, 500)).toBe(300);
    expect(overUnderCents(200, 500)).toBe(-300);
    expect(grossProfitCents(1_000, 400)).toBe(600);
    expect(grossProfitCents(1_000, 1_200)).toBe(-200);
    expect(grossProfitBps(1_000, -200)).toBe(-2000);
    expect(grossProfitBps(0, -200)).toBe(0);
    expect(costToCompleteCents(130, 80)).toBe(50);
    expect(costToCompleteCents(100, 160)).toBe(-60);
  });

  it("counts issued invoices with retainage once and skips drafts", () => {
    expect(invoiceBilledCents({ status: "draft", type: "progress", totalCents: 100, retainageCents: 10, applicationCents: null })).toBe(0);
    expect(invoiceBilledCents({ status: "void", type: "progress", totalCents: 100, retainageCents: 0, applicationCents: null })).toBe(0);
    expect(invoiceBilledCents({ status: "open", type: "deposit", totalCents: 100, retainageCents: 0, applicationCents: null })).toBe(100);
    expect(invoiceBilledCents({ status: "paid", type: "progress", totalCents: 90, retainageCents: 10, applicationCents: null })).toBe(100);
    expect(invoiceBilledCents({ status: "open", type: "pay_app", totalCents: 90, retainageCents: 10, applicationCents: 100 })).toBe(100);
    expect(invoiceBilledCents({ status: "open", type: "retainage", totalCents: 10, retainageCents: 0, applicationCents: null })).toBe(10);
  });

  it("uses an override for the job and keeps the totals equal to the rows", () => {
    const formula = jobFigures({
      contractCents: 1_000,
      costToDateCents: 200,
      codeProjectedCents: 500,
      overrideCents: null,
      billedCents: 100,
    });
    expect(formula).toMatchObject({ projectedCents: 500, percentBps: 4000, earnedCents: 400, overUnderCents: -300, profitCents: 500, costToCompleteCents: 300 });
    const overridden = jobFigures({
      contractCents: 1_000,
      costToDateCents: 200,
      codeProjectedCents: 500,
      overrideCents: 800,
      billedCents: 100,
    });
    expect(overridden.projectedCents).toBe(800);
    expect(overridden.earnedCents).toBe(250);
    const capped = jobFigures({
      contractCents: 500,
      costToDateCents: 200,
      codeProjectedCents: 100,
      overrideCents: null,
      billedCents: 0,
    });
    expect(capped.percentBps).toBe(10_000);
    expect(capped.earnedCents).toBe(500);
    const empty = jobFigures({ contractCents: 100, costToDateCents: 40, codeProjectedCents: 0, overrideCents: null, billedCents: 10 });
    expect(empty.percentBps).toBe(0);
    expect(empty.earnedCents).toBe(0);
    const pennies = [0, 1, 2].map(() =>
      jobFigures({ contractCents: 100, costToDateCents: 1, codeProjectedCents: 3, overrideCents: null, billedCents: 0 }),
    );
    const totals = sumFigures(pennies);
    expect(totals.earnedCents).toBe(pennies.reduce((sum, row) => sum + row.earnedCents, 0));
    expect(totals.contractCents).toBe(300);
    expect(totals.costToDateCents).toBe(3);
    expect(totals.projectedCents).toBe(9);
    expect(totals.overUnderCents).toBe(totals.billedCents - totals.earnedCents);
    expect(totals.profitCents).toBe(totals.contractCents - totals.projectedCents);
    expect(totals.costToCompleteCents).toBe(totals.projectedCents - totals.costToDateCents);
    expect(totals.percentBps).toBe(3333);
  });
});
