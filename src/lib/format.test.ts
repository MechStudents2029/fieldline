import { describe, expect, it } from "vitest";
import { formatCalendarDay, formatDate, formatDateTime } from "@/lib/format";

const iso = /\d{4}-\d{2}-\d{2}/;

describe("UI date formatters", () => {
  it("never outputs an ISO date", () => {
    const samples = ["2026-10-07", "2026-09-11", "2026-10-07T15:04:00.000Z", "not-a-date", ""];
    for (const sample of samples) {
      expect(formatDate(sample)).not.toMatch(iso);
      expect(formatDateTime(sample, "UTC")).not.toMatch(iso);
      expect(formatCalendarDay(sample)).not.toMatch(iso);
    }
    expect(formatCalendarDay("2026-10-07")).toBe("Oct 7");
    expect(formatCalendarDay("2026-09-11")).toBe("Sep 11");
    expect(formatCalendarDay("2026-10-07T15:04:00.000Z")).toBe("Oct 7");
    expect(formatDate("2026-09-11")).toBe("Sep 11");
    expect(formatDateTime("2026-10-07T15:04:00.000Z", "UTC")).toBe("Oct 7, 3:04 PM");
    expect(formatDate("nope")).toBe("—");
    expect(formatCalendarDay("nope")).toBe("—");
  });
});