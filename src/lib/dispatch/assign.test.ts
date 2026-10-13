import { describe, expect, it } from "vitest";
import { formatClock, lookbackStart, minuteFromRatio, overlappingIds, parseClock, planAssign, snapMinute, windowOf, type DispatchCard } from "@/lib/dispatch/assign";

function card(partial: Partial<DispatchCard> & Pick<DispatchCard, "id">): DispatchCard {
  return {
    source: partial.source ?? partial.id,
    assigneeId: partial.assigneeId ?? null,
    startMin: partial.startMin ?? null,
    endMin: partial.endMin ?? null,
    id: partial.id,
  };
}

describe("dispatch assignment", () => {
  it("keeps calendar days across month-end and the spring-forward weekend", () => {
    expect(lookbackStart("2026-03-01", 1)).toBe("2026-02-28");
    expect(lookbackStart("2024-03-01", 1)).toBe("2024-02-29");
    expect(lookbackStart("2026-03-09", 1)).toBe("2026-03-08");
    expect(lookbackStart("2026-10-13", 7)).toBe("2026-10-06");
    expect(parseClock("08:30")).toBe(510);
    expect(formatClock(510)).toBe("08:30");
    expect(parseClock("24:00")).toBeNull();
    expect(snapMinute(7 * 60 + 7)).toBe(7 * 60);
    expect(snapMinute(7 * 60 + 8)).toBe(7 * 60 + 15);
    expect(minuteFromRatio(0)).toBe(7 * 60);
    expect(minuteFromRatio(30 / 660)).toBe(7 * 60 + 30);
    expect(minuteFromRatio(480 / 660)).toBe(15 * 60);
    expect(minuteFromRatio(1)).toBe(17 * 60 + 45);
  });

  it("treats a missing end as 60 minutes and a shared edge as free", () => {
    expect(windowOf(8 * 60, null)).toEqual({ startMin: 480, endMin: 540 });
    expect(windowOf(null, 600)).toBeNull();
    expect(windowOf(600, 600)).toBeNull();
    const framing = card({ id: "frame", assigneeId: "luis", startMin: 8 * 60, endMin: null });
    const touch = card({ id: "coil", assigneeId: "luis", startMin: 9 * 60, endMin: 10 * 60 });
    const over = card({ id: "coil", assigneeId: "luis", startMin: 8 * 60 + 30, endMin: 9 * 60 + 30 });
    expect(overlappingIds([framing, touch])).toEqual([]);
    expect(overlappingIds([framing, over])).toEqual(["coil", "frame"]);
    expect(overlappingIds([framing, card({ id: "open", assigneeId: null, startMin: 8 * 60, endMin: 9 * 60 })])).toEqual([]);
  });

  it("blocks an overlap without changing the list, then allows the free tech", () => {
    const cards = [
      card({ id: "frame", assigneeId: "luis", startMin: 8 * 60, endMin: null }),
      card({ id: "coil", source: "item:coil", assigneeId: null, startMin: 8 * 60 + 30, endMin: 9 * 60 + 30 }),
    ];
    const blocked = planAssign(cards, "coil", "luis", 8 * 60 + 30, 9 * 60 + 30);
    expect(blocked).toEqual({ ok: false, code: "overlap", with: ["frame"] });
    expect(cards[1]?.assigneeId).toBeNull();
    const placed = planAssign(cards, "coil", "dana", 8 * 60 + 30, 9 * 60 + 30);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.next.find((row) => row.id === "coil")?.assigneeId).toBe("dana");
    expect(placed.next.find((row) => row.id === "frame")?.assigneeId).toBe("luis");
    const again = planAssign(placed.next, "coil", "luis", 10 * 60, 11 * 60);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.next.find((row) => row.id === "coil")).toMatchObject({ assigneeId: "luis", startMin: 600, endMin: 660 });
  });

  it("unassigns without erasing the clock and flags a doubled visit", () => {
    const cards = [card({ id: "coil", assigneeId: "dana", startMin: 8 * 60 + 30, endMin: 9 * 60 + 30 })];
    const cleared = planAssign(cards, "coil", null, 8 * 60 + 30, 9 * 60 + 30);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.next[0]).toMatchObject({ assigneeId: null, startMin: 510, endMin: 570 });
    expect(planAssign(cards, "missing", "dana", null, null)).toEqual({ ok: false, code: "missing", with: [] });
    expect(planAssign(cards, "coil", "dana", 11 * 60, 10 * 60)).toEqual({ ok: false, code: "window", with: [] });
    const doubled = [
      card({ id: "a", source: "visit:1", assigneeId: "dana", startMin: 8 * 60, endMin: 9 * 60 }),
      card({ id: "b", source: "visit:1", assigneeId: null, startMin: 13 * 60, endMin: 14 * 60 }),
    ];
    expect(overlappingIds(doubled)).toEqual(["a", "b"]);
  });
});
