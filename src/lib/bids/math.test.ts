import { describe, expect, it } from "vitest";
import { dueWithinThreeDays, extendCents, lowVendorIds, requestStatusLabel, varianceCents, vendorCanRevise } from "@/lib/bids/math";

describe("bid math", () => {
  it("extends milli quantity to cents and marks the low price", () => {
    expect(extendCents(1000, 480_000)).toBe(480_000);
    expect(extendCents(1500, 10_000)).toBe(15_000);
    expect(extendCents(1, 100)).toBe(0);
    const lows = lowVendorIds([
      { vendorId: "harbor", unitPriceCents: 480_000, noBid: false, live: true },
      { vendorId: "casa", unitPriceCents: 610_000, noBid: false, live: true },
      { vendorId: "brighton", unitPriceCents: null, noBid: false, live: false },
      { vendorId: "summit", unitPriceCents: 100, noBid: true, live: true },
    ]);
    expect(lows).toEqual(["harbor"]);
    expect(
      lowVendorIds([
        { vendorId: "a", unitPriceCents: 50, noBid: false, live: true },
        { vendorId: "b", unitPriceCents: 50, noBid: false, live: true },
      ]),
    ).toEqual(["a", "b"]);
    expect(varianceCents(480_000, 520_000)).toBe(-40_000);
    expect(varianceCents(100, null)).toBeNull();
  });

  it("names the request from how many prices are in", () => {
    expect(requestStatusLabel("draft", 0, 0)).toBe("Draft");
    expect(requestStatusLabel("out", 0, 3)).toBe("Out");
    expect(requestStatusLabel("out", 2, 3)).toBe("2 of 3 in");
    expect(requestStatusLabel("awarded", 3, 3)).toBe("Awarded");
    expect(requestStatusLabel("closed", 1, 3)).toBe("Closed");
  });

  it("keeps the due date open through that company-local day and counts three days ahead", () => {
    expect(vendorCanRevise("out", "2026-10-07", "2026-10-07", "submitted")).toBe(true);
    expect(vendorCanRevise("out", "2026-10-07", "2026-10-08", "submitted")).toBe(false);
    expect(vendorCanRevise("awarded", "2026-10-09", "2026-10-07", "submitted")).toBe(false);
    expect(vendorCanRevise("out", "2026-10-09", "2026-10-07", "declined")).toBe(false);
    expect(vendorCanRevise("out", "2026-10-09", "2026-10-07", "needs_revision")).toBe(true);
    expect(dueWithinThreeDays("2026-10-07", "2026-10-07")).toBe(true);
    expect(dueWithinThreeDays("2026-10-10", "2026-10-07")).toBe(true);
    expect(dueWithinThreeDays("2026-10-11", "2026-10-07")).toBe(false);
    expect(dueWithinThreeDays("2026-10-06", "2026-10-07")).toBe(false);
    // 2026-10-07T03:30:00Z is still 2026-10-06 in America/New_York. The caller passes that local day.
    expect(dueWithinThreeDays("2026-10-06", "2026-10-06")).toBe(true);
    expect(vendorCanRevise("out", "2026-10-06", "2026-10-06", "invited")).toBe(true);
    expect(vendorCanRevise("out", "2026-10-06", "2026-10-07", "invited")).toBe(false);
  });
});
