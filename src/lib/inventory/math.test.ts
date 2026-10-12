import { describe, expect, it } from "vitest";
import {
  addBalance,
  availableMilli,
  averageUnitCost,
  extendCost,
  isLowStock,
  receiveBalance,
  removeBalance,
  reorderQtyMilli,
  stockableQtyMilli,
  takeValue,
} from "@/lib/inventory/math";

describe("inventory math", () => {
  it("keeps available as on hand minus allocated", () => {
    expect(availableMilli(10_000, 2_000)).toBe(8_000);
    expect(availableMilli(2_000, 2_000)).toBe(0);
    expect(() => availableMilli(1_000, 2_000)).toThrow(/Allocated is past on hand/);
  });

  it("blends a receipt into the moving average and takes a proportional share", () => {
    const empty = { onHandMilli: 0, allocatedMilli: 0, valueCents: 0 };
    const received = receiveBalance(empty, 4_000, 1_000);
    expect(received).toEqual({ onHandMilli: 4_000, allocatedMilli: 0, valueCents: 4_000 });
    const blended = receiveBalance(received, 2_000, 2_000);
    expect(blended.valueCents).toBe(8_000);
    expect(averageUnitCost(blended.onHandMilli, blended.valueCents, 0)).toBe(1_333);
    const taken = removeBalance(blended, 1_000);
    expect(taken.costCents).toBe(Math.round((8_000 * 1_000) / 6_000));
    expect(taken.balance.onHandMilli).toBe(5_000);
    expect(taken.balance.valueCents).toBe(8_000 - taken.costCents);
  });

  it("gives the last units the remaining cents", () => {
    expect(takeValue(3_000, 10, 1_000)).toBe(3);
    expect(takeValue(3_000, 10, 2_000)).toBe(7);
    expect(takeValue(3_000, 10, 3_000)).toBe(10);
    const left = removeBalance({ onHandMilli: 2_000, allocatedMilli: 1_000, valueCents: 10 }, 1_000);
    expect(left.costCents).toBe(5);
    expect(() => removeBalance({ onHandMilli: 2_000, allocatedMilli: 1_000, valueCents: 10 }, 2_000)).toThrow(/available/);
  });

  it("rounds extended cost to the nearest cent", () => {
    expect(extendCost(1_500, 100)).toBe(150);
    expect(extendCost(1, 1)).toBe(0);
    expect(extendCost(500, 1)).toBe(1);
  });

  it("ignores short, damaged, and backordered quantities", () => {
    expect(
      stockableQtyMilli([
        { condition: "ok", qtyMilli: 1_000 },
        { condition: "short", qtyMilli: 500 },
        { condition: "damaged", qtyMilli: 250 },
        { condition: "backordered", qtyMilli: 0 },
      ]),
    ).toBe(1_000);
  });

  it("orders at least one unit when stock is at the reorder point", () => {
    expect(isLowStock(4_000, 4_000)).toBe(true);
    expect(isLowStock(4_001, 4_000)).toBe(false);
    expect(reorderQtyMilli(2_000, 4_000)).toBe(2_000);
    expect(reorderQtyMilli(4_000, 4_000)).toBe(1_000);
    expect(reorderQtyMilli(5_000, 4_000)).toBe(0);
  });

  it("puts a known cost back so a void can restore the balance", () => {
    const start = { onHandMilli: 4_000, allocatedMilli: 0, valueCents: 8_000 };
    const removed = removeBalance(start, 1_000);
    const restored = addBalance(removed.balance, 1_000, removed.costCents);
    expect(restored).toEqual(start);
  });
});
