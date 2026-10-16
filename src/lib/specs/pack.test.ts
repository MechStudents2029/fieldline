import { describe, expect, it } from "vitest";
import { budgetChanged, draftPastDue, groupOf, kept, latestByToken, publishedForToken, pulledLine, refreshed } from "@/lib/specs/pack";

const live = { id: "bud_1", name: "Framing", costCode: "FRM-WALL", priceCents: 2_860_000 };

describe("spec packs", () => {
  it("flags a linked line when the budget name or amount differs", () => {
    const line = pulledLine(live, 0);
    expect(budgetChanged(line, live)).toBe(false);
    expect(budgetChanged(line, { name: "Framing, 2x6", priceCents: live.priceCents })).toBe(true);
    expect(budgetChanged(line, { name: live.name, priceCents: live.priceCents - 1 })).toBe(true);
    expect(budgetChanged({ budgetLineId: null, sourceName: null, sourceCents: null }, null)).toBe(false);
    expect(budgetChanged(line, null)).toBe(true);
    expect(groupOf("")).toBe("General");
    expect(groupOf(" FRM-WALL ")).toBe("FRM-WALL");
  });

  it("refreshes the spec text and keep only moves the snapshot", () => {
    const next = { name: "Framing, 2x6", costCode: "FRM-EXT", priceCents: 2_900_000 };
    expect(refreshed(next)).toMatchObject({ description: "Framing, 2x6", sourceCents: 2_900_000, groupLabel: "FRM-EXT" });
    expect(kept(next)).toEqual({ sourceName: "Framing, 2x6", sourceCents: 2_900_000 });
    expect(draftPastDue("draft", "2026-10-15", "2026-10-16")).toBe(true);
    expect(draftPastDue("draft", "2026-10-16", "2026-10-16")).toBe(false);
    expect(draftPastDue("published", "2026-10-15", "2026-10-16")).toBe(false);
    expect(draftPastDue("draft", null, "2026-10-16")).toBe(false);
  });

  it("keeps the latest published revision for a share token", () => {
    const rows = [
      { id: "a", shareToken: "t", version: 1, status: "published" },
      { id: "b", shareToken: "t", version: 2, status: "draft" },
      { id: "c", shareToken: "u", version: 1, status: "draft" },
    ];
    expect(latestByToken(rows).map((row) => row.id).sort()).toEqual(["b", "c"]);
    expect(publishedForToken(rows, "t")?.id).toBe("a");
    expect(publishedForToken(rows, "u")).toBeNull();
  });
});
