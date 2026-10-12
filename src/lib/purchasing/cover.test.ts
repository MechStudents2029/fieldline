import { describe, expect, it } from "vitest";
import { budgetRemainder, committedByCode, coveredSourceIds, isStale, lineAmountCents, selectionSourceId } from "@/lib/purchasing/cover";

describe("purchase cover", () => {
  it("prices a line in integer cents and keys a selection choice", () => {
    expect(lineAmountCents(1000, 280000)).toBe(280000);
    expect(lineAmountCents(2500, 42000)).toBe(105000);
    expect(selectionSourceId("sel_ok_vanity", "choc_ok_quartz")).toBe("sel_ok_vanity:choc_ok_quartz");
  });

  it("treats void as uncovered and sums only draft and issued commitment", () => {
    const rows = [
      { sourceKind: "selection", sourceId: "sel:a", status: "draft", projectId: "p", costCode: "HDW", amountCents: 100 },
      { sourceKind: "selection", sourceId: "sel:b", status: "void", projectId: "p", costCode: "HDW", amountCents: 50 },
      { sourceKind: "selection", sourceId: "sel:c", status: "closed", projectId: "p", costCode: "HDW", amountCents: 80 },
      { sourceKind: "budget_line", sourceId: "bud", status: "issued", projectId: "p", costCode: "HDW", amountCents: 40 },
      { sourceKind: "budget_line", sourceId: "other", status: "issued", projectId: "q", costCode: "HDW", amountCents: 999 },
    ];
    expect([...coveredSourceIds(rows, "selection", new Set(["draft", "issued", "closed"]))].sort()).toEqual(["sel:a", "sel:c"]);
    expect(committedByCode(rows, "p").get("HDW")).toBe(140);
    expect(budgetRemainder(200, 140)).toBe(60);
    expect(budgetRemainder(100, 140)).toBe(0);
  });

  it("flags a confirmation only after the stale window", () => {
    const confirmed = "2026-10-01T12:00:00.000Z";
    const at = Date.parse(confirmed);
    expect(isStale(confirmed, at + 3 * 86_400_000)).toBe(false);
    expect(isStale(confirmed, at + 3 * 86_400_000 + 1)).toBe(true);
  });
});
