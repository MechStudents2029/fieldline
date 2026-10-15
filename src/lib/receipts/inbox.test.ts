import { afterEach, describe, expect, it } from "vitest";
import {
  duplicateOf,
  isUncodedStale,
  reimbursementTotals,
  splitSumError,
  suggestReceiptPrefill,
  type DuplicateRow,
} from "@/lib/receipts/inbox";

function row(partial: Partial<DuplicateRow> & Pick<DuplicateRow, "id">): DuplicateRow {
  return {
    vendorName: "Home Depot",
    amountCents: 4280,
    purchasedOn: "2026-10-10",
    photoHash: null,
    ...partial,
  };
}

describe("receipt inbox math", () => {
  afterEach(() => {
    delete process.env.AI_GATEWAY_API_KEY;
  });

  it("flags the same store and amount within three days, and the same photo, without blocking", () => {
    const rows = [
      row({ id: "a", purchasedOn: "2026-10-10", photoHash: "hash-a" }),
      row({ id: "b", vendorName: " home   depot ", purchasedOn: "2026-10-13", photoHash: "hash-b" }),
      row({ id: "c", vendorName: "Ace Hardware", amountCents: 4280, purchasedOn: "2026-10-10", photoHash: "hash-c" }),
      row({ id: "d", vendorName: "Home Depot", amountCents: 100, purchasedOn: "2026-10-10", photoHash: "hash-a" }),
      row({ id: "e", purchasedOn: "2026-10-20", photoHash: "hash-e" }),
    ];
    expect(duplicateOf(rows, "b")).toBe("a");
    expect(duplicateOf(rows, "a")).toBe("b");
    expect(duplicateOf(rows, "e")).toBeNull();
    expect(duplicateOf(rows, "d")).toBe("a");
    expect(duplicateOf(rows, "c")).toBeNull();
  });

  it("requires splits to add up to the receipt", () => {
    expect(splitSumError(1000, [])).toMatch(/cost code/);
    expect(splitSumError(1000, [{ costCode: "FRM-WALL", amountCents: 400 }, { costCode: "HDW-DOOR", amountCents: 500 }])).toMatch(/add up/);
    expect(splitSumError(1000, [{ costCode: "", amountCents: 1000 }])).toMatch(/cost code/);
    expect(splitSumError(1000, [{ costCode: "FRM-WALL", amountCents: 600 }, { costCode: "HDW-DOOR", amountCents: 400 }])).toBeNull();
  });

  it("counts a new receipt only once it is older than two days", () => {
    expect(isUncodedStale("new", "2026-10-12", "2026-10-15")).toBe(true);
    expect(isUncodedStale("new", "2026-10-13", "2026-10-15")).toBe(false);
    expect(isUncodedStale("coded", "2026-10-01", "2026-10-15")).toBe(false);
    expect(isUncodedStale("posted", "2026-10-01", "2026-10-15")).toBe(false);
    expect(isUncodedStale("rejected", "2026-10-01", "2026-10-15")).toBe(false);
  });

  it("totals personal posted receipts per person and leaves company card and cash out", () => {
    const totals = reimbursementTotals([
      { userId: "user_dana", name: "Dana Cho", payMethod: "personal", status: "posted", amountCents: 1840, reimbursedAt: null },
      { userId: "user_dana", name: "Dana Cho", payMethod: "personal", status: "posted", amountCents: 500, reimbursedAt: "2026-10-14" },
      { userId: "user_dana", name: "Dana Cho", payMethod: "personal", status: "new", amountCents: 900, reimbursedAt: null },
      { userId: "user_maya", name: "Maya Rivera", payMethod: "company_card", status: "posted", amountCents: 4280, reimbursedAt: null },
      { userId: "user_sam", name: "Sam Patel", payMethod: "cash", status: "posted", amountCents: 200, reimbursedAt: null },
    ]);
    expect(totals).toEqual([{ userId: "user_dana", name: "Dana Cho", openCents: 1840, reimbursedCents: 500, openCount: 1 }]);
  });

  it("does not invent a prefill or call out when a gateway key is set", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_key";
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      throw new Error("no network");
    }) as typeof fetch;
    try {
      expect(suggestReceiptPrefill()).toBeNull();
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
