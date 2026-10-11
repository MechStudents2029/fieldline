import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { auditLogs, customFields, customFieldValues, memberships, projects, templateFieldValues, users } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { canManageSettings, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";

export const RECORD_TYPES = ["job", "client", "lead", "vendor", "todo", "log", "price_item"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const RECORD_LABEL: Record<RecordType, string> = {
  job: "Jobs",
  client: "Clients",
  lead: "Leads",
  vendor: "Vendors",
  todo: "To-dos",
  log: "Daily logs",
  price_item: "Price book items",
};

export const FIELD_TYPES = ["text", "number", "money", "date", "yes_no", "single", "multi", "person", "link"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const TYPE_LABEL: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  money: "Money",
  date: "Date",
  yes_no: "Yes/no",
  single: "Single choice",
  multi: "Multi choice",
  person: "Person",
  link: "Link",
};

type Audience = "office" | "field" | "vendor" | "client";

type FieldRow = typeof customFields.$inferSelect;

export type FieldDef = {
  id: string;
  recordType: RecordType;
  label: string;
  fieldType: FieldType;
  options: string[];
  defaultValue: string;
  required: boolean;
  hint: string;
  office: boolean;
  field: boolean;
  vendor: boolean;
  client: boolean;
  showOnDocuments: boolean;
  sortOrder: number;
  archived: boolean;
};

export type ValueRow = {
  id: string;
  label: string;
  hint: string;
  fieldType: FieldType;
  options: string[];
  required: boolean;
  missing: boolean;
  empty: boolean;
  value: string;
  display: string;
};

export type FieldInput = {
  recordType: string;
  label: string;
  fieldType: string;
  options?: string[];
  defaultValue?: string;
  required?: boolean;
  hint?: string;
  office?: boolean;
  field?: boolean;
  vendor?: boolean;
  client?: boolean;
  showOnDocuments?: boolean;
};

function assertManager(actor: Actor) {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("Only an owner or admin can change custom fields.");
}

function recordTypeOf(value: string): RecordType {
  if ((RECORD_TYPES as readonly string[]).includes(value)) return value as RecordType;
  throw new ServiceError("Pick a record type.");
}

function fieldTypeOf(value: string): FieldType {
  if ((FIELD_TYPES as readonly string[]).includes(value)) return value as FieldType;
  throw new ServiceError("Pick a field type.");
}

function cleanLabel(value: string) {
  const label = value.trim().replace(/\s+/g, " ");
  if (!label || label.length > 40) throw new ServiceError("Add a label.");
  return label;
}

function cleanHint(value: string | undefined) {
  return (value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function parseOptions(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  } catch {
    return [];
  }
}

function choiceList(values: string[] | undefined, fieldType: FieldType) {
  const options = [...new Set((values ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 20);
  if ((fieldType === "single" || fieldType === "multi") && options.length === 0) throw new ServiceError("Add at least one choice.");
  return options;
}

function present(row: FieldRow): FieldDef {
  return {
    id: row.id,
    recordType: recordTypeOf(row.recordType),
    label: row.label,
    fieldType: fieldTypeOf(row.fieldType),
    options: parseOptions(row.optionsJson),
    defaultValue: row.defaultValue,
    required: row.required === 1,
    hint: row.hint,
    office: row.office === 1,
    field: row.field === 1,
    vendor: row.vendor === 1,
    client: row.client === 1,
    showOnDocuments: row.showOnDocuments === 1,
    sortOrder: row.sortOrder,
    archived: Boolean(row.archivedAt),
  };
}

function audit(actor: Actor, action: string, entityId: string, payload: Record<string, unknown>) {
  getDb()
    .insert(auditLogs)
    .values({
      id: id("aud"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action,
      entityType: "custom_field",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function audienceFor(role: string): Audience {
  return role === "field" ? "field" : "office";
}

function sees(row: FieldRow, audience: Audience) {
  if (row.archivedAt) return false;
  if (audience === "office") return row.office === 1;
  if (audience === "field") return row.field === 1;
  if (audience === "vendor") return row.vendor === 1;
  return row.client === 1;
}

function people(orgId: string) {
  return getDb()
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
}

function personName(orgId: string, userId: string) {
  return people(orgId).find((person) => person.id === userId)?.name ?? "";
}

export function fieldPeople(orgId: string) {
  return people(orgId);
}

function defs(orgId: string, recordType?: RecordType) {
  const rows = getDb().select().from(customFields).where(eq(customFields.orgId, orgId)).all();
  return rows.filter((row) => !recordType || row.recordType === recordType).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

export function listFields(actor: Actor, recordType?: string, includeArchived = true): FieldDef[] {
  const type = recordType ? recordTypeOf(recordType) : undefined;
  return defs(actor.orgId, type)
    .filter((row) => includeArchived || !row.archivedAt)
    .map(present);
}

function storedMap(orgId: string, recordId: string) {
  const rows = getDb().select().from(customFieldValues).where(and(eq(customFieldValues.orgId, orgId), eq(customFieldValues.recordId, recordId))).all();
  return new Map(rows.map((row) => [row.fieldId, row.valueText]));
}

function resolved(row: FieldRow, stored: Map<string, string>) {
  const value = stored.get(row.id);
  if (value != null && value !== "") return value;
  return row.defaultValue || "";
}

function displayOf(orgId: string, row: FieldRow, value: string) {
  if (!value) return "";
  if (row.fieldType === "money") return formatMoney(Number(value));
  if (row.fieldType === "yes_no") return value === "yes" ? "Yes" : "No";
  if (row.fieldType === "person") return personName(orgId, value) || value;
  if (row.fieldType === "multi") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").join(", ") : value;
    } catch {
      return value;
    }
  }
  return value;
}

function toValueRow(orgId: string, row: FieldRow, stored: Map<string, string>): ValueRow {
  const raw = stored.get(row.id) ?? "";
  const value = raw || row.defaultValue || "";
  const missing = row.required === 1 && !value;
  return {
    id: row.id,
    label: row.label,
    hint: row.hint,
    fieldType: fieldTypeOf(row.fieldType),
    options: parseOptions(row.optionsJson),
    required: row.required === 1,
    missing,
    empty: !value,
    value,
    display: missing ? "" : displayOf(orgId, row, value),
  };
}

export function fieldRows(actor: Actor, recordType: string, recordId: string, mode: "read" | "edit"): ValueRow[] {
  const type = recordTypeOf(recordType);
  const audience = audienceFor(actor.role);
  const stored = storedMap(actor.orgId, recordId);
  return defs(actor.orgId, type)
    .filter((row) => sees(row, audience))
    .map((row) => toValueRow(actor.orgId, row, stored))
    .filter((row) => mode === "edit" || row.missing || !row.empty);
}

export function portalRows(orgId: string, recordType: string, recordId: string, audience: "client" | "vendor"): ValueRow[] {
  const type = recordTypeOf(recordType);
  const stored = storedMap(orgId, recordId);
  return defs(orgId, type)
    .filter((row) => sees(row, audience))
    .map((row) => toValueRow(orgId, row, stored))
    .filter((row) => !row.empty);
}

export function documentFields(orgId: string, projectId: string): { label: string; value: string }[] {
  const stored = storedMap(orgId, projectId);
  return defs(orgId, "job")
    .filter((row) => row.client === 1 && row.showOnDocuments === 1 && !row.archivedAt)
    .map((row) => ({ label: row.label, value: displayOf(orgId, row, resolved(row, stored)) }))
    .filter((row) => row.value);
}

function moneyCents(raw: string): number | null {
  const text = raw.trim().replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, frac = ""] = text.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

function canonical(orgId: string, row: FieldRow, raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  const type = fieldTypeOf(row.fieldType);
  const options = parseOptions(row.optionsJson);
  if (type === "text") return text.slice(0, 500);
  if (type === "number") {
    if (!/^-?\d+(\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) throw new ServiceError(`${row.label} needs a number.`);
    return String(Number(text));
  }
  if (type === "money") {
    const cents = moneyCents(text);
    if (cents == null) throw new ServiceError(`${row.label} needs an amount.`);
    return String(cents);
  }
  if (type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new ServiceError(`${row.label} needs a date.`);
    return text;
  }
  if (type === "yes_no") {
    const token = text.toLowerCase();
    if (["yes", "true", "y", "1"].includes(token)) return "yes";
    if (["no", "false", "n", "0"].includes(token)) return "no";
    throw new ServiceError(`${row.label} needs yes or no.`);
  }
  if (type === "single") {
    if (!options.includes(text)) throw new ServiceError(`${row.label} needs one of the choices.`);
    return text;
  }
  if (type === "multi") {
    let picked: string[] = [];
    if (text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text) as unknown;
        picked = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
      } catch {
        picked = [];
      }
    } else picked = text.split(",").map((item) => item.trim()).filter(Boolean);
    if (picked.some((item) => !options.includes(item))) throw new ServiceError(`${row.label} needs the listed choices.`);
    return JSON.stringify([...new Set(picked)]);
  }
  if (type === "person") {
    if (!people(orgId).some((person) => person.id === text)) throw new ServiceError(`${row.label} needs a person in the company.`);
    return text;
  }
  if (!/^https?:\/\/\S+$/i.test(text)) throw new ServiceError(`${row.label} needs a link.`);
  return text.slice(0, 500);
}

function convertOne(orgId: string, from: FieldType, to: FieldType, value: string, options: string[]): string | null {
  if (!value) return "";
  if (from === to) return value;
  const asText = () => {
    if (from === "multi") {
      try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed.join(", ") : value;
      } catch {
        return value;
      }
    }
    if (from === "money") return formatMoney(Number(value));
    if (from === "yes_no") return value === "yes" ? "Yes" : "No";
    if (from === "person") return personName(orgId, value) || value;
    return value;
  };
  if (to === "text") return asText().slice(0, 500);
  try {
    const fake = { fieldType: to, label: "Value", optionsJson: JSON.stringify(options) } as FieldRow;
    return canonical(orgId, fake, from === "money" ? (Number(value) / 100).toFixed(2) : asText());
  } catch {
    return null;
  }
}

export function saveRecordFields(actor: Actor, recordType: string, recordId: string, input: Record<string, string | string[]>) {
  if (actor.role === "viewer") throw new ServiceError("Your role cannot edit this.");
  const type = recordTypeOf(recordType);
  const audience = audienceFor(actor.role);
  const rows = defs(actor.orgId, type).filter((row) => sees(row, audience));
  const now = nowIso();
  const db = getDb();
  for (const row of rows) {
    const rawValue = input[row.id];
    const raw = Array.isArray(rawValue) ? (row.fieldType === "multi" ? JSON.stringify(rawValue) : rawValue[0] || "") : rawValue ?? "";
    if (rawValue == null && row.fieldType !== "multi") continue;
    const value = raw.trim() ? canonical(actor.orgId, row, raw) : "";
    if (row.required === 1 && !value && !row.defaultValue) throw new ServiceError(`${row.label} is required.`);
    const existing = db
      .select()
      .from(customFieldValues)
      .where(and(eq(customFieldValues.orgId, actor.orgId), eq(customFieldValues.fieldId, row.id), eq(customFieldValues.recordId, recordId)))
      .get();
    if (!value) {
      if (existing) db.delete(customFieldValues).where(eq(customFieldValues.id, existing.id)).run();
      continue;
    }
    if (existing) {
      db.update(customFieldValues).set({ valueText: value, updatedAt: now }).where(eq(customFieldValues.id, existing.id)).run();
    } else {
      db.insert(customFieldValues).values({ id: id("cfv"), orgId: actor.orgId, fieldId: row.id, recordId, valueText: value, updatedAt: now }).run();
    }
  }
}

function writeCanonical(orgId: string, recordId: string, fieldId: string, value: string, db = getDb()) {
  const now = nowIso();
  const existing = db
    .select()
    .from(customFieldValues)
    .where(and(eq(customFieldValues.orgId, orgId), eq(customFieldValues.fieldId, fieldId), eq(customFieldValues.recordId, recordId)))
    .get();
  if (!value) {
    if (existing) db.delete(customFieldValues).where(eq(customFieldValues.id, existing.id)).run();
    return;
  }
  if (existing) db.update(customFieldValues).set({ valueText: value, updatedAt: now }).where(eq(customFieldValues.id, existing.id)).run();
  else db.insert(customFieldValues).values({ id: id("cfv"), orgId, fieldId, recordId, valueText: value, updatedAt: now }).run();
}

export function putFieldValues(orgId: string, recordId: string, values: Record<string, string>, db = getDb()) {
  for (const [fieldId, raw] of Object.entries(values)) {
    if (!raw.trim()) continue;
    const row = db.select().from(customFields).where(and(eq(customFields.orgId, orgId), eq(customFields.id, fieldId))).get();
    if (!row || row.archivedAt) continue;
    writeCanonical(orgId, recordId, fieldId, canonical(orgId, row, raw), db);
  }
}

export function applyDefaults(orgId: string, recordType: string, recordId: string) {
  const type = recordTypeOf(recordType);
  const stored = storedMap(orgId, recordId);
  for (const row of defs(orgId, type)) {
    if (row.archivedAt || !row.defaultValue || stored.get(row.id)) continue;
    writeCanonical(orgId, recordId, row.id, row.defaultValue);
  }
}

export function createField(actor: Actor, input: FieldInput) {
  assertManager(actor);
  const recordType = recordTypeOf(input.recordType);
  const fieldType = fieldTypeOf(input.fieldType);
  const label = cleanLabel(input.label);
  const options = choiceList(input.options, fieldType);
  const siblings = defs(actor.orgId, recordType).filter((row) => !row.archivedAt);
  if (siblings.some((row) => row.label.toLowerCase() === label.toLowerCase())) throw new ServiceError(`${label} is already on ${RECORD_LABEL[recordType]}.`);
  const fieldId = id("cf");
  const now = nowIso();
  const draft = {
    fieldType,
    label,
    optionsJson: JSON.stringify(options),
  } as FieldRow;
  const defaultValue = input.defaultValue?.trim() ? canonical(actor.orgId, draft, input.defaultValue) : "";
  getDb()
    .insert(customFields)
    .values({
      id: fieldId,
      orgId: actor.orgId,
      recordType,
      label,
      fieldType,
      optionsJson: JSON.stringify(options),
      defaultValue,
      required: input.required ? 1 : 0,
      hint: cleanHint(input.hint),
      office: input.office === false ? 0 : 1,
      field: input.field ? 1 : 0,
      vendor: input.vendor ? 1 : 0,
      client: input.client ? 1 : 0,
      showOnDocuments: input.showOnDocuments ? 1 : 0,
      sortOrder: siblings.length,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  audit(actor, "Created custom field", fieldId, { label, recordType, fieldType });
  return fieldId;
}

export function updateField(actor: Actor, fieldId: string, input: Partial<FieldInput>) {
  assertManager(actor);
  const db = getDb();
  const row = db.select().from(customFields).where(and(eq(customFields.orgId, actor.orgId), eq(customFields.id, fieldId))).get();
  if (!row) throw new ServiceError("That field is not in your company.");
  const nextType = input.fieldType ? fieldTypeOf(input.fieldType) : fieldTypeOf(row.fieldType);
  const options = input.options ? choiceList(input.options, nextType) : parseOptions(row.optionsJson);
  if ((nextType === "single" || nextType === "multi") && options.length === 0) throw new ServiceError("Add at least one choice.");
  if (nextType !== row.fieldType) {
    const values = db.select().from(customFieldValues).where(and(eq(customFieldValues.orgId, actor.orgId), eq(customFieldValues.fieldId, row.id))).all();
    const failed = values.filter((item) => item.valueText && convertOne(actor.orgId, fieldTypeOf(row.fieldType), nextType, item.valueText, options) == null);
    if (failed.length > 0) throw new ServiceError(`${row.label} has ${failed.length} ${failed.length === 1 ? "value" : "values"} that cannot become ${TYPE_LABEL[nextType].toLowerCase()}.`);
    const now = nowIso();
    for (const item of values) {
      const converted = convertOne(actor.orgId, fieldTypeOf(row.fieldType), nextType, item.valueText, options) ?? "";
      db.update(customFieldValues).set({ valueText: converted, updatedAt: now }).where(eq(customFieldValues.id, item.id)).run();
    }
  }
  const label = input.label != null ? cleanLabel(input.label) : row.label;
  const siblings = defs(actor.orgId, recordTypeOf(row.recordType)).filter((item) => item.id !== row.id && !item.archivedAt);
  if (siblings.some((item) => item.label.toLowerCase() === label.toLowerCase())) throw new ServiceError(`${label} is already on ${RECORD_LABEL[recordTypeOf(row.recordType)]}.`);
  const draft = { ...row, fieldType: nextType, label, optionsJson: JSON.stringify(options) };
  const defaultValue = input.defaultValue != null ? (input.defaultValue.trim() ? canonical(actor.orgId, draft, input.defaultValue) : "") : row.defaultValue;
  const now = nowIso();
  db.update(customFields)
    .set({
      label,
      fieldType: nextType,
      optionsJson: JSON.stringify(options),
      defaultValue,
      required: input.required == null ? row.required : input.required ? 1 : 0,
      hint: input.hint == null ? row.hint : cleanHint(input.hint),
      office: input.office == null ? row.office : input.office ? 1 : 0,
      field: input.field == null ? row.field : input.field ? 1 : 0,
      vendor: input.vendor == null ? row.vendor : input.vendor ? 1 : 0,
      client: input.client == null ? row.client : input.client ? 1 : 0,
      showOnDocuments: input.showOnDocuments == null ? row.showOnDocuments : input.showOnDocuments ? 1 : 0,
      updatedAt: now,
    })
    .where(eq(customFields.id, row.id))
    .run();
  audit(actor, "Updated custom field", row.id, { label, fieldType: nextType });
}

export function archiveField(actor: Actor, fieldId: string) {
  assertManager(actor);
  const row = getDb().select().from(customFields).where(and(eq(customFields.orgId, actor.orgId), eq(customFields.id, fieldId))).get();
  if (!row) throw new ServiceError("That field is not in your company.");
  if (row.archivedAt) return;
  const now = nowIso();
  getDb().update(customFields).set({ archivedAt: now, updatedAt: now }).where(eq(customFields.id, row.id)).run();
  audit(actor, "Archived custom field", row.id, { label: row.label });
}

export function restoreField(actor: Actor, fieldId: string) {
  assertManager(actor);
  const row = getDb().select().from(customFields).where(and(eq(customFields.orgId, actor.orgId), eq(customFields.id, fieldId))).get();
  if (!row) throw new ServiceError("That field is not in your company.");
  const now = nowIso();
  getDb().update(customFields).set({ archivedAt: null, updatedAt: now }).where(eq(customFields.id, row.id)).run();
  audit(actor, "Restored custom field", row.id, { label: row.label });
}

export function moveField(actor: Actor, fieldId: string, direction: -1 | 1) {
  assertManager(actor);
  const row = getDb().select().from(customFields).where(and(eq(customFields.orgId, actor.orgId), eq(customFields.id, fieldId))).get();
  if (!row) throw new ServiceError("That field is not in your company.");
  const siblings = defs(actor.orgId, recordTypeOf(row.recordType)).filter((item) => !item.archivedAt);
  const index = siblings.findIndex((item) => item.id === row.id);
  const swap = siblings[index + direction];
  if (!swap || index < 0) return;
  const db = getDb();
  db.update(customFields).set({ sortOrder: swap.sortOrder }).where(eq(customFields.id, row.id)).run();
  db.update(customFields).set({ sortOrder: row.sortOrder }).where(eq(customFields.id, swap.id)).run();
  audit(actor, "Reordered custom fields", row.id, { label: row.label, direction });
}

export function customFilters(actor: Actor, recordType: string) {
  const type = recordTypeOf(recordType);
  const audience = audienceFor(actor.role);
  return defs(actor.orgId, type)
    .filter((row) => sees(row, audience) && (row.fieldType === "single" || row.fieldType === "yes_no"))
    .map((row) => ({
      name: row.id,
      label: row.label,
      options: row.fieldType === "yes_no" ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] : parseOptions(row.optionsJson).map((option) => ({ value: option, label: option })),
    }));
}

export function customColumns(actor: Actor, recordType: string) {
  const type = recordTypeOf(recordType);
  const audience = audienceFor(actor.role);
  return defs(actor.orgId, type)
    .filter((row) => sees(row, audience))
    .map((row) => ({ key: row.id, label: row.label, fieldType: fieldTypeOf(row.fieldType) }));
}

export function customCell(actor: Actor, recordId: string, fieldId: string): { text: string; sort: string | number } {
  const row = defs(actor.orgId).find((item) => item.id === fieldId);
  if (!row || !sees(row, audienceFor(actor.role))) return { text: "", sort: "" };
  const value = resolved(row, storedMap(actor.orgId, recordId));
  const text = displayOf(actor.orgId, row, value);
  if (row.fieldType === "number" || row.fieldType === "money") return { text, sort: value ? Number(value) : -1 };
  return { text, sort: text };
}

export function matchesCustom(actor: Actor, recordType: string, recordId: string, query: Record<string, string>) {
  const type = recordTypeOf(recordType);
  const audience = audienceFor(actor.role);
  const stored = storedMap(actor.orgId, recordId);
  for (const row of defs(actor.orgId, type)) {
    const expected = query[row.id];
    if (!expected || !sees(row, audience)) continue;
    const value = resolved(row, stored);
    if (row.fieldType === "yes_no") {
      if ((expected === "yes" && value !== "yes") || (expected === "no" && value !== "no")) return false;
    } else if (value !== expected) return false;
  }
  return true;
}

export function customCsvHeaders(actor: Actor, recordType: string) {
  return customColumns(actor, recordType).map((column) => column.label);
}

export function customCsvCells(actor: Actor, recordType: string, recordId: string) {
  return customColumns(actor, recordType).map((column) => customCell(actor, recordId, column.key).text);
}

export function captureTemplateFields(actor: Actor, templateId: string, projectId: string, fieldIds: string[]) {
  const chosen = new Set(fieldIds);
  const db = getDb();
  const stored = storedMap(actor.orgId, projectId);
  db.delete(templateFieldValues).where(and(eq(templateFieldValues.orgId, actor.orgId), eq(templateFieldValues.templateId, templateId))).run();
  for (const row of defs(actor.orgId, "job")) {
    if (row.archivedAt || !chosen.has(row.id)) continue;
    const value = stored.get(row.id) || "";
    if (!value) continue;
    db.insert(templateFieldValues).values({ id: id("tfv"), orgId: actor.orgId, templateId, fieldId: row.id, valueText: value }).run();
  }
}

export function applyTemplateJobFields(actor: Actor, templateId: string, projectId: string) {
  const db = getDb();
  const copied = db.select().from(templateFieldValues).where(and(eq(templateFieldValues.orgId, actor.orgId), eq(templateFieldValues.templateId, templateId))).all();
  const values: Record<string, string> = {};
  for (const row of copied) values[row.fieldId] = row.valueText;
  for (const row of defs(actor.orgId, "job")) {
    if (row.archivedAt || values[row.id] || !row.defaultValue) continue;
    values[row.id] = row.defaultValue;
  }
  for (const [fieldId, value] of Object.entries(values)) writeCanonical(actor.orgId, projectId, fieldId, value);
}

export function importTargets(actor: Actor, kind: "contacts" | "vendors" | "price_book") {
  const recordType = kind === "price_book" ? "price_item" : kind === "vendors" ? "vendor" : "client";
  return defs(actor.orgId, recordType)
    .filter((row) => !row.archivedAt && sees(row, "office"))
    .map((row) => ({ id: row.id, label: row.label }));
}

export function fieldConditionMet(orgId: string, fieldId: string, target: { projectId: string | null; recordId: string }, op: "eq" | "empty" | "gt", expected: string) {
  const row = getDb().select().from(customFields).where(and(eq(customFields.orgId, orgId), eq(customFields.id, fieldId))).get();
  if (!row || row.archivedAt) return false;
  const recordId = recordFor(orgId, row.recordType, target);
  if (!recordId) return false;
  const value = resolved(row, storedMap(orgId, recordId));
  if (op === "empty") return !value;
  if (op === "eq") {
    if (row.fieldType === "yes_no") return value === (expected.toLowerCase() === "yes" ? "yes" : expected.toLowerCase() === "no" ? "no" : expected);
    if (row.fieldType === "money") {
      const cents = moneyCents(expected);
      return cents != null && value === String(cents);
    }
    return value === expected;
  }
  if (row.fieldType === "number") return value !== "" && Number(value) > Number(expected);
  if (row.fieldType === "money") {
    const cents = moneyCents(expected);
    return cents != null && value !== "" && Number(value) > cents;
  }
  if (row.fieldType === "date") return value !== "" && value > expected;
  return false;
}

export function setStoredField(orgId: string, fieldId: string, target: { projectId: string | null; recordId: string }, raw: string, dry = false) {
  const row = getDb().select().from(customFields).where(and(eq(customFields.orgId, orgId), eq(customFields.id, fieldId))).get();
  if (!row || row.archivedAt) throw new ServiceError("That field is not in your company.");
  const recordId = recordFor(orgId, row.recordType, target);
  if (!recordId) throw new ServiceError("No record for that field.");
  const value = raw.trim() ? canonical(orgId, row, raw) : "";
  if (!dry) writeCanonical(orgId, recordId, row.id, value);
  return `Set ${row.label}${value ? ` to ${displayOf(orgId, row, value)}` : ""}`.trim();
}

function recordFor(orgId: string, recordType: string, target: { projectId: string | null; recordId: string }) {
  if (recordType === "job") return target.projectId;
  if (recordType === "client" && target.projectId) {
    return getDb().select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, target.projectId))).get()?.contactId ?? null;
  }
  if (recordType === "lead" && target.projectId) {
    return getDb().select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, target.projectId))).get()?.leadId ?? target.recordId;
  }
  return target.recordId;
}

export function listCsv(actor: Actor, recordType: string, rows: { id: string; cells: string[] }[], headers: string[]) {
  const extra = customCsvHeaders(actor, recordType);
  const lines = [[...headers, ...extra].map(csvCell).join(",")];
  for (const row of rows) {
    lines.push([...row.cells, ...customCsvCells(actor, recordType, row.id)].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function jobsCsv(actor: Actor, rows: { id: string; name: string; status: string }[]) {
  const headers = ["Job", "Status", ...customCsvHeaders(actor, "job")];
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push([row.name, row.status, ...customCsvCells(actor, "job", row.id)].map(csvCell).join(","));
  }
  return lines.join("\n");
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
