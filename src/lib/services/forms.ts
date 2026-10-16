import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb } from "@/lib/db/client";
import {
  auditLogs,
  contacts,
  documents,
  formAttempts,
  formSubmissions as submissionTable,
  formTemplates,
  memberships,
  notifications,
  organizations,
  projects,
} from "@/lib/db/schema";
import {
  checkAnswers,
  linkAudience,
  normalizeTemplate,
  parseAudiences,
  parseFields,
  type Audience,
  type FormField,
  type StoredAnswer,
} from "@/lib/forms/template";
import { id, nowIso, token } from "@/lib/ids";
import { fillTimeError, honeypotTripped, IP_WINDOW_MS, ORG_WINDOW_MS, rateLimitError } from "@/lib/lead-form/rules";
import { canEditCrm, canManageSettings, type Role } from "@/lib/permissions";
import { appOrigin, attachmentExtension, attachmentUploadError, photoExtension, photoUploadError, rasterImageType } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";

type Database = ReturnType<typeof getDb>;
type Writer = Database;

export type TemplateView = {
  id: string;
  title: string;
  description: string;
  audiences: Audience[];
  fields: FormField[];
  status: "active" | "archived";
  token: string;
  link: string;
  sentAt: string | null;
  sentBy: string | null;
  canEdit: boolean;
  canCreate: boolean;
  canLink: boolean;
};

export type SubmissionListRow = {
  id: string;
  templateId: string;
  templateTitle: string;
  status: "new" | "reviewed";
  channel: string;
  projectName: string | null;
  contactName: string | null;
  createdAt: string;
};

export type AnswerView = {
  fieldId: string;
  label: string;
  type: string;
  text: string | null;
  documentId: string | null;
  filename: string | null;
  image: boolean;
};

export type SubmissionView = SubmissionListRow & {
  projectId: string | null;
  contactId: string | null;
  answers: AnswerView[];
  canReview: boolean;
};

export type PublicForm =
  | { state: "missing" }
  | { state: "closed"; title: string; orgName: string }
  | { state: "signin"; title: string; orgName: string }
  | { state: "denied"; title: string; orgName: string }
  | { state: "open"; title: string; description: string; orgName: string; token: string; fields: FormField[]; signed: boolean; templateId: string };

type Upload = { filename: string; bytes: Buffer };

const OFFICE = new Set(["owner", "admin", "estimator"]);

function roleOf(actor: Actor): Role {
  return actor.role as Role;
}

function audienceFor(role: Role): Audience | null {
  if (role === "field") return "field";
  if (OFFICE.has(role)) return "office";
  return null;
}

function audit(db: Writer, orgId: string, actorId: string | null, action: string, entityType: string, entityId: string, payload: unknown) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType,
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function fillLink(formToken: string): string {
  const origin = appOrigin(process.env);
  const href = `/forms/fill/${formToken}`;
  return origin ? `${origin}${href}` : href;
}

function mapTemplate(row: typeof formTemplates.$inferSelect, actor: Actor): TemplateView {
  const role = roleOf(actor);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    audiences: parseAudiences(row.audiencesJson),
    fields: parseFields(row.fieldsJson),
    status: row.status === "archived" ? "archived" : "active",
    token: row.token,
    link: fillLink(row.token),
    sentAt: row.sentAt,
    sentBy: row.sentBy,
    canEdit: canManageSettings(role),
    canCreate: canEditCrm(role),
    canLink: canEditCrm(role),
  };
}

function assertCreate(actor: Actor) {
  if (!canEditCrm(roleOf(actor))) throw new ServiceError("Your role cannot create a form.");
}

function assertEdit(actor: Actor) {
  if (!canManageSettings(roleOf(actor))) throw new ServiceError("Only an owner or admin can change a form.");
}

function assertReview(actor: Actor) {
  if (!canEditCrm(roleOf(actor))) throw new ServiceError("Your role cannot review this.");
}

