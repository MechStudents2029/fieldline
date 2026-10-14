import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, automationNotices, automationRules, automationRuns, messages, notifications, projects, selectionFollowUps, selections } from "@/lib/db/schema";
import { nowIso } from "@/lib/ids";
import { saveAutomation, triggerLabel, parseTrigger } from "@/lib/services/automations";
import { listInbox, openNotification } from "@/lib/services/comments";
import { authenticate } from "@/lib/services/read";
import { addCalendarDays, localDay } from "@/lib/time/calendar";
import {
  afterWindow,
  beforeWindow,
  dismissSelectionFollowUps,
  listSelectionFollowUps,
  markSelectionFollowUp,
  portalSelectionDue,
  saveSelectionFollowSettings,
  scanSelectionFollowUps,
  selectionFollowAttention,
  selectionFollowDetail,
  selectionFollowMonth,
  selectionFollowSettings,
} from "@/lib/services/selection-followups";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

function row() {
  const saved = getDb().select().from(selectionFollowUps).where(eq(selectionFollowUps.id, "sfol_ok_floor")).get();
  if (!saved) throw new Error("missing sfol_ok_floor");
  return saved;
}

function restore(saved: ReturnType<typeof row>) {
  const db = getDb();
  db.delete(selectionFollowUps).where(and(eq(selectionFollowUps.orgId, "org_rivera"), eq(selectionFollowUps.selectionId, "sel_ok_floor"))).run();
  db.delete(notifications).where(and(eq(notifications.orgId, "org_rivera"), eq(notifications.entityType, "selection_followup"), eq(notifications.entityId, saved.id))).run();
  db.insert(selectionFollowUps).values(saved).run();
  db.insert(notifications)
    .values(
      ["user_maya", "user_sam"].map((userId) => ({
        id: `note_sfol_${userId}`,
        orgId: "org_rivera",
        userId,
        kind: "selection",
        commentId: null,
        entityType: "selection_followup",
        entityId: saved.id,
        projectId: null,
        actorId: null,
        actorName: "Fieldline",
        snippet: "Floor tile",
        readAt: null,
        createdAt: saved.createdAt,
      })),
    )
    .run();
}

