import { describe, expect, it } from "vitest";
import {
  allocatePercents,
  billingGap,
  buildProgress,
  drawPhase,
  earnedDrawCents,
  previousFromApps,
  resolvedDrawAmounts,
  retainageByLine,
} from "@/lib/draws/math";

describe("draw and progress math", () => {
  it("makes percent draws and a change order total the contract to the cent", () => {
    const base = allocatePercents(4_620_000, [3636, 3636, 909, 909, 909]);
    expect(base.reduce((sum, amount) => sum + amount, 0)).toBe(4_620_000);
    const withChange = resolvedDrawAmounts(4_716_000, [
      ...base.map((amount) => ({ basis: "fixed" as const, bps: 0, amountCents: amount })),
      { basis: "fixed", bps: 0, amountCents: 96_000 },
    ]);
    expect(withChange.remainderCents).toBe(0);
    expect(withChange.amounts.reduce((sum, amount) => sum + amount, 0)).toBe(4_716_000);
  });

  it("keeps a percent and fixed mix exact and reports the remainder", () => {
    const even = resolvedDrawAmounts(10_000, [
      { basis: "fixed", bps: 0, amountCents: 6_000 },
      { basis: "percent", bps: 4000, amountCents: 0 },
    ]);
    expect(even.amounts).toEqual([6_000, 4_000]);
    expect(even.remainderCents).toBe(0);
    const off = resolvedDrawAmounts(10_000, [
      { basis: "fixed", bps: 0, amountCents: 6_000 },
      { basis: "percent", bps: 5000, amountCents: 0 },
    ]);
    expect(off.remainderCents).toBe(-1_000);
    const thirds = allocatePercents(100, [3333, 3333, 3334]);
    expect(thirds).toEqual([33, 33, 34]);
  });

  it("is ready when the linked schedule item is done or its date has passed", () => {
    expect(
      drawPhase({ invoiceStatus: null, scheduleStatus: "done", scheduleEnd: "2026-10-20", dueOn: null, today: "2026-10-07" }),
    ).toBe("ready");
    expect(
      drawPhase({ invoiceStatus: null, scheduleStatus: "confirmed", scheduleEnd: "2026-10-06", dueOn: null, today: "2026-10-07" }),
    ).toBe("ready");
    expect(
      drawPhase({ invoiceStatus: null, scheduleStatus: "planned", scheduleEnd: null, dueOn: "2026-10-08", today: "2026-10-07" }),
    ).toBe("not_ready");
    expect(
      drawPhase({ invoiceStatus: "draft", scheduleStatus: "done", scheduleEnd: "2026-10-06", dueOn: null, today: "2026-10-07" }),
    ).toBe("invoiced");
    expect(drawPhase({ invoiceStatus: "paid", scheduleStatus: null, scheduleEnd: null, dueOn: null, today: "2026-10-07" })).toBe("paid");
  });

  it("computes previous, this period, to date, balance, and retainage", () => {
    const first = buildProgress(
      [
        { key: "a", name: "Framing", scheduledCents: 1_000, previousCents: 0 },
        { key: "b", name: "Glass", scheduledCents: 500, previousCents: 0 },
      ],
      [
        { key: "a", thisCents: 400, percentBps: null },
        { key: "b", thisCents: null, percentBps: 2000 },
      ],
      1000,
    );
    expect(first.lines[0]).toMatchObject({ thisCents: 400, toDateCents: 400, balanceCents: 600, percentBps: 4000 });
    expect(first.lines[1]).toMatchObject({ thisCents: 100, toDateCents: 100, balanceCents: 400 });
    expect(first.thisPeriodCents).toBe(500);
    expect(first.retainageCents).toBe(50);
    expect(first.dueCents).toBe(450);
    expect(retainageByLine([333, 333, 334], 1000).reduce((sum, cents) => sum + cents, 0)).toBe(100);
    const previous = previousFromApps(
      ["a", "b"],
      [{ voided: false, lines: first.lines.map((line) => ({ key: line.key, thisCents: line.thisCents })) }],
    );
    const second = buildProgress(
      [
        { key: "a", name: "Framing", scheduledCents: 1_000, previousCents: previous.get("a") ?? 0 },
        { key: "b", name: "Glass", scheduledCents: 500, previousCents: previous.get("b") ?? 0 },
      ],
      [
        { key: "a", thisCents: 600, percentBps: null },
        { key: "b", thisCents: 0, percentBps: null },
      ],
      1000,
    );
    expect(second.lines[0]).toMatchObject({ previousCents: 400, thisCents: 600, toDateCents: 1_000, balanceCents: 0 });
  });

  it("blocks a line over 100% and restores previous when an application is void", () => {
    expect(() =>
      buildProgress(
        [{ key: "a", name: "Framing", scheduledCents: 1_000, previousCents: 800 }],
        [{ key: "a", thisCents: 300, percentBps: null }],
        0,
      ),
    ).toThrow(/over 100%/);
    const restored = previousFromApps(
      ["a"],
      [
        { voided: false, lines: [{ key: "a", thisCents: 200 }] },
        { voided: true, lines: [{ key: "a", thisCents: 500 }] },
      ],
    );
    expect(restored.get("a")).toBe(200);
  });

  it("marks underbilled and overbilled from earned work versus invoices", () => {
    const earned = earnedDrawCents([
      { amountCents: 4_000, phase: "paid" },
      { amountCents: 2_000, phase: "ready" },
      { amountCents: 4_000, phase: "not_ready" },
    ]);
    expect(billingGap(10_000, 4_000, earned)).toMatchObject({ state: "under", gapCents: 2_000, billedBps: 4000, completeBps: 6000 });
    expect(billingGap(10_000, 8_000, 5_000).state).toBe("over");
    expect(billingGap(10_000, 5_000, 5_000).state).toBe("even");
  });
});
