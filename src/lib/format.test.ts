import { describe, expect, it } from "vitest";
import { formatCalendarDay, formatDate, formatDateTime, formatWarrantyDay, formatWhen } from "@/lib/format";

const iso = /\d{4}-\d{2}-\d{2}/;
const now = new Date("2026-10-08T15:00:00.000Z");

describe("UI date formatters", () => {
  it("shows this year without a year, another year with one, and a clock time", () => {
    expect(formatWhen("2026-10-07", { now })).toBe("Oct 7");
    expect(formatWhen("2025-10-07", { now })).toBe("Oct 7, 2025");
    expect(formatWhen("2027-10-02", { now })).toBe("Oct 2, 2027");
    expect(formatWhen("2026-10-07T14:30:00.000Z", { now, timeZone: "UTC", withTime: true })).toBe("Oct 7, 2:30 PM");
    expect(formatWhen("2025-10-07T14:30:00.000Z", { now, timeZone: "UTC", withTime: true })).toBe("Oct 7, 2025, 2:30 PM");
    expect(formatWhen("", { now })).toBe("—");
    expect(formatWhen("nope", { now })).toBe("—");
  });

  it("never outputs an ISO date", () => {
    const samples = ["2026-10-07", "2026-09-11", "2025-10-07", "2026-10-07T15:04:00.000Z", "not-a-date", ""];
    for (const sample of samples) {
      expect(formatDate(sample, now)).not.toMatch(iso);
      expect(formatDateTime(sample, "UTC", now)).not.toMatch(iso);
      expect(formatCalendarDay(sample, now)).not.toMatch(iso);
      expect(formatWarrantyDay(sample, now)).not.toMatch(iso);
      expect(formatWhen(sample, { now, timeZone: "UTC", withTime: true })).not.toMatch(iso);
    }
    expect(formatCalendarDay("2026-10-07", now)).toBe("Oct 7");
    expect(formatWarrantyDay("2026-10-07", now)).toBe("Oct 7");
    expect(formatWarrantyDay("2027-10-02", now)).toBe("Oct 2, 2027");
    expect(formatWarrantyDay("2025-03-01", now)).toBe("Mar 1, 2025");
    expect(formatWarrantyDay("nope", now)).toBe("—");
    expect(formatCalendarDay("2026-09-11", now)).toBe("Sep 11");
    expect(formatCalendarDay("2026-10-07T15:04:00.000Z", now)).toBe("Oct 7");
    expect(formatDate("2026-09-11", now)).toBe("Sep 11");
    expect(formatDate("2025-09-11", now)).toBe("Sep 11, 2025");
    expect(formatDateTime("2026-10-07T15:04:00.000Z", "UTC", now)).toBe("Oct 7, 3:04 PM");
    expect(formatDate("nope", now)).toBe("—");
    expect(formatCalendarDay("nope", now)).toBe("—");
  });
});
