import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, automationNotices, automationRules, automationRuns, invoiceFollowUps, invoices, leads, messages, notifications, organizations, payments, projects } from "@/lib/db/schema";
import { saveAutomation, triggerLabel, parseTrigger } from "@/lib/services/automations";
import { listInbox, openNotification } from "@/lib/services/comments";
import { voidBilling } from "@/lib/services/draws";
import { loadSource } from "@/lib/reports/load";
import { authenticate } from "@/lib/services/read";
import { payInvoice } from "@/lib/services/write";
import {
  collectAttention,
  collectMonth,
  collectSettings,
  followUpCsv,
  followUpDetail,
  listFollowUps,
  markFollowUp,
  pastCadence,
  portalChase,
  saveCollectSettings,
  scanCollections,
} from "@/lib/services/collections";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

function fol() {
  const row = getDb().select().from(invoiceFollowUps).where(eq(invoiceFollowUps.id, "fol_diaz")).get();
  if (!row) throw new Error("missing fol_diaz");
  return row;
}

function restoreFol(row: ReturnType<typeof fol>) {
  const db = getDb();
  db.delete(invoiceFollowUps).where(and(eq(invoiceFollowUps.orgId, "org_rivera"), eq(invoiceFollowUps.invoiceId, "inv_dz_final"))).run();
  db.delete(notifications).where(and(eq(notifications.orgId, "org_rivera"), eq(notifications.entityType, "invoice_followup"), eq(notifications.entityId, row.id))).run();
  db.insert(invoiceFollowUps).values(row).run();
}

