import { describe, expect, it } from "vitest";
import { workedMinutes } from "@/lib/services/time";
import { localDay, zonedTimeToUtc } from "@/lib/time/calendar";
import {
  OT_DEFAULTS,
  burdenCents,
  laborMoney,
  premiumCents,
  projectedWeeklyOt,
  splitWeek,
  type OtRules,
  type SplitPunch,
} from "@/lib/time/overtime";

const ZONE = "America/New_York";

function rules(partial: Partial<OtRules> = {}): OtRules {
  return { ...OT_DEFAULTS, enabled: true, weeklyOtMinutes: 40 * 60, ...partial };
}

function punch(id: string, localDay: string, minutes: number, shiftType: SplitPunch["shiftType"] = "regular", frozen?: SplitPunch["frozen"]): SplitPunch {
  return { id, localDay, minutes, shiftType, frozen };
}

describe("overtime split", () => {
  it("keeps overtime off as straight time and applies burden only in the money step", () => {
    const split = splitWeek([punch("a", "2026-03-02", 12 * 60)], rules({ enabled: false, otDaysMask: 1 }));
    expect(split[0]).toMatchObject({ regularMinutes: 12 * 60, otMinutes: 0, dtMinutes: 0, nonjobMinutes: 0 });
    expect(laborMoney(split[0]!, 4500, rules({ enabled: false, burdenBps: 1000 }))).toEqual({
      baseCents: 54_000,
      premiumCents: 0,
      burdenCents: 5_400,
      totalCents: 59_400,
    });
  });

  it("uses overtime days, then daily double time, then daily overtime, then weekly, without double counting", () => {
    const sunday = splitWeek([punch("sun", "2026-03-08", 14 * 60)], rules({ otDaysMask: 1, dailyDtMinutes: 12 * 60, dailyOtMinutes: 8 * 60 }));
    expect(sunday[0]).toMatchObject({ regularMinutes: 0, otMinutes: 12 * 60, dtMinutes: 2 * 60, nonjobMinutes: 0 });

    const daily = splitWeek(
      [punch("mon", "2026-03-09", 10 * 60), punch("tue", "2026-03-10", 10 * 60)],
      rules({ dailyOtMinutes: 8 * 60, dailyDtMinutes: 12 * 60 }),
    );
    expect(daily[0]).toMatchObject({ regularMinutes: 8 * 60, otMinutes: 2 * 60, dtMinutes: 0 });
    expect(daily[1]).toMatchObject({ regularMinutes: 8 * 60, otMinutes: 2 * 60, dtMinutes: 0 });
    for (const row of [...sunday, ...daily]) {
      expect(row.regularMinutes + row.otMinutes + row.dtMinutes + row.nonjobMinutes).toBe(
        row.id === "sun" ? 14 * 60 : 10 * 60,
      );
    }

    const weekly = splitWeek(
      [
        punch("d1", "2026-03-09", 8 * 60),
        punch("d2", "2026-03-10", 8 * 60),
        punch("d3", "2026-03-11", 8 * 60),
        punch("d4", "2026-03-12", 8 * 60),
        punch("d5", "2026-03-13", 10 * 60),
      ],
      rules({ dailyOtMinutes: null }),
    );
    expect(weekly.slice(0, 4).every((row) => row.otMinutes === 0 && row.regularMinutes === 8 * 60)).toBe(true);
    expect(weekly[4]).toMatchObject({ regularMinutes: 8 * 60, otMinutes: 2 * 60, dtMinutes: 0 });
  });

  it("lets daily overtime consume the weekly bucket so later minutes are not classified twice", () => {
    const days = ["2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13"];
    const split = splitWeek(
      days.map((day, index) => punch(`d${index}`, day, 10 * 60)),
      rules({ dailyOtMinutes: 8 * 60 }),
    );
    expect(split.slice(0, 4).every((row) => row.regularMinutes === 8 * 60 && row.otMinutes === 2 * 60)).toBe(true);
    expect(split[4]).toMatchObject({ regularMinutes: 0, otMinutes: 10 * 60, dtMinutes: 0 });
    const job = split.reduce((sum, row) => sum + row.regularMinutes + row.otMinutes + row.dtMinutes, 0);
    expect(job).toBe(50 * 60);
  });

  it("keeps non-job time out of the thresholds unless the setting is on, and never labels it overtime", () => {
    const off = splitWeek(
      [punch("pto", "2026-03-09", 8 * 60, "pto"), punch("job", "2026-03-09", 8 * 60)],
      rules({ dailyOtMinutes: 8 * 60, nonjobCountsTowardOt: false }),
    );
    expect(off[0]).toMatchObject({ nonjobMinutes: 8 * 60, regularMinutes: 0, otMinutes: 0 });
    expect(off[1]).toMatchObject({ regularMinutes: 8 * 60, otMinutes: 0 });

    const on = splitWeek(
      [punch("pto", "2026-03-09", 8 * 60, "sick"), punch("job", "2026-03-09", 2 * 60)],
      rules({ dailyOtMinutes: 8 * 60, nonjobCountsTowardOt: true }),
    );
    expect(on[0]?.nonjobMinutes).toBe(8 * 60);
    expect(on[1]).toMatchObject({ regularMinutes: 0, otMinutes: 2 * 60 });
  });

  it("counts a midnight-crossing shift on the clock-in day, including a Sunday overtime day", () => {
    const start = zonedTimeToUtc(2026, 3, 8, 22, 0, 0, ZONE);
    const end = zonedTimeToUtc(2026, 3, 9, 6, 0, 0, ZONE);
    const day = localDay(start, ZONE);
    expect(day).toBe("2026-03-08");
    expect(localDay(end, ZONE)).toBe("2026-03-09");
    const minutes = workedMinutes(
      { clockInAt: new Date(start).toISOString(), clockOutAt: new Date(end).toISOString(), breakMinutes: 0, status: "pending", breakStartedAt: null },
      end,
    );
    expect(minutes).toBe(8 * 60);
    const split = splitWeek([punch("night", day, minutes)], rules({ otDaysMask: 1 }));
    expect(split[0]).toMatchObject({ regularMinutes: 0, otMinutes: 8 * 60, dtMinutes: 0 });
  });

  it("uses elapsed minutes across a DST week, not a wall-clock slot", () => {
    const springIn = zonedTimeToUtc(2026, 3, 8, 1, 30, 0, ZONE);
    const springOut = zonedTimeToUtc(2026, 3, 8, 4, 0, 0, ZONE);
    const spring = workedMinutes(
      { clockInAt: new Date(springIn).toISOString(), clockOutAt: new Date(springOut).toISOString(), breakMinutes: 0, status: "pending", breakStartedAt: null },
      springOut,
    );
    expect(spring).toBe(90);
    const fallIn = zonedTimeToUtc(2026, 11, 1, 0, 30, 0, ZONE);
    const fallOut = zonedTimeToUtc(2026, 11, 1, 3, 0, 0, ZONE);
    const fall = workedMinutes(
      { clockInAt: new Date(fallIn).toISOString(), clockOutAt: new Date(fallOut).toISOString(), breakMinutes: 0, status: "pending", breakStartedAt: null },
      fallOut,
    );
    expect(fall).toBe(210);
    expect(fall).not.toBe((3 * 60 + 0) - 30);
    const week = splitWeek(
      [
        punch("spring", localDay(springIn, ZONE), spring),
        punch("fall", localDay(fallIn, ZONE), fall),
      ],
      rules({ dailyOtMinutes: 8 * 60 }),
    );
    expect(week[0]).toMatchObject({ regularMinutes: 90, otMinutes: 0 });
    expect(week[1]).toMatchObject({ regularMinutes: 210, otMinutes: 0 });
  });

  it("switches jobs mid-day on one daily bucket and drops break minutes before the split", () => {
    const start = zonedTimeToUtc(2026, 3, 9, 7, 0, 0, ZONE);
    const end = zonedTimeToUtc(2026, 3, 9, 15, 30, 0, ZONE);
    const net = workedMinutes(
      { clockInAt: new Date(start).toISOString(), clockOutAt: new Date(end).toISOString(), breakMinutes: 30, status: "pending", breakStartedAt: null },
      end,
    );
    expect(net).toBe(8 * 60);
    const day = localDay(start, ZONE);
    const split = splitWeek([punch("tile", day, 6 * 60), punch("plumb", day, 4 * 60)], rules({ dailyOtMinutes: 8 * 60 }));
    expect(split[0]).toMatchObject({ regularMinutes: 6 * 60, otMinutes: 0 });
    expect(split[1]).toMatchObject({ regularMinutes: 2 * 60, otMinutes: 2 * 60 });
    expect(net).toBe(8 * 60);
  });

  it("moves the weekly premium onto the edited punch and leaves an invoiced punch frozen", () => {
    const days = ["2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13", "2026-03-14"];
    const original = days.map((day, index) => punch(`d${index}`, day, index === 5 ? 2 * 60 : 8 * 60));
    const first = splitWeek(original, rules({ dailyOtMinutes: null }));
    expect(first[5]).toMatchObject({ regularMinutes: 0, otMinutes: 2 * 60 });
    const edited = splitWeek(
      original.map((row) => (row.id === "d5" ? { ...row, minutes: 30 } : row)),
      rules({ dailyOtMinutes: null }),
    );
    expect(edited[5]).toMatchObject({ regularMinutes: 0, otMinutes: 30 });
    expect(edited[4]?.otMinutes).toBe(0);

    const frozenSaturday = {
      ...original[5]!,
      frozen: { regularMinutes: 2 * 60, otMinutes: 0, dtMinutes: 0, nonjobMinutes: 0 },
    };
    const locked = splitWeek([...original.slice(0, 5), frozenSaturday], rules({ dailyOtMinutes: null }));
    expect(locked[5]).toMatchObject({ regularMinutes: 2 * 60, otMinutes: 0 });
    expect(locked[4]).toMatchObject({ regularMinutes: 8 * 60, otMinutes: 0 });
  });

  it("prices premium and burden in integer cents", () => {
    expect(premiumCents(120, 5200, 15_000)).toBe(5_200);
    expect(premiumCents(60, 4500, 20_000)).toBe(4_500);
    expect(burdenCents(15_600, 1_500)).toBe(2_340);
    const money = laborMoney(
      { id: "x", regularMinutes: 0, otMinutes: 120, dtMinutes: 60, nonjobMinutes: 0 },
      4500,
      rules({ otMultiplierBps: 15_000, dtMultiplierBps: 20_000, burdenBps: 1_000 }),
    );
    expect(money.baseCents).toBe(13_500);
    expect(money.premiumCents).toBe(4_500 + 4_500);
    expect(money.burdenCents).toBe(Math.round((13_500 + 9_000) * 0.1));
    expect(money.totalCents).toBe(money.baseCents + money.premiumCents + money.burdenCents);
    expect(premiumCents(10, 100, 10_000)).toBe(0);
  });

  it("projects a weekly crossing only inside the next two workdays of this week", () => {
    const on = rules({ weeklyOtMinutes: 40 * 60 });
    const hit = projectedWeeklyOt(on, "2026-03-11", "2026-03-09", 62, [
      { userId: "dana", name: "Dana Cho", countedMinutes: 32 * 60, assignmentDays: ["2026-03-11", "2026-03-12"] },
      { userId: "luis", name: "Luis Ortega", countedMinutes: 40 * 60, assignmentDays: ["2026-03-11"] },
      { userId: "sam", name: "Sam Patel", countedMinutes: 10 * 60, assignmentDays: ["2026-03-16"] },
    ]);
    expect(hit.map((row) => row.userId)).toEqual(["dana"]);
    expect(hit[0]?.projectedMinutes).toBe(48 * 60);
    expect(projectedWeeklyOt(on, "2026-03-15", "2026-03-09", 62, [{ userId: "dana", name: "Dana Cho", countedMinutes: 36 * 60, assignmentDays: ["2026-03-16"] }])).toEqual([]);
    expect(projectedWeeklyOt({ ...on, enabled: false }, "2026-03-11", "2026-03-09", 62, hit.map((row) => ({ ...row, assignmentDays: ["2026-03-11"] })))).toEqual([]);
  });
});