describe("selection deadline follow-ups", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("opens a before window and an after window on the calendar", () => {
    expect(beforeWindow("2026-10-14", "2026-10-17", 3)).toBe(true);
    expect(beforeWindow("2026-10-13", "2026-10-17", 3)).toBe(false);
    expect(afterWindow("2026-10-15", "2026-10-14", 1)).toBe(true);
    expect(afterWindow("2026-10-14", "2026-10-14", 1)).toBe(false);
  });

  it("keeps the seeded Okonkwo floor follow-up and does not double it", () => {
    const maya = actor("maya@rivera.demo");
    expect(scanSelectionFollowUps("org_rivera").created).toBe(0);
    expect(scanSelectionFollowUps("org_rivera").created).toBe(0);
    const listed = listSelectionFollowUps(maya);
    expect(listed.map((item) => item.selection)).toEqual(["Floor tile"]);
    expect(listed[0]).toMatchObject({ status: "ready", cadence: 3, client: "Amara Okonkwo" });
    expect(listed.some((item) => item.selection === "Vanity" || item.selection === "Faucet")).toBe(false);
    expect(selectionFollowAttention("org_rivera")).toEqual({ count: 1, href: "/selection-followups" });
    expect(selectionFollowMonth("org_rivera").ready).toBe(1);
    expect(selectionFollowMonth("org_rivera").created).toBe(1);
    expect(portalSelectionDue("demo_portal_okonkwo").has("sel_ok_floor")).toBe(true);
    expect(selectionFollowDetail(maya, "sfol_ok_floor")?.url).toContain("#selection-sel_ok_floor");
    expect(selectionFollowDetail(maya, "sfol_ok_floor")?.message).toContain("Floor tile");
    expect(selectionFollowSettings(maya)).toMatchObject({ enabled: true, before: 3, after: 0 });
    const inbox = listInbox(maya, "all");
    const note = inbox.find((item) => item.snippet === "Floor tile");
    expect(note?.record).toBe("Floor tile");
    expect(openNotification(maya, note?.id || "")).toBe("/selection-followups/sfol_ok_floor");
    expect(triggerLabel(parseTrigger(JSON.stringify({ kind: "selection_followup_created" }))!)).toBe("Selection follow-up created");
    expect(triggerLabel(parseTrigger(JSON.stringify({ kind: "selection_followup_marked_sent" }))!)).toBe("Selection follow-up marked sent");
  });

  it("creates one row per cadence and skips a tagged job", () => {
    const maya = actor("maya@rivera.demo");
    const saved = row();
    const db = getDb();
    const project = db.select().from(projects).where(eq(projects.id, "proj_okonkwo")).get();
    db.delete(selectionFollowUps).where(eq(selectionFollowUps.id, saved.id)).run();
    expect(scanSelectionFollowUps("org_rivera").created).toBe(1);
    expect(scanSelectionFollowUps("org_rivera").created).toBe(0);
    db.delete(selectionFollowUps).where(eq(selectionFollowUps.selectionId, "sel_ok_floor")).run();
    saveSelectionFollowSettings(maya, { enabled: true, before: 3, after: 0, exclude: "warranty", template: "" });
    db.update(projects).set({ tags: "warranty" }).where(eq(projects.id, "proj_okonkwo")).run();
    expect(scanSelectionFollowUps("org_rivera").created).toBe(0);
    db.update(projects).set({ tags: project?.tags ?? "" }).where(eq(projects.id, "proj_okonkwo")).run();
    saveSelectionFollowSettings(maya, {
      enabled: true,
      before: 3,
      after: 1,
      exclude: "",
      template: "{client}, {selection} on {job} is due {due}. {link}",
    });
    expect(scanSelectionFollowUps("org_rivera").created).toBe(2);
    expect(scanSelectionFollowUps("org_rivera").created).toBe(0);
    saveSelectionFollowSettings(maya, {
      enabled: true,
      before: 3,
      after: 0,
      exclude: "",
      template: "{client}, {selection} on {job} is due {due}. {link}",
    });
    restore(saved);
  });

  it("voids an open follow-up when the selection is chosen and does not open another", () => {
    const saved = row();
    const db = getDb();
    const today = localDay(Date.now(), "America/New_York");
    const stamp = nowIso();
    db.insert(selections)
      .values({
        id: "sel_tmp_due",
        orgId: "org_rivera",
        projectId: "proj_okonkwo",
        title: "Temp tile",
        area: null,
        dueDate: addCalendarDays(today, -2),
        status: "draft",
        allowanceBudgetLineId: null,
        qtyMilli: 1000,
        chosenChoiceId: null,
        costItemId: null,
        changeOrderId: null,
        createdBy: "user_maya",
        createdAt: stamp,
        updatedAt: stamp,
      })
      .run();
    expect(scanSelectionFollowUps("org_rivera").created).toBe(1);
    db.update(selections).set({ status: "chosen" }).where(eq(selections.id, "sel_tmp_due")).run();
    dismissSelectionFollowUps("org_rivera", "sel_tmp_due");
    expect(db.select().from(selectionFollowUps).where(eq(selectionFollowUps.selectionId, "sel_tmp_due")).get()?.status).toBe("void");
    expect(scanSelectionFollowUps("org_rivera").created).toBe(0);
    db.delete(selectionFollowUps).where(eq(selectionFollowUps.selectionId, "sel_tmp_due")).run();
    db.delete(selections).where(eq(selections.id, "sel_tmp_due")).run();
    const future = "sel_tmp_later";
    db.insert(selections)
      .values({
        id: future,
        orgId: "org_rivera",
        projectId: "proj_okonkwo",
        title: "Later tile",
        area: null,
        dueDate: addCalendarDays(today, 20),
        status: "draft",
        allowanceBudgetLineId: null,
        qtyMilli: 1000,
        chosenChoiceId: null,
        costItemId: null,
        changeOrderId: null,
        createdBy: "user_maya",
        createdAt: stamp,
        updatedAt: stamp,
      })
      .run();
    expect(scanSelectionFollowUps("org_rivera").created).toBe(0);
    db.delete(selections).where(eq(selections.id, future)).run();
    restore(saved);
  });

  it("gates settings and follow-up changes by role and company", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const luis = actor("luis@rivera.demo");
    const jordan = actor("jordan@northline.demo");
    const saved = row();
    expect(() => saveSelectionFollowSettings(dana, { enabled: false, before: 3, after: 0, exclude: "", template: "" })).toThrow(/owner or admin/);
    expect(() => saveSelectionFollowSettings(maya, { enabled: true, before: 91, after: 0, exclude: "", template: "" })).toThrow(/1 to 90/);
    expect(() => saveSelectionFollowSettings(maya, { enabled: true, before: 3, after: 91, exclude: "", template: "" })).toThrow(/1 to 90/);
    expect(() => markSelectionFollowUp(jordan, "sfol_ok_floor", "sent")).toThrow(/not in your company/);
    expect(() => markSelectionFollowUp(dana, "sfol_ok_floor", "copy")).toThrow(/cannot change/);
    expect(() => markSelectionFollowUp(riley, "sfol_ok_floor", "sent")).toThrow(/cannot change/);
    expect(() => markSelectionFollowUp(maya, "sfol_ok_floor", "skip", "n")).toThrow(/Add a reason/);
    expect(listSelectionFollowUps(dana)).toEqual([]);
    try {
      markSelectionFollowUp(luis, "sfol_ok_floor", "copy");
      expect(selectionFollowDetail(maya, "sfol_ok_floor")?.status).toBe("copied");
      const audits = getDb().select().from(auditLogs).where(eq(auditLogs.orgId, "org_rivera")).all().map((item) => item.action);
      expect(audits).toContain("selfollow.copy");
      markSelectionFollowUp(maya, "sfol_ok_floor", "sent");
      expect(selectionFollowDetail(maya, "sfol_ok_floor")?.status).toBe("sent");
      expect(audits.concat(getDb().select().from(auditLogs).where(eq(auditLogs.orgId, "org_rivera")).all().map((item) => item.action))).toContain("selfollow.sent");
      expect(selectionFollowAttention("org_rivera").count).toBe(0);
      markSelectionFollowUp(maya, "sfol_ok_floor", "skip", "Called");
      expect(selectionFollowDetail(maya, "sfol_ok_floor")?.status).toBe("skipped");
      markSelectionFollowUp(maya, "sfol_ok_floor", "void");
      expect(selectionFollowDetail(maya, "sfol_ok_floor")?.status).toBe("void");
      expect(() => markSelectionFollowUp(maya, "sfol_ok_floor", "sent")).toThrow(/closed/);
    } finally {
      restore(saved);
    }
  });

  it("runs an automation when the office marks a follow-up sent", () => {
    const maya = actor("maya@rivera.demo");
    const db = getDb();
    const saved = row();
    const rules = db.select().from(automationRules).where(eq(automationRules.orgId, "org_rivera")).all();
    db.update(automationRules).set({ enabled: 0 }).where(eq(automationRules.orgId, "org_rivera")).run();
    const ruleId = saveAutomation(maya, {
      name: "Selection follow-up sent",
      enabled: true,
      trigger: { kind: "selection_followup_marked_sent" },
      conditions: [],
      actions: [{ kind: "today", title: "Selection sent", who: "role:owner" }],
    });
    try {
      const messagesBefore = db.select().from(messages).all().length;
      markSelectionFollowUp(maya, "sfol_ok_floor", "sent");
      expect(db.select().from(messages).all().length).toBe(messagesBefore);
      expect(db.select().from(automationRuns).where(eq(automationRuns.ruleId, ruleId)).all()).toHaveLength(1);
    } finally {
      restore(saved);
      db.delete(automationRuns).where(eq(automationRuns.ruleId, ruleId)).run();
      db.delete(automationNotices).where(eq(automationNotices.ruleId, ruleId)).run();
      db.delete(automationRules).where(eq(automationRules.id, ruleId)).run();
      for (const rule of rules) {
        db.update(automationRules).set({ enabled: rule.enabled }).where(eq(automationRules.id, rule.id)).run();
      }
    }
  });
});
