import { describe, expect, it } from "vitest";
import {
  applySlice,
  creditStatusLabel,
  creditView,
  damagedCreditCents,
  netAfterCredit,
  poCreditFacts,
  remainingCreditCents,
  settlePayment,
  shortCreditCents,
} from "@/lib/credits/math";

describe("vendor credit math", () => {
  it("keeps remaining cents and refuses an over-application", () => {
    expect(remainingCreditCents(250_000, 40_000)).toBe(210_000);
    expect(remainingCreditCents(100, 100)).toBe(0);
    expect(() => remainingCreditCents(100, 101)).toThrow(/outside the credit/);
    expect(applySlice(210_000, 0)).toBe(0);
    expect(applySlice(210_000, 50_000)).toBe(50_000);
    expect(() => applySlice(210_000, 210_001)).toThrow(/more than the credit left/);
  });

  it("pays the net after retainage and blocks credits past that net", () => {
    expect(netAfterCredit(180_000, 40_000)).toBe(140_000);
    expect(() => netAfterCredit(180_000, 180_001)).toThrow(/more than the net/);
    expect(
      settlePayment({
        billNetCents: 180_000,
        slices: [
          { remainingCents: 250_000, requestedCents: 100_000 },
          { remainingCents: 18_000, requestedCents: 0 },
        ],
      }),
    ).toEqual({ appliedCents: 100_000, netPaidCents: 80_000 });
    expect(() =>
      settlePayment({
        billNetCents: 50_000,
        slices: [{ remainingCents: 250_000, requestedCents: 80_000 }],
      }),
    ).toThrow(/more than the net/);
  });

  it("prices a short or damaged receipt from quantity and unit cost", () => {
    expect(shortCreditCents(4000, 1500, 100_000)).toBe(250_000);
    expect(shortCreditCents(4000, 4000, 100_000)).toBe(0);
    expect(damagedCreditCents(500, 100_000)).toBe(50_000);
    expect(damagedCreditCents(0, 100_000)).toBe(0);
  });

  it("labels partial and full application without dropping the vendor response", () => {
    expect(creditView("issued", 100_000, 0)).toBe("issued");
    expect(creditView("acknowledged", 100_000, 40_000)).toBe("partial");
    expect(creditView("disputed", 22_000, 22_000)).toBe("applied");
    expect(creditView("void", 22_000, 0)).toBe("void");
    expect(creditView("draft", 0, 0)).toBe("draft");
    expect(creditStatusLabel("partial")).toBe("Partially applied");
    expect(creditStatusLabel("applied")).toBe("Applied");
  });

  it("nets purchase-order committed and billed by the credit", () => {
    expect(
      poCreditFacts({
        status: "issued",
        amountCents: 400_000,
        billedCents: 150_000,
        openCents: 250_000,
        credits: [
          { amountCents: 250_000, appliedCents: 0 },
          { amountCents: 100_000, appliedCents: 40_000 },
        ],
      }),
    ).toEqual({ committedCents: 50_000, billedCents: 110_000, openCents: 0, creditCents: 350_000 });
    expect(
      poCreditFacts({
        status: "issued",
        amountCents: 400_000,
        billedCents: 150_000,
        openCents: 250_000,
        credits: [],
      }),
    ).toMatchObject({ committedCents: 400_000, openCents: 250_000, creditCents: 0 });
    expect(poCreditFacts({ status: "draft", amountCents: 100, billedCents: 0, openCents: 0, credits: [] }).committedCents).toBe(0);
  });
});
