import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, formSubmissions as formSubmissionRows } from "@/lib/db/schema";
import { listInbox, mentionUnread, openNotification } from "@/lib/services/comments";
import {
  archiveFormTemplate,
  createFormTemplate,
  formAttention,
  formCsv,
  formSubmission,
  formSubmissions,
  markFormLinkSent,
  reviewForm,
  submitPublicForm,
  submitSignedForm,
  updateFormTemplate,
} from "@/lib/services/forms";
import { authenticate } from "@/lib/services/read";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(email);
  return user;
}

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

describe("custom forms", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("seeds a new vendor submission and a reviewed walkthrough", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const rows = formSubmissions(maya);
    expect(rows.find((row) => row.id === "fsub_vendor")?.status).toBe("new");
    expect(rows.find((row) => row.id === "fsub_walk")?.status).toBe("reviewed");
    expect(formAttention(maya)).toEqual({ count: 1, href: "/forms" });
    expect(formAttention(dana)).toEqual({ count: 0, href: null });
    expect(formSubmissions(dana).map((row) => row.id)).toEqual(["fsub_walk"]);
    expect(formSubmission(dana, "fsub_vendor")).toBeNull();
    const walk = formSubmission(maya, "fsub_walk");
    expect(walk?.answers.find((answer) => answer.label === "Notes")?.text).toBe("Gate latched.");
    expect(walk?.answers.find((answer) => answer.label === "Photo")?.filename).toBe("walk.png");
    expect(formCsv(maya, { templateId: "ft_vendor" })).toContain("Harbor Electric");
    expect(formCsv(dana)).not.toContain("Harbor Electric");
    expect(formCsv(dana)).toContain("Gate latched.");
    expect(listInbox(maya, "all").some((row) => row.record === "Vendor info update" && row.kind === "form")).toBe(true);
    expect(listInbox(dana, "all").some((row) => row.snippet === "Vendor info update")).toBe(false);
    expect(mentionUnread(maya)).toBe(2);
    expect(openNotification(maya, "note_form_maya")).toBe("/forms/fsub_vendor");
    const sql = readFileSync("supabase/rls.sql", "utf8");
    const member = sql.slice(sql.indexOf("foreach tbl in"), sql.lastIndexOf("foreach tbl in"));
    const money = sql.slice(sql.lastIndexOf("foreach tbl in"));
    for (const table of ["form_templates", "form_submissions", "form_attempts"]) {
      expect(member).toContain(`'${table}'`);
      expect(money).toContain(`'${table}'`);
    }
    expect(() => createFormTemplate(dana, { title: "Nope", description: "", audiences: ["field"], fields: [{ label: "Note", type: "text", required: false }] })).toThrow(/cannot create/);
    expect(() => createFormTemplate(actor("riley@rivera.demo"), { title: "Nope", description: "", audiences: ["office"], fields: [{ label: "Note", type: "text", required: false }] })).toThrow(/cannot create/);
    expect(() => reviewForm(actor("riley@rivera.demo"), "fsub_vendor")).toThrow(/cannot review/);
    expect(formSubmission(actor("jordan@northline.demo"), "fsub_vendor")).toBeNull();
  });

  it("lets office create a link, rate-limits anonymous fills, and keeps submissions after archive", () => {
    const maya = actor("maya@rivera.demo");
    const luis = actor("luis@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const created = createFormTemplate(luis, {
      title: "Closeout notes",
      description: "After the walk",
      audiences: ["client"],
      fields: [{ label: "Notes", type: "text", required: true }],
    });
    expect(created.link).toContain(`/forms/fill/${created.token}`);
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.action, "form.create")).all().some((row) => row.entityId === created.id)).toBe(true);
    expect(() => updateFormTemplate(luis, created.id, { title: "Changed", description: "", audiences: ["client"], fields: [{ id: "notes", label: "Notes", type: "text", required: true }] })).toThrow(/owner or admin/);
    markFormLinkSent(maya, created.id);
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.action, "form.link")).all().some((row) => row.entityId === created.id)).toBe(true);

    const now = Date.parse("2026-10-16T15:00:00Z");
    expect(() =>
      submitPublicForm({
        token: created.token,
        ip: "203.0.113.10",
        now,
        startedAt: String(now - 500),
        texts: { notes: "Too fast" },
        files: {},
      }),
    ).toThrow(/Wait a moment/);
    const sent = submitPublicForm({
      token: created.token,
      ip: "203.0.113.11",
      now,
      startedAt: String(now - 4_000),
      texts: { notes: "Gate checked" },
      files: {},
    });
    if (!("id" in sent)) throw new Error("dropped");
    expect(formSubmission(maya, sent.id)?.status).toBe("new");
    reviewForm(luis, sent.id);
    expect(formSubmission(maya, sent.id)?.status).toBe("reviewed");
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.action, "form.review")).all().some((row) => row.entityId === sent.id)).toBe(true);
    expect(formCsv(maya, { templateId: created.id })).toContain("Gate checked");

    for (let n = 0; n < 8; n += 1) {
      submitPublicForm({
        token: created.token,
        ip: "203.0.113.20",
        now: now + n,
        startedAt: String(now + n - 4_000),
        texts: { notes: `Row ${n}` },
        files: {},
      });
    }
    expect(() =>
      submitPublicForm({
        token: created.token,
        ip: "203.0.113.20",
        now: now + 9,
        startedAt: String(now + 9 - 4_000),
        texts: { notes: "Over the limit" },
        files: {},
      }),
    ).toThrow(/Too many/);

    const before = getDb().select().from(formSubmissionRows).where(eq(formSubmissionRows.templateId, created.id)).all().length;
    archiveFormTemplate(maya, created.id);
    expect(getDb().select().from(formSubmissionRows).where(eq(formSubmissionRows.templateId, created.id)).all()).toHaveLength(before);
    expect(() =>
      submitPublicForm({
        token: created.token,
        ip: "203.0.113.30",
        now: now + 20_000,
        startedAt: String(now + 16_000),
        texts: { notes: "After archive" },
        files: {},
      }),
    ).toThrow(/closed/);

    const pto = submitSignedForm(dana, "ft_pto", { texts: { start: "2026-10-20", end: "2026-10-21", reason: "Travel" }, files: {} });
    expect(formSubmission(dana, pto)?.answers.find((answer) => answer.label === "Reason")?.text).toBe("Travel");
    expect(formSubmission(maya, pto)?.channel).toBe("field");
    expect(() => submitSignedForm(maya, "ft_pto", { texts: { start: "2026-10-20", end: "2026-10-21", reason: "No" }, files: {} })).toThrow(/cannot fill/);
    submitSignedForm(dana, "ft_walk", {
      texts: { fw_safe: "yes", fw_notes: "Clear" },
      files: { fw_photo: { filename: "site.png", bytes: png } },
    });
  });
});
