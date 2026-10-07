import { describe, expect, it } from "vitest";
import { cascadeShift, hasCycle, movesLabel } from "@/lib/schedule/deps";

const WEEKDAYS = 62;

describe("schedule dependencies", () => {
  const nodes = [
    { id: "a", start: "2026-10-05", end: "2026-10-06" },
    { id: "b", start: "2026-10-07", end: "2026-10-08" },
    { id: "c", start: "2026-10-09", end: "2026-10-09" },
  ];
  const edges = [
    { itemId: "b", predecessorId: "a", lag: 0 },
    { itemId: "c", predecessorId: "b", lag: 0 },
  ];

  it("shifts dependents when a finish moves, and keeps workday length", () => {
    const shifts = cascadeShift(nodes, edges, "a", "2026-10-05", "2026-10-08", WEEKDAYS);
    expect(movesLabel(shifts.length)).toBe("Moves 3 items");
    expect(shifts).toEqual([
      { id: "a", start: "2026-10-05", end: "2026-10-08" },
      { id: "b", start: "2026-10-09", end: "2026-10-12" },
      { id: "c", start: "2026-10-13", end: "2026-10-13" },
    ]);
  });

  it("honors lag and the later of two predecessors", () => {
    const withLag = cascadeShift(nodes, [{ itemId: "b", predecessorId: "a", lag: 1 }], "a", "2026-10-05", "2026-10-06", WEEKDAYS);
    expect(withLag.find((shift) => shift.id === "b")).toEqual({ id: "b", start: "2026-10-08", end: "2026-10-09" });
    const both = [
      { id: "a", start: "2026-10-05", end: "2026-10-06" },
      { id: "d", start: "2026-10-05", end: "2026-10-07" },
      { id: "b", start: "2026-10-08", end: "2026-10-08" },
    ];
    const shifts = cascadeShift(
      both,
      [
        { itemId: "b", predecessorId: "a", lag: 0 },
        { itemId: "b", predecessorId: "d", lag: 0 },
      ],
      "a",
      "2026-10-05",
      "2026-10-05",
      WEEKDAYS,
    );
    expect(shifts.find((shift) => shift.id === "b")).toBeUndefined();
  });

  it("refuses a cycle", () => {
    expect(hasCycle([...edges, { itemId: "a", predecessorId: "c", lag: 0 }])).toBe(true);
    expect(hasCycle([{ itemId: "a", predecessorId: "a", lag: 0 }])).toBe(true);
    expect(() => cascadeShift(nodes, [...edges, { itemId: "a", predecessorId: "c", lag: 0 }], "a", "2026-10-06", "2026-10-06", WEEKDAYS)).toThrow(/cycle/);
  });
});
