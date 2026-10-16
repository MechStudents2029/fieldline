import { describe, expect, it } from "vitest";
import { closeoutHandover, missingDocs, nextMaintenance, warrantyEnd } from "@/lib/handover/package";

describe("handover package math", () => {
  it("computes the manufacturer warranty end from the install date", () => {
    expect(warrantyEnd("2026-01-31", 1)).toBe("2026-02-28");
    expect(warrantyEnd("2026-10-16", 12)).toBe("2027-10-16");
    expect(warrantyEnd("2026-10-16", 0)).toBeNull();
    expect(warrantyEnd("", 12)).toBeNull();
  });

  it("rolls the next maintenance date to today or later", () => {
    expect(nextMaintenance("2026-08-01", 90, "2026-10-16")).toBe("2026-10-30");
    expect(nextMaintenance("2026-10-01", 90, "2026-10-16")).toBe("2026-12-30");
    expect(nextMaintenance("2026-10-16", 90, "2026-10-16")).toBe("2027-01-14");
    expect(nextMaintenance("2026-01-01", 365, "2026-10-16")).toBe("2027-01-01");
    expect(nextMaintenance("2026-10-16", 0, "2026-10-16")).toBeNull();
  });

  it("counts installed items that have no manual", () => {
    expect(
      missingDocs([
        { sectionKind: "selections", documentId: null },
        { sectionKind: "installed", documentId: null },
        { sectionKind: "installed", documentId: "doc" },
        { sectionKind: "trades", documentId: null },
      ]),
    ).toBe(1);
  });

  it("blocks close only for a draft package", () => {
    expect(closeoutHandover(null)).toBe(0);
    expect(closeoutHandover("draft")).toBe(1);
    expect(closeoutHandover("ready")).toBe(0);
    expect(closeoutHandover("delivered")).toBe(0);
  });
});
