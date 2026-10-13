import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  daysBetween,
  lineAmountCents,
  monthlyNormalizedCents,
  periodDates,
  renewalRateBps,
  sellUnitCents,
  termEnd,
  visitDates,
  displayStatus,
} from "@/lib/agreements/cadence";

describe("agreement cadence", () => {
  it("adds days in UTC so a DST boundary stays on the calendar date", () => {
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(daysBetween("2026-03-08", "2026-03-09")).toBe(1);
  });

  it("clamps month-end and keeps the anchor day on later months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
  });

  it("lists weekly, every-n-weeks, and monthly visits inside the term and horizon", () => {
    expect(
      visitDates(
        { startOn: "2026-01-05", termKind: "visits", visitLimit: 4, cadence: "weekly" },
        "2026-12-31",
      ),
    ).toEqual(["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"]);
    expect(
      visitDates(
        { startOn: "2026-01-05", termKind: "until_cancelled", cadence: "weeks", intervalWeeks: 2 },
        "2026-02-02",
      ),
    ).toEqual(["2026-01-05", "2026-01-19", "2026-02-02"]);
    expect(
      visitDates(
        { startOn: "2026-01-31", termKind: "months", termMonths: 4, cadence: "monthly" },
        "2027-01-01",
      ),
    ).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(termEnd({ startOn: "2026-01-15", termKind: "months", termMonths: 12 })).toBe("2027-01-14");
  });

  it("keeps custom dates, drops as-needed, and stops at a horizon", () => {
    expect(
      visitDates(
        {
          startOn: "2026-01-01",
          termKind: "until_cancelled",
          cadence: "custom",
          customDates: ["2026-06-01", "2026-01-01", "2025-12-01", "2026-06-01"],
        },
        "2026-05-01",
      ),
    ).toEqual(["2026-01-01"]);
    expect(visitDates({ startOn: "2026-01-01", termKind: "until_cancelled", cadence: "as_needed" }, "2026-06-01")).toEqual([]);
    expect(
      visitDates({ startOn: "2026-01-01", termKind: "until_cancelled", cadence: "weekly" }, "2026-01-10"),
    ).toEqual(["2026-01-01", "2026-01-08"]);
  });

  it("bills each period once up to today and normalizes a year to a month", () => {
    expect(periodDates("2026-01-31", "monthly", "2026-04-15", null)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(periodDates("2026-01-01", "quarterly", "2026-10-01", "2026-07-01")).toEqual(["2026-01-01", "2026-04-01", "2026-07-01"]);
    expect(periodDates("2026-01-01", "per_visit", "2026-06-01", null)).toEqual([]);
    const visit = lineAmountCents(sellUnitCents(7800, 3500), 1000);
    expect(visit).toBe(10530);
    expect(
      monthlyNormalizedCents({
        billing: "per_visit",
        fixedCents: 0,
        visitCents: 12_000,
        cadence: "monthly",
        intervalWeeks: 1,
        customPerYear: 0,
      }),
    ).toBe(12_000);
    expect(
      monthlyNormalizedCents({
        billing: "quarterly",
        fixedCents: 45_000,
        visitCents: 0,
        cadence: "quarterly",
        intervalWeeks: 1,
        customPerYear: 0,
      }),
    ).toBe(15_000);
    expect(
      monthlyNormalizedCents({
        billing: "per_visit",
        fixedCents: 0,
        visitCents: 10_000,
        cadence: "as_needed",
        intervalWeeks: 1,
        customPerYear: 0,
      }),
    ).toBe(0);
  });

  it("marks expiring within 30 days and rates renewals", () => {
    expect(displayStatus("active", "2026-02-10", "2026-01-20")).toBe("expiring");
    expect(displayStatus("active", "2026-06-01", "2026-01-20")).toBe("active");
    expect(displayStatus("active", "2026-01-01", "2026-01-20")).toBe("expired");
    expect(displayStatus("pending_renewal", "2026-01-25", "2026-01-20")).toBe("pending_renewal");
    expect(renewalRateBps({ renewed: 1, expired: 1 })).toBe(5000);
    expect(renewalRateBps({ renewed: 0, expired: 0 })).toBeNull();
  });
});
