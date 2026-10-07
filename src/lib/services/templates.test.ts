import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, draws, jobTemplates, organizations, projects, scheduleItems, templateAttempts } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { authenticate } from "@/lib/services/read";
import { closeRfi, createRfi, shiftRfiSchedule } from "@/lib/services/rfis";
import { moveScheduleItem, saveScheduleItem } from "@/lib/services/schedule";
import { replaceScheduleLinks } from "@/lib/services/schedule-shift";
import {
  createJobFromTemplate,
  createTemplate,
  importTemplate,
  listTemplates,
  renameTemplate,
  saveJobAsTemplate,
  templateDetail,
} from "@/lib/services/templates";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("job templates", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("keeps template money inside the company and away from field", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const jordan = actor("jordan@northline.demo");
    const names = listTemplates(maya).map((row) => row.name);
    expect(names).toEqual(["Bathroom remodel", "Kitchen remodel"]);
    expect(listTemplates(maya)[0]?.counts.estimate).toBeGreaterThan(0);
    expect(listTemplates(dana)[0]?.counts.estimate).toBeNull();
    expect(templateDetail(dana, "tpl_bath").lines).toEqual([]);
    expect(listTemplates(jordan)).toEqual([]);
    expect(() => templateDetail(jordan, "tpl_bath")).toThrow(/not in your company/);
    expect(() =>
      createJobFromTemplate(jordan, {
        templateId: "tpl_bath",
        name: "Other bath",
        contactId: "c_north_ada",
        startDate: "2026-10-05",
        pmUserId: "user_jordan",
        parts: ["schedule"],
        trades: {},
      }),
    ).toThrow(/not in your company/);
    expect(() =>
      createJobFromTemplate(dana, {
        templateId: "tpl_bath",
        name: "Field bath",
        contactId: "c_okonkwo",
        startDate: "2026-10-05",
        pmUserId: "user_dana",
        parts: ["schedule"],
        trades: {},
      }),
    ).toThrow(/cannot change templates/);
  });

  it("creates a job on workdays and rescales draws to the cent", () => {
    const maya = actor("maya@rivera.demo");
    const created = createJobFromTemplate(maya, {
      templateId: "tpl_bath",
      name: "Template bath",
      contactId: "c_okonkwo",
      startDate: "2026-10-05",
      pmUserId: "user_maya",
      parts: ["schedule", "estimate", "draws", "selections", "punch"],
      trades: { Plumbing: "c_harbor", Tile: "c_casa" },
    });
    expect(created.created).toBe(5 + 6 + 4 + 2 + 3);
    const project = getDb().select().from(projects).where(eq(projects.id, created.projectId)).get();
    expect(project?.templateName).toBe("Bathroom remodel");
    expect(project?.templateVersion).toBe(1);
    expect(project?.pmUserId).toBe("user_maya");
    const items = getDb().select().from(scheduleItems).where(eq(scheduleItems.projectId, created.projectId)).all();
    expect(items.find((item) => item.title === "Demo")?.startDate).toBe("2026-10-05");
    expect(items.find((item) => item.title === "Rough plumbing")?.startDate).toBe("2026-10-07");
    expect(items.find((item) => item.title === "Rough plumbing")?.vendorContactId).toBe("c_harbor");
    const amounts = getDb().select().from(draws).where(eq(draws.projectId, created.projectId)).all();
    expect(amounts.reduce((sum, draw) => sum + draw.amountCents, 0)).toBe(project?.contractValueCents);
    const odd = createTemplate(maya, {
      name: "Odd draws",
      jobType: "Bath",
      tasks: [],
      lines: [{ name: "One dollar", costCode: "MISC", qtyMilli: 1000, unit: "ea", unitCostCents: 40, unitPriceCents: 100 }],
      draws: [
        { title: "A", bps: 3334 },
        { title: "B", bps: 3333 },
        { title: "C", bps: 3333 },
      ],
      selections: [],
      checks: [],
    });
    const oddJob = createJobFromTemplate(maya, {
      templateId: odd,
      name: "Odd dollar",
      contactId: "c_okonkwo",
      startDate: "2026-10-05",
      pmUserId: "user_maya",
      parts: ["estimate", "draws"],
      trades: {},
    });
    const oddProject = getDb().select().from(projects).where(eq(projects.id, oddJob.projectId)).get();
    const oddDraws = getDb().select().from(draws).where(eq(draws.projectId, oddJob.projectId)).all();
    expect(oddDraws.reduce((sum, draw) => sum + draw.amountCents, 0)).toBe(100);
    expect(oddProject?.contractValueCents).toBe(100);
  });

  it("snaps a weekend start onto the company workweek", () => {
    const maya = actor("maya@rivera.demo");
    const created = createJobFromTemplate(maya, {
      templateId: "tpl_bath",
      name: "Saturday bath",
      contactId: "c_okonkwo",
      startDate: "2026-10-10",
      pmUserId: "user_maya",
      parts: ["schedule"],
      trades: {},
    });
    const demo = getDb().select().from(scheduleItems).where(eq(scheduleItems.projectId, created.projectId)).all().find((item) => item.title === "Demo");
    expect(demo?.startDate).toBe("2026-10-12");
    getDb().update(organizations).set({ workdaysMask: 62 | 64 }).where(eq(organizations.id, "org_rivera")).run();
    const saturday = createJobFromTemplate(maya, {
      templateId: "tpl_bath",
      name: "Open Saturday",
      contactId: "c_okonkwo",
      startDate: "2026-10-10",
      pmUserId: "user_maya",
      parts: ["schedule"],
      trades: {},
    });
    const open = getDb().select().from(scheduleItems).where(eq(scheduleItems.projectId, saturday.projectId)).all().find((item) => item.title === "Demo");
    expect(open?.startDate).toBe("2026-10-10");
    getDb().update(organizations).set({ workdaysMask: 62 }).where(eq(organizations.id, "org_rivera")).run();
  });

  it("leaves existing jobs alone when the template changes", () => {
    const maya = actor("maya@rivera.demo");
    const created = createJobFromTemplate(maya, {
      templateId: "tpl_kitchen",
      name: "Template kitchen",
      contactId: "c_okonkwo",
      startDate: "2026-10-05",
      pmUserId: "user_luis",
      parts: ["schedule"],
      trades: {},
    });
    const before = getDb().select().from(scheduleItems).where(eq(scheduleItems.projectId, created.projectId)).all().length;
    renameTemplate(maya, "tpl_kitchen", "Kitchen plan", "Kitchen");
    const project = getDb().select().from(projects).where(eq(projects.id, created.projectId)).get();
    const template = getDb().select().from(jobTemplates).where(eq(jobTemplates.id, "tpl_kitchen")).get();
    expect(project?.templateName).toBe("Kitchen remodel");
    expect(project?.templateVersion).toBe(1);
    expect(template?.version).toBe(2);
    expect(template?.name).toBe("Kitchen plan");
    expect(getDb().select().from(scheduleItems).where(eq(scheduleItems.projectId, created.projectId)).all()).toHaveLength(before);
  });

  it("refuses an empty template instead of creating a blank job", () => {
    const maya = actor("maya@rivera.demo");
    const before = getDb().select().from(projects).where(eq(projects.orgId, "org_rivera")).all().length;
    const empty = createTemplate(maya, { name: "Empty", jobType: "Bath", tasks: [], lines: [], draws: [], selections: [], checks: [] });
    expect(() =>
      createJobFromTemplate(maya, {
        templateId: empty,
        name: "Should not exist",
        contactId: "c_okonkwo",
        startDate: "2026-10-05",
        pmUserId: "user_maya",
        parts: ["schedule", "estimate", "draws", "selections", "punch"],
        trades: {},
      }),
    ).toThrow(/nothing to copy/);
    expect(getDb().select().from(projects).where(eq(projects.orgId, "org_rivera")).all()).toHaveLength(before);
    expect(getDb().select().from(projects).where(eq(projects.name, "Should not exist")).all()).toHaveLength(0);
  });

  it("appends a template onto a job and leaves the old rows in place", () => {
    const maya = actor("maya@rivera.demo");
    const before = getDb().select().from(scheduleItems).where(and(eq(scheduleItems.orgId, "org_rivera"), eq(scheduleItems.projectId, "proj_chen"))).all();
    const previewIds = new Map(before.map((row) => [row.id, `${row.startDate}|${row.endDate}`]));
    const result = importTemplate(maya, { projectId: "proj_chen", templateId: "tpl_bath", parts: ["schedule"], anchor: "2026-10-12", trades: {} });
    expect(result.created).toBe(5);
    const after = getDb().select().from(scheduleItems).where(eq(scheduleItems.projectId, "proj_chen")).all();
    expect(after).toHaveLength(before.length + 5);
    for (const row of after) {
      const stamp = previewIds.get(row.id);
      if (stamp) expect(`${row.startDate}|${row.endDate}`).toBe(stamp);
    }
    expect(getDb().select().from(auditLogs).where(and(eq(auditLogs.orgId, "org_rivera"), eq(auditLogs.action, "template.import"))).all().length).toBeGreaterThan(0);
  });

  it("cascades a move, refuses a cycle, and cascades an RFI shift", () => {
    const maya = actor("maya@rivera.demo");
    const created = createJobFromTemplate(maya, {
      templateId: "tpl_bath",
      name: "Cascade bath",
      contactId: "c_okonkwo",
      startDate: "2026-10-05",
      pmUserId: "user_maya",
      parts: ["schedule"],
      trades: {},
    });
    const items = getDb().select().from(scheduleItems).where(eq(scheduleItems.projectId, created.projectId)).all();
    const demo = items.find((item) => item.title === "Demo");
    const rough = items.find((item) => item.title === "Rough plumbing");
    if (!demo || !rough) throw new Error("missing chain");
    moveScheduleItem(maya, demo.id, { startDate: demo.startDate, endDate: "2026-10-08", assigneeId: null });
    const moved = getDb().select().from(scheduleItems).where(eq(scheduleItems.id, rough.id)).get();
    expect(moved?.startDate).toBe("2026-10-09");
    const audit = getDb().select().from(auditLogs).where(eq(auditLogs.action, "schedule.shift")).all();
    expect(audit.some((row) => (row.payloadJson ?? "").includes("Moves"))).toBe(true);
    const first = saveScheduleItem(maya, {
      projectId: "proj_chen",
      title: "Cycle A",
      startDate: "2026-11-02",
      endDate: "2026-11-02",
      startTime: null,
      status: "planned",
      note: null,
      assigneeIds: [],
    });
    const second = saveScheduleItem(maya, {
      projectId: "proj_chen",
      title: "Cycle B",
      startDate: "2026-11-03",
      endDate: "2026-11-03",
      startTime: null,
      status: "planned",
      note: null,
      assigneeIds: [],
    });
    replaceScheduleLinks(maya, second, [{ predecessorId: first, lag: 0 }]);
    expect(() => replaceScheduleLinks(maya, first, [{ predecessorId: second, lag: 0 }])).toThrow(/loop/);
    const rfiId = createRfi(maya, created.projectId, {
      title: "Hold the demo",
      question: "Can demo slip?",
      dueOn: "2026-12-01",
      assignee: "user:user_maya",
      related: `schedule:${demo.id}`,
      internalNote: null,
    });
    closeRfi(maya, rfiId, { costImpact: false, scheduleImpactDays: 1 });
    shiftRfiSchedule(maya, rfiId);
    const afterShift = getDb().select().from(scheduleItems).where(eq(scheduleItems.id, rough.id)).get();
    expect(afterShift?.startDate && moved?.startDate && afterShift.startDate > moved.startDate).toBe(true);
  });

  it("strips the client and the vendor name when saving a template", () => {
    const maya = actor("maya@rivera.demo");
    const templateId = saveJobAsTemplate(maya, "proj_okonkwo", { name: "Bath shell", jobType: "Bath", parts: ["schedule"] });
    const detail = templateDetail(maya, templateId);
    const blob = JSON.stringify(detail.tasks);
    expect(blob).not.toContain("Amara");
    expect(blob).not.toContain("Harbor");
    expect(blob).not.toContain("Okonkwo");
    expect(detail.tasks.some((task) => task.trade === "Plumbing" || task.trade === "Tile")).toBe(true);
  });

  it("rate limits template writes", () => {
    const maya = actor("maya@rivera.demo");
    const now = nowIso();
    getDb()
      .insert(templateAttempts)
      .values(Array.from({ length: 20 }, () => ({ id: id("tatt"), orgId: "org_rivera", userId: maya.userId, createdAt: now })))
      .run();
    expect(() => createTemplate(maya, { name: "Too many", jobType: "Bath", tasks: [], lines: [], draws: [], selections: [], checks: [] })).toThrow(/Wait a few minutes/);
  });
});
