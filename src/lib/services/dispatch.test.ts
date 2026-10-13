import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, scheduleAssignees, scheduleItems } from "@/lib/db/schema";
import { assignDispatch, dispatchBoard } from "@/lib/services/dispatch";
import { authenticate } from "@/lib/services/read";
import { todayKey } from "@/lib/receiving/facts";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("day dispatch", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("blocks an overlap, keeps the audit, and lets a later window move", () => {
    const maya = actor("maya@rivera.demo");
    const day = todayKey(getDb(), maya.orgId);
    const board = dispatchBoard(maya, day);
    expect(board.columns.map((column) => column.name)).not.toContain("Unassigned");
    expect(board.columns.every((column) => column.id)).toBe(true);
    expect(board.columns.map((column) => column.name)).toContain("Dana Cho");
    expect(board.cards.some((card) => card.title === "Coil visit" && !card.assigneeId)).toBe(true);
    expect(() => assignDispatch(maya, { cardId: "item:sch_disp_coil", assigneeId: "user_dana", start: "07:30", end: "08:30", day })).toThrow(/Overlaps Tile shower/);
    expect(getDb().select().from(scheduleAssignees).where(eq(scheduleAssignees.itemId, "sch_disp_coil")).all()).toEqual([]);
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.action, "dispatch.assign")).all()).toEqual([]);

    assignDispatch(maya, { cardId: "item:sch_disp_coil", assigneeId: "user_maya", start: "08:30", end: "09:30", day });
    assignDispatch(maya, { cardId: "item:sch_disp_coil", assigneeId: "user_maya", start: "08:30", end: "09:30", day });
    expect(getDb().select().from(scheduleAssignees).where(eq(scheduleAssignees.itemId, "sch_disp_coil")).all().map((row) => row.userId)).toEqual(["user_maya"]);
    const placed = getDb().select().from(auditLogs).where(and(eq(auditLogs.orgId, maya.orgId), eq(auditLogs.entityId, "sch_disp_coil"))).all();
    expect(placed.map((row) => row.action)).toEqual(["dispatch.assign"]);

    assignDispatch(maya, { cardId: "item:sch_disp_coil", assigneeId: "user_luis", start: "15:00", end: "16:00", day });
    const moved = getDb().select().from(auditLogs).where(eq(auditLogs.entityId, "sch_disp_coil")).all();
    expect(moved.map((row) => row.action)).toEqual(["dispatch.assign", "dispatch.reassign"]);
    expect(getDb().select().from(scheduleItems).where(eq(scheduleItems.id, "sch_disp_coil")).get()).toMatchObject({ startTime: "15:00", endTime: "16:00" });

    assignDispatch(maya, { cardId: "item:sch_disp_coil", assigneeId: null, start: "15:00", end: "16:00", day });
    expect(getDb().select().from(scheduleAssignees).where(eq(scheduleAssignees.itemId, "sch_disp_coil")).all()).toEqual([]);
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.entityId, "sch_disp_coil")).all().map((row) => row.action)).toEqual(["dispatch.assign", "dispatch.reassign", "dispatch.unassign"]);

    expect(() => assignDispatch(actor("dana@rivera.demo"), { cardId: "item:sch_disp_coil", assigneeId: "user_luis", start: "15:00", end: "16:00", day })).toThrow(/view the day/);
    const field = dispatchBoard(actor("dana@rivera.demo"), day);
    expect(field.canEdit).toBe(false);
    expect(field.columns.map((column) => column.name)).toEqual(["Dana Cho"]);
    expect(field.cards.every((card) => card.assigneeId === "user_dana")).toBe(true);
  });
});
