import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { scheduleDelays, scheduleItems } from "@/lib/db/schema";
import { workdayOffset } from "@/lib/schedule/workdays";
import { portalByToken, authenticate } from "@/lib/services/read";
import { moveScheduleItem, saveScheduleItem } from "@/lib/services/schedule";
import { replaceScheduleLinks } from "@/lib/services/schedule-shift";
import { baselineHistory, scheduleVariance, setScheduleBaseline, slippedSchedule } from "@/lib/services/schedule-plan";
import { workCalendarFor } from "@/lib/services/work-calendar";
import { draftClientUpdate, renderUpdateBody } from "@/lib/updates/draft";
import { gatherClientUpdateFacts } from "@/lib/updates/gather";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("schedule baseline and delays", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("compares Brooks to its baseline and keeps delay reasons off the portal", () => {
    const maya = actor("maya@rivera.demo");
    const report = scheduleVariance(maya);
    const brooks = report.rows.find((row) => row.projectId === "proj_brooks");
    expect(brooks?.baselineFinish).toBeTruthy();
    expect(brooks?.currentFinish).toBeTruthy();
    const calendar = workCalendarFor(maya.orgId, "proj_brooks");
    expect(brooks?.variance).toBe(workdayOffset(brooks!.baselineFinish!, brooks!.currentFinish!, calendar));
    expect(brooks?.variance).toBeGreaterThanOrEqual(5);
    expect(brooks?.delays.weather).toBe(3);
    expect(brooks?.delays.material).toBe(2);
    expect(slippedSchedule(maya.orgId).count).toBe(1);
    expect(calendar.exceptions.some((row) => row.kind === "off" && row.start === "2026-10-12")).toBe(true);
    expect(calendar.exceptions.some((row) => row.kind === "work")).toBe(true);
    const portal = JSON.stringify(portalByToken("demo_portal_brooks"));
    expect(portal).not.toContain("Storm held the crane");
    const facts = gatherClientUpdateFacts(getDb(), maya.orgId, "proj_brooks", { start: "2026-01-01", end: "2026-12-31" }, "America/New_York");
    expect(JSON.stringify(facts)).not.toContain("Storm held the crane");
    expect(renderUpdateBody(draftClientUpdate(facts))).not.toContain("Storm held the crane");
    expect(() => scheduleVariance(actor("dana@rivera.demo"))).toThrow(/cannot open/);
  });

  it("keeps the earlier baseline and logs one delay on a cascade root", () => {
    const maya = actor("maya@rivera.demo");
    const root = saveScheduleItem(maya, {
      projectId: "proj_chen",
      title: "Root slab",
      startDate: "2026-10-13",
      endDate: "2026-10-13",
      startTime: null,
      status: "planned",
      note: null,
      assigneeIds: [],
    });
    const child = saveScheduleItem(maya, {
      projectId: "proj_chen",
      title: "Root successor",
      startDate: "2026-10-14",
      endDate: "2026-10-14",
      startTime: null,
      status: "planned",
      note: null,
      assigneeIds: [],
    });
    replaceScheduleLinks(maya, child, [{ predecessorId: root, lag: 0 }]);
    const first = setScheduleBaseline(maya, "proj_chen");
    moveScheduleItem(maya, root, { startDate: "2026-10-15", endDate: "2026-10-15", assigneeId: null }, { reason: "weather", note: null });
    const moved = getDb().select().from(scheduleItems).where(and(eq(scheduleItems.orgId, maya.orgId), eq(scheduleItems.id, child))).get();
    expect(moved?.startDate).toBe("2026-10-16");
    const delays = getDb().select().from(scheduleDelays).where(and(eq(scheduleDelays.orgId, maya.orgId), eq(scheduleDelays.projectId, "proj_chen"))).all();
    expect(delays).toHaveLength(1);
    expect(delays[0]).toMatchObject({ itemId: root, reason: "weather", days: 2 });
    expect(() => moveScheduleItem(maya, root, { startDate: "2026-10-16", endDate: "2026-10-16", assigneeId: null })).toThrow(/reason/i);
    const again = setScheduleBaseline(maya, "proj_chen");
    const history = baselineHistory(maya, "proj_chen");
    expect(history.filter((row) => row.current)).toHaveLength(1);
    expect(history.some((row) => row.id === first.id && !row.current)).toBe(true);
    expect(history.find((row) => row.id === again.id)?.setBy).toBe("Maya Rivera");
    expect(() => setScheduleBaseline(actor("dana@rivera.demo"), "proj_chen")).toThrow(/view the schedule/);
  });
});
