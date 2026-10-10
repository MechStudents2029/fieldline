import { describe, expect, it } from "vitest";
import { localDay, localDayBounds } from "@/lib/time/calendar";
import { daysInRange, defaultRange, inRange, nextWeekRange } from "@/lib/updates/range";

describe("client update ranges", () => {
  it("keeps seven local days across the spring-forward", () => {
    const zone = "America/New_York";
    const now = Date.parse("2026-03-08T15:00:00Z");
    const range = defaultRange(now, zone);
    expect(range).toEqual({ start: "2026-03-02", end: "2026-03-08" });
    expect(daysInRange(range.start, range.end)).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
    ]);
    const bounds = localDayBounds("2026-03-08", zone);
    expect(bounds.end - bounds.start).toBe(23 * 60 * 60 * 1000);
    expect(inRange(localDay(Date.parse("2026-03-08T07:30:00Z"), zone), range.start, range.end)).toBe(true);
    expect(localDay(Date.parse("2026-03-08T04:30:00Z"), zone)).toBe("2026-03-07");
    expect(inRange("2026-03-07", range.start, range.end)).toBe(true);
    expect(nextWeekRange(range.end)).toEqual({ start: "2026-03-09", end: "2026-03-15" });
  });

  it("keeps the fall-back day inside a seven-day window", () => {
    const zone = "America/New_York";
    const bounds = localDayBounds("2026-11-01", zone);
    expect(bounds.end - bounds.start).toBe(25 * 60 * 60 * 1000);
    const range = defaultRange(Date.parse("2026-11-01T18:00:00Z"), zone);
    expect(range).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(new Set(daysInRange(range.start, range.end)).size).toBe(7);
    expect(localDay(Date.parse("2026-11-01T05:30:00Z"), zone)).toBe("2026-11-01");
    expect(localDay(Date.parse("2026-11-01T06:30:00Z"), zone)).toBe("2026-11-01");
    expect(localDay(Date.parse("2026-11-01T03:30:00Z"), zone)).toBe("2026-10-31");
  });
});