describe("invoice follow-ups", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("fires on the calendar day the cadence lands", () => {
    expect(pastCadence("2026-10-14", "2026-10-11", 3)).toBe(true);
    expect(pastCadence("2026-10-13", "2026-10-11", 3)).toBe(false);
    expect(pastCadence("2026-10-14", "2026-10-11", 14)).toBe(false);
    expect(pastCadence("2026-10-25", "2026-10-11T15:00:00.000Z", 14)).toBe(true);
  });

  it("keeps one ready follow-up on the past-due Diaz invoice", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const settings = collectSettings(maya);
    expect(settings?.enabled).toBe(true);
    expect(settings?.first).toBe(3);
    expect(settings?.second).toBe(14);
    expect(collectSettings(dana)).toBeNull();
    const db = getDb();
    const invoicesBefore = db.select().from(invoices).all().length;
    const messagesBefore = db.select().from(messages).all().length;
    const projectsBefore = db.select().from(projects).all().length;
    const leadsBefore = db.select().from(leads).all().length;
    expect(scanCollections("org_rivera").created).toBe(0);
    expect(scanCollections("org_rivera").created).toBe(0);
    const rows = db.select().from(invoiceFollowUps).where(eq(invoiceFollowUps.orgId, "org_rivera")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.invoiceId).toBe("inv_dz_final");
    expect(rows[0]?.cadenceDays).toBe(3);
    expect(rows[0]?.status).toBe("ready");
    expect(rows[0]?.url).toContain("/pay/demo_pay_diaz_final");
    expect(db.select().from(invoices).all().length).toBe(invoicesBefore);
    expect(db.select().from(messages).all().length).toBe(messagesBefore);
    expect(db.select().from(projects).all().length).toBe(projectsBefore);
    expect(db.select().from(leads).all().length).toBe(leadsBefore);
    expect(listFollowUps(maya).some((row) => row.invoice === "RR-1019" && row.status === "ready")).toBe(true);
    expect(listFollowUps(maya).some((row) => row.invoice === "RR-1008")).toBe(false);
    expect(listFollowUps(dana)).toEqual([]);
    expect(followUpCsv(maya)).toContain("RR-1019");
    expect(followUpCsv(dana)).toBeNull();
    const month = collectMonth("org_rivera");
    expect(month.created).toBe(1);
    expect(month.sent).toBe(0);
    expect(month.skipped).toBe(0);
    expect(month.ready).toBe(1);
    expect(month.openCents).toBe(480000);
    const report = loadSource(maya, "collections", "2026-10-14");
    expect(report.map((row) => row.cells.metric?.text)).toEqual(["Created", "Sent", "Skipped", "Ready"]);
    expect(report[0]?.cells.count?.sort).toBe(1);
    expect(report[3]?.cells.open?.sort).toBe(480000);
    expect(collectAttention("org_rivera")).toEqual({ count: 1, href: "/collections" });
    expect(portalChase("demo_portal_diaz").has("inv_dz_final")).toBe(true);
    expect(followUpDetail(maya, "fol_diaz")?.message).toContain("Rosa Diaz");
    expect(followUpDetail(maya, "fol_diaz")?.message).toContain("$4,800.00");
    expect(triggerLabel(parseTrigger(JSON.stringify({ kind: "invoice_followup_created" }))!)).toBe("Invoice follow-up created");
    expect(triggerLabel(parseTrigger(JSON.stringify({ kind: "invoice_followup_marked_sent" }))!)).toBe("Invoice follow-up marked sent");
    const note = db.select().from(notifications).where(and(eq(notifications.userId, "user_maya"), eq(notifications.entityId, "fol_diaz"))).get();
    expect(note?.snippet).toBe("RR-1019");
    expect(listInbox(maya, "all").some((row) => row.record === "RR-1019" && row.snippet === "RR-1019")).toBe(true);
    expect(openNotification(maya, note!.id)).toBe("/collections/fol_diaz");
  });

  it("creates the same invoice and cadence once", () => {
    const db = getDb();
    const saved = fol();
    const invoicesBefore = db.select().from(invoices).all().length;
    const messagesBefore = db.select().from(messages).all().length;
    db.delete(invoiceFollowUps).where(eq(invoiceFollowUps.id, saved.id)).run();
    try {
      expect(scanCollections("org_rivera").created).toBe(1);
      expect(scanCollections("org_rivera").created).toBe(0);
      const rows = db.select().from(invoiceFollowUps).where(eq(invoiceFollowUps.invoiceId, "inv_dz_final")).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.cadenceDays).toBe(3);
      expect(rows[0]?.status).toBe("ready");
      expect(rows[0]?.url).toContain("demo_pay_diaz_final");
      expect(db.select().from(invoices).all().length).toBe(invoicesBefore);
      expect(db.select().from(messages).all().length).toBe(messagesBefore);
      expect(db.select().from(auditLogs).where(eq(auditLogs.action, "collect.create")).all().length).toBeGreaterThan(0);
      expect(db.select().from(invoiceFollowUps).all().some((row) => row.invoiceId === "inv_dz_dep" || row.invoiceId === "inv_ellis_draft")).toBe(false);
    } finally {
      const created = db.select().from(invoiceFollowUps).where(eq(invoiceFollowUps.invoiceId, "inv_dz_final")).all();
      for (const row of created) {
        db.delete(notifications).where(eq(notifications.entityId, row.id)).run();
        db.delete(invoiceFollowUps).where(eq(invoiceFollowUps.id, row.id)).run();
      }
      db.insert(invoiceFollowUps).values(saved).run();
    }
  });

  it("skips a job whose tag is excluded", () => {
    const db = getDb();
    const saved = fol();
    const job = db.select().from(projects).where(eq(projects.id, "proj_diaz")).get();
    if (!job) throw new Error("missing diaz");
    db.delete(invoiceFollowUps).where(eq(invoiceFollowUps.id, saved.id)).run();
    db.update(projects).set({ tags: "warranty" }).where(eq(projects.id, "proj_diaz")).run();
    db.update(organizations).set({ collectExcludeTags: "warranty" }).where(eq(organizations.id, "org_rivera")).run();
    try {
      expect(scanCollections("org_rivera").created).toBe(0);
      expect(db.select().from(invoiceFollowUps).where(eq(invoiceFollowUps.invoiceId, "inv_dz_final")).all()).toHaveLength(0);
    } finally {
      db.update(projects).set({ tags: job.tags, updatedAt: job.updatedAt }).where(eq(projects.id, "proj_diaz")).run();
      db.update(organizations).set({ collectExcludeTags: "" }).where(eq(organizations.id, "org_rivera")).run();
      db.delete(invoiceFollowUps).where(eq(invoiceFollowUps.invoiceId, "inv_dz_final")).run();
      db.insert(invoiceFollowUps).values(saved).run();
    }
  });

  it("drops an open follow-up when the invoice is paid or void", () => {
    const maya = actor("maya@rivera.demo");
    const db = getDb();
    const saved = fol();
    const invoice = db.select().from(invoices).where(eq(invoices.id, "inv_dz_final")).get();
    if (!invoice) throw new Error("missing final");
    const failed = payInvoice({
      token: invoice.payToken,
      method: "ach",
      routing: "110000000",
      account: "000222222227",
      idempotencyKey: "col-fail",
    });
    expect(failed.ok).toBe(false);
    expect(fol().status).toBe("ready");
    db.delete(payments).where(eq(payments.idempotencyKey, "col-fail")).run();
    const paid = payInvoice({
      token: invoice.payToken,
      method: "ach",
      routing: "110000000",
      account: "000123456789",
      idempotencyKey: "col-pay",
    });
    expect(paid.ok).toBe(true);
    expect(db.select().from(invoiceFollowUps).where(eq(invoiceFollowUps.id, "fol_diaz")).get()?.status).toBe("void");
    expect(scanCollections("org_rivera").created).toBe(0);
    expect(db.select().from(invoiceFollowUps).where(eq(invoiceFollowUps.invoiceId, "inv_dz_final")).all()).toHaveLength(1);
    db.delete(payments).where(eq(payments.idempotencyKey, "col-pay")).run();
    db.update(invoices)
      .set({ status: invoice.status, amountPaidCents: invoice.amountPaidCents, updatedAt: invoice.updatedAt })
      .where(eq(invoices.id, invoice.id))
      .run();
    restoreFol(saved);
    expect(fol().status).toBe("ready");
    voidBilling(maya, "inv_dz_final");
    expect(db.select().from(invoiceFollowUps).where(eq(invoiceFollowUps.id, "fol_diaz")).get()?.status).toBe("void");
    db.update(invoices)
      .set({ status: invoice.status, amountPaidCents: invoice.amountPaidCents, updatedAt: invoice.updatedAt })
      .where(eq(invoices.id, invoice.id))
      .run();
    restoreFol(saved);
    db.update(invoices).set({ status: "draft" }).where(eq(invoices.id, invoice.id)).run();
    expect(scanCollections("org_rivera").created).toBe(0);
    expect(db.select().from(invoiceFollowUps).where(eq(invoiceFollowUps.id, "fol_diaz")).get()?.status).toBe("void");
    db.update(invoices)
      .set({ status: invoice.status, amountPaidCents: invoice.amountPaidCents, updatedAt: invoice.updatedAt })
      .where(eq(invoices.id, invoice.id))
      .run();
    restoreFol(saved);
    expect(collectMonth("org_rivera").ready).toBe(1);
  });

  it("gates settings and follow-up changes by role and company", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const luis = actor("luis@rivera.demo");
    const jordan = actor("jordan@northline.demo");
    const saved = fol();
    expect(() => saveCollectSettings(dana, { enabled: false, first: 3, second: 14, exclude: "", template: "" })).toThrow(/owner or admin/);
    expect(() => saveCollectSettings(maya, { enabled: true, first: 3, second: 3, exclude: "", template: "" })).toThrow(/two different/);
    expect(() => saveCollectSettings(maya, { enabled: true, first: 91, second: 0, exclude: "", template: "" })).toThrow(/1 to 90/);
    expect(() => markFollowUp(jordan, "fol_diaz", "sent")).toThrow(/not in your company/);
    expect(() => markFollowUp(dana, "fol_diaz", "copy")).toThrow(/cannot change/);
    expect(() => markFollowUp(riley, "fol_diaz", "sent")).toThrow(/cannot change/);
    expect(() => markFollowUp(maya, "fol_diaz", "skip", "n")).toThrow(/Add a reason/);
    try {
      saveCollectSettings(maya, { enabled: true, first: 14, second: 3, exclude: "Hold, hold", template: "" });
      expect(collectSettings(maya)).toMatchObject({ enabled: true, first: 3, second: 14, exclude: "hold" });
      markFollowUp(luis, "fol_diaz", "copy");
      expect(followUpDetail(maya, "fol_diaz")?.status).toBe("copied");
      expect(portalChase("demo_portal_diaz").has("inv_dz_final")).toBe(true);
      markFollowUp(maya, "fol_diaz", "sent");
      expect(followUpDetail(maya, "fol_diaz")?.status).toBe("sent");
      expect(collectMonth("org_rivera").sent).toBe(1);
      expect(collectAttention("org_rivera").count).toBe(0);
      expect(portalChase("demo_portal_diaz").has("inv_dz_final")).toBe(false);
      const audits = getDb().select().from(auditLogs).where(eq(auditLogs.orgId, "org_rivera")).all().map((row) => row.action);
      expect(audits).toContain("collect.copy");
      expect(audits).toContain("collect.sent");
      markFollowUp(maya, "fol_diaz", "skip", "Called");
      expect(followUpDetail(maya, "fol_diaz")?.status).toBe("skipped");
      expect(collectMonth("org_rivera").skipped).toBe(1);
      markFollowUp(maya, "fol_diaz", "void");
      expect(followUpDetail(maya, "fol_diaz")?.status).toBe("void");
      expect(() => markFollowUp(maya, "fol_diaz", "sent")).toThrow(/closed/);
    } finally {
      saveCollectSettings(maya, {
        enabled: true,
        first: 3,
        second: 14,
        exclude: "",
        template: "{client}, {invoice} for {amount} was due {due}. {link}",
      });
      restoreFol(saved);
    }
  });

  it("runs an automation when the office marks a follow-up sent", () => {
    const maya = actor("maya@rivera.demo");
    const db = getDb();
    const saved = fol();
    const rules = db.select().from(automationRules).where(eq(automationRules.orgId, "org_rivera")).all();
    db.update(automationRules).set({ enabled: 0 }).where(eq(automationRules.orgId, "org_rivera")).run();
    const ruleId = saveAutomation(maya, {
      name: "Follow-up sent note",
      enabled: true,
      trigger: { kind: "invoice_followup_marked_sent" },
      conditions: [],
      actions: [{ kind: "today", title: "Follow-up sent", who: "role:owner" }],
    });
    try {
      const messagesBefore = db.select().from(messages).all().length;
      markFollowUp(maya, "fol_diaz", "sent");
      expect(db.select().from(messages).all().length).toBe(messagesBefore);
      expect(db.select().from(automationRuns).where(eq(automationRuns.ruleId, ruleId)).all()).toHaveLength(1);
    } finally {
      restoreFol(saved);
      db.delete(automationRuns).where(eq(automationRuns.ruleId, ruleId)).run();
      db.delete(automationNotices).where(eq(automationNotices.ruleId, ruleId)).run();
      db.delete(automationRules).where(eq(automationRules.id, ruleId)).run();
      for (const rule of rules) {
        db.update(automationRules).set({ enabled: rule.enabled }).where(eq(automationRules.id, rule.id)).run();
      }
    }
  });
});
