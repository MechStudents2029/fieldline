import { z } from "zod";
import { ServiceError } from "@/lib/services/errors";

export const FIELD_TYPES = ["text", "number", "date", "select", "checkbox", "photo", "file", "signature"] as const;
export const AUDIENCES = ["office", "field", "client", "vendor"] as const;
export const FILE_TYPES = ["photo", "file", "signature"] as const;

export type FieldType = (typeof FIELD_TYPES)[number];
export type Audience = (typeof AUDIENCES)[number];

export type FormField = {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
};

export type FormTemplateInput = {
  title: string;
  description: string;
  audiences: Audience[];
  fields: FormField[];
};

export type StoredAnswer = { fieldId: string; text: string | null; documentId: string | null };

const fieldSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  label: z.string().trim().min(1, "Add a field label.").max(80, "A field label is too long."),
  type: z.enum(FIELD_TYPES),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(40)).max(12),
});

const templateSchema = z.object({
  title: z.string().trim().min(1, "Add a title.").max(80, "Title is too long."),
  description: z.string().trim().max(140, "Description is too long."),
  audiences: z.array(z.enum(AUDIENCES)).min(1, "Choose who can fill this."),
  fields: z.array(fieldSchema).min(1, "Add a field.").max(12, "Twelve fields at most."),
});

function slug(label: string, used: Set<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "field";
  let next = base;
  let n = 2;
  while (used.has(next)) {
    next = `${base.slice(0, 20)}_${n}`;
    n += 1;
  }
  used.add(next);
  return next;
}

export function normalizeTemplate(
  input: {
    title: string;
    description: string;
    audiences: string[];
    fields: { id?: string; label: string; type: string; required: boolean; options?: string[] }[];
  },
  existingIds: string[] = [],
): FormTemplateInput {
  const audiences = [...new Set(input.audiences.map((item) => item.trim()).filter(Boolean))];
  if (audiences.some((item) => !(AUDIENCES as readonly string[]).includes(item))) throw new ServiceError("Choose who can fill this.");
  const used = new Set<string>();
  const fields = input.fields
    .filter((field) => field.label.trim())
    .map((field) => {
      if (!(FIELD_TYPES as readonly string[]).includes(field.type)) throw new ServiceError("Choose a field type.");
      const wanted = (field.id ?? "").trim();
      const id = wanted && /^[a-z0-9_]{1,40}$/.test(wanted) && existingIds.includes(wanted) && !used.has(wanted) ? wanted : slug(field.label, used);
      if (!used.has(id)) used.add(id);
      const options = field.type === "select" ? (field.options ?? []).map((item) => item.trim()).filter(Boolean) : [];
      if (field.type === "select" && options.length === 0) throw new ServiceError("Add options.");
      return { id, label: field.label.trim(), type: field.type as FieldType, required: field.required, options };
    });
  const parsed = templateSchema.safeParse({
    title: input.title,
    description: input.description,
    audiences,
    fields,
  });
  if (!parsed.success) throw new ServiceError(parsed.error.issues[0]?.message || "Check the form.");
  return parsed.data;
}

export function parseFields(raw: string): FormField[] {
  try {
    const parsed = z.array(fieldSchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function parseAudiences(raw: string): Audience[] {
  try {
    const parsed = z.array(z.enum(AUDIENCES)).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function linkAudience(audiences: Audience[]): boolean {
  return audiences.includes("client") || audiences.includes("vendor");
}

export function checkAnswers(
  fields: FormField[],
  raw: Record<string, { text?: string | null; hasFile?: boolean }>,
): { fieldId: string; text: string | null; needsFile: boolean }[] {
  return fields.map((field) => {
    const entry = raw[field.id] ?? {};
    const text = (entry.text ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
    if ((FILE_TYPES as readonly string[]).includes(field.type)) {
      if (field.required && !entry.hasFile) throw new ServiceError(`Add ${field.label}.`);
      return { fieldId: field.id, text: null, needsFile: Boolean(entry.hasFile) };
    }
    if (field.type === "checkbox") {
      const checked = text === "yes";
      if (field.required && !checked) throw new ServiceError(`Check ${field.label}.`);
      return { fieldId: field.id, text: checked ? "yes" : "no", needsFile: false };
    }
    if (field.required && !text) throw new ServiceError(`Add ${field.label}.`);
    if (!text) return { fieldId: field.id, text: null, needsFile: false };
    if (text.length > 2000) throw new ServiceError(`${field.label} is too long.`);
    if (field.type === "number" && !/^-?\d+(\.\d+)?$/.test(text)) throw new ServiceError(`${field.label} needs a number.`);
    if (field.type === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new ServiceError(`${field.label} needs a date.`);
    }
    if (field.type === "select" && !field.options.includes(text)) throw new ServiceError(`Choose ${field.label}.`);
    return { fieldId: field.id, text, needsFile: false };
  });
}