export function formTemplateList(actor: Actor): TemplateView[] {
  if (roleOf(actor) === "field") throw new ServiceError("Your role cannot change a form.");
  const db = getDb();
  return db
    .select()
    .from(formTemplates)
    .where(eq(formTemplates.orgId, actor.orgId))
    .all()
    .map((row) => mapTemplate(row, actor))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function formTemplate(actor: Actor, templateId: string): TemplateView | null {
  if (roleOf(actor) === "field") throw new ServiceError("Your role cannot change a form.");
  const row = getDb().select().from(formTemplates).where(and(eq(formTemplates.id, templateId), eq(formTemplates.orgId, actor.orgId))).get();
  return row ? mapTemplate(row, actor) : null;
}

export function createFormTemplate(
  actor: Actor,
  input: { title: string; description: string; audiences: string[]; fields: { id?: string; label: string; type: string; required: boolean; options?: string[] }[] },
): TemplateView {
  assertCreate(actor);
  const spec = normalizeTemplate(input);
  const db = getDb();
  const now = nowIso();
  const templateId = id("form");
  db.insert(formTemplates)
    .values({
      id: templateId,
      orgId: actor.orgId,
      title: spec.title,
      description: spec.description,
      audiencesJson: JSON.stringify(spec.audiences),
      fieldsJson: JSON.stringify(spec.fields),
      status: "active",
      token: token(),
      sentAt: null,
      sentBy: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  audit(db, actor.orgId, actor.userId, "form.create", "form_template", templateId, { title: spec.title });
  const created = formTemplate(actor, templateId);
  if (!created) throw new ServiceError("Check the form.");
  return created;
}

export function updateFormTemplate(
  actor: Actor,
  templateId: string,
  input: { title: string; description: string; audiences: string[]; fields: { id?: string; label: string; type: string; required: boolean; options?: string[] }[] },
): void {
  assertEdit(actor);
  const db = getDb();
  const row = db.select().from(formTemplates).where(and(eq(formTemplates.id, templateId), eq(formTemplates.orgId, actor.orgId))).get();
  if (!row) throw new ServiceError("That form is not in your company.");
  const spec = normalizeTemplate(input, parseFields(row.fieldsJson).map((field) => field.id));
  db.update(formTemplates)
    .set({
      title: spec.title,
      description: spec.description,
      audiencesJson: JSON.stringify(spec.audiences),
      fieldsJson: JSON.stringify(spec.fields),
      updatedAt: nowIso(),
    })
    .where(and(eq(formTemplates.id, row.id), eq(formTemplates.orgId, actor.orgId)))
    .run();
  audit(db, actor.orgId, actor.userId, "form.update", "form_template", row.id, { title: spec.title, status: row.status });
}

export function archiveFormTemplate(actor: Actor, templateId: string): void {
  assertEdit(actor);
  const db = getDb();
  const row = db.select().from(formTemplates).where(and(eq(formTemplates.id, templateId), eq(formTemplates.orgId, actor.orgId))).get();
  if (!row) throw new ServiceError("That form is not in your company.");
  if (row.status === "archived") return;
  db.update(formTemplates)
    .set({ status: "archived", updatedAt: nowIso() })
    .where(and(eq(formTemplates.id, row.id), eq(formTemplates.orgId, actor.orgId)))
    .run();
  audit(db, actor.orgId, actor.userId, "form.update", "form_template", row.id, { title: row.title, status: "archived" });
}

export function markFormLinkSent(actor: Actor, templateId: string): void {
  if (!canEditCrm(roleOf(actor))) throw new ServiceError("Your role cannot change this.");
  const db = getDb();
  const row = db.select().from(formTemplates).where(and(eq(formTemplates.id, templateId), eq(formTemplates.orgId, actor.orgId))).get();
  if (!row || row.status !== "active") throw new ServiceError("That form is not in your company.");
  const sentAt = nowIso();
  db.update(formTemplates)
    .set({ sentAt, sentBy: actor.userId, updatedAt: sentAt })
    .where(and(eq(formTemplates.id, row.id), eq(formTemplates.orgId, actor.orgId)))
    .run();
  audit(db, actor.orgId, actor.userId, "form.link", "form_template", row.id, { sentAt });
}

function attemptCount(db: Database, orgId: string, sinceIso: string, ip?: string) {
  return db
    .select()
    .from(formAttempts)
    .where(eq(formAttempts.orgId, orgId))
    .all()
    .filter((row) => row.createdAt >= sinceIso && (!ip || row.ip === ip)).length;
}

function recordAttempt(db: Database, orgId: string, templateId: string, ip: string, atIso: string) {
  const cutoff = new Date(Date.parse(atIso) - ORG_WINDOW_MS).toISOString();
  const stale = db
    .select()
    .from(formAttempts)
    .where(eq(formAttempts.orgId, orgId))
    .all()
    .filter((row) => row.createdAt < cutoff);
  for (const row of stale) {
    db.delete(formAttempts).where(and(eq(formAttempts.id, row.id), eq(formAttempts.orgId, orgId))).run();
  }
  db.insert(formAttempts)
    .values({ id: id("fatt"), orgId, templateId, ip: ip.slice(0, 80) || "local", createdAt: atIso })
    .run();
}

function storeUpload(orgId: string, actorId: string | null, upload: Upload, kind: "photo" | "file" | "signature"): string {
  const error = kind === "file" ? attachmentUploadError(upload.filename, upload.bytes) : photoUploadError(upload.filename, upload.bytes);
  if (error) throw new ServiceError(error);
  const documentId = id("doc");
  const ext = kind === "file" ? attachmentExtension(upload.bytes) : photoExtension(rasterImageType(upload.bytes) || "image/png");
  const relative = path.join("uploads", orgId, `${documentId}.${ext}`);
  const absolute = path.join(dataDir(), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, upload.bytes);
  const stem = path.basename(upload.filename).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80);
  getDb()
    .insert(documents)
    .values({
      id: documentId,
      orgId,
      projectId: null,
      leadId: null,
      contactId: null,
      type: "form",
      filename: `${stem || (kind === "signature" ? "signature" : "file")}.${ext}`,
      storagePath: relative,
      metadataJson: null,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy: actorId,
    })
    .run();
  return documentId;
}

function signatureBytes(value: string | null | undefined): Buffer | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value ?? "");
  if (!match) return null;
  const bytes = Buffer.from(match[1], "base64");
  return bytes.length > 0 ? bytes : null;
}

