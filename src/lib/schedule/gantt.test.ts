import { describe, expect, it } from "vitest";
import { cascadeShift, movesLabel } from "@/lib/schedule/deps";
import { moveBar, resizeBar } from "@/lib/schedule/gantt";

const WEEKDAYS = 62;
const nodes = [
  { id: "a", start: "2026-10-05", end: "2026-10-06" },
  { id: "b", start: "2026-10-07", end: "2026-10-08" },
  { id: "c", start: "2026-10-09", end: "2026-10-09" },
];
const edges = [
  { itemId: "b", predecessorId: "a", lag: 0 },
  { itemId: "c", predecessorId: "b", lag: 0 },
];

describe("gantt drag", () => {
  it("moves a bar by whole days and cascades successors", () => {
    const moved = moveBar("2026-10-05", "2026-10-06", 2);
    expect(moved).toEqual({ startDate: "2026-10-07", endDate: "2026-10-08" });
    const shifts = cascadeShift(nodes, edges, "a", moved.startDate, moved.endDate, WEEKDAYS);
    expect(movesLabel(shifts.length)).toBe("Moves 3 items");
    expect(shifts.find((shift) => shift.id === "b")?.start).toBe("2026-10-09");
  });

  it("resizes the finish and pulls the next start", () => {
    const resized = resizeBar("2026-10-05", "2026-10-06", 2);
    expect(resized).toEqual({ startDate: "2026-10-05", endDate: "2026-10-08" });
    const shifts = cascadeShift(nodes, edges, "a", resized.startDate, resized.endDate, WEEKDAYS);
    expect(shifts.find((shift) => shift.id === "b")).toEqual({ id: "b", start: "2026-10-09", end: "2026-10-12" });
    expect(movesLabel(shifts.length)).toBe("Moves 3 items");
  });

  it("leaves the bar where it is when the drag is zero", () => {
    expect(moveBar("2026-10-05", "2026-10-06", 0)).toEqual({ startDate: "2026-10-05", endDate: "2026-10-06" });
    expect(resizeBar("2026-10-05", "2026-10-06", 0)).toEqual({ startDate: "2026-10-05", endDate: "2026-10-06" });
  });

  it("will not resize a bar earlier than its start", () => {
    expect(resizeBar("2026-10-05", "2026-10-06", -5)).toEqual({ startDate: "2026-10-05", endDate: "2026-10-05" });
  });
});
