import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { costItems, inspectionGates, inspections, permits, scheduleItems, tasks, templateInspections } from "@/lib/db/schema";
import { inNextWorkdays } from "@/lib/permits/rules";
import { authenticate } from "@/lib/services/read";
import { moveScheduleItem, saveScheduleItem } from "@/lib/services/schedule";
import { workCalendarFor } from "@/lib/services/work-calendar";
import { createJobFromTemplate } from "@/lib/services/templates";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";
import {
  closeoutPermitFacts,
  feedInspectionEvents,
  inspectionQueue,
  inspectionTodos,
  permitBoard,
  portalPassedInspections,
  requestReinspection,
  saveInspection,
  savePermit,
  setInspectionGateMode,
  vendorInspectionRows,
} from "@/lib/services/permits";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("permits and inspections", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("seeds Brooks, hides the fee from field, and filters the portals", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const board = permitBoard(maya, "proj_brooks");
    expect(board?.permits[0]).toMatchObject({ number: "B-2026-014", status: "issued", feeCents: 18500, posted: true });
    const field = permitBoard(dana, "proj_brooks");
    expect(field?.showFee).toBe(false);
    expect(field?.canEdit).toBe(false);
    expect(field?.permits[0]?.feeCents).toBeNull();
    expect(field?.permits[0]?.number).toBe("B-2026-014");
    expect(field?.permits[0]?.status).toBe("issued");
    expect(() => savePermit(dana, "proj_brooks", { permitType: "building", number: "X", jurisdiction: "", status: "issued", appliedOn: null, issuedOn: null, expiresOn: null, feeCents: 100, costCode: "GC-SUPER", showPassed: false })).toThrow(/cannot edit/);
    const passed = portalPassedInspections("demo_portal_brooks");
    expect(passed.map((row) => row.name)).toEqual(["Framing"]);
    expect(passed[0]?.date).toBeTruthy();
    const portalJson = JSON.stringify(passed);
    expect(portalJson).not.toContain("Alex Kim");
    expect(portalJson).not.toContain("Strap the supply");
    expect(portalJson).not.toContain("18500");
    expect(portalJson).not.toContain("Failed");
    const vendor = vendorInspectionRows(DEMO_HARBOR_PORTAL_TOKEN);
    expect(vendor).toEqual([expect.objectContaining({ name: "Rough plumbing", result: "Pending" })]);
    expect(JSON.stringify(vendor)).not.toContain("Strap the supply");
    expect(JSON.stringify(vendor)).not.toContain("Pat Nguyen");
    const queue = inspectionQueue(maya.orgId, "2026-10-10");
    expect(queue.upcoming.count).toBe(1);
    expect(queue.failed.count).toBe(1);
    expect(queue.expiring.count).toBe(1);
    const calendar = workCalendarFor(maya.orgId);
    expect(inNextWorkdays("2026-10-10", "2026-10-12", calendar, 3)).toBe(false);
    expect(inNextWorkdays("2026-10-10", "2026-10-13", calendar, 3)).toBe(true);
    expect(inNextWorkdays("2026-10-10", "2026-10-16", calendar, 3)).toBe(false);
    expect(closeoutPermitFacts(maya.orgId, "proj_brooks")).toEqual({ permitsOpen: 1, inspectionsOpen: 2 });
    const todos = inspectionTodos(maya, "insp_br_rough");
    expect(todos.ids).toHaveLength(2);
    expect(inspectionTodos(maya, "insp_br_rough").ids).toEqual(todos.ids);
    expect(getDb().select().from(tasks).where(eq(tasks.orgId, maya.orgId)).all().filter((task) => task.tags.includes("inspection:insp_br_rough"))).toHaveLength(2);
    const feed = feedInspectionEvents(maya.orgId, "user_luis");
    expect(feed.some((row) => row.title.includes("Framing"))).toBe(true);
    expect(feed.some((row) => row.title.includes("Rough plumbing"))).toBe(true);
    expect(JSON.stringify(feed)).not.toContain("Strap the supply");
  });

  it("posts a permit fee once and keeps re-inspection history", () => {
    const maya = actor("maya@rivera.demo");
    const before = getDb().select().from(costItems).where(and(eq(costItems.orgId, maya.orgId), eq(costItems.projectId, "proj_chen"), eq(costItems.source, "permit"))).all();
    const saved = savePermit(maya, "proj_chen", {
      permitType: "electrical",
      number: "E-100",
      jurisdiction: "Austin",
      status: "issued",
      appliedOn: "2026-10-01",
      issuedOn: "2026-10-02",
      expiresOn: null,
      feeCents: 2500,
      costCode: "ELE-KIT",
      showPassed: false,
    });
    const posted = getDb().select().from(costItems).where(and(eq(costItems.orgId, maya.orgId), eq(costItems.projectId, "proj_chen"), eq(costItems.source, "permit"))).all();
    expect(posted).toHaveLength(before.length + 1);
    savePermit(
      maya,
      "proj_chen",
      {
        permitType: "electrical",
        number: "E-100",
        jurisdiction: "Austin",
        status: "issued",
        appliedOn: "2026-10-01",
        issuedOn: "2026-10-02",
        expiresOn: null,
        feeCents: 9900,
        costCode: "ELE-KIT",
        showPassed: false,
      },
      saved.id,
    );
    const again = getDb().select().from(costItems).where(and(eq(costItems.orgId, maya.orgId), eq(costItems.projectId, "proj_chen"), eq(costItems.source, "permit"))).all();
    expect(again).toHaveLength(posted.length);
    expect(getDb().select().from(permits).where(eq(permits.id, saved.id)).get()?.feeCents).toBe(2500);
    const failed = saveInspection(maya, "proj_chen", {
      permitId: saved.id,
      name: "Rough electrical",
      scheduleItemId: null,
      requestedOn: null,
      scheduledOn: "2026-10-14",
      inspector: "Alex Kim",
      result: "failed",
      notes: "Replace the trap\nStrap the line",
      gateItemIds: [],
    });
    const next = requestReinspection(maya, failed.id);
    expect(next.attempt).toBe(2);
    const chain = getDb().select().from(inspections).where(and(eq(inspections.orgId, maya.orgId), eq(inspections.rootId, failed.id))).all();
    expect(chain).toHaveLength(2);
    expect(chain.find((row) => row.attempt === 2)?.result).toBe("pending");
    expect(() => requestReinspection(maya, failed.id)).toThrow(/already open/);
    const created = inspectionTodos(maya, failed.id);
    expect(created.ids).toHaveLength(2);
    expect(inspectionTodos(maya, failed.id).ids).toEqual(created.ids);
  });

  it("warns, blocks, or ignores a gated move", () => {
    const maya = actor("maya@rivera.demo");
    const row = getDb().select().from(scheduleItems).where(eq(scheduleItems.id, "sch_br_drywall")).get();
    if (!row) throw new Error("missing drywall");
    const input = (status: "planned" | "confirmed" | "done") => ({
      projectId: row.projectId,
      title: row.title,
      startDate: row.startDate,
      endDate: row.endDate,
      startTime: null as string | null,
      status,
      note: null as string | null,
      assigneeIds: ["user_luis"],
    });
    setInspectionGateMode(maya, "block");
    expect(() => saveScheduleItem(maya, input("done"), row.id, null, true)).toThrow(/has not passed/);
    setInspectionGateMode(maya, "warn");
    expect(() => saveScheduleItem(maya, input("done"), row.id)).toThrow(/has not passed/);
    saveScheduleItem(maya, input("done"), row.id, null, true);
    expect(getDb().select().from(scheduleItems).where(eq(scheduleItems.id, row.id)).get()?.status).toBe("done");
    saveScheduleItem(maya, input("planned"), row.id);
    expect(() => moveScheduleItem(maya, row.id, { startDate: "2026-10-06", endDate: "2026-10-06", assigneeId: "user_luis" })).toThrow(/has not passed/);
    setInspectionGateMode(maya, "off");
    moveScheduleItem(maya, row.id, { startDate: "2026-10-06", endDate: "2026-10-06", assigneeId: "user_luis" });
    moveScheduleItem(maya, row.id, { startDate: row.startDate, endDate: row.endDate, assigneeId: "user_luis" });
    setInspectionGateMode(maya, "warn");
    expect(getDb().select().from(scheduleItems).where(eq(scheduleItems.id, row.id)).get()?.startDate).toBe(row.startDate);
  });

  it("copies a template permit and its gate", () => {
    const maya = actor("maya@rivera.demo");
    expect(getDb().select().from(templateInspections).where(eq(templateInspections.templateId, "tpl_kitchen")).all()).toHaveLength(3);
    const created = createJobFromTemplate(maya, {
      templateId: "tpl_bath",
      name: "Permit bath",
      contactId: "c_okonkwo",
      startDate: "2026-10-05",
      pmUserId: "user_maya",
      parts: ["schedule"],
      trades: {},
    });
    const copied = getDb().select().from(permits).where(eq(permits.projectId, created.projectId)).all();
    expect(copied).toHaveLength(1);
    expect(copied[0]?.permitType).toBe("building");
    const rows = getDb().select().from(inspections).where(eq(inspections.projectId, created.projectId)).all();
    expect(rows.map((row) => row.name).sort()).toEqual(["Final", "Rough plumbing"]);
    const tile = getDb().select().from(scheduleItems).where(eq(scheduleItems.projectId, created.projectId)).all().find((item) => item.title === "Tile shower");
    const rough = rows.find((row) => row.name === "Rough plumbing");
    const gates = getDb().select().from(inspectionGates).where(eq(inspectionGates.inspectionId, rough?.id ?? "")).all();
    expect(gates.map((gate) => gate.scheduleItemId)).toEqual([tile?.id]);
  });
});
