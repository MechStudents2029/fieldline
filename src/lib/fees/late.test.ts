import { describe, expect, it } from "vitest";
import { allocatePayment, arBucket, feeAmount, feeEligible, lateFeePolicyLine, type FeeInvoice, type LatePolicy } from "@/lib/fees/late";

const policy: LatePolicy = {
  enabled: true,
  flatCents: 2_500,
  monthlyBps: 100,
  graceDays: 7,
  minimumCents: 5_000,
  capCents: 10_000,
  excludeRetainage: true,
  excludeDraws: true,
  excludeAgreements: true,
  mode: "review",
};

function invoice(patch: Partial<FeeInvoice> = {}): FeeInvoice {
  return {
    status: "open",
    dueDate: "2026-10-01",
    totalCents: 20_000,
    amountPaidCents: 0,
    retainageCents: 0,
    type: "progress",
    draw: false,
    agreement: false,
    ...patch,
  };
}

describe("late fee math", () => {
  it("adds a flat fee, a percent, or both, and respects grace, minimum, and cap", () => {
    expect(feeAmount({ flatCents: 2_500, monthlyBps: 0, capCents: 0 }, 20_000, 0)).toBe(2_500);
    expect(feeAmount({ flatCents: 0, monthlyBps: 100, capCents: 0 }, 20_000, 0)).toBe(200);
    expect(feeAmount(policy, 20_000, 0)).toBe(2_700);
    expect(feeAmount(policy, 20_000, 8_000)).toBe(2_000);
    expect(feeAmount(policy, 20_000, 10_000)).toBe(0);
    expect(feeEligible(policy, invoice(), "2026-10-08")).toBe(false);
    expect(feeEligible(policy, invoice(), "2026-10-09")).toBe(true);
    expect(feeEligible(policy, invoice({ totalCents: 4_000 }), "2026-10-09")).toBe(false);
    expect(feeEligible({ ...policy, graceDays: 0 }, invoice({ dueDate: "2026-10-15" }), "2026-10-15")).toBe(false);
    expect(feeEligible({ ...policy, graceDays: 0 }, invoice({ dueDate: "2026-10-14" }), "2026-10-15")).toBe(true);
  });

  it("skips paid, void, disputed, hold, retainage, draws, and agreement invoices", () => {
    const today = "2026-10-20";
    for (const status of ["paid", "void", "disputed", "hold", "draft"]) {
      expect(feeEligible(policy, invoice({ status }), today)).toBe(false);
    }
    expect(feeEligible(policy, invoice({ retainageCents: 100 }), today)).toBe(false);
    expect(feeEligible(policy, invoice({ type: "retainage" }), today)).toBe(false);
    expect(feeEligible(policy, invoice({ draw: true }), today)).toBe(false);
    expect(feeEligible(policy, invoice({ type: "draw" }), today)).toBe(false);
    expect(feeEligible(policy, invoice({ agreement: true }), today)).toBe(false);
    expect(feeEligible(policy, invoice({ type: "service" }), today)).toBe(false);
    expect(feeEligible({ ...policy, excludeRetainage: false }, invoice({ retainageCents: 100 }), today)).toBe(true);
    expect(feeEligible({ ...policy, enabled: false }, invoice(), today)).toBe(false);
    expect(lateFeePolicyLine(policy)).toBe("$25.00 + 1.00% after 7 days");
    expect(lateFeePolicyLine({ ...policy, enabled: false })).toBeNull();
  });

  it("pays fees before principal and buckets aging", () => {
    const split = allocatePayment(10_000, [
      { id: "b", amountCents: 1_000, appliedAt: "2026-10-02" },
      { id: "a", amountCents: 2_500, appliedAt: "2026-09-01" },
    ], 3_000);
    expect(split.fees).toEqual([
      { id: "a", paidCents: 2_500, openCents: 0 },
      { id: "b", paidCents: 500, openCents: 500 },
    ]);
    expect(split.principalPaidCents).toBe(0);
    expect(split.principalOpenCents).toBe(10_000);
    expect(allocatePayment(10_000, [{ id: "a", amountCents: 2_500, appliedAt: "2026-09-01" }], 4_000)).toMatchObject({
      principalPaidCents: 1_500,
      principalOpenCents: 8_500,
    });
    expect(arBucket("2026-10-15", "2026-10-15")).toBe("Current");
    expect(arBucket("2026-10-14", "2026-10-15")).toBe("1–30");
    expect(arBucket("2026-09-15", "2026-10-15")).toBe("1–30");
    expect(arBucket("2026-09-14", "2026-10-15")).toBe("31–60");
    expect(arBucket("2026-08-16", "2026-10-15")).toBe("31–60");
    expect(arBucket("2026-08-15", "2026-10-15")).toBe("61–90");
    expect(arBucket("2026-07-17", "2026-10-15")).toBe("61–90");
    expect(arBucket("2026-07-16", "2026-10-15")).toBe("90+");
  });
});
