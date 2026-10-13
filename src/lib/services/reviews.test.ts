import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, automationRules, automationRuns, invoices, leads, messages, notifications, organizations, projects, reviewRequests } from "@/lib/db/schema";
import { emitAutomation, parseTrigger, saveAutomation, triggerLabel } from "@/lib/services/automations";
import { listInbox, openNotification } from "@/lib/services/comments";
import { authenticate } from "@/lib/services/read";
import { loadSource } from "@/lib/reports/load";
import {
  considerReview,
  fieldReviewQueue,
  listReviews,
  markReview,
  portalReview,
  reviewCsv,
  reviewDetail,
  reviewMonth,
  reviewSettings,
  saveReviewSettings,
} from "@/lib/services/reviews";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

const GOOGLE = "https://search.google.com/local/writereview?placeid=ChIJdemoRiveraOakland";

describe("review requests", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("keeps one ready request on the finished Diaz job", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const settings = reviewSettings(maya);
    expect(settings?.enabled).toBe(true);
    expect(settings?.timing).toBe("complete");
    expect(settings?.google).toBe(GOOGLE);
    expect(reviewSettings(dana)).toBeNull();
    const db = getDb();
    const invoicesBefore = db.select().from(invoices).all().length;
    const messagesBefore = db.select().from(messages).all().length;
    const projectsBefore = db.select().from(projects).all().length;
    const leadsBefore = db.select().from(leads).all().length;
    const again = considerReview("org_rivera", "proj_diaz", "complete");
    expect(again?.id).toBe("rev_diaz");
    expect(db.select().from(reviewRequests).where(eq(reviewRequests.projectId, "proj_diaz")).all()).toHaveLength(1);
    expect(db.select().from(invoices).all().length).toBe(invoicesBefore);
    expect(db.select().from(messages).all().length).toBe(messagesBefore);
    expect(db.select().from(projects).all().length).toBe(projectsBefore);
    expect(db.select().from(leads).all().length).toBe(leadsBefore);
    expect(listReviews(maya).some((row) => row.job === "Diaz deck replacement" && row.status === "ready")).toBe(true);
    expect(listReviews(dana)).toEqual([]);
    expect(reviewCsv(maya)).toContain("Diaz deck replacement");
    expect(reviewCsv(dana)).toBeNull();
    const month = reviewMonth("org_rivera");
    expect(month).toEqual({ created: 1, sent: 0, skipped: 0 });
    const report = loadSource(maya, "reviews", "2026-10-13");
    expect(report.map((row) => row.cells.metric?.text)).toEqual(["Created", "Marked sent", "Skipped"]);
    expect(report[0]?.cells.count?.sort).toBe(1);
    expect(portalReview("demo_portal_diaz")?.url).toBe(GOOGLE);
    expect(fieldReviewQueue(dana).some((row) => row.job === "Diaz deck replacement")).toBe(true);
    expect(reviewDetail(maya, "rev_diaz")?.message).toContain("Rosa Diaz");
    expect(triggerLabel(parseTrigger(JSON.stringify({ kind: "review_request_created" }))!)).toBe("Review request created");
    expect(triggerLabel(parseTrigger(JSON.stringify({ kind: "review_request_marked_sent" }))!)).toBe("Review marked sent");
  });

  it("copies, skips, and voids without a second request", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    markReview(dana, "rev_diaz", "copy");
    expect(reviewDetail(maya, "rev_diaz")?.status).toBe("copied");
    expect(() => markReview(dana, "rev_diaz", "sent")).toThrow(/cannot change/);
    expect(() => markReview(riley, "rev_diaz", "sent")).toThrow(/cannot change/);
    expect(() => markReview(maya, "rev_diaz", "skip", "n")).toThrow(/Add a reason/);
    markReview(maya, "rev_diaz", "skip", "Not a fit");
    expect(reviewDetail(maya, "rev_diaz")?.status).toBe("skipped");
    expect(reviewMonth("org_rivera").skipped).toBe(1);
    expect(portalReview("demo_portal_diaz")).toBeNull();
    markReview(maya, "rev_diaz", "decline");
    expect(reviewDetail(maya, "rev_diaz")?.status).toBe("declined");
    expect(considerReview("org_rivera", "proj_diaz", "complete")?.id).toBe("rev_diaz");
    expect(getDb().select().from(reviewRequests).where(eq(reviewRequests.projectId, "proj_diaz")).all()).toHaveLength(1);
    const audits = getDb().select().from(auditLogs).where(eq(auditLogs.orgId, "org_rivera")).all().map((row) => row.action);
    expect(audits).toContain("review.copy");
    expect(audits).toContain("review.skip");
    expect(audits).toContain("review.void");
    getDb().update(reviewRequests).set({ status: "ready", skipReason: "", copiedAt: null, sentAt: null }).where(eq(reviewRequests.id, "rev_diaz")).run();
    expect(reviewMonth("org_rivera")).toEqual({ created: 1, sent: 0, skipped: 0 });
    expect(portalReview("demo_portal_diaz")?.url).toBe(GOOGLE);
  });

  it("skips a job whose tag is excluded", () => {
    const db = getDb();
    const job = db.select().from(projects).where(eq(projects.id, "proj_okonkwo")).get();
    if (!job) throw new Error("missing okonkwo");
    setExclude("warranty");
    db.update(projects).set({ status: "complete", tags: "warranty" }).where(eq(projects.id, "proj_okonkwo")).run();
    try {
      expect(considerReview("org_rivera", "proj_okonkwo", "complete")).toBeNull();
      db.update(projects).set({ tags: "" }).where(eq(projects.id, "proj_okonkwo")).run();
      const created = considerReview("org_rivera", "proj_okonkwo", "complete");
      expect(created?.status).toBe("ready");
      expect(considerReview("org_rivera", "proj_okonkwo", "complete")?.id).toBe(created?.id);
      expect(db.select().from(auditLogs).where(eq(auditLogs.action, "review.create")).all().length).toBeGreaterThan(0);
    } finally {
      db.delete(reviewRequests).where(eq(reviewRequests.projectId, "proj_okonkwo")).run();
      db.update(projects).set({ status: job.status, tags: job.tags, updatedAt: job.updatedAt }).where(eq(projects.id, "proj_okonkwo")).run();
      setExclude("");
    }
  });

  it("waits for every invoice when timing is fully paid", () => {
    const db = getDb();
    const invoice = db.select().from(invoices).where(eq(invoices.id, "inv_dz_final")).get();
    if (!invoice) throw new Error("missing final");
    setTiming("paid");
    db.delete(reviewRequests).where(eq(reviewRequests.id, "rev_diaz")).run();
    try {
      expect(considerReview("org_rivera", "proj_diaz", "complete")).toBeNull();
      expect(considerReview("org_rivera", "proj_diaz", "paid")).toBeNull();
      db.update(invoices).set({ status: "paid", amountPaidCents: invoice.totalCents }).where(eq(invoices.id, invoice.id)).run();
      const created = considerReview("org_rivera", "proj_diaz", "paid");
      expect(created?.status).toBe("ready");
      expect(created?.url).toBe(GOOGLE);
      expect(considerReview("org_rivera", "proj_diaz", "paid")?.id).toBe(created?.id);
      expect(db.select().from(reviewRequests).where(eq(reviewRequests.projectId, "proj_diaz")).all()).toHaveLength(1);
    } finally {
      db.update(invoices).set({ status: invoice.status, amountPaidCents: invoice.amountPaidCents }).where(eq(invoices.id, invoice.id)).run();
      db.delete(reviewRequests).where(eq(reviewRequests.projectId, "proj_diaz")).run();
      db.insert(reviewRequests)
        .values({
          id: "rev_diaz",
          orgId: "org_rivera",
          projectId: "proj_diaz",
          contactId: "c_diaz",
          status: "ready",
          platform: "google",
          url: GOOGLE,
          message: `Rosa Diaz, Diaz deck replacement is finished. ${GOOGLE}`,
          skipReason: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          copiedAt: null,
          sentAt: null,
        })
        .run();
      setTiming("complete");
    }
  });

  it("opens a request when an automation marks the job complete", () => {
    const maya = actor("maya@rivera.demo");
    const db = getDb();
    const project = db.select().from(projects).where(eq(projects.id, "proj_chen")).get();
    if (!project) throw new Error("missing chen");
    const rules = db.select().from(automationRules).where(eq(automationRules.orgId, "org_rivera")).all();
    db.update(automationRules).set({ enabled: 0 }).where(eq(automationRules.orgId, "org_rivera")).run();
    const ruleId = saveAutomation(maya, {
      name: "Finish to review",
      enabled: true,
      trigger: { kind: "job_status", status: "active" },
      conditions: [],
      actions: [{ kind: "set_status", status: "complete" }],
    });
    const sentRule = saveAutomation(maya, {
      name: "Review sent note",
      enabled: true,
      trigger: { kind: "review_request_marked_sent" },
      conditions: [],
      actions: [{ kind: "today", title: "Review sent", who: "role:owner" }],
    });
    try {
      const messagesBefore = db.select().from(messages).all().length;
      emitAutomation({
        orgId: "org_rivera",
        kind: "job_status",
        recordType: "project",
        recordId: project.id,
        recordLabel: project.name,
        projectId: project.id,
        status: "active",
        name: project.name,
        amountCents: project.contractValueCents,
      });
      const review = db.select().from(reviewRequests).where(and(eq(reviewRequests.orgId, "org_rivera"), eq(reviewRequests.projectId, "proj_chen"))).get();
      expect(review?.status).toBe("ready");
      expect(db.select().from(projects).where(eq(projects.id, "proj_chen")).get()?.contractValueCents).toBe(project.contractValueCents);
      markReview(maya, review!.id, "sent");
      expect(db.select().from(messages).all().length).toBe(messagesBefore);
      expect(db.select().from(automationRuns).where(eq(automationRuns.ruleId, sentRule)).all().length).toBe(1);
    } finally {
      const review = db.select().from(reviewRequests).where(eq(reviewRequests.projectId, "proj_chen")).get();
      if (review) db.delete(notifications).where(eq(notifications.entityId, review.id)).run();
      db.delete(reviewRequests).where(eq(reviewRequests.projectId, "proj_chen")).run();
      db.update(projects).set({ status: project.status, updatedAt: project.updatedAt }).where(eq(projects.id, "proj_chen")).run();
      db.delete(automationRuns).where(eq(automationRuns.ruleId, ruleId)).run();
      db.delete(automationRuns).where(eq(automationRuns.ruleId, sentRule)).run();
      db.delete(automationRules).where(eq(automationRules.id, ruleId)).run();
      db.delete(automationRules).where(eq(automationRules.id, sentRule)).run();
      for (const rule of rules) {
        db.update(automationRules).set({ enabled: rule.enabled }).where(eq(automationRules.id, rule.id)).run();
      }
    }
  });

  it("opens the inbox note on the review", () => {
    const maya = actor("maya@rivera.demo");
    const note = getDb().select().from(notifications).where(and(eq(notifications.userId, "user_maya"), eq(notifications.entityId, "rev_diaz"))).get();
    expect(note?.snippet).toBe("Diaz deck replacement");
    expect(listInbox(maya, "all").some((row) => row.record === "Diaz deck replacement" && row.snippet === "Diaz deck replacement")).toBe(true);
    expect(openNotification(maya, note!.id)).toBe("/reviews/rev_diaz");
    expect(() =>
      saveReviewSettings(actor("dana@rivera.demo"), {
        enabled: false,
        timing: "complete",
        google: "",
        facebook: "",
        website: "",
        exclude: "",
        template: "",
      }),
    ).toThrow(/owner or admin/);
    expect(() =>
      saveReviewSettings(maya, {
        enabled: true,
        timing: "complete",
        google: "javascript:alert(1)",
        facebook: "",
        website: "",
        exclude: "",
        template: "{client}",
      }),
    ).toThrow(/http/);
    expect(reviewSettings(maya)?.google).toBe(GOOGLE);
  });
});

function setExclude(exclude: string) {
  getDb().update(organizations).set({ reviewExcludeTags: exclude }).where(eq(organizations.id, "org_rivera")).run();
}

function setTiming(timing: string) {
  getDb().update(organizations).set({ reviewTiming: timing }).where(eq(organizations.id, "org_rivera")).run();
}
