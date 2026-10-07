import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, notifications, scheduleItems, taskChecks, taskFiles, tasks } from "@/lib/db/schema";
import { addCalendarDays } from "@/lib/time/calendar";
import { linkedDeadline } from "@/lib/todos/deadline";
import { listInbox, openNotification } from "@/lib/services/comments";
import { authenticate } from "@/lib/services/read";
import { removeScheduleItem, saveScheduleItem } from "@/lib/services/schedule";
import { previewScheduleShift, shiftScheduleDates } from "@/lib/services/schedule-shift";
import { createJobFromTemplate } from "@/lib/services/templates";
import { completeTask } from "@/lib/services/write";
import {
  completeTodos,
  createTodo,
  listTodos,
  setTodoCheck,
  sweepTodoReminders,
  todoDetail,
  vendorTick,
  vendorTodos,
} from "@/lib/services/todos";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

describe("to-dos", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("stores a workday offset from a schedule edge", () => {
    const maya = actor("maya@rivera.demo");
    const tile = getDb().select().from(scheduleItems).where(eq(scheduleItems.id, "sch_ok_tile")).get();
    if (!tile) throw new Error("missing tile");
    const taskId = createTodo(maya, {
      title: "Offset from tile",
      projectId: "proj_okonkwo",
      scheduleItemId: "sch_ok_tile",
      deadlineEdge: "finish",
      deadlineOffset: -1,
    });
    expect(todoDetail(maya, taskId)?.dueAt).toBe(linkedDeadline(tile.endDate, -1));
  });

  it("recomputes the deadline when a schedule item moves, including the cascade count", () => {
    const maya = actor("maya@rivera.demo");
    const before = getDb().select().from(tasks).where(eq(tasks.id, "task_walk")).get();
    const tile = getDb().select().from(scheduleItems).where(eq(scheduleItems.id, "sch_ok_tile")).get();
    if (!before || !tile) throw new Error("missing walk");
    const nextEnd = addCalendarDays(tile.endDate, 7);
    const preview = previewScheduleShift(maya, "sch_ok_tile", tile.startDate, nextEnd);
    expect(preview.count).toBeGreaterThan(preview.shifts.length);
    expect(preview.label).toBe(`Moves ${preview.count} items`);
    const shifted = shiftScheduleDates(maya, "sch_ok_tile", tile.startDate, nextEnd);
    const after = getDb().select().from(tasks).where(eq(tasks.id, "task_walk")).get();
    expect(after?.dueAt).toBe(linkedDeadline(nextEnd, -1));
    expect(after?.dueAt).not.toBe(before.dueAt);
    expect(after?.remindedFor).toBeNull();
    expect(shifted.label).toBe(preview.label);
  });

  it("keeps the last date when the schedule item is deleted", () => {
    const maya = actor("maya@rivera.demo");
    const itemId = saveScheduleItem(maya, {
      projectId: "proj_chen",
      title: "Temporary measure",
      startDate: "2026-10-12",
      endDate: "2026-10-13",
      startTime: null,
      status: "planned",
      note: null,
      assigneeIds: [],
    });
    const taskId = createTodo(maya, {
      title: "Linked then dropped",
      projectId: "proj_chen",
      scheduleItemId: itemId,
      deadlineEdge: "finish",
      deadlineOffset: 0,
    });
    const due = todoDetail(maya, taskId)?.dueAt;
    removeScheduleItem(maya, itemId);
    const row = getDb().select().from(tasks).where(eq(tasks.id, taskId)).get();
    expect(row?.dueAt).toBe(due);
    expect(row?.scheduleItemId).toBeNull();
    expect(row?.deadlineUnlinked).toBe(1);
    expect(todoDetail(maya, taskId)?.unlinked).toBe(true);
    expect(todoDetail(maya, taskId)?.scheduleItemId).toBeNull();
    const audit = getDb().select().from(auditLogs).where(eq(auditLogs.entityId, taskId)).all();
    expect(audit.some((entry) => entry.action === "todo.unlink")).toBe(true);
  });

  it("isolates field, vendor, and other-company to-dos", () => {
    const dana = actor("dana@rivera.demo");
    const jordan = actor("jordan@northline.demo");
    const riley = actor("riley@rivera.demo");
    const titles = listTodos(dana).map((row) => row.title);
    expect(titles).toContain("Pre-drywall walk");
    expect(titles).toContain("Order the niche tile for Okonkwo");
    expect(titles).not.toContain("Collect the Diaz final invoice");
    expect(titles).not.toContain("Confirm the tile delivery");
    const walk = listTodos(dana).find((row) => row.id === "task_walk");
    expect(walk?.checks.map((check) => check.title)).toContain("Water lines capped");
    expect(walk?.checks.map((check) => check.title)).not.toContain("Blocking in place");
    expect(todoDetail(dana, "task_diaz")).toBeNull();
    expect(() => setTodoCheck(dana, "tchk_walk_block", true)).toThrow(/not assigned/);
    expect(listTodos(riley).some((row) => row.id === "task_diaz")).toBe(true);
    expect(() => setTodoCheck(riley, "tchk_walk_water", true)).toThrow(/cannot change/);
    expect(listTodos(jordan)).toEqual([]);
    expect(() => createTodo(jordan, { title: "Other company", projectId: "proj_okonkwo" })).toThrow(/not in your company/);
    const vendor = vendorTodos(DEMO_HARBOR_PORTAL_TOKEN);
    expect(vendor.map((row) => row.title)).toEqual(["Blocking in place"]);
    expect(JSON.stringify(vendor)).not.toMatch(/cents|contract|margin/i);
    expect(vendorTodos("not-a-token")).toEqual([]);
  });

  it("tracks checklist progress, offers done, and reopens the parent", () => {
    const maya = actor("maya@rivera.demo");
    const taskId = createTodo(maya, {
      title: "Cabinet delivery",
      projectId: "proj_okonkwo",
      checks: [{ title: "Confirm the size" }, { title: "Clear the path" }],
    });
    const detail = todoDetail(maya, taskId);
    const first = detail?.checks[0];
    const second = detail?.checks[1];
    if (!first || !second) throw new Error("missing checks");
    expect(detail?.progress).toBe("0/2");
    expect(setTodoCheck(maya, first.id, true).offerDone).toBe(false);
    expect(todoDetail(maya, taskId)?.progress).toBe("1/2");
    expect(todoDetail(maya, taskId)?.status).toBe("open");
    expect(setTodoCheck(maya, second.id, true).offerDone).toBe(true);
    expect(todoDetail(maya, taskId)?.status).toBe("open");
    completeTodos(maya, [taskId]);
    expect(todoDetail(maya, taskId)?.status).toBe("done");
    setTodoCheck(maya, second.id, false);
    expect(todoDetail(maya, taskId)?.status).toBe("open");
    const audit = getDb().select().from(auditLogs).where(eq(auditLogs.entityId, taskId)).all();
    expect(audit.some((entry) => entry.action === "todo.reopen")).toBe(true);
    const checkAudit = getDb().select().from(auditLogs).where(eq(auditLogs.entityId, second.id)).all();
    expect(checkAudit.some((entry) => entry.action === "todo.check" && entry.payloadJson?.includes(maya.userId))).toBe(true);
  });

  it("applies template to-dos with a relative deadline", () => {
    const maya = actor("maya@rivera.demo");
    const created = createJobFromTemplate(maya, {
      templateId: "tpl_bath",
      name: "Walk bath",
      contactId: "c_okonkwo",
      startDate: "2026-10-05",
      pmUserId: "user_maya",
      parts: ["schedule", "todos"],
      trades: {},
    });
    const items = getDb().select().from(scheduleItems).where(eq(scheduleItems.projectId, created.projectId)).all();
    const plumb = items.find((item) => item.title === "Rough plumbing");
    const walk = getDb().select().from(tasks).where(eq(tasks.relatedId, created.projectId)).all().find((row) => row.title === "Pre-drywall walk");
    if (!plumb || !walk) throw new Error("missing template walk");
    expect(walk.scheduleItemId).toBe(plumb.id);
    expect(walk.dueAt).toBe(linkedDeadline(plumb.endDate, -1));
    expect(getDb().select().from(taskChecks).where(eq(taskChecks.taskId, walk.id)).all()).toHaveLength(3);
    const loose = createJobFromTemplate(maya, {
      templateId: "tpl_kitchen",
      name: "Walk kitchen",
      contactId: "c_okonkwo",
      startDate: "2026-10-05",
      pmUserId: "user_maya",
      parts: ["todos"],
      trades: {},
    });
    const dropped = getDb().select().from(tasks).where(eq(tasks.relatedId, loose.projectId)).all().find((row) => row.title === "Pre-drywall walk");
    expect(dropped?.scheduleItemId).toBeNull();
    expect(dropped?.deadlineUnlinked).toBe(1);
    expect(dropped?.dueAt).toBe(linkedDeadline("2026-10-05", -1));
  });

  it("puts a reminder in Inbox once and audits a completion", () => {
    const maya = actor("maya@rivera.demo");
    const db = getDb();
    db.update(tasks).set({ remindedFor: null }).where(eq(tasks.id, "task_tile_time")).run();
    db.delete(notifications).where(eq(notifications.entityId, "task_tile_time")).run();
    const first = sweepTodoReminders(db, maya.orgId);
    expect(first).toBeGreaterThan(0);
    expect(sweepTodoReminders(db, maya.orgId)).toBe(0);
    const inbox = listInbox(maya, "unread");
    const notice = inbox.find((row) => row.kind === "todo" && row.snippet === "Confirm the tile delivery");
    expect(notice?.who).toBe("Reminder");
    expect(openNotification(maya, notice?.id || "")).toBe("/todos?task=task_tile_time");
    completeTask(maya, "task_ok");
    const audit = db.select().from(auditLogs).where(eq(auditLogs.entityId, "task_ok")).all();
    expect(audit.some((entry) => entry.action === "todo.complete" && entry.actorId === maya.userId)).toBe(true);
    const harbor = vendorTodos(DEMO_HARBOR_PORTAL_TOKEN)[0];
    if (!harbor) throw new Error("missing vendor item");
    vendorTick(DEMO_HARBOR_PORTAL_TOKEN, harbor.id, true, { filename: "cap.png", bytes: png });
    const check = db.select().from(taskChecks).where(eq(taskChecks.id, harbor.id)).get();
    expect(check?.status).toBe("done");
    expect(check?.completedBy).toBe("c_harbor");
    expect(db.select().from(taskFiles).where(eq(taskFiles.checkId, harbor.id)).all()).toHaveLength(1);
    const vendorAudit = db.select().from(auditLogs).where(eq(auditLogs.entityId, harbor.id)).all();
    expect(vendorAudit.some((entry) => entry.action === "todo.check")).toBe(true);
  });
});