function notifyOffice(db: Database, orgId: string, submissionId: string, title: string, actorId: string | null, actorName: string) {
  const members = db.select().from(memberships).where(eq(memberships.orgId, orgId)).all();
  const at = nowIso();
  for (const member of members) {
    if (!OFFICE.has(member.role) || member.userId === actorId) continue;
    db.insert(notifications)
      .values({
        id: id("note"),
        orgId,
        userId: member.userId,
        kind: "form",
        commentId: null,
        entityType: "form_submission",
        entityId: submissionId,
        projectId: null,
        actorId,
        actorName,
        snippet: title.slice(0, 140),
        readAt: null,
        createdAt: at,
      })
      .run();
  }
}

function writeSubmission(input: {
  orgId: string;
  templateId: string;
  title: string;
  fields: FormField[];
  channel: string;
  submitterId: string | null;
  actorName: string;
  texts: Record<string, string | null>;
  files: Record<string, Upload>;
}): string {
  const prepared: Record<string, { text?: string | null; hasFile?: boolean }> = {};
  const uploads: Record<string, Upload> = { ...input.files };
  for (const field of input.fields) {
    if (field.type === "signature") {
      const bytes = signatureBytes(input.texts[field.id]);
      if (bytes) uploads[field.id] = { filename: "signature.png", bytes };
      prepared[field.id] = { hasFile: Boolean(uploads[field.id]) };
      continue;
    }
    if (field.type === "photo" || field.type === "file") {
      prepared[field.id] = { hasFile: Boolean(uploads[field.id]) };
      continue;
    }
    prepared[field.id] = { text: input.texts[field.id] };
  }
  const checked = checkAnswers(input.fields, prepared);
  const answers: StoredAnswer[] = checked.map((answer) => {
    const field = input.fields.find((item) => item.id === answer.fieldId);
    const upload = uploads[answer.fieldId];
    const documentId = answer.needsFile && upload && field ? storeUpload(input.orgId, input.submitterId, upload, field.type === "file" ? "file" : field.type === "signature" ? "signature" : "photo") : null;
    return { fieldId: answer.fieldId, text: answer.text, documentId };
  });
  const db = getDb();
  const submissionId = id("fsub");
  db.insert(submissionTable)
    .values({
      id: submissionId,
      orgId: input.orgId,
      templateId: input.templateId,
      status: "new",
      projectId: null,
      contactId: null,
      submitterId: input.submitterId,
      channel: input.channel,
      answersJson: JSON.stringify(answers),
      reviewedAt: null,
      reviewedBy: null,
      createdAt: nowIso(),
    })
    .run();
  audit(db, input.orgId, input.submitterId, "form.submit", "form_submission", submissionId, { templateId: input.templateId, channel: input.channel });
  notifyOffice(db, input.orgId, submissionId, input.title, input.submitterId, input.actorName);
  return submissionId;
}

