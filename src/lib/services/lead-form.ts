import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { extractIntake } from "@/lib/ai/intake";
import { dataDir, getDb } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  activities,
  aiRuns,
  auditLogs,
  contacts,
  documents,
  leadFormAttempts,
  leadFormSubmissions,
  leadForms,
  leads,
  organizations,
  pipelineStages,
} from "@/lib/db/schema";
import { id, nowIso, token } from "@/lib/ids";
import {
  attributionLabel,
  defaultFields,
  externalReferrer,
  fillTimeError,
  honeypotTripped,
  IP_WINDOW_MS,
  leadFormConfigSchema,
  MAX_PHOTOS,
  ORG_WINDOW_MS,
  parseFieldFlags,
  parseProjectTypes,
  phoneDigits,
  phonesMatch,
  rateLimitError,
  validatePublicAnswers,
  WEBSITE_FORM_SOURCE,
  type FieldFlags,
  type LeadFormAnswers,
  type LeadFormConfig,
} from "@/lib/lead-form/rules";
import { MAX_MONEY_CENTS } from "@/lib/money";
import { canManageSettings, type Role } from "@/lib/permissions";
import { photoExtension, photoUploadError, rasterImageType } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";

type Database = ReturnType<typeof getDb>;

export type LeadFormBoard = {
  enabled: boolean;
  token: string;
  intro: string;
  thanks: string;
  fields: FieldFlags;
  projectTypes: string[];
};

export type PublicLeadForm =
  | { state: "missing" }
  | { state: "disabled"; orgName: string }
  | {
      state: "open";
      orgName: string;
      token: string;
      intro: string;
      thanks: string;
      fields: FieldFlags;
      projectTypes: string[];
    };

export type WebLeadView = {
  answers: LeadFormAnswers;
  attribution: string | null;
};

type SubmitInput = {
  token: string;
  ip: string;
  now?: number;
  referrer?: string | null;
  source?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  companyUrl?: string | null;
  startedAt?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  projectType?: string | null;
  budget?: string | null;
  timeline?: string | null;
  description?: string | null;
  photos?: { filename: string; bytes: Buffer }[];
};

const DEFAULT_INTRO = "Tell us about the project.";
const DEFAULT_THANKS = "Thanks. We'll be in touch.";

function assertSettings(actor: Actor) {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("Only an owner or admin can change the lead form.");
}

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function mapBoard(row: typeof leadForms.$inferSelect): LeadFormBoard {
  return {
    enabled: row.enabled === 1,
    token: row.token,
    intro: row.intro,
    thanks: row.thanks,
    fields: parseFieldFlags(row.fieldsJson),
    projectTypes: parseProjectTypes(row.projectTypesJson),
  };
}

