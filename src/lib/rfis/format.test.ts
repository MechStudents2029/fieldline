import { describe, expect, it } from "vitest";
import { ageDays, impactText, isOverdueRfi, nextRfiNumber, rfiLabel } from "@/lib/rfis/format";

describe("RFI numbering and overdue", () => {
  it("numbers per job and keeps voided numbers", () => {
    expect(nextRfiNumber([])).toBe(1);
    expect(rfiLabel(1)).toBe("RFI-001");
    expect(nextRfiNumber([1, 2])).toBe(3);
    expect(rfiLabel(nextRfiNumber([1]))).toBe("RFI-002");
    expect(nextRfiNumber([1, 3])).toBe(4);
  });

  it("counts age and overdue only while open", () => {
    expect(ageDays("2026-10-01", "2026-10-07")).toBe(6);
    expect(ageDays("2026-10-07", "2026-10-07")).toBe(0);
    expect(isOverdueRfi("open", "2026-10-06", "2026-10-07")).toBe(true);
    expect(isOverdueRfi("open", "2026-10-07", "2026-10-07")).toBe(false);
    expect(isOverdueRfi("answered", "2026-10-01", "2026-10-07")).toBe(false);
    expect(isOverdueRfi("closed", "2026-10-01", "2026-10-07")).toBe(false);
    expect(isOverdueRfi("void", "2026-10-01", "2026-10-07")).toBe(false);
  });

  it("hides cost amounts when money is hidden", () => {
    expect(impactText({ costImpact: true, costImpactCents: 180_000, scheduleImpactDays: 2, showMoney: true })).toBe("$1,800 · 2d");
    expect(impactText({ costImpact: true, costImpactCents: 180_000, scheduleImpactDays: null, showMoney: false })).toBe("Cost");
    expect(impactText({ costImpact: false, costImpactCents: null, scheduleImpactDays: null, showMoney: true })).toBe("");
  });
});
