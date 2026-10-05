import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  localDay,
  localDayBounds,
  localWeek,
  zonedTimeToUtc,
} from "@/lib/time/calendar";

const NY = "America/New_York";
const LA = "America/Los_Angeles";
const HOUR = 60 * 60 * 1000;

describe("company calendar", () => {
  it("keeps an 11 PM local log on that evening, including the spring-forward day", () => {
    const evening = zonedTimeToUtc(2026, 10, 5, 23, 0, 0, NY);
    expect(new Date(evening).toISOString()).toBe("2026-10-06T03:00:00.000Z");
    expect(localDay(evening, NY)).toBe("2026-10-05");
    const springEvening = zonedTimeToUtc(2026, 3, 8, 23, 0, 0, NY);
    expect(localDay(springEvening, NY)).toBe("2026-03-08");
    expect(new Date(springEvening).toISOString().slice(0, 10)).toBe("2026-03-09");
  });

  it("measures the 23-hour spring-forward day and the 25-hour fall-back day", () => {
    const spring = localDayBounds("2026-03-08", NY);
    const fall = localDayBounds("2026-11-01", NY);
    expect(spring.end - spring.start).toBe(23 * HOUR);
    expect(fall.end - fall.start).toBe(25 * HOUR);
    const gap = zonedTimeToUtc(2026, 3, 8, 2, 30, 0, NY);
    expect(new Date(gap).toISOString()).toBe("2026-03-08T07:00:00.000Z");
    const firstOneThirty = zonedTimeToUtc(2026, 11, 1, 1, 30, 0, NY);
    expect(new Date(firstOneThirty).toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("puts a Sunday-night shift in different weeks for Sunday and Monday starts", () => {
    const sundayNight = zonedTimeToUtc(2026, 10, 4, 22, 0, 0, NY);
    const mondayMorning = zonedTimeToUtc(2026, 10, 5, 8, 0, 0, NY);
    const mondayWeek = localWeek(mondayMorning, { timeZone: NY, weekStartsOn: 1 });
    const sundayWeek = localWeek(mondayMorning, { timeZone: NY, weekStartsOn: 0 });
    expect(mondayWeek.startDay).toBe("2026-10-05");
    expect(sundayWeek.startDay).toBe("2026-10-04");
    expect(sundayNight >= mondayWeek.start && sundayNight < mondayWeek.end).toBe(false);
    expect(sundayNight >= sundayWeek.start && sundayNight < sundayWeek.end).toBe(true);
    expect(localDay(sundayNight, NY)).toBe("2026-10-04");
    expect(localDay(mondayMorning, NY)).toBe("2026-10-05");
  });

  it("dates the same instant a day apart in New York, Los Angeles, and Tokyo", () => {
    const instant = Date.parse("2026-10-06T04:30:00.000Z");
    expect(localDay(instant, NY)).toBe("2026-10-06");
    expect(localDay(instant, LA)).toBe("2026-10-05");
    const noonNewYork = zonedTimeToUtc(2026, 10, 5, 12, 0, 0, NY);
    expect(localDay(noonNewYork, "Asia/Tokyo")).toBe("2026-10-06");
    expect(localDay(noonNewYork, "Pacific/Auckland")).toBe("2026-10-06");
    expect(addCalendarDays("2026-03-08", -1)).toBe("2026-03-07");
  });

  it("counts a shift that crosses local midnight on the clock-in day", () => {
    const start = zonedTimeToUtc(2026, 10, 5, 23, 0, 0, NY);
    const end = zonedTimeToUtc(2026, 10, 6, 1, 0, 0, NY);
    expect(end - start).toBe(2 * HOUR);
    expect(localDay(start, NY)).toBe("2026-10-05");
    expect(localDay(end, NY)).toBe("2026-10-06");
    const week = localWeek(start, { timeZone: NY, weekStartsOn: 1 });
    expect(start >= week.start && start < week.end).toBe(true);
    expect(localDay(start, LA)).toBe("2026-10-05");
  });
});