function insertDefault(db: Database, orgId: string) {
  const now = nowIso();
  db.insert(leadForms)
    .values({
      id: id("form"),
      orgId,
      enabled: 0,
      token: token(),
      intro: DEFAULT_INTRO,
      thanks: DEFAULT_THANKS,
      fieldsJson: JSON.stringify(defaultFields(true)),
      projectTypesJson: JSON.stringify(["Kitchen remodel", "Bath remodel", "Addition", "Deck"]),
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

export function leadFormBoard(actor: Actor): LeadFormBoard | null {
  if (!canManageSettings(actor.role as Role)) return null;
  const db = dbFor(actor);
  let row = db.select().from(leadForms).where(eq(leadForms.orgId, actor.orgId)).get();
  if (!row) {
    insertDefault(db, actor.orgId);
    row = db.select().from(leadForms).where(eq(leadForms.orgId, actor.orgId)).get();
  }
  return row ? mapBoard(row) : null;
}

export function saveLeadForm(actor: Actor, input: LeadFormConfig) {
  assertSettings(actor);
  const parsed = leadFormConfigSchema.safeParse({
    ...input,
    projectTypes: [...new Set(input.projectTypes.map((item) => item.trim()).filter(Boolean))],
  });
  if (!parsed.success) throw new ServiceError(parsed.error.issues[0]?.message || "Check the form.");
  const db = dbFor(actor);
  let row = db.select().from(leadForms).where(eq(leadForms.orgId, actor.orgId)).get();
  if (!row) {
    insertDefault(db, actor.orgId);
    row = db.select().from(leadForms).where(eq(leadForms.orgId, actor.orgId)).get();
  }
  if (!row) throw new ServiceError("Lead form is missing.");
  const now = nowIso();
  db.update(leadForms)
    .set({
      enabled: parsed.data.enabled ? 1 : 0,
      intro: parsed.data.intro,
      thanks: parsed.data.thanks,
      fieldsJson: JSON.stringify(parsed.data.fields),
      projectTypesJson: JSON.stringify(parsed.data.projectTypes),
      updatedAt: now,
    })
    .where(and(eq(leadForms.id, row.id), eq(leadForms.orgId, actor.orgId)))
    .run();
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action: "lead_form.save",
      entityType: "lead_form",
      entityId: row.id,
      payloadJson: JSON.stringify({ enabled: parsed.data.enabled }),
      ip: null,
      createdAt: now,
    })
    .run();
}

export function regenerateLeadFormKey(actor: Actor): string {
  assertSettings(actor);
  const db = dbFor(actor);
  const row = db.select().from(leadForms).where(eq(leadForms.orgId, actor.orgId)).get();
  if (!row) throw new ServiceError("Lead form is missing.");
  const next = token();
  const now = nowIso();
  db.update(leadForms)
    .set({ token: next, updatedAt: now })
    .where(and(eq(leadForms.id, row.id), eq(leadForms.orgId, actor.orgId)))
    .run();
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action: "lead_form.rotate",
      entityType: "lead_form",
      entityId: row.id,
      payloadJson: null,
      ip: null,
      createdAt: now,
    })
    .run();
  return next;
}

export function publicLeadForm(formToken: string): PublicLeadForm {
  const db = getDb();
  const row = db.select().from(leadForms).where(eq(leadForms.token, formToken)).get();
  if (!row) return { state: "missing" };
  const org = db.select().from(organizations).where(eq(organizations.id, row.orgId)).get();
  const orgName = org?.name || "Fieldline";
  if (row.enabled !== 1) return { state: "disabled", orgName };
  return {
    state: "open",
    orgName,
    token: row.token,
    intro: row.intro,
    thanks: row.thanks,
    fields: parseFieldFlags(row.fieldsJson),
    projectTypes: parseProjectTypes(row.projectTypesJson),
  };
}

function attemptCount(db: Database, orgId: string, sinceIso: string, ip?: string) {
  return db
    .select()
    .from(leadFormAttempts)
    .where(eq(leadFormAttempts.orgId, orgId))
    .all()
    .filter((row) => row.createdAt >= sinceIso && (!ip || row.ip === ip)).length;
}

function recordAttempt(db: Database, orgId: string, ip: string, atIso: string) {
  const cutoff = new Date(Date.parse(atIso) - ORG_WINDOW_MS).toISOString();
  const stale = db
    .select()
    .from(leadFormAttempts)
    .where(eq(leadFormAttempts.orgId, orgId))
    .all()
    .filter((row) => row.createdAt < cutoff);
  for (const row of stale) {
    db.delete(leadFormAttempts).where(and(eq(leadFormAttempts.id, row.id), eq(leadFormAttempts.orgId, orgId))).run();
  }
  db.insert(leadFormAttempts)
    .values({ id: id("att"), orgId, ip: ip.slice(0, 80) || "local", createdAt: atIso })
    .run();
}

function findContact(db: Database, orgId: string, email: string | null, phone: string | null) {
  const rows = db
    .select()
    .from(contacts)
    .where(and(eq(contacts.orgId, orgId), isNull(contacts.deletedAt)))
    .all();
  if (email) {
    const match = rows.find((row) => row.email?.trim().toLowerCase() === email);
    if (match) return match;
  }
  if (phone && phoneDigits(phone).length >= 10) {
    return rows.find((row) => phonesMatch(row.phone, phone));
  }
  return undefined;
}

