import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, customFieldValues, tasks, templateFieldValues } from "@/lib/db/schema";
import { commitImport } from "@/lib/services/import";
import { emitAutomation, saveAutomation } from "@/lib/services/automations";
import {
  archiveField,
  createField,
  documentFields,
  fieldRows,
  captureTemplateFields,
  listCsv,
  listFields,
  matchesCustom,
  portalRows,
  restoreField,
  saveRecordFields,
  updateField,
} from "@/lib/services/custom-fields";
import { authenticate } from "@/lib/services/read";
import { createJobFromTemplate } from "@/lib/services/templates";

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

describe("custom fields", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("seeds Rivera fields, hides office money from field, and keeps a missing pill", () => {
    const owner = maya();
    const field = dana();
    const labels = listFields(owner, "job").map((row) => row.label);
    expect(labels).toEqual(["Lead source", "Permit required", "Home built year"]);
    expect(fieldRows(field, "job", "proj_chen", "read").map((row) => row.label)).toEqual(["Lead source", "Permit required"]);
    expect(fieldRows(field, "job", "proj_chen", "read").some((row) => row.label === "Home built year")).toBe(false);
    expect(fieldRows(field, "client", "c_chen", "read").map((row) => row.display)).toContain("4412");
    expect(portalRows("org_rivera", "client", "c_chen", "client").some((row) => row.label === "Gate code")).toBe(false);
    expect(portalRows("org_rivera", "vendor", "c_summit", "vendor")).toEqual([]);
    const money = createField(owner, { recordType: "job", label: "Deposit held", fieldType: "money", office: true, field: false });
    expect(fieldRows(field, "job", "proj_chen", "edit").some((row) => row.id === money)).toBe(false);
    saveRecordFields(field, "job", "proj_chen", { [money]: "50.00" });
    expect(getDb().select().from(customFieldValues).where(eq(customFieldValues.fieldId, money)).all()).toHaveLength(0);
    const note = createField(owner, { recordType: "job", label: "Lockbox", fieldType: "text", required: true, office: true, field: true });
    expect(fieldRows(owner, "job", "proj_chen", "read").find((row) => row.id === note)?.missing).toBe(true);
    expect(() => saveRecordFields(owner, "job", "proj_chen", { [note]: "" })).toThrow(/Lockbox is required/);
    saveRecordFields(owner, "job", "proj_chen", { [note]: "side" });
    putValue(owner.orgId, money, "12.50");
    expect(() => updateField(owner, money, { fieldType: "date" })).toThrow(/cannot become date/);
    archiveField(owner, note);
    expect(fieldRows(owner, "job", "proj_chen", "read").some((row) => row.id === note)).toBe(false);
    expect(getDb().select().from(customFieldValues).where(eq(customFieldValues.fieldId, note)).get()?.valueText).toBe("side");
    restoreField(owner, note);
    expect(fieldRows(owner, "job", "proj_chen", "read").some((row) => row.id === note)).toBe(true);
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.entityType, "custom_field")).all().length).toBeGreaterThan(0);
    updateField(owner, "cf_job_source", { showOnDocuments: true, client: true });
    expect(documentFields("org_rivera", "proj_chen").map((row) => row.value)).toContain("Referral");
  });

  it("filters, sorts, and exports a custom column", () => {
    const owner = maya();
    expect(matchesCustom(owner, "job", "proj_chen", { cf_job_source: "Referral" })).toBe(true);
    expect(matchesCustom(owner, "job", "proj_brooks", { cf_job_source: "Referral" })).toBe(false);
    const csv = listCsv(owner, "job", [{ id: "proj_chen", cells: ["Chen powder room", "active"] }], ["Job", "Status"]);
    expect(csv.split("\n")[0]).toContain("Lead source");
    expect(csv).toContain("Referral");
  });

  it("copies chosen job fields onto a template and defaults the rest", () => {
    const owner = maya();
    captureTemplateFields(owner, "tpl_kitchen", "proj_chen", ["cf_job_source", "cf_job_permit"]);
    const copied = getDb().select().from(templateFieldValues).where(eq(templateFieldValues.templateId, "tpl_kitchen")).all();
    expect(copied.map((row) => row.fieldId).sort()).toEqual(["cf_job_permit", "cf_job_source"]);
    const created = createJobFromTemplate(owner, {
      templateId: "tpl_kitchen",
      name: "Field copy",
      contactId: "c_chen",
      startDate: "2026-10-12",
      pmUserId: "user_maya",
      parts: ["schedule"],
      trades: {},
    });
    expect(fieldRows(owner, "job", created.projectId, "read").find((row) => row.label === "Lead source")?.display).toBe("Referral");
  });

  it("maps an import column onto a custom field", () => {
    const owner = maya();
    const result = commitImport(owner, {
      kind: "contacts",
      csv: "Display Name,Email,Gate code\nNora Fields,nora.fields@example.com,9090\n",
      mapping: ["name", "email", "cf_client_gate"],
      choices: [],
    });
    expect(result.counts.new).toBe(1);
    const contact = getDb().select().from(customFieldValues).where(and(eq(customFieldValues.fieldId, "cf_client_gate"), eq(customFieldValues.valueText, "9090"))).get();
    expect(contact).toBeTruthy();
  });

  it("runs a field condition and sets a field once", () => {
    const owner = maya();
    emitAutomation({
      orgId: owner.orgId,
      kind: "job_status",
      recordType: "project",
      recordId: "proj_chen",
      recordLabel: "Chen powder room",
      projectId: "proj_chen",
      status: "active",
      name: "Chen powder room",
    });
    expect(getDb().select().from(tasks).where(eq(tasks.title, "Pull permit")).all().length).toBe(1);
    emitAutomation({
      orgId: owner.orgId,
      kind: "job_status",
      recordType: "project",
      recordId: "proj_chen",
      recordLabel: "Chen powder room",
      projectId: "proj_chen",
      status: "active",
      name: "Chen powder room",
    });
    expect(getDb().select().from(tasks).where(eq(tasks.title, "Pull permit")).all().length).toBe(1);
    const ruleId = saveAutomation(owner, {
      name: "Set year",
      enabled: true,
      trigger: { kind: "job_status", status: "active" },
      conditions: [],
      actions: [{ kind: "set_field", fieldId: "cf_job_year", value: "1901" }],
    });
    emitAutomation({
      orgId: owner.orgId,
      kind: "job_status",
      recordType: "project",
      recordId: "proj_okonkwo",
      recordLabel: "Okonkwo primary bath",
      projectId: "proj_okonkwo",
      status: "active",
      name: "Okonkwo primary bath",
    });
    expect(fieldRows(owner, "job", "proj_okonkwo", "read").find((row) => row.label === "Home built year")?.display).toBe("1901");
    expect(ruleId).toBeTruthy();
  });
});

function putValue(orgId: string, fieldId: string, raw: string) {
  saveRecordFields(maya(), "job", "proj_chen", { [fieldId]: raw });
}
