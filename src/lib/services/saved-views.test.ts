import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs } from "@/lib/db/schema";
import { pinnedTarget } from "@/lib/lists/query";
import { authenticate } from "@/lib/services/read";
import {
  LIST_FILTERS,
  deleteView,
  listSavedViews,
  pinView,
  renameView,
  saveView,
  savedViewsPolicy,
  shareView,
  unpinView,
  viewHref,
} from "@/lib/services/saved-views";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("saved views", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("saves, renames, pins, and deletes a view for one person", () => {
    const maya = actor("maya@rivera.demo");
    const created = saveView(maya, { list: "todos", name: "High open", query: { priority: "high", status: "all", ignored: "no" }, sortKey: "due", sortDir: "asc" });
    expect(created.query).toEqual({ priority: "high", status: "all" });
    expect(created.mine).toBe(true);
    expect(created.shared).toBe(false);
    expect(viewHref(created)).toContain("priority=high");
    expect(viewHref(created)).toContain(`view=${created.id}`);
    const renamed = renameView(maya, created.id, "High only");
    expect(renamed.name).toBe("High only");
    const pinned = pinView(maya, created.id);
    expect(pinned.pinned).toBe(true);
    const views = listSavedViews(maya, "todos");
    const mine = views.find((row) => row.id === created.id);
    expect(mine?.pinned).toBe(true);
    expect(pinnedTarget("/todos", {}, mine ?? null, LIST_FILTERS.todos, ["task", "new"])).toContain("priority=high");
    expect(pinnedTarget("/todos", { view: "none" }, mine ?? null, LIST_FILTERS.todos)).toBeNull();
    unpinView(maya, created.id);
    expect(listSavedViews(maya, "todos").find((row) => row.id === created.id)?.pinned).toBe(false);
    deleteView(maya, created.id);
    expect(listSavedViews(maya, "todos").some((row) => row.id === created.id)).toBe(false);
    const actions = getDb().select().from(auditLogs).where(eq(auditLogs.orgId, maya.orgId)).all().map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["view.create", "view.rename", "view.pin", "view.unpin", "view.delete"]));
  });

  it("keeps a private view in the company and lets office share one", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const jordan = actor("jordan@northline.demo");
    const riley = actor("riley@rivera.demo");
    const mine = saveView(maya, { list: "rfis", name: "Awaiting answer", query: { status: "open" } });
    expect(listSavedViews(dana, "rfis").some((row) => row.id === mine.id)).toBe(false);
    expect(listSavedViews(jordan, "rfis")).toEqual([]);
    expect(() => pinView(jordan, mine.id)).toThrow(/not in your company/);
    expect(() => renameView(dana, mine.id, "Nope")).toThrow(/not in your company/);
    const shared = shareView(maya, mine.id, true);
    expect(() => renameView(dana, mine.id, "Nope")).toThrow(/not yours/);
    expect(shared.shared).toBe(true);
    expect(listSavedViews(dana, "rfis").some((row) => row.id === mine.id)).toBe(true);
    expect(listSavedViews(riley, "rfis").some((row) => row.id === mine.id)).toBe(true);
    pinView(dana, mine.id);
    expect(listSavedViews(dana, "rfis").find((row) => row.id === mine.id)?.pinned).toBe(true);
    expect(listSavedViews(maya, "rfis").find((row) => row.id === mine.id)?.pinned).toBe(false);
    expect(() => saveView(dana, { list: "todos", name: "Crew", query: { due: "week" }, shared: true })).toThrow(/Office can share/);
    const personal = saveView(dana, { list: "todos", name: "Crew", query: { due: "week" } });
    expect(personal.mine).toBe(true);
    expect(listSavedViews(maya, "todos").some((row) => row.id === personal.id)).toBe(false);
    expect(savedViewsPolicy()).toBe(true);
  });

  it("loads the seeded views for each demo user", () => {
    const maya = actor("maya@rivera.demo");
    const names = listSavedViews(maya, "todos").map((row) => row.name);
    expect(names).toContain("My overdue");
    expect(listSavedViews(maya, "rfis").map((row) => row.name)).toContain("Awaiting answer");
    expect(listSavedViews(actor("dana@rivera.demo"), "todos").map((row) => row.name)).toContain("This week");
    expect(listSavedViews(actor("jordan@northline.demo"), "todos")).toEqual([]);
  });
});
