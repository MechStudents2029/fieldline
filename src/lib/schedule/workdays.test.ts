import { describe, expect, it } from "vitest";
import { addWorkdays, dateFromOffset, endFromDuration, inclusiveWorkdays, workdayOffset } from "@/lib/schedule/workdays";

const WEEKDAYS = 62;
const WITH_SATURDAY = 62 | 64;

describe("workday offsets", () => {
  it("counts Monday through Friday and skips the weekend", () => {
    expect(dateFromOffset("2026-10-05", 0, WEEKDAYS)).toBe("2026-10-05");
    expect(dateFromOffset("2026-10-05", 1, WEEKDAYS)).toBe("2026-10-06");
    expect(dateFromOffset("2026-10-05", 5, WEEKDAYS)).toBe("2026-10-12");
    expect(workdayOffset("2026-10-05", "2026-10-12", WEEKDAYS)).toBe(5);
    expect(workdayOffset("2026-10-09", "2026-10-12", WEEKDAYS)).toBe(1);
    expect(addWorkdays("2026-10-09", 1, WEEKDAYS)).toBe("2026-10-12");
  });

  it("snaps a weekend anchor forward onto the next workday", () => {
    expect(dateFromOffset("2026-10-10", 0, WEEKDAYS)).toBe("2026-10-12");
    expect(endFromDuration("2026-10-10", 2, WEEKDAYS)).toBe("2026-10-13");
    expect(inclusiveWorkdays("2026-10-09", "2026-10-13", WEEKDAYS)).toBe(3);
    expect(inclusiveWorkdays("2026-10-10", "2026-10-11", WEEKDAYS)).toBe(0);
  });

  it("keeps Saturday when the company works that day", () => {
    expect(dateFromOffset("2026-10-10", 0, WITH_SATURDAY)).toBe("2026-10-10");
    expect(addWorkdays("2026-10-09", 1, WITH_SATURDAY)).toBe("2026-10-10");
    expect(workdayOffset("2026-10-09", "2026-10-12", WITH_SATURDAY)).toBe(2);
  });

  it("skips a holiday and honors an extra workday", () => {
    const holiday = {
      mask: WEEKDAYS,
      exceptions: [{ kind: "off" as const, start: "2026-10-12", end: "2026-10-12", yearly: false }],
    };
    expect(addWorkdays("2026-10-09", 1, holiday)).toBe("2026-10-13");
    expect(inclusiveWorkdays("2026-10-09", "2026-10-13", holiday)).toBe(2);
    const saturday = {
      mask: WEEKDAYS,
      exceptions: [{ kind: "work" as const, start: "2026-10-10", end: "2026-10-10", yearly: false }],
    };
    expect(addWorkdays("2026-10-09", 1, saturday)).toBe("2026-10-10");
    const yearly = {
      mask: WEEKDAYS,
      exceptions: [{ kind: "off" as const, start: "2026-07-04", end: "2026-07-04", yearly: true }],
    };
    expect(addWorkdays("2028-07-03", 1, yearly)).toBe("2028-07-05");
    const override = {
      mask: WEEKDAYS,
      exceptions: [
        { kind: "off" as const, start: "2026-10-12", end: "2026-10-12", yearly: false },
        { kind: "work" as const, start: "2026-10-12", end: "2026-10-12", yearly: false },
      ],
    };
    expect(addWorkdays("2026-10-09", 1, override)).toBe("2026-10-12");
  });
});
