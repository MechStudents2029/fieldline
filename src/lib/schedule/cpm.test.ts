import { describe, expect, it } from "vitest";
import { criticalPath } from "@/lib/schedule/cpm";

const WEEKDAYS = 62;

describe("critical path", () => {
  it("keeps the longer lagged path critical and gives the short path float", () => {
    const result = criticalPath(
      [
        { id: "a", start: "2026-10-05", end: "2026-10-06" },
        { id: "b", start: "2026-10-05", end: "2026-10-05" },
        { id: "c", start: "2026-10-08", end: "2026-10-08" },
      ],
      [
        { itemId: "c", predecessorId: "a", lag: 0 },
        { itemId: "c", predecessorId: "b", lag: 2 },
      ],
      WEEKDAYS,
    );
    const byId = new Map(result.items.map((item) => [item.id, item]));
    expect(result.finish).toBe("2026-10-08");
    expect(byId.get("b")).toMatchObject({ float: 0, critical: true });
    expect(byId.get("c")).toMatchObject({ float: 0, critical: true });
    expect(byId.get("a")?.critical).toBe(false);
    expect(byId.get("a")?.float).toBeGreaterThan(0);
  });

  it("does not count a weekend as float", () => {
    const result = criticalPath(
      [
        { id: "a", start: "2026-10-09", end: "2026-10-09" },
        { id: "b", start: "2026-10-12", end: "2026-10-12" },
      ],
      [],
      WEEKDAYS,
    );
    const byId = new Map(result.items.map((item) => [item.id, item]));
    expect(byId.get("b")).toMatchObject({ float: 0, critical: true });
    expect(byId.get("a")).toMatchObject({ float: 1, critical: false });
  });

  it("treats a tight lag across a weekend as zero float", () => {
    const result = criticalPath(
      [
        { id: "a", start: "2026-10-09", end: "2026-10-09" },
        { id: "b", start: "2026-10-14", end: "2026-10-14" },
      ],
      [{ itemId: "b", predecessorId: "a", lag: 2 }],
      WEEKDAYS,
    );
    expect(result.items.every((item) => item.critical && item.float === 0)).toBe(true);
  });

  it("marks a lone item critical and gives an earlier independent item float", () => {
    const alone = criticalPath([{ id: "a", start: "2026-10-05", end: "2026-10-07" }], [], WEEKDAYS);
    expect(alone.items[0]).toMatchObject({ float: 0, critical: true });
    const pair = criticalPath(
      [
        { id: "early", start: "2026-10-05", end: "2026-10-05" },
        { id: "late", start: "2026-10-07", end: "2026-10-07" },
      ],
      [],
      WEEKDAYS,
    );
    const byId = new Map(pair.items.map((item) => [item.id, item]));
    expect(byId.get("late")).toMatchObject({ float: 0, critical: true });
    expect(byId.get("early")).toMatchObject({ float: 2, critical: false });
  });

  it("skips a non-workday that the calendar marks off", () => {
    const calendar = { mask: WEEKDAYS, exceptions: [{ kind: "off" as const, start: "2026-10-06", end: "2026-10-06", yearly: false }] };
    const result = criticalPath(
      [
        { id: "a", start: "2026-10-05", end: "2026-10-05" },
        { id: "b", start: "2026-10-07", end: "2026-10-07" },
      ],
      [],
      calendar,
    );
    const early = result.items.find((item) => item.id === "a");
    expect(early?.float).toBe(1);
    expect(early?.critical).toBe(false);
  });

  it("refuses a cycle", () => {
    expect(() =>
      criticalPath(
        [
          { id: "a", start: "2026-10-05", end: "2026-10-05" },
          { id: "b", start: "2026-10-06", end: "2026-10-06" },
        ],
        [
          { itemId: "b", predecessorId: "a", lag: 0 },
          { itemId: "a", predecessorId: "b", lag: 0 },
        ],
        WEEKDAYS,
      ),
    ).toThrow(/cycle/);
  });
});
