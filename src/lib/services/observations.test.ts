import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { costItems, inspections, notifications, observationEvents, observations, planPins, safetyCheckItems, safetyChecks, vendorCredits } from "@/lib/db/schema";
import { nowIso } from "@/lib/ids";
import { parseTrigger, previewChoices, triggerLabel } from "@/lib/services/automations";
import { listInbox, mentionUnread } from "@/lib/services/comments";
import { ServiceError } from "@/lib/services/errors";
import {
  addObservationPhoto,
  closeObservation,
  createObservation,
  createObservationBackcharge,
  linkObservationFromCheck,
  linkObservationFromInspection,
  listObservations,
  markObservationReady,
  notAcceptObservation,
  observationAttention,
  observationDetail,
  observationsCsv,
  openObservation,
  portalObservationRows,
  portalReadyObservation,
  saveObservation,
  voidObservation,
} from "@/lib/services/observations";
import { punchBoard } from "@/lib/services/punch";
import { authenticate, portalByToken } from "@/lib/services/read";
import { vendorPortal } from "@/lib/services/vendor-portal";
import { wipJob } from "@/lib/services/wip";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>");

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

describe("observations", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("seeds one overdue open, one aged review, a closed quality row, and a Brooks draft", () => {
    const maya = actor("maya@rivera.demo");
    const rows = listObservations(maya, {});
    expect(rows.map((row) => [row.id, row.status, row.priority, row.type])).toEqual([
      ["obs_br_d", "draft", "low", "commissioning"],
      ["obs_ok_q", "ready", "high", "quality"],
      ["obs_ok_s", "open", "high", "safety"],
      ["obs_ok_c", "closed", "medium", "quality"],
    ]);
    expect(observationDetail(maya, "obs_ok_q")?.photos.map((photo) => photo.documentId)).toEqual(["doc_ok_harbor"]);
    expect(observationDetail(maya, "obs_ok_s")?.hazard).toBe("Fall");
    expect(observationDetail(maya, "obs_ok_s")?.overdue).toBe(true);
    expect(observationDetail(maya, "obs_ok_q")?.reviewAged).toBe(true);
    const attention = observationAttention(maya);
    expect(attention.overdue).toEqual({ count: 1, href: "/observations?filter=overdue" });
    expect(attention.review).toEqual({ count: 1, href: "/observations?filter=review" });
    expect(listObservations(maya, { status: "overdue" }).map((row) => row.id)).toEqual(["obs_ok_s"]);
    expect(listObservations(maya, { status: "review", vendorContactId: "c_harbor", projectId: "proj_okonkwo", type: "quality", priority: "high" }).map((row) => row.id)).toEqual(["obs_ok_q"]);
    expect(punchBoard(maya, "proj_okonkwo")?.closeout.checklist.find((row) => row.key === "observations")?.count).toBe(1);
    expect(punchBoard(maya, "proj_diaz")?.closeout.checklist.find((row) => row.key === "observations")?.count).toBe(0);
    expect(punchBoard(maya, "proj_brooks")?.closeout.checklist.find((row) => row.key === "observations")?.count).toBe(0);
    expect(mentionUnread(maya)).toBe(2);
    expect(observationsCsv(maya)).toContain("Shower valve rough is proud");
    expect(observationsCsv(maya, { status: "overdue" })).toContain("Open stair guard");
    expect(observationsCsv(maya, { status: "overdue" })).not.toContain("Frame check draft");
    const sql = readFileSync("supabase/rls.sql", "utf8");
    for (const table of ["observations", "observation_photos", "observation_events"]) {
      expect(sql.split(`'${table}'`).length - 1).toBe(2);
    }
    expect(parseTrigger(JSON.stringify({ kind: "observation_overdue" }))).toEqual({ kind: "observation_overdue" });
    expect(triggerLabel({ kind: "observation_overdue" })).toBe("Observation overdue");
    expect(previewChoices(maya.orgId, { kind: "observation_overdue" }).map((row) => row.id)).toEqual(["obs_ok_s"]);
    expect(observationDetail(actor("jordan@northline.demo"), "obs_ok_q")).toBeNull();
    expect(listObservations(actor("jordan@northline.demo"), {})).toEqual([]);
    expect(listObservations(actor("riley@rivera.demo"), {}).length).toBe(4);
    expect(listObservations(actor("dana@rivera.demo"), {}).length).toBe(4);
    const harbor = vendorPortal(DEMO_HARBOR_PORTAL_TOKEN);
    expect(harbor?.observations.map((row) => row.title)).toEqual(["Open stair guard"]);
    expect(JSON.stringify(harbor)).not.toContain("Tile lip closed");
    expect(JSON.stringify(harbor)).not.toContain("Frame check draft");
    expect(vendorPortal("demo_vendor_brighton_k4n2p9qx")?.observations).toEqual([]);
    expect(JSON.stringify(portalByToken("demo_portal_okonkwo"))).not.toContain("Shower valve rough is proud");
    expect(JSON.stringify(portalByToken("demo_portal_okonkwo"))).not.toContain("Open stair guard");
    expect(portalObservationRows("org_rivera", "c_brighton")).toEqual([]);
  });

  it("walks draft, open, ready, not accepted, and closed, and locks the record", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    expect(() => createObservation(riley, { projectId: "proj_brooks", title: "Viewer row", type: "quality", priority: "low" })).toThrow(ServiceError);
    expect(() => openObservation(dana, "obs_br_d")).toThrow(/cannot change/);
    const created = createObservation(maya, {
      projectId: "proj_okonkwo",
      title: "E2E valve gap",
      type: "quality",
      priority: "high",
      assigneeContactId: "c_harbor",
      dueDate: "2026-11-20",
      description: "Gap at the wall.",
    });
    expect(created.number).toBe(4);
    expect(observationDetail(maya, created.id)?.status).toBe("draft");
    expect(() => markObservationReady(maya, created.id)).toThrow(/open/);
    openObservation(maya, created.id);
    expect(() => notAcceptObservation(maya, created.id, "Too soon")).toThrow(/review/);
    expect(() => closeObservation(maya, created.id)).toThrow(/Review/);
    markObservationReady(maya, created.id);
    expect(() => notAcceptObservation(maya, created.id, " ")).toThrow(/note/);
    notAcceptObservation(maya, created.id, "Redo the gap");
    expect(observationDetail(maya, created.id)?.status).toBe("open");
    expect(observationDetail(maya, created.id)?.rejectNote).toBe("Redo the gap");
    expect(() => markObservationReady(dana, created.id)).toThrow(/cannot change/);
    const own = createObservation(dana, { projectId: "proj_okonkwo", title: "Field guard", type: "safety", priority: "medium", hazard: "Fall" });
    expect(observationDetail(maya, own.id)?.assigneeUserId).toBe(dana.userId);
    expect(observationDetail(maya, own.id)?.status).toBe("open");
    markObservationReady(dana, own.id);
    expect(() => closeObservation(dana, own.id)).toThrow(/cannot change/);
    expect(() => voidObservation(dana, own.id, "Nope")).toThrow(/cannot change/);
    markObservationReady(maya, created.id);
    closeObservation(maya, created.id);
    expect(() => saveObservation(maya, created.id, { projectId: "proj_okonkwo", title: "Changed", type: "quality", priority: "low" })).toThrow(/locked/);
    expect(() => addObservationPhoto(maya, created.id, { filename: "a.png", bytes: png })).toThrow(/locked/);
    expect(() => voidObservation(maya, created.id, "Too late")).toThrow(/locked/);
    const events = getDb().select().from(observationEvents).where(eq(observationEvents.observationId, created.id)).all();
    expect(events.map((row) => row.action)).toEqual(["create", "open", "ready", "not_accepted", "ready", "close"]);
    expect(events.every((row) => row.actorId === maya.userId && row.createdAt.length > 10)).toBe(true);
    const draft = createObservation(maya, { projectId: "proj_brooks", title: "Void me", type: "environmental", priority: "low" });
    expect(() => voidObservation(maya, draft.id, "x")).toThrow(/reason/);
    voidObservation(maya, draft.id, "Wrong job");
    expect(observationDetail(maya, draft.id)?.status).toBe("void");
    expect(() => openObservation(maya, draft.id)).toThrow(/draft/);
  });

  it("lets the assigned vendor respond once, and refuses another vendor", () => {
    const maya = actor("maya@rivera.demo");
    expect(portalObservationRows("org_rivera", "c_harbor").some((row) => row.title === "Open stair guard")).toBe(true);
    expect(() => portalReadyObservation("org_rivera", "c_brighton", "Brighton Electric", "obs_ok_s", { note: "Done" })).toThrow(/not found/);
    expect(() => portalReadyObservation("org_rivera", "c_harbor", "Harbor Plumbing", "obs_ok_s", { note: "x" })).toThrow(/note/);
    expect(() => portalReadyObservation("org_rivera", "c_harbor", "Harbor Plumbing", "obs_ok_s", { note: "Guard is up", photo: { filename: "x.svg", bytes: svg } })).toThrow(/JPEG/);
    portalReadyObservation("org_rivera", "c_harbor", "Harbor Plumbing", "obs_ok_s", { note: "Guard is up", photo: { filename: "guard.png", bytes: png } });
    expect(observationDetail(maya, "obs_ok_s")?.status).toBe("ready");
    expect(portalObservationRows("org_rivera", "c_harbor").some((row) => row.id === "obs_ok_s")).toBe(false);
    const notes = getDb().select().from(notifications).where(eq(notifications.entityId, "obs_ok_s")).all();
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((row) => row.kind === "observation")).toBe(true);
    expect(mentionUnread(maya)).toBe(2);
    expect(listInbox(maya, "unread").some((row) => row.kind === "observation" && row.record === "Open stair guard" && row.snippet === "Guard is up")).toBe(true);
    notAcceptObservation(maya, "obs_ok_s", "Still open");
    expect(portalObservationRows("org_rivera", "c_harbor").find((row) => row.id === "obs_ok_s")?.rejectNote).toBe("Still open");
  });

  it("opens one observation from a failed check or inspection, and drafts one backcharge", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const now = nowIso();
    getDb()
      .insert(safetyChecks)
      .values({ id: "chk_obs", orgId: "org_rivera", projectId: "proj_okonkwo", templateId: "stmpl_obs", name: "Guard", completedBy: "user_maya", completedAt: now, voidedAt: null, createdAt: now })
      .run();
    getDb()
      .insert(safetyCheckItems)
      .values({ id: "chi_obs", orgId: "org_rivera", checkId: "chk_obs", title: "Missing rail", result: "fail", documentId: null, todoId: null, punchId: null, observationId: null })
      .run();
    expect(() => linkObservationFromCheck(dana, "chi_obs")).toThrow(ServiceError);
    const first = linkObservationFromCheck(maya, "chi_obs");
    const second = linkObservationFromCheck(maya, "chi_obs");
    expect(second).toEqual({ id: first.id, existing: true });
    expect(getDb().select().from(observations).where(eq(observations.safetyCheckItemId, "chi_obs")).all()).toHaveLength(1);
    getDb()
      .insert(inspections)
      .values({
        id: "insp_obs",
        orgId: "org_rivera",
        projectId: "proj_brooks",
        permitId: "perm_br_bldg",
        rootId: "insp_obs",
        attempt: 2,
        name: "Failed rough",
        scheduleItemId: null,
        requestedOn: null,
        scheduledOn: null,
        inspector: null,
        result: "failed",
        resultOn: null,
        notes: "Redo the stack",
        createdAt: now,
        updatedAt: now,
        createdBy: "user_maya",
        observationId: null,
      })
      .run();
    const linked = linkObservationFromInspection(maya, "insp_obs");
    expect(linkObservationFromInspection(maya, "insp_obs")).toEqual({ id: linked.id, existing: true });
    expect(getDb().select().from(inspections).where(eq(inspections.id, "insp_obs")).get()?.observationId).toBe(linked.id);
    expect(() => linkObservationFromInspection(maya, "insp_br_frame")).toThrow(/failed/);
    const before = getDb().select().from(costItems).where(eq(costItems.orgId, "org_rivera")).all().length;
    expect(() => createObservationBackcharge(maya, "obs_ok_q")).toThrow(/Open or close/);
    expect(() => createObservationBackcharge(maya, "obs_ok_s")).toThrow(/quality/);
    expect(() => createObservationBackcharge(dana, "obs_ok_c")).toThrow(ServiceError);
    const credit = createObservationBackcharge(maya, "obs_ok_c");
    const again = createObservationBackcharge(maya, "obs_ok_c");
    expect(again.id).toBe(credit.id);
    expect(again.existing).toBe(true);
    expect(credit.amountCents).toBe(0);
    expect(credit.status).toBe("draft");
    const stored = getDb().select().from(vendorCredits).where(eq(vendorCredits.id, credit.id)).get();
    expect(stored?.sourceKey).toBe("observation:obs_ok_c");
    expect(stored?.kind).toBe("backcharge");
    expect(getDb().select().from(costItems).where(eq(costItems.orgId, "org_rivera")).all().length).toBe(before);
    expect(wipJob(maya, "proj_okonkwo")?.billedCents).toBe(3_360_000);
    const openQuality = createObservation(maya, { projectId: "proj_okonkwo", title: "Open quality gap", type: "quality", priority: "low", assigneeContactId: "c_harbor" });
    openObservation(maya, openQuality.id);
    const fromOpen = createObservationBackcharge(maya, openQuality.id);
    expect(fromOpen.existing).toBe(false);
    expect(fromOpen.id).not.toBe(credit.id);
    getDb().insert(planPins).values({
      id: "pin_obs_punch",
      orgId: "org_rivera",
      projectId: "proj_okonkwo",
      jobFileId: "jf_ok_harbor",
      number: 90,
      xMilli: 1,
      yMilli: 1,
      linkType: "punch",
      linkId: "punch_ok_esc",
      note: "",
      cropDocumentId: null,
      copiedFromId: null,
      reviewed: 1,
      createdAt: now,
      createdBy: "user_maya",
    }).run();
    expect(() =>
      saveObservation(maya, openQuality.id, {
        projectId: "proj_okonkwo",
        title: "Open quality gap",
        type: "quality",
        priority: "low",
        assigneeContactId: "c_harbor",
        planPinId: "pin_obs_punch",
      }),
    ).toThrow(/already linked/);
  });
});
