import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { clientUpdateFromFacts } from "@/lib/ai/client-update";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, equipment, safetyCheckItems, tasks, toolboxAttendees, toolboxTalks } from "@/lib/db/schema";
import type { OfflineEvent } from "@/lib/offline/event";
import { addWorkdays } from "@/lib/schedule/workdays";
import { saveAutomation, toggleAutomation } from "@/lib/services/automations";
import { checkOut } from "@/lib/services/equipment";
import { authenticate, portalByToken } from "@/lib/services/read";
import { portalClientUpdates } from "@/lib/services/client-updates";
import {
  completeTalk,
  createIncident,
  incidentView,
  linkCheckTodo,
  listSafety,
  listTemplates,
  runChecklist,
  safetyQueue,
  scheduleTalk,
  talkStatus,
} from "@/lib/services/safety";
import { applyOfflineBatch } from "@/lib/services/sync";
import { workCalendarFor } from "@/lib/services/work-calendar";
import { vendorPortal } from "@/lib/services/vendor-portal";
import { renderUpdateBody } from "@/lib/updates/draft";
import { gatherClientUpdateFacts } from "@/lib/updates/gather";
import { defaultRange } from "@/lib/updates/range";
import { localDay } from "@/lib/time/calendar";

const SIGN = "data:image/png;base64,iVBORw0KGgo=";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

function today() {
  return localDay(Date.now(), "America/New_York");
}

