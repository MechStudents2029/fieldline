import { describe, expect, it } from "vitest";
import { canEditMeeting, carryForward, nextNumber, sourceLabel, type CarryAction, type CarryItem } from "@/lib/meetings/series";

const items: CarryItem[] = [
  { id: "closed", title: "Valve spec", notes: "", decision: "Use the specified valve", itemStatus: "closed", linkType: "", linkId: null, sortOrder: 0 },
  { id: "open", title: "Tile niche", notes: "Wet wall", decision: "", itemStatus: "open", linkType: "rfi", linkId: "rfi_ok_niche", sortOrder: 1 },
  { id: "shut", title: "Delivery", notes: "", decision: "", itemStatus: "closed", linkType: "", linkId: null, sortOrder: 2 },
];

const actions: CarryAction[] = [
  { id: "done", itemId: "open", title: "Order the tile", assigneeKind: "user", userId: "user_maya", contactId: null, dueOn: "2026-10-01", status: "done" },
  { id: "open-act", itemId: "open", title: "Confirm niche depth", assigneeKind: "user", userId: "user_maya", contactId: null, dueOn: "2026-10-30", status: "open" },
  { id: "late", itemId: "shut", title: "Call the sub", assigneeKind: "vendor", userId: null, contactId: "c_harbor", dueOn: "2026-10-15", status: "open" },
];

describe("meeting series", () => {
  it("carries open items and open actions with the source meeting number", () => {
    expect(sourceLabel(3)).toBe("from meeting #3");
    expect(nextNumber(3)).toBe(4);
    const carried = carryForward(items, actions, 3);
    expect(carried.map((item) => item.title)).toEqual(["Tile niche", "Delivery"]);
    expect(carried[0]?.sourceLabel).toBe("from meeting #3");
    expect(carried[0]?.carriedFromItemId).toBe("open");
    expect(carried[0]?.linkType).toBe("rfi");
    expect(carried[0]?.actions.map((action) => action.title)).toEqual(["Confirm niche depth"]);
    expect(carried[0]?.actions[0]?.sourceLabel).toBe("from meeting #3");
    expect(carried[0]?.actions[0]?.carriedFromActionId).toBe("open-act");
    expect(carried[1]?.itemStatus).toBe("closed");
    expect(carried[1]?.actions[0]?.title).toBe("Call the sub");
    expect(carried.some((item) => item.title === "Valve spec")).toBe(false);
  });

  it("locks approved minutes", () => {
    expect(canEditMeeting("agenda")).toBe(true);
    expect(canEditMeeting("minutes")).toBe(true);
    expect(canEditMeeting("approved")).toBe(false);
  });
});
