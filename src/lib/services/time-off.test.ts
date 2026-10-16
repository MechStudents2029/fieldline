import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { costItems, scheduleItems, timeApprovals, timeEntries } from "@/lib/db/schema";
import { mentionUnread } from "@/lib/services/comments";
import { authenticate } from "@/lib/services/read";
import { scheduleBoard, saveScheduleItem } from "@/lib/services/schedule";
import { approvedHoursCsv } from "@/lib/services/time";
import {
  allowanceFor,
  approveTimeOff,
  cancelTimeOff,
  declineTimeOff,
  listTimeOff,
  requestTimeOff,
  setPtoAllowance,
  timeOffAttention,
  timeOffAudit,
  timeOffCsv,
  timeOffWarning,
} from "@/lib/services/time-off";
import { dispatchBoard } from "@/lib/services/dispatch";
import { addWorkException } from "@/lib/services/work-calendar";
import { workloadBoard } from "@/lib/services/workload";

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

describe("crew time off", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("seeds one pending request and an approved day on a scheduled item", () => {
    const maya = actor("maya@rivera.demo");
    expect(timeOffAttention(maya)).toEqual({ count: 1, href: "/time-off?status=pending" });
    expect(mentionUnread(maya)).toBe(2);
    const rows = listTimeOff(maya);
    const approved = rows.find((row) => row.id === "toff_dana_out");
    const pending = rows.find((row) => row.status === "pending");
    expect(approved?.name).toBe("Dana Cho");
    expect(approved?.status).toBe("approved");
    expect(approved?.hours).toBe("8");
    expect(pending?.userId).toBe("user_luis");
    expect(timeOffWarning(maya, ["user_dana"], approved!.startOn, approved!.endOn)).toBe("Dana Cho is out");
    const schedule = scheduleBoard(maya, { on: approved!.startOn });
    expect(schedule.rows.find((row) => row.name === "Dana Cho")?.cells.find((cell) => cell.date === approved!.startOn)?.out).toBe(true);
    expect(dispatchBoard(maya, approved!.startOn).columns.find((column) => column.name === "Dana Cho")?.out).toBe(true);
    const board = workloadBoard(maya, {});
    const dana = board.rows.find((row) => row.name === "Dana Cho");
    const sam = board.rows.find((row) => row.name === "Sam Patel");
    expect(dana!.cells[0]!.capacity).toBe(40 * 60);
    expect(dana!.cells[1]!.capacity).toBe(32 * 60);
    expect(dana!.cells[1]!.over).toBe(true);
    expect(sam!.cells[0]!.pto).toBe(8 * 60);
    expect(sam!.cells[0]!.capacity).toBe(16 * 60);
    expect(sam!.cells[1]!.capacity).toBe(24 * 60);
    const saved = saveScheduleItem(maya, {
      projectId: "proj_chen",
      title: "Off day visit",
      startDate: approved!.startOn,
      endDate: approved!.endOn,
      startTime: "15:00",
      status: "planned",
      note: null,
      assigneeIds: ["user_dana"],
    });
    expect(getDb().select().from(scheduleItems).where(eq(scheduleItems.id, saved)).get()?.title).toBe("Off day visit");
    expect(timeOffWarning(maya, ["user_dana"], approved!.startOn, approved!.endOn)).toMatch(/is out/);
    const csv = approvedHoursCsv(maya, approved!.startOn, approved!.endOn);
    expect(csv).toContain("General");
    expect(csv).toContain("PTO");
    expect(csv).toContain("pto");
    expect(csv).toContain("8.00");
    const approval = getDb().select().from(timeApprovals).where(eq(timeApprovals.entryId, "time_dana_off")).get();
    expect(approval?.amountCents).toBe(0);
    expect(approval?.costItemId).toBeNull();
    const sql = readFileSync("supabase/rls.sql", "utf8");
    const member = sql.slice(sql.indexOf("foreach tbl in"), sql.lastIndexOf("foreach tbl in"));
    const money = sql.slice(sql.lastIndexOf("foreach tbl in"));
    expect(member).toContain("'time_off_requests'");
    expect(member).toContain("'time_off_days'");
    expect(money).toContain("'time_off_requests'");
    expect(money).toContain("'time_off_days'");
  });

  it("lets a person see their own requests and blocks field approval", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const luis = actor("luis@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const jordan = actor("jordan@northline.demo");
    expect(listTimeOff(dana).every((row) => row.userId === "user_dana")).toBe(true);
    expect(listTimeOff(dana).some((row) => row.userId === "user_luis")).toBe(false);
    expect(listTimeOff(maya).some((row) => row.userId === "user_luis")).toBe(true);
    expect(listTimeOff(jordan).some((row) => row.name === "Dana Cho")).toBe(false);
    expect(timeOffCsv(dana)).toContain("Dana Cho");
    expect(timeOffCsv(dana)).not.toContain("Luis Ortega");
    expect(timeOffCsv(maya)).toContain("Luis Ortega");
    expect(() => approveTimeOff(dana, "toff_luis_pending")).toThrow(/cannot approve/);
    expect(() => declineTimeOff(dana, "toff_luis_pending", "No")).toThrow(/cannot approve/);
    expect(() => requestTimeOff(riley, { startOn: "2026-12-07", endOn: "2026-12-07", kind: "vacation" })).toThrow(/cannot request/);
    expect(() => setPtoAllowance(dana, "user_dana", "40")).toThrow(/cannot set/);
    expect(luis.role).toBe("estimator");
    const own = requestTimeOff(luis, { startOn: "2026-12-28", endOn: "2026-12-28", kind: "personal", note: "Errand" });
    cancelTimeOff(luis, own);
    expect(listTimeOff(maya).find((row) => row.id === own)?.status).toBe("cancelled");
    const trail = timeOffAudit(maya.orgId, own);
    expect(trail.some((row) => row.action === "timeoff.request" && row.actorId === "user_luis")).toBe(true);
    expect(trail.some((row) => row.action === "timeoff.cancel" && row.actorId === "user_luis" && row.createdAt)).toBe(true);
    expect(() => cancelTimeOff(maya, "toff_luis_pending")).toThrow(/your own request/);
    expect(() => declineTimeOff(maya, "toff_luis_pending", "  ")).toThrow(/reason/);
  });

  it("skips a holiday, posts paid PTO off the job, and drops capacity for unpaid with zero hours", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    addWorkException(maya, { title: "Shop closed", kind: "off", startDate: "2026-12-08", endDate: "2026-12-08" });
    const paid = requestTimeOff(dana, { startOn: "2026-12-07", endOn: "2026-12-09", hours: "4", kind: "sick", note: "Partial" });
    const costs = getDb().select().from(costItems).where(eq(costItems.orgId, maya.orgId)).all().length;
    approveTimeOff(maya, paid, "");
    expect(getDb().select().from(costItems).where(eq(costItems.orgId, maya.orgId)).all().length).toBe(costs);
    const paidRow = listTimeOff(maya).find((row) => row.id === paid);
    expect(paidRow?.hours).toBe("8");
    const week = workloadBoard(maya, { on: "2026-12-07" });
    expect(week.rows.find((row) => row.name === "Dana Cho")?.cells[0]?.capacity).toBe(32 * 60);
    const entry = getDb()
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.userId, "user_dana"))
      .all()
      .filter((row) => row.shiftType === "pto" && row.costCode === "PTO" && row.projectId === "");
    expect(entry.length).toBeGreaterThan(0);
    const approval = getDb()
      .select()
      .from(timeApprovals)
      .all()
      .filter((row) => entry.some((item) => item.id === row.entryId && row.amountCents === 0 && row.costItemId == null));
    expect(approval.length).toBeGreaterThan(0);
    const payroll = approvedHoursCsv(maya, "2026-12-07", "2026-12-09");
    expect(payroll).toContain("General");
    expect(payroll).toContain("4.00");
    expect(payroll).not.toContain("2026-12-08");
    const unpaid = requestTimeOff(dana, { startOn: "2026-12-21", endOn: "2026-12-21", kind: "unpaid" });
    approveTimeOff(maya, unpaid);
    expect(listTimeOff(maya).find((row) => row.id === unpaid)?.hours).toBe("0");
    const unpaidWeek = workloadBoard(maya, { on: "2026-12-21" });
    expect(unpaidWeek.rows.find((row) => row.name === "Dana Cho")?.cells[0]?.capacity).toBe(32 * 60);
    expect(approvedHoursCsv(maya, "2026-12-21", "2026-12-21")).not.toContain("Dana Cho");
    const decided = timeOffAudit(maya.orgId, paid);
    expect(decided.some((row) => row.action === "timeoff.approve" && row.actorId === "user_maya")).toBe(true);
    expect(allowanceFor(maya, "user_dana")).toBeNull();
    setPtoAllowance(maya, "user_dana", "40");
    const left = allowanceFor(maya, "user_dana");
    expect(left).toBeTruthy();
    expect(left!.remaining).toBe(40 * 60 - left!.used);
    expect(listTimeOff(maya).find((row) => row.userId === "user_dana")?.allowanceLabel).toContain("left");
    setPtoAllowance(maya, "user_dana", "");
    expect(allowanceFor(maya, "user_dana")).toBeNull();
  });
});