function writePhoto(orgId: string, documentId: string, upload: { filename: string; bytes: Buffer }) {
  const error = photoUploadError(upload.filename, upload.bytes);
  if (error) throw new ServiceError(error);
  const type = rasterImageType(upload.bytes);
  if (!type) throw new ServiceError("Use a JPEG, PNG, or WebP photo.");
  const ext = photoExtension(type);
  const relative = path.join("uploads", orgId, `${documentId}.${ext}`);
  const absolute = path.join(dataDir(), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, upload.bytes);
  const stem = path.basename(upload.filename).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80);
  return { storagePath: relative, filename: `${stem || "photo"}.${ext}` };
}

function scopeFrom(answers: LeadFormAnswers) {
  return [
    answers.projectType,
    answers.address,
    answers.budget ? `Budget ${answers.budget}` : null,
    answers.timeline ? `Timeline ${answers.timeline}` : null,
    answers.description,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
}

export function submitLeadForm(input: SubmitInput): { leadId: string; contactId: string; deduped: boolean } | { dropped: "honeypot" } {
  const nowMs = input.now ?? Date.now();
  const atIso = new Date(nowMs).toISOString();
  const db = getDb();
  const form = db.select().from(leadForms).where(eq(leadForms.token, input.token)).get();
  if (!form || form.enabled !== 1) throw new ServiceError("Not taking requests.");
  const orgId = form.orgId;

  if (honeypotTripped(input.companyUrl)) {
    recordAttempt(db, orgId, input.ip, atIso);
    return { dropped: "honeypot" };
  }
  const fill = fillTimeError(Number(input.startedAt), nowMs);
  if (fill) {
    recordAttempt(db, orgId, input.ip, atIso);
    throw new ServiceError(fill);
  }
  const ip = input.ip.slice(0, 80) || "local";
  const limited = rateLimitError({
    ipCount: attemptCount(db, orgId, new Date(nowMs - IP_WINDOW_MS).toISOString(), ip),
    orgCount: attemptCount(db, orgId, new Date(nowMs - ORG_WINDOW_MS).toISOString()),
  });
  if (limited) throw new ServiceError(limited);
  recordAttempt(db, orgId, ip, atIso);

  const flags = parseFieldFlags(form.fieldsJson);
  const answers = validatePublicAnswers(input, flags, parseProjectTypes(form.projectTypesJson));
  const photos = flags.photos ? (input.photos ?? []).filter((photo) => photo.bytes.length > 0) : [];
  if (photos.length > MAX_PHOTOS) throw new ServiceError("Three photos at most.");
  for (const photo of photos) {
    const error = photoUploadError(photo.filename, photo.bytes);
    if (error) throw new ServiceError(error);
  }

  const intake = answers.description ? extractIntake(answers.description) : null;
  const projectType = answers.projectType || (intake && intake.projectType !== "Remodel" ? intake.projectType : "");
  let value = intake ? (intake.valueHighCents ?? intake.valueLowCents) : null;
  if (value != null && (!Number.isInteger(value) || value < 0 || value > MAX_MONEY_CENTS)) value = null;
  const sqft = intake?.sqft && intake.sqft > 0 && intake.sqft < 1_000_000 ? intake.sqft : null;
  const title = `${answers.name}${projectType ? ` ${projectType}` : ""}`.slice(0, 120);
  const attribution = attributionLabel({
    source: input.source,
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
    utmCampaign: input.utmCampaign,
    referrer: externalReferrer(input.referrer),
  });

  const stage = db
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.orgId, orgId), eq(pipelineStages.kind, "open")))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
  if (!stage) throw new ServiceError("Not taking requests.");

  const leadId = id("lead");
  const existing = findContact(db, orgId, answers.email, answers.phone);
  const contactId = existing?.id ?? id("c");
  const deduped = Boolean(existing);

  db.transaction((tx) => {
    if (existing) {
      tx.update(contacts)
        .set({
          email: existing.email || answers.email,
          phone: existing.phone || answers.phone,
          address: existing.address || answers.address,
          updatedAt: atIso,
        })
        .where(and(eq(contacts.id, existing.id), eq(contacts.orgId, orgId)))
        .run();
      tx.insert(activities)
        .values({
          id: id("act"),
          orgId,
          entityType: "contact",
          entityId: existing.id,
          type: "note",
          actorType: "system",
          actorId: null,
          summary: "Website form matched this contact.",
          payloadJson: null,
          createdAt: atIso,
        })
        .run();
    } else {
      tx.insert(contacts)
        .values({
          id: contactId,
          orgId,
          type: "client",
          name: answers.name,
          company: null,
          email: answers.email,
          phone: answers.phone,
          address: answers.address,
          city: null,
          state: null,
          zip: null,
          notes: null,
          deletedAt: null,
          createdAt: atIso,
          updatedAt: atIso,
          createdBy: null,
        })
        .run();
    }
    tx.insert(leads)
      .values({
        id: leadId,
        orgId,
        contactId,
        stageId: stage.id,
        title,
        source: WEBSITE_FORM_SOURCE,
        valueEstCents: value,
        ownerUserId: null,
        status: "open",
        lostReason: null,
        scopeText: scopeFrom(answers),
        sqft,
        deletedAt: null,
        createdAt: atIso,
        updatedAt: atIso,
        createdBy: null,
      })
      .run();
    for (const photo of photos) {
      const documentId = id("doc");
      const stored = writePhoto(orgId, documentId, photo);
      tx.insert(documents)
        .values({
          id: documentId,
          orgId,
          projectId: null,
          leadId,
          contactId,
          type: "photo",
          filename: stored.filename,
          storagePath: stored.storagePath,
          metadataJson: JSON.stringify({ caption: "Website form" }),
          deletedAt: null,
          createdAt: atIso,
          createdBy: null,
        })
        .run();
    }
    tx.insert(leadFormSubmissions)
      .values({
        id: id("sub"),
        orgId,
        formId: form.id,
        leadId,
        contactId,
        answersJson: JSON.stringify(answers),
        attribution,
        seenAt: null,
        createdAt: atIso,
      })
      .run();
    tx.insert(activities)
      .values({
        id: id("act"),
        orgId,
        entityType: "lead",
        entityId: leadId,
        type: "intake",
        actorType: "system",
        actorId: null,
        summary: `Website form from ${answers.name}.`,
        payloadJson: null,
        createdAt: atIso,
      })
      .run();
    tx.insert(auditLogs)
      .values({
        id: id("audit"),
        orgId,
        actorId: null,
        action: "lead_form.submit",
        entityType: "lead",
        entityId: leadId,
        payloadJson: JSON.stringify({ attribution, deduped, contactId }),
        ip,
        createdAt: atIso,
      })
      .run();
    if (intake) {
      tx.insert(aiRuns)
        .values({
          id: id("airun"),
          orgId,
          feature: "intake",
          model: "fieldline-intake-v1",
          tokensIn: Math.ceil((answers.description ?? "").length / 4),
          tokensOut: 40,
          costCents: 0,
          inputRef: leadId,
          outputJson: JSON.stringify({
            projectType: intake.projectType,
            sqft: intake.sqft,
            valueHighCents: intake.valueHighCents,
          }),
          latencyMs: 1,
          createdAt: atIso,
          createdBy: null,
        })
        .run();
    }
  });

  return { leadId, contactId, deduped };
}

export function unseenWebLeadCount(orgId: string): number {
  const db = officeDb(orgId);
  if (!db) return 0;
  return db
    .select()
    .from(leadFormSubmissions)
    .where(and(eq(leadFormSubmissions.orgId, orgId), isNull(leadFormSubmissions.seenAt)))
    .all().length;
}

export function markWebLeadOpened(orgId: string, leadId: string) {
  const db = officeDb(orgId);
  if (!db) return;
  db.update(leadFormSubmissions)
    .set({ seenAt: nowIso() })
    .where(and(eq(leadFormSubmissions.orgId, orgId), eq(leadFormSubmissions.leadId, leadId), isNull(leadFormSubmissions.seenAt)))
    .run();
}

export function webLeadSubmission(orgId: string, leadId: string): WebLeadView | null {
  const db = officeDb(orgId);
  if (!db) return null;
  const row = db
    .select()
    .from(leadFormSubmissions)
    .where(and(eq(leadFormSubmissions.orgId, orgId), eq(leadFormSubmissions.leadId, leadId)))
    .get();
  if (!row) return null;
  try {
    const answers = JSON.parse(row.answersJson) as LeadFormAnswers;
    return { answers, attribution: row.attribution };
  } catch {
    return null;
  }
}
