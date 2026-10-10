import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import {
  auditLogs,
  automationNotices,
  automationRules,
  automationRuns,
  contacts,
  projects,
  punchItems,
  scheduleItems,
  tasks,
  vendorCertificates,
} from "@/lib/db/schema";
import { nowIso } from "@/lib/ids";
import {
  AUTOMATION_DEPTH_LIMIT,
  emitAutomation,
  noticesFor,
  previewRule,
  saveAutomation,
  scanAutomationClock,
  toggleAutomation,
  type AutomationEvent,
  type RuleDraft,
} from "@/lib/services/automations";
import { authenticate } from "@/lib/services/read";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

function clearSupabaseEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

function maya() {
  const user = authenticate("maya@rivera.demo", "demo");
  if (!user) throw new Error("missing maya");
  return user;
}

function dana() {
  const user = authenticate("dana@rivera.demo", "demo");
  if (!user) throw new Error("missing dana");
  return user;
}

function quietSeeds() {
  getDb().update(automationRules).set({ enabled: 0 }).where(eq(automationRules.orgId, "org_rivera")).run();
}

function jobEvent(projectId: string, status: string, name: string): AutomationEvent {
  return {
    orgId: "org_rivera",
    kind: "job_status",
    recordType: "project",
    recordId: projectId,
    recordLabel: name,
    projectId,
    status,
    name,
    amountCents: 100_00,
  };
}

function counts() {
  const db = getDb();
  return {
    runs: db.select().from(automationRuns).all().length,
    notices: db.select().from(automationNotices).all().length,
    tasks: db.select().from(tasks).all().length,
    punches: db.select().from(punchItems).all().length,
    schedule: db.select().from(scheduleItems).all().length,
    audits: db.select().from(auditLogs).all().length,
  };
}

