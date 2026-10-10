import { describe, expect, it } from "vitest";
import { gateDecision, inNextWorkdays, permitExpiring } from "@/lib/permits/rules";
import type { WorkdayCalendar } from "@/lib/schedule/workdays";

const holiday: WorkdayCalendar = {
  mask: 62,
  exceptions: [{ kind: "off", start: "2026-10-12", end: "2026-10-12", yearly: false }],
};

describe("inspection gates", () => {
  const previous = { startDate: "2026-10-13", status: "planned" };

  it("warns when a gated item is marked done and stays quiet when the inspection passed", () => {
    expect(
      gateDecision({
        mode: "warn",
        name: "Rough plumbing",
        scheduledOn: "2026-10-13",
        previous,
        next: { startDate: "2026-10-13", status: "done" },
      }),
    ).toEqual({ action: "warn", reason: "Rough plumbing has not passed." });
    expect(
      gateDecision({
        mode: "warn",
        name: null,
        scheduledOn: "2026-10-13",
        previous,
        next: { startDate: "2026-10-13", status: "done" },
      }).action,
    ).toBe("allow");
  });

  it("blocks a drag before the inspection and lets Off ignore it", () => {
    expect(
      gateDecision({
        mode: "block",
        name: "Rough plumbing",
        scheduledOn: "2026-10-13",
        previous,
        next: { startDate: "2026-10-12", status: "planned" },
      }).action,
    ).toBe("block");
    expect(
      gateDecision({
        mode: "off",
        name: "Rough plumbing",
        scheduledOn: "2026-10-13",
        previous,
        next: { startDate: "2026-10-12", status: "planned" },
      }).action,
    ).toBe("allow");
  });

  it("counts the next workdays and skips a holiday", () => {
    expect(inNextWorkdays("2026-10-10", "2026-10-12", holiday, 3)).toBe(false);
    expect(inNextWorkdays("2026-10-10", "2026-10-13", holiday, 3)).toBe(true);
    expect(inNextWorkdays("2026-10-10", "2026-10-15", holiday, 3)).toBe(true);
    expect(inNextWorkdays("2026-10-10", "2026-10-16", holiday, 3)).toBe(false);
    expect(permitExpiring("2026-10-10", "2026-10-31", "issued")).toBe(true);
    expect(permitExpiring("2026-10-10", "2026-12-01", "issued")).toBe(false);
    expect(permitExpiring("2026-10-10", "2026-10-20", "closed")).toBe(false);
  });
});
