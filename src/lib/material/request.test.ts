import { describe, expect, it } from "vitest";
import { duplicateRequest, formatQty, isMaterialAttention, parseQtyToMilli } from "@/lib/material/request";

describe("material requests", () => {
  it("parses quantities as milli-units", () => {
    expect(parseQtyToMilli("2")).toBe(2_000);
    expect(parseQtyToMilli("1.5")).toBe(1_500);
    expect(parseQtyToMilli("0")).toBeNull();
    expect(parseQtyToMilli("")).toBeNull();
    expect(formatQty(2_000)).toBe("2");
    expect(formatQty(1_500)).toBe("1.5");
  });

  it("counts urgent submitted requests and submitted requests older than two days", () => {
    expect(isMaterialAttention("submitted", "urgent", "2026-10-14", "2026-10-15")).toBe(true);
    expect(isMaterialAttention("submitted", "normal", "2026-10-10", "2026-10-15")).toBe(true);
    expect(isMaterialAttention("submitted", "normal", "2026-10-14", "2026-10-15")).toBe(false);
    expect(isMaterialAttention("approved", "urgent", "2026-10-01", "2026-10-15")).toBe(false);
    expect(isMaterialAttention("submitted", "urgent", null, "2026-10-15")).toBe(false);
  });

  it("flags the same job and SKU inside three days and still returns the other id", () => {
    const rows = [
      { id: "a", projectId: "proj_brooks", stockItemIds: ["stk_tile"], createdOn: "2026-10-14" },
      { id: "b", projectId: "proj_brooks", stockItemIds: ["stk_tile"], createdOn: "2026-10-13" },
      { id: "c", projectId: "proj_okonkwo", stockItemIds: ["stk_tile"], createdOn: "2026-10-14" },
      { id: "d", projectId: "proj_brooks", stockItemIds: ["stk_tile"], createdOn: "2026-10-01" },
      { id: "e", projectId: "proj_brooks", stockItemIds: [], createdOn: "2026-10-14" },
    ];
    expect(duplicateRequest(rows, "a")).toBe("b");
    expect(duplicateRequest(rows, "c")).toBeNull();
    expect(duplicateRequest(rows, "d")).toBeNull();
    expect(duplicateRequest(rows, "e")).toBeNull();
  });
});
