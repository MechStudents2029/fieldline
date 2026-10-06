import { describe, expect, it } from "vitest";
import { zonedTimeToUtc } from "@/lib/time/calendar";
import { aggregateWeek, hoursOver40, reviewDays, type GridEntry } from "@/lib/time/grid";

function at(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  return new Date(zonedTimeToUtc(year, month, day, hour, minute, 0, timeZone)).toISOString();
}

function entry(id: string, userId: string, clockInAt: string, clockOutAt: string, status = "approved"): GridEntry {
  return { id, userId, status, clockInAt, clockOutAt, breakMinutes: 0 };
}

describe("time week grid", () => {
  it("keeps a spring-forward shift at the real elapsed hours", () => {
    const zone = "America/New_York";
    const days = reviewDays("week", "2026-03-08", 1);
    expect(days[0]).toBe("2026-03-02");
    expect(days[6]).toBe("2026-03-08");
    const grid = aggregateWeek(
      [entry("spring", "u1", at(2026, 3, 8, 1, 30, zone), at(2026, 3, 8, 4, 0, zone))],
      [{ userId: "u1", name: "Dana Cho" }],
      days,
      { timeZone: zone, weekStartsOn: 1 },
    );
    const sunday = grid.rows[0]?.days.find((day) => day.day === "2026-03-08");
    expect(sunday?.minutes).toBe(90);
    expect(grid.totalHours).toBe(1.5);
    expect(grid.overtimeHours).toBe(0);
  });

  it("counts the extra hour on the fall-back day", () => {
    const zone = "America/New_York";
    const days = reviewDays("week", "2026-11-01", 1);
    expect(days).toContain("2026-11-01");
    const grid = aggregateWeek(
      [entry("fall", "u1", "2026-11-01T05:30:00.000Z", "2026-11-01T07:30:00.000Z")],
      [{ userId: "u1", name: "Dana Cho" }],
      days,
      { timeZone: zone, weekStartsOn: 1 },
    );
    const cell = grid.rows[0]?.days.find((day) => day.day === "2026-11-01");
    expect(cell?.minutes).toBe(120);
  });

  it("puts the same instant on different local days when the company zone changes", () => {
    const instantIn = "2026-03-09T06:30:00.000Z";
    const instantOut = "2026-03-09T08:30:00.000Z";
    const people = [{ userId: "u1", name: "Dana Cho" }];
    const days = reviewDays("week", "2026-03-09", 0);
    const east = aggregateWeek([entry("z", "u1", instantIn, instantOut)], people, days, { timeZone: "America/New_York", weekStartsOn: 0 });
    const west = aggregateWeek([entry("z", "u1", instantIn, instantOut)], people, days, { timeZone: "America/Los_Angeles", weekStartsOn: 0 });
    expect(east.rows[0]?.days.find((day) => day.minutes > 0)?.day).toBe("2026-03-09");
    expect(west.rows[0]?.days.find((day) => day.minutes > 0)?.day).toBe("2026-03-08");
  });

  it("follows the company workweek start", () => {
    const zone = "America/New_York";
    const punch = entry("sun", "u1", at(2026, 3, 8, 9, 0, zone), at(2026, 3, 8, 17, 0, zone));
    const people = [{ userId: "u1", name: "Dana Cho" }];
    const mondayWeek = reviewDays("week", "2026-03-09", 1);
    const sundayWeek = reviewDays("week", "2026-03-09", 0);
    expect(mondayWeek[0]).toBe("2026-03-09");
    expect(sundayWeek[0]).toBe("2026-03-08");
    const monday = aggregateWeek([punch], people, mondayWeek, { timeZone: zone, weekStartsOn: 1 });
    const sunday = aggregateWeek([punch], people, sundayWeek, { timeZone: zone, weekStartsOn: 0 });
    expect(monday.totalHours).toBe(0);
    expect(sunday.totalHours).toBe(8);
    expect(reviewDays("period", "2026-03-09", 1)).toHaveLength(14);
    expect(reviewDays("day", "2026-03-09", 1)).toEqual(["2026-03-09"]);
  });

  it("sums hours over 40 per person per workweek and ignores a second copy", () => {
    expect(hoursOver40([45 * 60, 40 * 60, 10 * 60])).toBe(5);
    expect(hoursOver40([40 * 60])).toBe(0);
    const zone = "America/Chicago";
    const days = reviewDays("week", "2026-06-01", 1);
    const long = entry("ot", "u1", at(2026, 6, 1, 7, 0, zone), at(2026, 6, 3, 3, 0, zone));
    const exact = entry("full", "u2", at(2026, 6, 1, 7, 0, zone), at(2026, 6, 2, 23, 0, zone));
    const grid = aggregateWeek(
      [long, exact],
      [
        { userId: "u1", name: "Luis Ortega" },
        { userId: "u2", name: "Sam Patel" },
      ],
      days,
      { timeZone: zone, weekStartsOn: 1 },
    );
    expect(grid.rows.find((row) => row.userId === "u1")?.overtimeMinutes).toBe(4 * 60);
    expect(grid.rows.find((row) => row.userId === "u2")?.overtimeMinutes).toBe(0);
    expect(grid.overtimeHours).toBe(4);
    const pending = entry("p", "u1", at(2026, 6, 2, 8, 0, zone), at(2026, 6, 2, 12, 0, zone), "pending");
    const withPending = aggregateWeek([pending], [{ userId: "u1", name: "Luis Ortega" }], days, { timeZone: zone, weekStartsOn: 1 });
    expect(withPending.pendingIds).toEqual(["p"]);
    expect(withPending.rows[0]?.status).toBe("Submitted");
  });
});
