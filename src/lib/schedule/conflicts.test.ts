import { describe, expect, it } from "vitest";
import { scheduleConflicts } from "@/lib/schedule/conflicts";

describe("schedule conflicts", () => {
  it("flags one person on two jobs the same day and ignores the same job", () => {
    const hits = scheduleConflicts([
      { id: "a", projectId: "job-a", startDate: "2026-10-06", endDate: "2026-10-08", assigneeIds: ["dana"] },
      { id: "b", projectId: "job-b", startDate: "2026-10-07", endDate: "2026-10-07", assigneeIds: ["dana"] },
      { id: "c", projectId: "job-a", startDate: "2026-10-07", endDate: "2026-10-07", assigneeIds: ["dana"] },
      { id: "d", projectId: "job-b", startDate: "2026-10-07", endDate: "2026-10-07", assigneeIds: ["luis"] },
    ]);
    expect(hits).toEqual([{ userId: "dana", day: "2026-10-07", itemIds: ["a", "b", "c"] }]);
  });

  it("does not flag ranges that miss each other", () => {
    expect(
      scheduleConflicts([
        { id: "a", projectId: "job-a", startDate: "2026-10-05", endDate: "2026-10-05", assigneeIds: ["dana"] },
        { id: "b", projectId: "job-b", startDate: "2026-10-06", endDate: "2026-10-06", assigneeIds: ["dana"] },
      ]),
    ).toEqual([]);
  });
});
