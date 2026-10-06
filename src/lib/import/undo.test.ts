import { describe, expect, it } from "vitest";
import { undoDecision } from "@/lib/import/undo";

describe("undo safety", () => {
  const batch = "2026-10-06T12:00:00.000Z";

  it("removes a created row until something references it", () => {
    expect(undoDecision({ created: true, recordUpdatedAt: batch, batchCreatedAt: batch, usedAt: null })).toBeNull();
    expect(undoDecision({ created: true, recordUpdatedAt: batch, batchCreatedAt: batch, usedAt: "2026-09-01T00:00:00.000Z" })).toBe("Used on a job");
  });

  it("reverts an update unless the record changed or was used after the batch", () => {
    expect(undoDecision({ created: false, recordUpdatedAt: batch, batchCreatedAt: batch, usedAt: "2026-09-01T00:00:00.000Z" })).toBeNull();
    expect(undoDecision({ created: false, recordUpdatedAt: "2026-10-06T13:00:00.000Z", batchCreatedAt: batch, usedAt: null })).toBe("Changed since import");
    expect(undoDecision({ created: false, recordUpdatedAt: batch, batchCreatedAt: batch, usedAt: "2026-10-06T13:00:00.000Z" })).toBe("Used on a job");
  });
});
