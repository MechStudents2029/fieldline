import { describe, expect, it } from "vitest";
import { backoffMs, clockFlag, DRIFT_MS, keepAfterSync, pendingSyncCount, projectShift, sortOldestFirst, STALE_MS } from "@/lib/offline/replay";

describe("offline replay", () => {
  it("sorts oldest first and backs off until five minutes", () => {
    const sorted = sortOldestFirst([
      { capturedAt: "2026-10-05T18:00:00.000Z", seq: 2, id: "b" },
      { capturedAt: "2026-10-05T18:00:00.000Z", seq: 1, id: "a" },
      { capturedAt: "2026-10-05T17:00:00.000Z", seq: 9, id: "z" },
    ]);
    expect(sorted.map((row) => row.id)).toEqual(["z", "a", "b"]);
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(2)).toBe(4000);
    expect(backoffMs(20)).toBe(5 * 60 * 1000);
  });

  it("flags future, stale, and a clock more than two minutes off", () => {
    const now = Date.parse("2026-10-05T18:00:00.000Z");
    expect(clockFlag(now - DRIFT_MS, now)).toBeNull();
    expect(clockFlag(now - DRIFT_MS - 1, now)).toBe("clock_drift");
    expect(clockFlag(now + 1, now)).toBe("future");
    expect(clockFlag(now - STALE_MS, now)).toBe("clock_drift");
    expect(clockFlag(now - STALE_MS - 1, now)).toBe("stale");
  });

  it("projects the local shift and keeps review rows out of the open punch", () => {
    const names = new Map([["proj_okonkwo", "Okonkwo primary bath"]]);
    const open = projectShift(
      null,
      [
        { kind: "clock_in", capturedAt: "2026-10-05T15:00:00.000Z", seq: 1, projectId: "proj_okonkwo", costCode: "TILE-SHOWER", syncStatus: "pending" },
        { kind: "break_start", capturedAt: "2026-10-05T16:00:00.000Z", seq: 2, projectId: null, costCode: null, syncStatus: "pending" },
        { kind: "break_end", capturedAt: "2026-10-05T16:15:00.000Z", seq: 3, projectId: null, costCode: null, syncStatus: "pending" },
        { kind: "switch", capturedAt: "2026-10-05T17:00:00.000Z", seq: 4, projectId: "proj_okonkwo", costCode: "PLB-SHOWER", syncStatus: "pending" },
      ],
      names,
    );
    expect(open).toMatchObject({ costCode: "PLB-SHOWER", status: "open", projectName: "Okonkwo primary bath" });
    const closed = projectShift(open, [{ kind: "clock_out", capturedAt: "2026-10-05T18:00:00.000Z", seq: 5, projectId: null, costCode: null }], names);
    expect(closed).toBeNull();
    const reviewed = projectShift(
      { projectId: "proj_okonkwo", projectName: "Okonkwo primary bath", costCode: "GC-SUPER", status: "open", clockInAt: "2026-10-05T12:00:00.000Z" },
      [{ kind: "clock_in", capturedAt: "2026-10-05T13:00:00.000Z", seq: 1, projectId: "proj_chen", costCode: "TILE-SHOWER", syncStatus: "needs_review" }],
      names,
    );
    expect(reviewed?.costCode).toBe("GC-SUPER");
    expect(pendingSyncCount([{ kind: "clock_in", syncStatus: "pending" }, { kind: "clock_out", syncStatus: "needs_review" }])).toBe(1);
    expect(keepAfterSync({ status: "applied" })).toBe("drop");
    expect(keepAfterSync({ status: "needs_review" })).toBe("review");
    expect(keepAfterSync({ status: "sign_in" })).toBe("signin");
    expect(keepAfterSync({ status: "error" })).toBe("keep");
  });
});
