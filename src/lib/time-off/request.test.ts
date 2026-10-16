import { describe, expect, it } from "vitest";
import { DEFAULT_WORKDAY_MASK, type WorkdayCalendar } from "@/lib/schedule/workdays";
import {
  allowanceRemaining,
  capacityOffMinutes,
  conflictDays,
  expandOffDays,
  outWarning,
  payrollMinutes,
} from "@/lib/time-off/request";

const holiday: WorkdayCalendar = {
  mask: DEFAULT_WORKDAY_MASK,
  exceptions: [{ kind: "off", start: "2026-11-04", end: "2026-11-04", yearly: false }],
};

describe("time off days", () => {
  it("skips weekends and a company holiday and keeps a partial day", () => {
    const full = expandOffDays("2026-11-02", "2026-11-08", 8 * 60, holiday);
    expect(full.map((row) => row.day)).toEqual(["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06"]);
    const partial = expandOffDays("2026-11-02", "2026-11-02", 4 * 60, holiday);
    expect(partial).toEqual([{ day: "2026-11-02", minutes: 4 * 60 }]);
    expect(expandOffDays("2026-11-07", "2026-11-08", 8 * 60, holiday)).toEqual([]);
    expect(expandOffDays("2026-11-04", "2026-11-04", 8 * 60, holiday)).toEqual([]);
  });

  it("counts paid hours and leaves unpaid at zero while both reduce capacity", () => {
    expect(payrollMinutes("vacation", 4 * 60)).toBe(4 * 60);
    expect(payrollMinutes("sick", 8 * 60)).toBe(8 * 60);
    expect(payrollMinutes("personal", 2 * 60)).toBe(2 * 60);
    expect(payrollMinutes("unpaid", 8 * 60)).toBe(0);
    expect(capacityOffMinutes(4 * 60)).toBe(4 * 60);
    expect(capacityOffMinutes(8 * 60)).toBe(8 * 60);
  });

  it("flags an assignment that lands on an off workday", () => {
    const off = ["2026-11-02", "2026-11-03"];
    expect(conflictDays(off, "2026-11-03", "2026-11-04")).toEqual(["2026-11-03"]);
    expect(conflictDays(off, "2026-11-04", "2026-11-04")).toEqual([]);
    expect(conflictDays([], "2026-11-04", "2026-11-04")).toEqual([]);
    expect(outWarning(["Dana Cho"])).toBe("Dana Cho is out");
    expect(outWarning(["Dana Cho", "Luis Ortega"])).toBe("Dana Cho, Luis Ortega are out");
    expect(outWarning([])).toBeNull();
  });

  it("leaves allowance off until hours are set", () => {
    expect(allowanceRemaining(null, 8 * 60)).toBeNull();
    expect(allowanceRemaining(40 * 60, 8 * 60)).toEqual({ used: 8 * 60, remaining: 32 * 60 });
    expect(allowanceRemaining(8 * 60, 16 * 60)).toEqual({ used: 16 * 60, remaining: -8 * 60 });
  });
});
