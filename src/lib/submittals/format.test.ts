import { describe, expect, it } from "vitest";
import { canMoveSubmittal, isOverdueSubmittal, nextSubmittalNumber, submittalLabel } from "@/lib/submittals/format";

describe("submittal format", () => {
  it("numbers past the highest, including a void", () => {
    expect(nextSubmittalNumber([])).toBe(1);
    expect(nextSubmittalNumber([1, 2])).toBe(3);
    expect(nextSubmittalNumber([3, 1])).toBe(4);
    expect(submittalLabel(4)).toBe("SUB-004");
  });

  it("allows the review moves and keeps a closed submittal closed", () => {
    expect(canMoveSubmittal("draft", "submitted")).toBe(true);
    expect(canMoveSubmittal("draft", "approved")).toBe(false);
    expect(canMoveSubmittal("submitted", "revise")).toBe(true);
    expect(canMoveSubmittal("review", "noted")).toBe(true);
    expect(canMoveSubmittal("revise", "submitted")).toBe(true);
    expect(canMoveSubmittal("approved", "revise")).toBe(false);
    expect(canMoveSubmittal("void", "submitted")).toBe(false);
    expect(isOverdueSubmittal("submitted", "2026-10-01", "2026-10-08")).toBe(true);
    expect(isOverdueSubmittal("approved", "2026-10-01", "2026-10-08")).toBe(false);
    expect(isOverdueSubmittal("review", "2026-10-09", "2026-10-08")).toBe(false);
  });
});
