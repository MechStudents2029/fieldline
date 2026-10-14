import { describe, expect, it } from "vitest";
import { localDay, localWeek } from "@/lib/time/calendar";
import type { WorkdayCalendar } from "@/lib/schedule/workdays";
import {
  DEFAULT_DAY_MINUTES,
  buildWorkload,
  capacityWarningText,
  formatHours,
  minutesByDay,
  weekColumns,
  type LoadBlock,
} from "@/lib/workload/hours";

const WEEKDAYS: WorkdayCalendar = { mask: 62, exceptions: [] };

function block(partial: Partial<LoadBlock> & Pick<LoadBlock, "key" | "startDate" | "endDate">): LoadBlock {
  return {
    personId: "dana",
    plannedMinutes: null,
    startMin: null,
    endMin: null,
    title: "Work",
    job: "Brooks",
    source: "schedule",
    href: "/schedule",
    crewId: null,
    ...partial,
  };
}

function dana(blocks: LoadBlock[], extra?: { capacityMinutes?: number | null; pto?: { day: string; minutes: number }[]; calendar?: WorkdayCalendar; weeks?: number }) {
  const weeks = weekColumns("2026-03-02", 1, extra?.weeks ?? 2);
  return buildWorkload({
    people: [{ id: "dana", name: "Dana Cho", role: "field", capacityMinutes: extra?.capacityMinutes === undefined ? null : extra.capacityMinutes, kind: "member" }],
    blocks,
    pto: (extra?.pto ?? []).map((row) => ({ personId: "dana", ...row })),
    weeks,
    companyMinutes: 40 * 60,
    calendar: extra?.calendar ?? WEEKDAYS,
  })[0]!;
}

describe("workload hours", () => {
  it("spreads hours set on an item across workdays and keeps the sum", () => {
    const days = minutesByDay(block({ key: "item:a", startDate: "2026-03-02", endDate: "2026-03-04", plannedMinutes: 100 }), WEEKDAYS);
    expect([...days.values()]).toEqual([34, 33, 33]);
    expect([...days.values()].reduce((sum, minutes) => sum + minutes, 0)).toBe(100);
  });

  it("puts a multi-day item on each week it touches and skips the weekend", () => {
    const row = dana([
      block({ key: "item:span", startDate: "2026-03-06", endDate: "2026-03-10", plannedMinutes: 24 * 60 }),
    ]);
    expect(row.cells[0]!.booked).toBe(8 * 60);
    expect(row.cells[1]!.booked).toBe(16 * 60);
    const weekend = minutesByDay(block({ key: "item:end", startDate: "2026-03-07", endDate: "2026-03-08", plannedMinutes: 16 * 60 }), WEEKDAYS);
    expect(weekend.size).toBe(0);
  });

  it("uses a clock span per workday and otherwise 8 hours", () => {
    const clock = minutesByDay(
      block({ key: "item:clock", startDate: "2026-03-02", endDate: "2026-03-03", startMin: 7 * 60 + 30, endMin: 15 * 60 + 30 }),
      WEEKDAYS,
    );
    expect([...clock.values()]).toEqual([8 * 60, 8 * 60]);
    const plain = minutesByDay(block({ key: "item:day", startDate: "2026-03-02", endDate: "2026-03-02" }), WEEKDAYS);
    expect(plain.get("2026-03-02")).toBe(DEFAULT_DAY_MINUTES);
  });

  it("drops a company day off and keeps a Saturday the company is working", () => {
    const offFriday: WorkdayCalendar = { mask: 62, exceptions: [{ kind: "off", start: "2026-03-06", end: "2026-03-06", yearly: false }] };
    const row = dana([block({ key: "item:week", startDate: "2026-03-02", endDate: "2026-03-06", plannedMinutes: 32 * 60 })], { calendar: offFriday });
    expect(row.cells[0]!.booked).toBe(32 * 60);
    expect(row.cells[0]!.items[0]!.minutes).toBe(32 * 60);
    const saturday: WorkdayCalendar = { mask: 62, exceptions: [{ kind: "work", start: "2026-03-07", end: "2026-03-07", yearly: false }] };
    const worked = minutesByDay(block({ key: "item:sat", startDate: "2026-03-07", endDate: "2026-03-07" }), saturday);
    expect(worked.get("2026-03-07")).toBe(DEFAULT_DAY_MINUTES);
  });

  it("keeps a UTC Monday on the previous company Sunday and applies PTO to that week", () => {
    const instant = Date.parse("2026-03-09T03:30:00.000Z");
    expect(localDay(instant, "America/New_York")).toBe("2026-03-08");
    expect(localDay(instant, "UTC")).toBe("2026-03-09");
    expect(localWeek(instant, { timeZone: "America/New_York", weekStartsOn: 1 }).startDay).toBe("2026-03-02");
    expect(localWeek(instant, { timeZone: "UTC", weekStartsOn: 1 }).startDay).toBe("2026-03-09");
    const row = dana([], { pto: [{ day: localDay(instant, "America/New_York"), minutes: 8 * 60 }] });
    expect(row.cells[0]!.pto).toBe(8 * 60);
    expect(row.cells[0]!.capacity).toBe(32 * 60);
    expect(row.cells[1]!.capacity).toBe(40 * 60);
    expect(row.cells[1]!.pto).toBe(0);
  });

  it("uses a per-person weekly override", () => {
    const row = dana([block({ key: "item:day", startDate: "2026-03-02", endDate: "2026-03-02" })], { capacityMinutes: 20 * 60 });
    expect(row.cells[0]!.capacity).toBe(20 * 60);
    expect(row.cells[0]!.booked).toBe(8 * 60);
    expect(row.cells[0]!.over).toBe(false);
  });

  it("does not count the same assignment twice", () => {
    const item = block({ key: "item:tile", startDate: "2026-03-02", endDate: "2026-03-02", plannedMinutes: 8 * 60 });
    const visit = block({ key: "item:tile", startDate: "2026-03-02", endDate: "2026-03-02", source: "visit", title: "Visit" });
    const again = block({ key: "item:tile", startDate: "2026-03-02", endDate: "2026-03-02", personId: "dana" });
    const row = dana([item, visit, again, block({ key: "book:1", startDate: "2026-03-03", endDate: "2026-03-03", plannedMinutes: 60, source: "booking" })]);
    expect(row.cells[0]!.booked).toBe(9 * 60);
    expect(row.cells[0]!.items.map((item) => item.key)).toEqual(["item:tile", "book:1"]);
  });

  it("warns with the resulting hours and stays quiet at capacity", () => {
    expect(capacityWarningText([{ name: "Dana Cho", booked: 48 * 60, capacity: 40 * 60 }])).toBe("Dana Cho 48h / 40h");
    expect(capacityWarningText([{ name: "Luis Ortega", booked: 40 * 60, capacity: 40 * 60 }])).toBeNull();
    expect(formatHours(90)).toBe("1.5h");
  });
});