describe("automations", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("matches a trigger and skips a different one", () => {
    quietSeeds();
    const actor = maya();
    saveAutomation(actor, {
      name: "Complete only",
      enabled: true,
      trigger: { kind: "job_status", status: "complete" },
      conditions: [],
      actions: [{ kind: "todo", title: "Close the file", who: "", dueDays: 0 }],
    });
    emitAutomation(jobEvent("proj_chen", "active", "Chen powder room"));
    expect(getDb().select().from(tasks).where(eq(tasks.title, "Close the file")).all()).toHaveLength(0);
    emitAutomation(jobEvent("proj_chen", "complete", "Chen powder room"));
    expect(getDb().select().from(tasks).where(eq(tasks.title, "Close the file")).all()).toHaveLength(1);
  });

  it("applies job type, PM, cost code, and amount conditions", () => {
    quietSeeds();
    const actor = maya();
    const draft = (name: string, conditions: RuleDraft["conditions"]): RuleDraft => ({
      name,
      enabled: true,
      trigger: { kind: "job_status", status: "active" },
      conditions,
      actions: [{ kind: "todo", title: name, who: "", dueDays: 0 }],
    });
    saveAutomation(actor, draft("Kitchen only", [{ kind: "job_type", value: "Kitchen" }]));
    saveAutomation(actor, draft("Powder only", [{ kind: "job_type", value: "powder" }]));
    saveAutomation(actor, draft("Maya PM", [{ kind: "pm", userId: "user_maya" }]));
    saveAutomation(actor, draft("Luis PM", [{ kind: "pm", userId: "user_luis" }]));
    saveAutomation(actor, draft("Demo code", [{ kind: "cost_code", value: "DEMO" }]));
    saveAutomation(actor, draft("Missing code", [{ kind: "cost_code", value: "NO-SUCH" }]));
    saveAutomation(actor, draft("Over a dollar", [{ kind: "amount_over", cents: 100 }]));
    saveAutomation(actor, draft("Under a dollar", [{ kind: "amount_under", cents: 100 }]));
    emitAutomation({ ...jobEvent("proj_chen", "active", "Chen powder room"), amountCents: 5000 });
    const titles = getDb().select().from(tasks).all().map((row) => row.title);
    expect(titles).not.toContain("Kitchen only");
    expect(titles).toContain("Powder only");
    expect(titles).toContain("Maya PM");
    expect(titles).not.toContain("Luis PM");
    expect(titles).toContain("Demo code");
    expect(titles).not.toContain("Missing code");
    expect(titles).toContain("Over a dollar");
    expect(titles).not.toContain("Under a dollar");
  });

  it("runs a rule once per record", () => {
    quietSeeds();
    saveAutomation(maya(), {
      name: "Once",
      enabled: true,
      trigger: { kind: "schedule_done" },
      conditions: [],
      actions: [{ kind: "todo", title: "Once todo", who: "user:user_luis", dueDays: 2 }],
    });
    const event: AutomationEvent = {
      orgId: "org_rivera",
      kind: "schedule_done",
      recordType: "schedule_item",
      recordId: "sch_once",
      recordLabel: "Tile",
      projectId: "proj_chen",
      name: "Tile",
      scheduleItemId: "sch_once",
    };
    emitAutomation(event);
    emitAutomation(event);
    expect(getDb().select().from(tasks).where(eq(tasks.title, "Once todo")).all()).toHaveLength(1);
    expect(getDb().select().from(automationRuns).where(eq(automationRuns.recordId, "sch_once")).all()).toHaveLength(1);
  });

  it("stops a chain at three levels and still runs inside the limit", () => {
    quietSeeds();
    expect(AUTOMATION_DEPTH_LIMIT).toBe(3);
    saveAutomation(maya(), {
      name: "Depth",
      enabled: true,
      trigger: { kind: "job_status", status: "active" },
      conditions: [],
      actions: [{ kind: "todo", title: "Depth todo", who: "", dueDays: 1 }],
    });
    emitAutomation(jobEvent("proj_brooks", "active", "Brooks family room addition"), 3);
    expect(getDb().select().from(tasks).where(eq(tasks.title, "Depth todo")).all()).toHaveLength(0);
    const blocked = getDb().select().from(automationRuns).where(eq(automationRuns.recordId, "proj_brooks")).all();
    expect(blocked.some((run) => run.result === "depth")).toBe(true);
    emitAutomation(jobEvent("proj_diaz", "active", "Diaz deck replacement"), 2);
    expect(getDb().select().from(tasks).where(eq(tasks.title, "Depth todo")).all()).toHaveLength(1);
  });

  it("previews a rule without writing", () => {
    quietSeeds();
    const actor = maya();
    const ruleId = saveAutomation(actor, {
      name: "Preview me",
      enabled: true,
      trigger: { kind: "job_status", status: "active" },
      conditions: [],
      actions: [{ kind: "todo", title: "Preview todo", who: "role:pm", dueDays: 3 }],
    });
    const before = counts();
    const preview = previewRule(actor, ruleId, "proj_chen");
    expect(preview.match).toBe(true);
    expect(preview.lines).toContain("To-do: Preview todo");
    expect(counts()).toEqual(before);
    expect(getDb().select().from(tasks).where(eq(tasks.title, "Preview todo")).all()).toHaveLength(0);
  });

  it("applies a template once, then skips titles that are already there", () => {
    quietSeeds();
    const before = getDb().select().from(scheduleItems).where(eq(scheduleItems.projectId, "proj_chen")).all().length;
    saveAutomation(maya(), {
      name: "Apply kitchen",
      enabled: true,
      trigger: { kind: "punch_verified" },
      conditions: [],
      actions: [{ kind: "apply_template", templateId: "tpl_kitchen" }],
    });
    const event: AutomationEvent = {
      orgId: "org_rivera",
      kind: "punch_verified",
      recordType: "punch_item",
      recordId: "punch_apply",
      recordLabel: "Apply",
      projectId: "proj_chen",
      name: "Apply",
    };
    emitAutomation(event);
    const titles = getDb().select().from(scheduleItems).where(eq(scheduleItems.projectId, "proj_chen")).all().map((row) => row.title);
    expect(titles).toContain("Cabinets");
    expect(titles.length).toBeGreaterThan(before);
    const todos = getDb().select().from(tasks).where(and(eq(tasks.relatedId, "proj_chen"), eq(tasks.title, "Pre-drywall walk"))).all();
    expect(todos.length).toBe(1);
    emitAutomation({ ...event, recordId: "punch_apply_2" });
    expect(getDb().select().from(scheduleItems).where(eq(scheduleItems.projectId, "proj_chen")).all()).toHaveLength(titles.length);
    expect(getDb().select().from(tasks).where(and(eq(tasks.relatedId, "proj_chen"), eq(tasks.title, "Pre-drywall walk"))).all()).toHaveLength(1);
  });

  it("creates a to-do, a Today row, a punch, and holds then releases a schedule item", () => {
    quietSeeds();
    const actor = maya();
    const item = getDb().select().from(scheduleItems).where(eq(scheduleItems.projectId, "proj_brooks")).all()[0];
    expect(item).toBeTruthy();
    saveAutomation(actor, {
      name: "Todo and today",
      enabled: true,
      trigger: { kind: "schedule_done" },
      conditions: [{ kind: "item_name", value: "Hold me" }],
      actions: [
        { kind: "todo", title: "Call the inspector", who: "role:office", dueDays: 4 },
        { kind: "today", title: "Inspector follow-up", who: "role:office" },
      ],
    });
    emitAutomation({
      orgId: "org_rivera",
      kind: "schedule_done",
      recordType: "schedule_item",
      recordId: item!.id,
      recordLabel: "Hold me",
      projectId: "proj_brooks",
      name: "Hold me",
      scheduleItemId: item!.id,
    });
    const todo = getDb().select().from(tasks).where(eq(tasks.title, "Call the inspector")).get();
    expect(todo?.assigneeUserId).toBeTruthy();
    expect(todo?.dueAt).toBe(addCalendarDays(localDay(Date.now(), "America/New_York"), 4));
    expect(noticesFor(actor).some((notice) => notice.title === "Inspector follow-up")).toBe(true);
    expect(noticesFor(dana()).some((notice) => notice.title === "Inspector follow-up")).toBe(false);
    saveAutomation(actor, {
      name: "Punch and hold",
      enabled: true,
      trigger: { kind: "inspection_result", result: "failed" },
      conditions: [],
      actions: [
        { kind: "punch", title: "Open the wall" },
        { kind: "hold" },
      ],
    });
    emitAutomation({
      orgId: "org_rivera",
      kind: "inspection_result",
      recordType: "inspection",
      recordId: "insp_hold",
      recordLabel: "Rough",
      projectId: "proj_brooks",
      status: "failed",
      name: "Rough",
      scheduleItemId: item!.id,
      gateItemIds: [item!.id],
    });
    expect(getDb().select().from(punchItems).where(eq(punchItems.title, "Open the wall")).get()?.status).toBe("open");
    expect(getDb().select().from(scheduleItems).where(eq(scheduleItems.id, item!.id)).get()?.held).toBe(1);
    saveAutomation(actor, {
      name: "Release it",
      enabled: true,
      trigger: { kind: "inspection_result", result: "passed" },
      conditions: [],
      actions: [{ kind: "release" }],
    });
    emitAutomation({
      orgId: "org_rivera",
      kind: "inspection_result",
      recordType: "inspection",
      recordId: "insp_release",
      recordLabel: "Rough",
      projectId: "proj_brooks",
      status: "passed",
      name: "Rough",
      scheduleItemId: item!.id,
      gateItemIds: [item!.id],
    });
    expect(getDb().select().from(scheduleItems).where(eq(scheduleItems.id, item!.id)).get()?.held).toBe(0);
    const audit = getDb().select().from(auditLogs).where(eq(auditLogs.action, "Automation: Punch and hold")).all();
    expect(audit.length).toBeGreaterThan(0);
  });

  it("sets a job status and records the automation on the audit log", () => {
    quietSeeds();
    saveAutomation(maya(), {
      name: "Mark complete",
      enabled: true,
      trigger: { kind: "punch_verified" },
      conditions: [],
      actions: [{ kind: "set_status", status: "complete" }],
    });
    emitAutomation({
      orgId: "org_rivera",
      kind: "punch_verified",
      recordType: "punch_item",
      recordId: "punch_status",
      recordLabel: "Done",
      projectId: "proj_chen",
      name: "Done",
    });
    expect(getDb().select().from(projects).where(eq(projects.id, "proj_chen")).get()?.status).toBe("complete");
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.action, "Automation: Mark complete")).get()).toBeTruthy();
    getDb().update(projects).set({ status: "active" }).where(eq(projects.id, "proj_chen")).run();
  });

  it("logs a failed action, continues the rest, and does not throw", () => {
    quietSeeds();
    saveAutomation(maya(), {
      name: "Broken then todo",
      enabled: true,
      trigger: { kind: "job_status", status: "active" },
      conditions: [],
      actions: [
        { kind: "apply_template", templateId: "tpl_missing" },
        { kind: "todo", title: "After the failure", who: "", dueDays: 0 },
      ],
    });
    expect(() => emitAutomation(jobEvent("proj_okonkwo", "active", "Okonkwo primary bath"))).not.toThrow();
    expect(getDb().select().from(tasks).where(eq(tasks.title, "After the failure")).all()).toHaveLength(1);
    const run = getDb().select().from(automationRuns).where(eq(automationRuns.recordId, "proj_okonkwo")).all().find((row) => row.result === "failed");
    expect(run).toBeTruthy();
  });

  it("stops immediately when the rule is off", () => {
    quietSeeds();
    const actor = maya();
    const ruleId = saveAutomation(actor, {
      name: "Off switch",
      enabled: true,
      trigger: { kind: "job_status", status: "active" },
      conditions: [],
      actions: [{ kind: "todo", title: "Should not exist", who: "", dueDays: 0 }],
    });
    toggleAutomation(actor, ruleId, false);
    emitAutomation(jobEvent("proj_diaz", "active", "Diaz deck replacement"));
    expect(getDb().select().from(tasks).where(eq(tasks.title, "Should not exist")).all()).toHaveLength(0);
  });

  it("evaluates overdue invoices, expiring insurance, and overdue equipment from the clock", () => {
    quietSeeds();
    const actor = maya();
    const today = localDay(Date.now(), "America/New_York");
    saveAutomation(actor, {
      name: "Invoice late",
      enabled: true,
      trigger: { kind: "invoice_overdue", days: 1 },
      conditions: [],
      actions: [{ kind: "today", title: "Invoice late", who: "role:office" }],
    });
    const first = scanAutomationClock("org_rivera");
    expect(first.ran).toBeGreaterThan(0);
    expect(getDb().select().from(automationRuns).where(eq(automationRuns.recordId, "inv_br_prog")).get()).toBeTruthy();
    expect(getDb().select().from(automationRuns).where(eq(automationRuns.recordId, "inv_ok_dep")).get()).toBeUndefined();
    expect(scanAutomationClock("org_rivera").ran).toBe(0);
    const contact = getDb().select().from(contacts).where(eq(contacts.orgId, "org_rivera")).all().find((row) => row.id !== "c_harbor");
    expect(contact).toBeTruthy();
    getDb()
      .insert(vendorCertificates)
      .values({
        id: "vcert_test_soon",
        orgId: "org_rivera",
        contactId: contact!.id,
        type: "general_liability",
        expiresOn: addCalendarDays(today, 10),
        documentId: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      })
      .run();
    saveAutomation(actor, {
      name: "Cert soon",
      enabled: true,
      trigger: { kind: "vendor_expiring", days: 14, cert: "insurance" },
      conditions: [],
      actions: [{ kind: "today", title: "Cert soon", who: "role:office" }],
    });
    expect(scanAutomationClock("org_rivera").ran).toBe(1);
    expect(getDb().select().from(automationRuns).where(eq(automationRuns.recordId, "vcert_harbor_gl")).get()).toBeUndefined();
    expect(noticesFor(actor).some((notice) => notice.title === "Cert soon")).toBe(true);
    saveAutomation(actor, {
      name: "Gear late",
      enabled: true,
      trigger: { kind: "equipment_overdue" },
      conditions: [],
      actions: [{ kind: "today", title: "Gear late", who: "user:user_maya" }],
    });
    expect(scanAutomationClock("org_rivera").ran).toBe(1);
    expect(getDb().select().from(automationRuns).where(eq(automationRuns.recordLabel, "Mud mixer")).get()?.result).toBe("ok");
  });

  it("keeps the seeded kitchen run on Okonkwo without applying the template", () => {
    const run = getDb().select().from(automationRuns).where(eq(automationRuns.id, "run_ok_kitchen")).get();
    expect(run?.recordLabel).toBe("Okonkwo primary bath");
    expect(run?.result).toBe("skipped");
    const preview = previewRule(maya(), "rule_sold_kitchen", "proj_okonkwo");
    expect(preview.match).toBe(false);
    expect(preview.lines).toContain("Conditions do not match");
  });
});
