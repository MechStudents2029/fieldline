import { z } from "zod";
import { normalizeEmail } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";

export const WEBSITE_FORM_SOURCE = "Website form";
export const DEMO_RIVERA_FORM_TOKEN = "demo_form_rivera_k7m2p9qx";
export const DEMO_NORTH_FORM_TOKEN = "demo_form_northline_q4n8vw";

export const MIN_FILL_MS = 3_000;
export const MAX_FILL_MS = 2 * 60 * 60 * 1000;
export const IP_LIMIT = 8;
export const IP_WINDOW_MS = 10 * 60 * 1000;
export const ORG_LIMIT = 30;
export const ORG_WINDOW_MS = 60 * 60 * 1000;
export const MAX_PHOTOS = 3;
export const MAX_NAME = 80;
export const MAX_INTRO = 140;
export const MAX_THANKS = 140;
export const MAX_DESCRIPTION = 4_000;
export const MAX_ADDRESS = 200;
export const MAX_PROJECT_TYPES = 12;

export const OPTIONAL_FIELDS = ["address", "projectType", "budget", "timeline", "description", "photos"] as const;
export type OptionalField = (typeof OPTIONAL_FIELDS)[number];
export type FieldFlags = Record<OptionalField, boolean>;

export const BUDGET_BANDS = ["Under $10k", "$10–25k", "$25–50k", "$50–100k", "$100k+", "Not sure"] as const;
export const TIMELINES = ["ASAP", "1–3 months", "3–6 months", "Just looking"] as const;

export type LeadFormAnswers = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  projectType: string | null;
  budget: string | null;
  timeline: string | null;
  description: string | null;
};

const fieldFlagsSchema = z.object({
  address: z.boolean(),
  projectType: z.boolean(),
  budget: z.boolean(),
  timeline: z.boolean(),
  description: z.boolean(),
  photos: z.boolean(),
});

export const leadFormConfigSchema = z.object({
  enabled: z.boolean(),
  intro: z.string().trim().max(MAX_INTRO, "Intro is too long."),
  thanks: z.string().trim().min(1, "Add a thank-you line.").max(MAX_THANKS, "Thank-you line is too long."),
  fields: fieldFlagsSchema,
  projectTypes: z.array(z.string().trim().min(1).max(40)).max(MAX_PROJECT_TYPES, "Twelve project types at most."),
});

export type LeadFormConfig = z.infer<typeof leadFormConfigSchema>;

export function defaultFields(on: boolean): FieldFlags {
  return {
    address: on,
    projectType: on,
    budget: on,
    timeline: on,
    description: on,
    photos: on,
  };
}

export function parseFieldFlags(raw: string): FieldFlags {
  const flags = defaultFields(false);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of OPTIONAL_FIELDS) flags[key] = parsed[key] === true;
  } catch {
    return defaultFields(false);
  }
  return flags;
}

export function parseProjectTypes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, MAX_PROJECT_TYPES);
  } catch {
    return [];
  }
}

export function honeypotTripped(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

export function fillTimeError(startedAt: number, now: number): string | null {
  if (!Number.isFinite(startedAt) || startedAt > now + 30_000) return "Send it again.";
  const elapsed = now - startedAt;
  if (elapsed < MIN_FILL_MS) return "Wait a moment, then send.";
  if (elapsed > MAX_FILL_MS) return "Send it again.";
  return null;
}

export function rateLimitError(input: { ipCount: number; orgCount: number }): string | null {
  if (input.ipCount >= IP_LIMIT || input.orgCount >= ORG_LIMIT) return "Too many requests. Try again later.";
  return null;
}

export function phoneDigits(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function phonesMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = phoneDigits(left);
  const b = phoneDigits(right);
  return a.length >= 10 && a === b;
}

function stripControls(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
}

function bound(value: string | null | undefined, max: number, label: string): string {
  const text = stripControls(value ?? "");
  if (text.length > max) throw new ServiceError(`${label} is too long.`);
  return text;
}

export function validatePublicAnswers(
  raw: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    projectType?: string | null;
    budget?: string | null;
    timeline?: string | null;
    description?: string | null;
  },
  flags: FieldFlags,
  projectTypes: string[],
): LeadFormAnswers {
  const name = bound(raw.name, MAX_NAME, "Name");
  if (!name || !/[A-Za-z]/.test(name)) throw new ServiceError("Add a name.");
  const emailText = bound(raw.email, 120, "Email");
  let email: string | null = null;
  if (emailText) {
    email = normalizeEmail(emailText);
    if (!email) throw new ServiceError("That email is not valid.");
  }
  const phoneText = bound(raw.phone, 40, "Phone");
  let phone: string | null = null;
  if (phoneText) {
    const digits = phoneDigits(phoneText);
    if (digits.length < 10 || digits.length > 15) throw new ServiceError("That phone is not valid.");
    phone = phoneText;
  }
  if (!email && !phone) throw new ServiceError("Add an email or a phone.");

  const addressText = flags.address ? bound(raw.address, MAX_ADDRESS, "Address") : "";
  const projectType = flags.projectType ? bound(raw.projectType, 40, "Project type") : "";
  if (projectType && !projectTypes.includes(projectType)) throw new ServiceError("Choose a project type.");
  const budget = flags.budget ? bound(raw.budget, 40, "Budget") : "";
  if (budget && !(BUDGET_BANDS as readonly string[]).includes(budget)) throw new ServiceError("Choose a budget.");
  const timeline = flags.timeline ? bound(raw.timeline, 40, "Timeline") : "";
  if (timeline && !(TIMELINES as readonly string[]).includes(timeline)) throw new ServiceError("Choose a timeline.");
  const description = flags.description ? bound(raw.description, MAX_DESCRIPTION, "Description") : "";

  const parsed = z
    .object({
      name: z.string().min(1).max(MAX_NAME),
      email: z.string().max(120).nullable(),
      phone: z.string().max(40).nullable(),
      address: z.string().max(MAX_ADDRESS).nullable(),
      projectType: z.string().max(40).nullable(),
      budget: z.string().max(40).nullable(),
      timeline: z.string().max(40).nullable(),
      description: z.string().max(MAX_DESCRIPTION).nullable(),
    })
    .safeParse({
      name,
      email,
      phone,
      address: addressText || null,
      projectType: projectType || null,
      budget: budget || null,
      timeline: timeline || null,
      description: description || null,
    });
  if (!parsed.success) throw new ServiceError("Check the form.");
  return parsed.data;
}

export function attributionLabel(input: {
  source?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
}): string | null {
  const parts: string[] = [];
  const add = (key: string, value: string | null | undefined) => {
    const clean = stripControls(value ?? "").replace(/\s+/g, " ").slice(0, 80);
    if (!clean) return;
    parts.push(`${key} ${clean}`);
  };
  add("source", input.source);
  add("utm_source", input.utmSource);
  add("utm_medium", input.utmMedium);
  add("utm_campaign", input.utmCampaign);
  add("referrer", input.referrer);
  const text = parts.join(" · ").slice(0, 240);
  return text || null;
}

export function embedSnippet(url: string): string {
  const safe = url.replace(/["<>]/g, "");
  return `<iframe src="${safe}" title="Project request" style="width:100%;max-width:420px;height:640px;border:0"></iframe>\n<p><a href="${safe}">Project request</a></p>`;
}

export function externalReferrer(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.pathname.startsWith("/f/")) return null;
    return `${url.origin}${url.pathname}`.slice(0, 180);
  } catch {
    return null;
  }
}
