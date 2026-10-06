import { describe, expect, it } from "vitest";
import { inclusiveDays, scheduleWindow, shiftSpan } from "@/lib/schedule/range";

const HOUR = 60 * 60 * 1000;
const calendar = { timeZone: "America/New_York", weekStartsOn: 1 };

describe("schedule week range", () => {
  it("keeps calendar days across the spring-forward week", () => {
    const window = scheduleWindow(Date.parse("2026-03-04T15:00:00Z"), calendar, 7);
    expect(window.startDay).toBe("2026-03-02");
    expect(window.days).toEqual(["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08"]);
    expect(window.end - window.start).toBe(167 * HOUR);
  });

  it("keeps calendar days across the fall-back week", () => {
    const window = scheduleWindow(Date.parse("2026-10-28T15:00:00Z"), calendar, 7);
    expect(window.days[0]).toBe("2026-10-26");
    expect(window.days[6]).toBe("2026-11-01");
    expect(window.end - window.start).toBe(169 * HOUR);
  });

  it("spans fourteen company days from the workweek start", () => {
    const window = scheduleWindow(Date.parse("2026-10-06T15:00:00Z"), calendar, 14);
    expect(window.days).toHaveLength(14);
    expect(window.startDay).toBe("2026-10-05");
    expect(window.endDay).toBe("2026-10-18");
  });

  it("shifts a multi-day span onto a new start", () => {
    expect(inclusiveDays("2026-10-05", "2026-10-07")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(shiftSpan("2026-10-05", "2026-10-07", "2026-10-12")).toEqual({ startDate: "2026-10-12", endDate: "2026-10-14" });
  });
});