export function publicForm(formToken: string, actor: Actor | null): PublicForm {
  const db = getDb();
  const row = db.select().from(formTemplates).where(eq(formTemplates.token, formToken)).get();
  if (!row) return { state: "missing" };
  const org = db.select().from(organizations).where(eq(organizations.id, row.orgId)).get();
  const orgName = org?.name || "Fieldline";
  const title = row.title;
  if (row.status !== "active") return { state: "closed", title, orgName };
  const audiences = parseAudiences(row.audiencesJson);
  const fields = parseFields(row.fieldsJson);
  const signedAudience = actor && actor.orgId === row.orgId ? audienceFor(roleOf(actor)) : null;
  if (signedAudience && audiences.includes(signedAudience)) {
    return { state: "open", title, description: row.description, orgName, token: row.token, fields, signed: true, templateId: row.id };
  }
  if (linkAudience(audiences) && !actor) {
    return { state: "open", title, description: row.description, orgName, token: row.token, fields, signed: false, templateId: row.id };
  }
  if (linkAudience(audiences) && actor) return { state: "denied", title, orgName };
  if (!actor) return { state: "signin", title, orgName };
  return { state: "denied", title, orgName };
}

export function submitPublicForm(input: {
  token: string;
  ip: string;
  now?: number;
  startedAt?: string | null;
  companyUrl?: string | null;
  texts: Record<string, string | null>;
  files: Record<string, Upload>;
}): { id: string } | { dropped: "honeypot" } {
  const nowMs = input.now ?? Date.now();
  const atIso = new Date(nowMs).toISOString();
  const db = getDb();
  const row = db.select().from(formTemplates).where(eq(formTemplates.token, input.token)).get();
  if (!row || row.status !== "active") throw new ServiceError("This form is closed.");
  const audiences = parseAudiences(row.audiencesJson);
  if (!linkAudience(audiences)) throw new ServiceError("Sign in to fill this.");
  const orgId = row.orgId;
  if (honeypotTripped(input.companyUrl)) {
    recordAttempt(db, orgId, row.id, input.ip, atIso);
    return { dropped: "honeypot" };
  }
  const fill = fillTimeError(Number(input.startedAt), nowMs);
  if (fill) {
    recordAttempt(db, orgId, row.id, input.ip, atIso);
    throw new ServiceError(fill);
  }
  const ip = input.ip.slice(0, 80) || "local";
  const limited = rateLimitError({
    ipCount: attemptCount(db, orgId, new Date(nowMs - IP_WINDOW_MS).toISOString(), ip),
    orgCount: attemptCount(db, orgId, new Date(nowMs - ORG_WINDOW_MS).toISOString()),
  });
  if (limited) throw new ServiceError(limited);
  recordAttempt(db, orgId, row.id, ip, atIso);
  const submissionId = writeSubmission({
    orgId,
    templateId: row.id,
    title: row.title,
    fields: parseFields(row.fieldsJson),
    channel: "link",
    submitterId: null,
    actorName: "Fieldline",
    texts: input.texts,
    files: input.files,
  });
  return { id: submissionId };
}

export function submitSignedForm(
  actor: Actor,
  templateId: string,
  input: { texts: Record<string, string | null>; files: Record<string, Upload> },
): string {
  const audience = audienceFor(roleOf(actor));
  if (!audience) throw new ServiceError("Your role cannot fill this.");
  const db = getDb();
  const row = db.select().from(formTemplates).where(and(eq(formTemplates.id, templateId), eq(formTemplates.orgId, actor.orgId))).get();
  if (!row || row.status !== "active") throw new ServiceError("This form is closed.");
  const audiences = parseAudiences(row.audiencesJson);
  if (!audiences.includes(audience)) throw new ServiceError("Your role cannot fill this.");
  return writeSubmission({
    orgId: actor.orgId,
    templateId: row.id,
    title: row.title,
    fields: parseFields(row.fieldsJson),
    channel: audience,
    submitterId: actor.userId,
    actorName: actor.name,
    texts: input.texts,
    files: input.files,
  });
}

function namesOf(db: Database, orgId: string) {
  return {
    jobs: new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row.name])),
    people: new Map(db.select().from(contacts).where(and(eq(contacts.orgId, orgId))).all().filter((row) => !row.deletedAt).map((row) => [row.id, row.name])),
  };
}

