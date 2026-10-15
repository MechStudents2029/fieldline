import { describe, expect, it } from "vitest";
import {
  formatMiles,
  formatRate,
  isWaitingTrip,
  mileageCents,
  milesFromOdometer,
  parseMilesToMilli,
  parseRateToDeciCents,
  parseReadingToMilli,
  periodsOverlap,
  rateForDate,
  type RatePeriod,
} from "@/lib/mileage/rate";

const periods: RatePeriod[] = [
  { id: "mr_2026_h1", startsOn: "2026-01-01", endsOn: "2026-06-30", rateDeciCents: 725, irsDeciCents: 725 },
  { id: "mr_2026_h2", startsOn: "2026-07-01", endsOn: "2026-12-31", rateDeciCents: 760, irsDeciCents: 760 },
];

describe("mileage rates", () => {
  it("picks the period that covers the trip date", () => {
    expect(rateForDate(periods, "2026-01-01")?.rateDeciCents).toBe(725);
    expect(rateForDate(periods, "2026-06-30")?.rateDeciCents).toBe(725);
    expect(rateForDate(periods, "2026-07-01")?.rateDeciCents).toBe(760);
    expect(rateForDate(periods, "2026-12-31")?.rateDeciCents).toBe(760);
    expect(rateForDate(periods, "2025-12-31")).toBeNull();
    expect(rateForDate(periods, "2027-01-01")).toBeNull();
  });

  it("uses the later start when periods overlap", () => {
    const overlap: RatePeriod[] = [
      { id: "a", startsOn: "2026-01-01", endsOn: "2026-08-01", rateDeciCents: 700, irsDeciCents: 700 },
      { id: "b", startsOn: "2026-07-01", endsOn: "2026-12-31", rateDeciCents: 760, irsDeciCents: 760 },
    ];
    expect(rateForDate(overlap, "2026-07-15")?.id).toBe("b");
    expect(rateForDate(overlap, "2026-06-01")?.id).toBe("a");
  });

  it("flags inclusive overlaps and accepts the 2026 split", () => {
    expect(periodsOverlap(periods)).toBe(false);
    expect(periodsOverlap([{ startsOn: "2026-01-01", endsOn: "2026-06-30" }, { startsOn: "2026-06-30", endsOn: "2026-12-31" }])).toBe(true);
  });

  it("rounds miles times the rate to integer cents, half up", () => {
    expect(mileageCents(10_000, 725)).toBe(725);
    expect(mileageCents(1_000, 725)).toBe(73);
    expect(mileageCents(10_000, 760)).toBe(760);
    expect(mileageCents(20_000, 725)).toBe(1450);
    expect(mileageCents(8_000, 725)).toBe(580);
    expect(mileageCents(4_999, 1)).toBe(0);
    expect(mileageCents(5_000, 1)).toBe(1);
    expect(mileageCents(0, 725)).toBe(0);
  });

  it("parses miles, odometer, and a one-decimal rate", () => {
    expect(parseMilesToMilli("10")).toBe(10_000);
    expect(parseMilesToMilli("10.125")).toBe(10_125);
    expect(parseMilesToMilli("0")).toBeNull();
    expect(parseMilesToMilli("10.1234")).toBeNull();
    expect(parseReadingToMilli("0")).toBe(0);
    expect(parseReadingToMilli("100.5")).toBe(100_500);
    expect(parseRateToDeciCents("72.5")).toBe(725);
    expect(parseRateToDeciCents("76")).toBe(760);
    expect(parseRateToDeciCents("76.0")).toBe(760);
    expect(parseRateToDeciCents("72.55")).toBeNull();
    expect(milesFromOdometer(100_000, 110_000)).toEqual({ milesMilli: 10_000 });
    expect(milesFromOdometer(110_000, 100_000)).toEqual({ error: "End reading is below the start." });
    expect(formatMiles(10_125)).toBe("10.125");
    expect(formatMiles(10_000)).toBe("10");
    expect(formatRate(725)).toBe("72.5");
    expect(formatRate(760)).toBe("76");
  });

  it("counts a submitted trip only after two days", () => {
    expect(isWaitingTrip("submitted", "2026-10-10", "2026-10-15")).toBe(true);
    expect(isWaitingTrip("submitted", "2026-10-13", "2026-10-15")).toBe(false);
    expect(isWaitingTrip("approved", "2026-10-01", "2026-10-15")).toBe(false);
    expect(isWaitingTrip("submitted", null, "2026-10-15")).toBe(false);
  });
});
