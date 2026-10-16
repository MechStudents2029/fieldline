import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, meetingActions, meetings, tasks } from "@/lib/db/schema";
import { mentionUnread } from "@/lib/services/comments";
import {
  addAction,
  addItem,
  approveMinutes,
  createActionTodo,
  createMeeting,
  followUpMeeting,
  listMeetings,
  meetingAttention,
  meetingDetail,
  meetingsCsv,
  portalMeetingsForClient,
  portalMeetingsForVendor,
  reviseMeeting,
  setActionStatus,
  startMinutes,
} from "@/lib/services/meetings";
import { authenticate } from "@/lib/services/read";
import { completeTodos } from "@/lib/services/todos";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";

function clearSupabaseEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(email);
  return user;
}

describe("project meetings", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("seeds an approved OAC with a carried item and one overdue action", () => {
    const maya = actor("maya@rivera.demo");
    expect(meetingAttention(maya)).toEqual({ count: 1, href: "/meetings?filter=overdue" });
    expect(mentionUnread(maya)).toBe(2);
    const upcoming = listMeetings(maya, { filter: "upcoming" });
    expect(upcoming.some((row) => row.id === "mtg_ok_oac_2" && row.status === "agenda")).toBe(true);
    const overdue = listMeetings(maya, { filter: "overdue" });
    expect(overdue.map((row) => row.id)).toEqual(["mtg_br_sub"]);
    const carried = meetingDetail(maya, "mtg_ok_oac_2");
    expect(carried?.items.map((item) => item.sourceLabel)).toEqual(["from meeting #1"]);
    expect(carried?.items[0]?.title).toBe("Tile niche");
    expect(carried?.items.some((item) => item.title === "Valve spec")).toBe(false);
    expect(meetingDetail(maya, "mtg_ok_oac_1")?.status).toBe("approved");
    expect(meetingsCsv(maya, { filter: "overdue" })).toContain("Confirm the valve delivery");
    const sql = readFileSync("supabase/rls.sql", "utf8");
    const member = sql.slice(sql.indexOf("foreach tbl in"), sql.lastIndexOf("foreach tbl in"));
    const money = sql.slice(sql.lastIndexOf("foreach tbl in"));
    for (const table of ["meetings", "meeting_attendees", "meeting_items", "meeting_actions"]) {
      expect(member).toContain(`'${table}'`);
      expect(money).toContain(`'${table}'`);
    }
    expect(actor("jordan@northline.demo") && listMeetings(actor("jordan@northline.demo")).some((row) => row.id === "mtg_br_sub")).toBe(false);
  });

  it("locks approved minutes and revises them into a new version", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    expect(() => createMeeting(dana, { projectId: "proj_chen", kind: "oac", title: "Field", meetOn: "2026-11-02", startTime: "09:00", location: "" })).toThrow(/role/);
    expect(() => createMeeting(riley, { projectId: "proj_chen", kind: "oac", title: "Viewer", meetOn: "2026-11-02", startTime: "09:00", location: "" })).toThrow(/role/);
    const meetingId = createMeeting(maya, { projectId: "proj_chen", kind: "internal", title: "Lock check", meetOn: "2026-11-20", startTime: "11:00", location: "Office", userId: "user_maya" });
    const itemId = addItem(maya, meetingId, { title: "Access", link: "" });
    addAction(maya, itemId, { title: "Bring the key", assignee: "user:user_maya", dueOn: "2026-12-01" });
    expect(() => addItem(maya, meetingId, { title: "Wrong job", link: "rfi:rfi_ok_niche" })).toThrow(/not on this job/);
    startMinutes(maya, meetingId);
    approveMinutes(maya, meetingId);
    expect(meetingDetail(maya, meetingId)?.status).toBe("approved");
    expect(() => addItem(maya, meetingId, { title: "Late item" })).toThrow(/locked/);
    const revisionId = reviseMeeting(maya, meetingId);
    const revision = meetingDetail(maya, revisionId);
    expect(revision?.status).toBe("minutes");
    expect(revision?.version).toBe(2);
    expect(revision?.items.map((item) => item.title)).toContain("Access");
    expect(getDb().select().from(meetings).where(eq(meetings.id, meetingId)).get()?.status).toBe("approved");
    expect(listMeetings(maya).some((row) => row.id === meetingId)).toBe(false);
    expect(listMeetings(maya).some((row) => row.id === revisionId)).toBe(true);
    const audit = getDb().select().from(auditLogs).where(eq(auditLogs.entityId, revisionId)).all();
    expect(audit.some((row) => row.action === "meeting.revise")).toBe(true);
  });

  it("carries open items into the follow-up and syncs a linked to-do", () => {
    const maya = actor("maya@rivera.demo");
    const meetingId = createMeeting(maya, {
      projectId: "proj_okonkwo",
      kind: "oac",
      title: "OAC extra",
      meetOn: "2026-11-18",
      startTime: "09:00",
      location: "Trailer",
      vendorId: "c_harbor",
      clientId: "c_okonkwo",
    });
    const itemId = addItem(maya, meetingId, { title: "Niche blocking", link: "rfi:rfi_ok_niche" });
    addItem(maya, meetingId, { title: "Closed later" });
    const actionId = addAction(maya, itemId, { title: "E2E harbor action", assignee: "vendor:c_harbor", dueOn: "2026-12-02" });
    const otherId = addAction(maya, itemId, { title: "Maya only action", assignee: "user:user_maya", dueOn: "2026-12-03" });
    addAction(maya, itemId, { title: "Amara picks the niche", assignee: "client:c_okonkwo", dueOn: "2026-12-05" });
    const todoId = createActionTodo(maya, actionId);
    expect(getDb().select().from(tasks).where(eq(tasks.id, todoId)).get()?.status).toBe("open");
    setActionStatus(maya, actionId, "done");
    expect(getDb().select().from(tasks).where(eq(tasks.id, todoId)).get()?.status).toBe("done");
    expect(getDb().select().from(meetingActions).where(eq(meetingActions.id, actionId)).get()?.status).toBe("done");
    const secondId = addAction(maya, itemId, { title: "Sync from to-do", assignee: "user:user_maya", dueOn: "2026-12-04" });
    const secondTodo = createActionTodo(maya, secondId);
    completeTodos(maya, [secondTodo]);
    expect(getDb().select().from(meetingActions).where(eq(meetingActions.id, secondId)).get()?.status).toBe("done");
    startMinutes(maya, meetingId);
    approveMinutes(maya, meetingId);
    const followId = followUpMeeting(maya, meetingId, "2026-11-25");
    const follow = meetingDetail(maya, followId);
    expect(follow?.number).toBe(2);
    expect(follow?.status).toBe("agenda");
    expect(follow?.items.map((item) => item.title)).toContain("Niche blocking");
    expect(follow?.items.find((item) => item.title === "Niche blocking")?.sourceLabel).toBe("from meeting #1");
    const openTitles = follow?.items.flatMap((item) => item.actions.map((action) => action.title)) ?? [];
    expect(openTitles).toContain("Maya only action");
    expect(openTitles).toContain("Amara picks the niche");
    expect(openTitles).not.toContain("E2E harbor action");
    expect(openTitles).not.toContain("Sync from to-do");
    const client = portalMeetingsForClient("demo_portal_okonkwo");
    expect(client.some((row) => row.id === "mtg_ok_oac_1")).toBe(true);
    expect(client.some((row) => row.id === "mtg_ok_oac_2")).toBe(false);
    expect(client.find((row) => row.id === meetingId)?.actions.map((action) => action.title)).toEqual(["Amara picks the niche"]);
    expect(JSON.stringify(client)).not.toContain("Maya only action");
    expect(JSON.stringify(client)).not.toContain("E2E harbor action");
    const vendor = portalMeetingsForVendor(DEMO_HARBOR_PORTAL_TOKEN);
    expect(vendor.find((row) => row.id === meetingId)?.actions.map((action) => action.title)).toEqual(["E2E harbor action"]);
    expect(JSON.stringify(vendor)).not.toContain("Maya only action");
    expect(JSON.stringify(vendor)).not.toContain("Amara picks the niche");
    expect(vendor.some((row) => row.id === "mtg_br_sub")).toBe(false);
    expect(portalMeetingsForVendor("missing")).toEqual([]);
    expect(otherId).toBeTruthy();
  });
});
