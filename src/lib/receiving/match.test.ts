import { describe, expect, it } from "vitest";
import {
  assertReceive,
  orderLabel,
  overReceived,
  receiveLabel,
  receivedCents,
  receivedQty,
  remainingQty,
  unbilledReceived,
} from "@/lib/receiving/match";

const slice = (qtyMilli: number, condition: "ok" | "short" | "damaged" | "backordered" = "ok", voided = false) => ({
  qtyMilli,
  percentBps: 0,
  condition,
  voided,
});

describe("receiving match", () => {
  it("keeps a partial receipt below ordered and ignores a void", () => {
    const open = [slice(1500, "short")];
    expect(receivedQty("purchase", open)).toBe(1500);
    expect(remainingQty(4000, 1500)).toBe(2500);
    expect(receiveLabel(4000, 1500)).toBe("Partially received");
    expect(receivedCents(400_000, 4000, 1500)).toBe(150_000);
    const voided = [slice(1500, "short", true)];
    expect(receivedQty("purchase", voided)).toBe(0);
    expect(remainingQty(4000, receivedQty("purchase", voided))).toBe(4000);
    expect(receiveLabel(4000, 0)).toBe("Not received");
    expect(orderLabel([{ ordered: 4000, received: 1500 }, { ordered: 1000, received: 0 }])).toBe("Partially received");
  });

  it("refuses a quantity past what is still open", () => {
    expect(() =>
      assertReceive({ kind: "purchase", ordered: 4000, received: 1500, qtyMilli: 2501, percentBps: 0, condition: "ok", expectedOn: null }),
    ).toThrow(/more than remaining/);
    expect(() =>
      assertReceive({ kind: "purchase", ordered: 4000, received: 1500, qtyMilli: 2500, percentBps: 0, condition: "ok", expectedOn: null }),
    ).not.toThrow();
    expect(receivedQty("purchase", [slice(1000, "damaged"), slice(500)])).toBe(500);
  });

  it("flags a bill past the received amount", () => {
    const lines = [{ costCode: "PLB-SHOWER", receivedCents: 150_000 }];
    const prior = [{ costCode: "PLB-SHOWER", amountCents: 150_000 }];
    const incoming = [{ costCode: "PLB-SHOWER", amountCents: 50_000 }];
    expect(overReceived(lines, prior, incoming)).toEqual([{ code: "PLB-SHOWER", overCents: 50_000 }]);
    expect(unbilledReceived([{ costCode: "PLB-SHOWER", description: "Valve", receivedCents: 200_000 }], prior)).toEqual([
      { costCode: "PLB-SHOWER", description: "Valve", amountCents: 50_000 },
    ]);
  });

  it("tracks work orders as percent complete", () => {
    const slices = [{ qtyMilli: 0, percentBps: 4000, condition: "ok" as const, voided: false }];
    expect(receivedQty("work", slices)).toBe(4000);
    expect(receiveLabel(10_000, 4000)).toBe("Partially received");
    expect(() =>
      assertReceive({ kind: "work", ordered: 10_000, received: 4000, qtyMilli: 0, percentBps: 7000, condition: "ok", expectedOn: null }),
    ).toThrow(/more than remaining/);
  });
});