describe("jobsite safety", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("marks a past talk missed and keeps a signed talk locked", () => {
    const maya = actor("maya@rivera.demo");
    const missed = getDb().select().from(toolboxTalks).where(eq(toolboxTalks.id, "talk_br_missed")).get();
    expect(missed).toBeTruthy();
    expect(talkStatus(missed!, today())).toBe("missed");
    expect(listSafety(maya, { type: "talk", status: "missed" }).some((row) => row.id === "talk_br_missed")).toBe(true);
    expect(safetyQueue("org_rivera", today()).missed.count).toBeGreaterThan(0);
    const talkId = scheduleTalk(maya, {
      projectId: "proj_chen",
      topicId: "topic_ppe",
      scheduledOn: today(),
      leaderUserId: "user_maya",
    });
    completeTalk(maya, talkId, {
      attendees: [{ userId: "user_maya", visitorName: "", typedName: "Maya Rivera", drawnDataUrl: SIGN }],
    });
    expect(getDb().select().from(toolboxAttendees).where(eq(toolboxAttendees.talkId, talkId)).all()).toHaveLength(1);
    expect(() =>
      completeTalk(maya, talkId, {
        attendees: [{ userId: "user_dana", visitorName: "", typedName: "Dana Cho", drawnDataUrl: SIGN }],
      }),
    ).toThrow(/locked/);
    expect(getDb().select().from(toolboxAttendees).where(eq(toolboxAttendees.talkId, talkId)).all()).toHaveLength(1);
    expect(talkStatus(getDb().select().from(toolboxTalks).where(eq(toolboxTalks.id, talkId)).get()!, today())).toBe("completed");
  });

  it("replays an offline sign-off once", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const talkId = scheduleTalk(maya, {
      projectId: "proj_chen",
      topicId: "topic_house",
      scheduledOn: today(),
      leaderUserId: "user_dana",
    });
    const event: OfflineEvent = {
      clientEventId: randomUUID(),
      seq: 1,
      kind: "toolbox_complete",
      capturedAt: new Date().toISOString(),
      orgId: "org_rivera",
      userId: "user_dana",
      projectId: "proj_chen",
      costCode: null,
      note: null,
      lat: null,
      lng: null,
      log: null,
      talk: {
        talkId,
        attendees: [{ userId: "user_dana", visitorName: "", typedName: "Dana Cho", drawnDataUrl: SIGN }],
      },
    };
    const first = applyOfflineBatch(dana, [event], Date.now());
    const second = applyOfflineBatch(dana, [event], Date.now() + 1000);
    expect(first[0]?.status).toBe("applied");
    expect(second[0]?.status).toBe("applied");
    expect(second[0]?.entryId).toBe(first[0]?.entryId);
    expect(getDb().select().from(toolboxAttendees).where(eq(toolboxAttendees.talkId, talkId)).all()).toHaveLength(1);
    expect(getDb().select().from(toolboxTalks).where(eq(toolboxTalks.id, talkId)).get()?.completedAt).toBeTruthy();
  });

  it("creates one to-do when a failed checklist item is linked twice", () => {
    const maya = actor("maya@rivera.demo");
    const walk = listTemplates("org_rivera").find((row) => row.id === "stpl_walk");
    expect(walk).toBeTruthy();
    const before = getDb().select().from(tasks).all().length;
    const checkId = runChecklist(maya, {
      projectId: "proj_chen",
      templateId: walk!.id,
      items: walk!.items.map((item, index) => ({ templateItemId: item.id, result: index === 0 ? "fail" : "pass" })),
    });
    const failed = getDb().select().from(safetyCheckItems).where(and(eq(safetyCheckItems.checkId, checkId), eq(safetyCheckItems.result, "fail"))).get();
    expect(failed).toBeTruthy();
    const first = linkCheckTodo(maya, failed!.id);
    const second = linkCheckTodo(maya, failed!.id);
    expect(second).toBe(first);
    expect(getDb().select().from(tasks).all().length).toBe(before + 1);
    expect(getDb().select().from(safetyCheckItems).where(eq(safetyCheckItems.id, failed!.id)).get()?.todoId).toBe(first);
  });

  it("hides other incidents from the field, keeps them off the portal, and takes equipment out of service", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    expect(listSafety(maya, { type: "incident" }).some((row) => row.title === "Stair opening near miss")).toBe(true);
    expect(listSafety(dana, { type: "incident" }).some((row) => row.title === "Stair opening near miss")).toBe(false);
    expect(listSafety(dana, { type: "incident" }).some((row) => row.title === "Splinter from the jamb")).toBe(true);
    expect(incidentView(dana, "inc_br_stair")).toBeNull();
    expect(incidentView(maya, "inc_br_stair")?.description).toBe("Stair opening near miss");
    expect(listSafety(riley, { type: "incident" })).toHaveLength(0);
    const facts = gatherClientUpdateFacts(getDb(), "org_rivera", "proj_brooks", defaultRange(Date.now(), "America/New_York"), "America/New_York");
    expect(renderUpdateBody(clientUpdateFromFacts(facts))).not.toContain("Stair opening near miss");
    const portal = portalByToken("demo_portal_brooks");
    expect(portal).toBeTruthy();
    expect(JSON.stringify(portal)).not.toContain("Stair opening near miss");
    expect(JSON.stringify(portalClientUpdates("demo_portal_brooks", null))).not.toContain("Stair opening near miss");
    const vendor = vendorPortal("demo_vendor_harbor_m3p8qx7k");
    expect(vendor).toBeTruthy();
    expect(JSON.stringify(vendor)).not.toContain("Stair opening near miss");
    const incidentId = createIncident(maya, {
      projectId: "proj_chen",
      equipmentId: "eq_laser",
      kind: "equipment",
      occurredAt: new Date().toISOString(),
      description: "Laser level will not self-level",
      factors: "Dropped off the sawhorse.",
      people: ["Maya Rivera"],
      actions: [{ title: "Send the laser in", assigneeUserId: "user_maya" }],
    });
    expect(getDb().select().from(equipment).where(eq(equipment.id, "eq_laser")).get()?.status).toBe("in_service");
    expect(() =>
      checkOut(maya, { equipmentId: "eq_laser", projectId: "proj_chen", userId: null, expectedReturn: null, transfer: false, hours: null, costCents: null }),
    ).toThrow(/In service/);
    expect(incidentView(maya, incidentId)?.equipment?.name).toBe("Laser level");
    const scheduled = addWorkdays(today(), 2, workCalendarFor("org_rivera"));
    const talks = getDb().select().from(toolboxTalks).where(eq(toolboxTalks.projectId, "proj_chen")).all();
    expect(talks.some((row) => row.topicId === "topic_ladder" && row.scheduledOn === scheduled)).toBe(true);
    const ruleId = saveAutomation(maya, {
      name: "Failed check schedules a talk",
      enabled: true,
      trigger: { kind: "checklist_failed" },
      conditions: [],
      actions: [{ kind: "schedule_talk", topicId: "topic_silica", withinWorkdays: 2 }],
    });
    const ladder = listTemplates("org_rivera").find((row) => row.id === "stpl_ladder");
    runChecklist(maya, {
      projectId: "proj_diaz",
      templateId: ladder!.id,
      items: ladder!.items.map((item, index) => ({ templateItemId: item.id, result: index === 0 ? "fail" : "na" })),
    });
    expect(getDb().select().from(toolboxTalks).where(and(eq(toolboxTalks.projectId, "proj_diaz"), eq(toolboxTalks.topicId, "topic_silica"))).all().length).toBe(1);
    toggleAutomation(maya, ruleId, false);
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.entityType, "incident")).all().length).toBeGreaterThan(0);
  });
});
