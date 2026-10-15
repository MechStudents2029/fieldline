import { describe, expect, it } from "vitest";
import {
  boxFigures,
  cardExcluded,
  exemptFromNec,
  filingSeason,
  filingYear,
  maskTin,
  necCashCents,
  necThresholdCents,
  w9State,
} from "@/lib/tax/nec";

describe("1099 threshold and exemptions", () => {
  it("keeps $600 through 2025 and $2,000 from 2026", () => {
    expect(necThresholdCents(2024)).toBe(60_000);
    expect(necThresholdCents(2025)).toBe(60_000);
    expect(necThresholdCents(2026)).toBe(200_000);
    expect(necThresholdCents(2030)).toBe(200_000);
  });

  it("exempts corporations and an explicit flag, and keeps attorneys in", () => {
    expect(exemptFromNec("c_corp", false)).toBe(true);
    expect(exemptFromNec("s_corp", false)).toBe(true);
    expect(exemptFromNec("llc", false)).toBe(false);
    expect(exemptFromNec("sole_prop", true)).toBe(true);
    expect(exemptFromNec("attorney", false)).toBe(false);
    expect(exemptFromNec("attorney", true)).toBe(false);
    expect(exemptFromNec("", false)).toBe(false);
  });

  it("drops card and processor payments and keeps an unknown method", () => {
    expect(cardExcluded("card")).toBe(true);
    expect(cardExcluded("processor")).toBe(true);
    expect(cardExcluded("third_party")).toBe(true);
    expect(cardExcluded("check")).toBe(false);
    expect(cardExcluded("ach")).toBe(false);
    expect(cardExcluded(null)).toBe(false);
    expect(cardExcluded("other")).toBe(false);
  });

  it("nets retainage and applied credits, and splits card cash off box 1", () => {
    expect(necCashCents(100_000, 10_000, "standard", 5_000)).toBe(85_000);
    expect(necCashCents(20_000, 0, "release", 25_000)).toBe(0);
    const mixed = boxFigures(
      [
        { paidOn: "2026-06-01", status: "paid", amountCents: 250_000, retainageCents: 0, kind: "standard", method: "check", creditCents: 0 },
        { paidOn: "2026-08-15", status: "paid", amountCents: 350_000, retainageCents: 0, kind: "standard", method: "card", creditCents: 0 },
        { paidOn: "2025-08-15", status: "paid", amountCents: 90_000, retainageCents: 0, kind: "standard", method: "check", creditCents: 0 },
        { paidOn: "2026-01-02", status: "approved", amountCents: 80_000, retainageCents: 0, kind: "standard", method: "check", creditCents: 0 },
      ],
      2026,
    );
    expect(mixed).toEqual({ cashCents: 250_000, cardCents: 350_000 });
  });

  it("masks a TIN to the last four and reads W-9 and filing season", () => {
    expect(maskTin("12-3456789")).toBe("••••6789");
    expect(maskTin("123")).toBe("");
    expect(maskTin(null)).toBe("");
    expect(w9State(null, "2026-10-15")).toBe("missing");
    expect(w9State("2026-10-14", "2026-10-15")).toBe("stale");
    expect(w9State("2027-06-01", "2026-10-15")).toBe("on_file");
    expect(filingSeason("2026-10-15")).toBe(false);
    expect(filingSeason("2026-11-30")).toBe(false);
    expect(filingSeason("2026-12-01")).toBe(true);
    expect(filingSeason("2027-01-31")).toBe(true);
    expect(filingSeason("2027-02-01")).toBe(false);
    expect(filingYear("2026-12-15")).toBe(2026);
    expect(filingYear("2027-01-15")).toBe(2026);
    expect(filingYear("2026-10-15")).toBeNull();
  });
});
