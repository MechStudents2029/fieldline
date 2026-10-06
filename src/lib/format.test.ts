import { describe, expect, it } from "vitest";
import { formatCalendarDay, formatDate, formatDateTime, formatWarrantyDay } from "@/lib/format";

const iso = /\d{4}-\d{2}-\d{2}/;

describe("UI date formatters", () => {
  it("never outputs an ISO date", () => {
    const samples = ["2026-10-07", "2026-09-11", "2026-10-07T15:04:00.000Z", "not-a-date", ""];
    for (const sample of samples) {
      expect(formatDate(sample)).not.toMatch(iso);
      expect(formatDateTime(sample, "UTC")).not.toMatch(iso);
      expect(formatCalendarDay(sample)).not.toMatch(iso);
      expect(formatWarrantyDay(sample)).not.toMatch(iso);
    }
    expect(formatCalendarDay("2026-10-07")).toBe("Oct 7");
    expect(formatWarrantyDay("2026-10-07")).toBe("Oct 7, 2026");
    expect(formatWarrantyDay("2027-10-02")).toBe("Oct 2, 2027");
    expect(formatWarrantyDay("nope")).toBe("—");
    expect(formatCalendarDay("2026-09-11")).toBe("Sep 11");
    expect(formatCalendarDay("2026-10-07T15:04:00.000Z")).toBe("Oct 7");
    expect(formatDate("2026-09-11")).toBe("Sep 11");
    expect(formatDateTime("2026-10-07T15:04:00.000Z", "UTC")).toBe("Oct 7, 3:04 PM");
    expect(formatDate("nope")).toBe("—");
    expect(formatCalendarDay("nope")).toBe("—");
  });
});