function visibleRows(actor: Actor) {
  const db = getDb();
  const templates = new Map(db.select().from(formTemplates).where(eq(formTemplates.orgId, actor.orgId)).all().map((row) => [row.id, row]));
  const names = namesOf(db, actor.orgId);
  const rows = db
    .select()
    .from(submissionTable)
    .where(eq(submissionTable.orgId, actor.orgId))
    .all()
    .filter((row) => roleOf(actor) !== "field" || row.submitterId === actor.userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { rows, templates, names };
}

export function formSubmissions(actor: Actor, filter: { templateId?: string; status?: string } = {}): SubmissionListRow[] {
  const { rows, templates, names } = visibleRows(actor);
  const templateId = filter.templateId?.trim() || "";
  const status = filter.status?.trim() || "";
  return rows
    .filter((row) => (!templateId || row.templateId === templateId) && (!status || row.status === status))
    .map((row) => ({
      id: row.id,
      templateId: row.templateId,
      templateTitle: templates.get(row.templateId)?.title ?? "Form",
      status: row.status === "reviewed" ? "reviewed" : "new",
      channel: row.channel,
      projectName: row.projectId ? names.jobs.get(row.projectId) ?? null : null,
      contactName: row.contactId ? names.people.get(row.contactId) ?? null : null,
      createdAt: row.createdAt,
    }));
}

function parseAnswers(raw: string): StoredAnswer[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as { fieldId?: unknown; text?: unknown; documentId?: unknown };
      if (typeof row.fieldId !== "string") return [];
      return [{ fieldId: row.fieldId, text: typeof row.text === "string" ? row.text : null, documentId: typeof row.documentId === "string" ? row.documentId : null }];
    });
  } catch {
    return [];
  }
}

export function formSubmission(actor: Actor, submissionId: string): SubmissionView | null {
  const db = getDb();
  const row = db.select().from(submissionTable).where(and(eq(submissionTable.id, submissionId), eq(submissionTable.orgId, actor.orgId))).get();
  if (!row) return null;
  if (roleOf(actor) === "field" && row.submitterId !== actor.userId) return null;
  const template = db.select().from(formTemplates).where(and(eq(formTemplates.id, row.templateId), eq(formTemplates.orgId, actor.orgId))).get();
  const fields = template ? parseFields(template.fieldsJson) : [];
  const names = namesOf(db, actor.orgId);
  const docs = new Map(db.select().from(documents).where(eq(documents.orgId, actor.orgId)).all().map((item) => [item.id, item]));
  const answers = parseAnswers(row.answersJson).map((answer) => {
    const field = fields.find((item) => item.id === answer.fieldId);
    const doc = answer.documentId ? docs.get(answer.documentId) : undefined;
    const filename = doc?.filename ?? null;
    const image = Boolean(filename && /\.(png|jpe?g|webp)$/i.test(filename));
    return {
      fieldId: answer.fieldId,
      label: field?.label ?? answer.fieldId,
      type: field?.type ?? "text",
      text: answer.text,
      documentId: answer.documentId,
      filename,
      image,
    };
  });
  return {
    id: row.id,
    templateId: row.templateId,
    templateTitle: template?.title ?? "Form",
    status: row.status === "reviewed" ? "reviewed" : "new",
    channel: row.channel,
    projectId: row.projectId,
    contactId: row.contactId,
    projectName: row.projectId ? names.jobs.get(row.projectId) ?? null : null,
    contactName: row.contactId ? names.people.get(row.contactId) ?? null : null,
    createdAt: row.createdAt,
    answers,
    canReview: canEditCrm(roleOf(actor)),
  };
}

export function reviewForm(actor: Actor, submissionId: string): void {
  assertReview(actor);
  const db = getDb();
  const row = db.select().from(submissionTable).where(and(eq(submissionTable.id, submissionId), eq(submissionTable.orgId, actor.orgId))).get();
  if (!row) throw new ServiceError("That form is not in your company.");
  if (row.status === "reviewed") return;
  const at = nowIso();
  db.update(submissionTable)
    .set({ status: "reviewed", reviewedAt: at, reviewedBy: actor.userId })
    .where(and(eq(submissionTable.id, row.id), eq(submissionTable.orgId, actor.orgId)))
    .run();
  audit(db, actor.orgId, actor.userId, "form.review", "form_submission", row.id, { status: "reviewed" });
}

