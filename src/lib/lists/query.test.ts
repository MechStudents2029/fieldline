import { describe, expect, it } from "vitest";
import { pinnedTarget, readQuery, withPatch, writeQuery } from "@/lib/lists/query";

const keys = ["assignee", "job", "priority", "due", "status", "q"];

describe("list filter URLs", () => {
  it("round-trips filters and drops empty values", () => {
    const query = { assignee: "user_maya", due: "overdue", priority: "high" };
    const href = writeQuery("/todos", { ...query, job: "", status: null });
    expect(href).toBe("/todos?assignee=user_maya&due=overdue&priority=high");
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(readQuery(params, keys)).toEqual(query);
    expect(readQuery({ assignee: "user_maya", due: ["overdue"], job: "" }, keys)).toEqual({
      assignee: "user_maya",
      due: "overdue",
    });
  });

  it("patches one filter and clears the view id", () => {
    const current = { priority: "high", view: "view_1", sort: "due" };
    expect(withPatch("/todos", current, { due: "week", view: null })).toBe("/todos?due=week&priority=high&sort=due");
    expect(withPatch("/todos", current, { priority: null, view: null, sort: null })).toBe("/todos");
  });

  it("sends a bare list to the pinned view and leaves an explicit URL alone", () => {
    const pin = { id: "view_overdue", query: { assignee: "user_maya", due: "overdue" }, sortKey: "due", sortDir: "asc" as const };
    expect(pinnedTarget("/todos", {}, pin, keys, ["task", "new"])).toBe("/todos?assignee=user_maya&dir=asc&due=overdue&sort=due&view=view_overdue");
    expect(pinnedTarget("/todos", { view: "none" }, pin, keys)).toBeNull();
    expect(pinnedTarget("/todos", { due: "week" }, pin, keys)).toBeNull();
    expect(pinnedTarget("/todos", { task: "task_walk" }, pin, keys, ["task"])).toBeNull();
    expect(pinnedTarget("/todos", {}, null, keys)).toBeNull();
  });
});