export function attachForm(actor: Actor, submissionId: string, projectId: string, contactId: string): void {
  assertReview(actor);
  const db = getDb();
  const row = db.select().from(submissionTable).where(and(eq(submissionTable.id, submissionId), eq(submissionTable.orgId, actor.orgId))).get();
  if (!row) throw new ServiceError("That form is not in your company.");
  const job = projectId ? db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get() : null;
  const person = contactId ? db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.orgId, actor.orgId))).get() : null;
  if (projectId && !job) throw new ServiceError("That job is not in your company.");
  if (contactId && (!person || person.deletedAt)) throw new ServiceError("That contact is not in your company.");
  db.update(submissionTable)
    .set({ projectId: job?.id ?? null, contactId: person?.id ?? null })
    .where(and(eq(submissionTable.id, row.id), eq(submissionTable.orgId, actor.orgId)))
    .run();
  audit(db, actor.orgId, actor.userId, "form.update", "form_submission", row.id, { projectId: job?.id ?? null, contactId: person?.id ?? null });
}

export function fillableTemplates(actor: Actor): { id: string; title: string }[] {
  const audience = audienceFor(roleOf(actor));
  if (!audience) return [];
  return getDb()
    .select()
    .from(formTemplates)
    .where(and(eq(formTemplates.orgId, actor.orgId), eq(formTemplates.status, "active")))
    .all()
    .filter((row) => parseAudiences(row.audiencesJson).includes(audience))
    .map((row) => ({ id: row.id, title: row.title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function signedForm(actor: Actor, templateId: string): { title: string; description: string; fields: FormField[] } | null {
  const audience = audienceFor(roleOf(actor));
  if (!audience) return null;
  const row = getDb().select().from(formTemplates).where(and(eq(formTemplates.id, templateId), eq(formTemplates.orgId, actor.orgId), eq(formTemplates.status, "active"))).get();
  if (!row || !parseAudiences(row.audiencesJson).includes(audience)) return null;
  return { title: row.title, description: row.description, fields: parseFields(row.fieldsJson) };
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function formCsv(actor: Actor, filter: { templateId?: string; status?: string } = {}): string {
  const rows = formSubmissions(actor, filter);
  const db = getDb();
  const full = rows.map((row) => formSubmission(actor, row.id)).filter((row): row is SubmissionView => Boolean(row));
  const oneTemplate = filter.templateId?.trim() ? db.select().from(formTemplates).where(and(eq(formTemplates.id, filter.templateId.trim()), eq(formTemplates.orgId, actor.orgId))).get() : undefined;
  const fields = oneTemplate ? parseFields(oneTemplate.fieldsJson) : [];
  const header = ["Template", "Status", "Submitted", "Channel", "Job", "Contact", ...(fields.length ? fields.map((field) => field.label) : ["Answers"])];
  const lines = full.map((row) => {
    const base = [row.templateTitle, row.status, row.createdAt.slice(0, 10), row.channel, row.projectName ?? "", row.contactName ?? ""];
    if (fields.length) {
      return [
        ...base,
        ...fields.map((field) => {
          const answer = row.answers.find((item) => item.fieldId === field.id);
          return answer?.filename || answer?.text || "";
        }),
      ];
    }
    return [...base, row.answers.map((answer) => `${answer.label}: ${answer.filename || answer.text || ""}`).join("; ")];
  });
  return [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n");
}

export function formAttention(actor: Actor): { count: number; href: string | null } {
  const count = formSubmissions(actor, { status: "new" }).length;
  return { count, href: count > 0 ? "/forms" : null };
}

export function attachChoices(actor: Actor): { jobs: { id: string; name: string }[]; contacts: { id: string; name: string }[] } {
  const db = getDb();
  return {
    jobs: db
      .select()
      .from(projects)
      .where(eq(projects.orgId, actor.orgId))
      .all()
      .map((row) => ({ id: row.id, name: row.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    contacts: db
      .select()
      .from(contacts)
      .where(eq(contacts.orgId, actor.orgId))
      .all()
      .filter((row) => !row.deletedAt)
      .map((row) => ({ id: row.id, name: row.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function formNotice(actor: Actor, submissionId: string): { record: string; href: string } | null {
  const row = formSubmission(actor, submissionId);
  if (!row) return null;
  return { record: row.templateTitle, href: `/forms/${row.id}` };
}
