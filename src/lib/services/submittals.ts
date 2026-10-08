import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  bidInvites,
  bidRequests,
  contacts,
  documents,
  memberships,
  organizations,
  projects,
  punchItems,
  purchaseOrders,
  scheduleItems,
  selections,
  submittalAttempts,
  submittalFiles,
  submittalRevisions,
  submittals,
  users,
  vendorPortals,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { IP_WINDOW_MS, ORG_WINDOW_MS, rateLimitError } from "@/lib/lead-form/rules";
import { canAddFieldNotes, canEditCrm, type Role } from "@/lib/permissions";
import { attachmentExtension, attachmentUploadError } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import {
  awaitingReview,
  canMoveSubmittal,
  isOverdueSubmittal,
  nextSubmittalNumber,
  pendingSubmittal,
  SUBMITTAL_STATUS_LABEL,
  submittalAge,
  submittalLabel,
} from "@/lib/submittals/format";
import { localDay } from "@/lib/time/calendar";
import { hashVendorToken, vendorTokenMatches } from "@/lib/vendor/token";

const RELATED = ["schedule", "selection", "purchase_order", "bid"] as const;
const VENDOR_TYPES = new Set(["sub", "vendor"]);
const DECISIONS = ["approved", "noted", "revise", "rejected"] as const;

export type SubmittalUpload = { filename: string; bytes: Buffer };
export type SubmittalFileView = { id: string; filename: string };
export type RevisionView = {
  id: string;
  revision: number;
  note: string;
  reviewNote: string | null;
  authorName: string;
  reviewerName: string | null;
  createdAt: string;
  reviewedAt: string | null;
  files: SubmittalFileView[];
};

export type SubmittalListItem = {
  id: string;
  number: number;
  label: string;
  title: string;
  division: string;
  assigneeName: string;
  assigneeKind: string;
  assigneeValue: string;
  dueOn: string | null;
  ageDays: number;
  status: string;
  statusLabel: string;
  pending: boolean;
  overdue: boolean;
  revision: number;
  projectId: string;
  projectName: string;
  href: string;
};

export type JobSubmittalBoard = {
  projectId: string;
  projectName: string;
  canAdd: boolean;
  canReview: boolean;
  items: SubmittalListItem[];
  assignees: { value: string; label: string }[];
  related: { value: string; label: string }[];
};

export type SubmittalDetail = SubmittalListItem & {
  specNote: string;
  internalNote: string | null;
  relatedLabel: string | null;
  canSubmit: boolean;
  canReview: boolean;
  canVoid: boolean;
  decisions: { value: string; label: string }[];
  revisions: RevisionView[];
};

export type PortalSubmittal = {
  id: string;
  label: string;
  title: string;
  spec: string;
  division: string;
  job: string;
  dueOn: string | null;
  status: string;
  statusLabel: string;
  revision: number;
  canSubmit: boolean;
  canReview: boolean;
  revisions: RevisionView[];
};

type Row = typeof submittals.$inferSelect;

function dbFor(actor: Actor): AppDatabase {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("That job is not in your company.");
  return db;
}

function roleOf(actor: Actor): Role {
  return actor.role as Role;
}

function cleanText(value: string | null | undefined, max: number, label: string, required: boolean): string {
  const text = (value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  if (required && !text) throw new ServiceError(`Add a ${label}.`);
  if (text.length > max) throw new ServiceError(`${label} is too long.`);
  return text;
}

function cleanDate(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ServiceError("Use a date.");
  return text;
}

function writeAudit(tx: AppDatabase, orgId: string, actorId: string | null, action: string, entityId: string, payload: Record<string, unknown> | null, ip?: string) {
  tx.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "submittal",
      entityId,
      payloadJson: payload ? JSON.stringify(payload) : null,
      ip: ip ?? null,
      createdAt: nowIso(),
    })
    .run();
}

function orgRow(db: AppDatabase, orgId: string) {
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) throw new ServiceError("Company not found.");
  return org;
}

function todayFor(db: AppDatabase, orgId: string) {
  return localDay(Date.now(), orgRow(db, orgId).timeZone);
}

function projectIn(db: AppDatabase, orgId: string, projectId: string) {
  return db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
}

function memberName(db: AppDatabase, orgId: string, userId: string): string | null {
  const row = db
    .select({ name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .get();
  return row?.name ?? null;
}

function loadContact(db: AppDatabase, orgId: string, contactId: string) {
  const row = db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId))).get();
  if (!row || row.deletedAt) return null;
  return row;
}

function vendorsOnJob(db: AppDatabase, orgId: string, projectId: string): Map<string, string> {
  const ids = new Set<string>();
  for (const row of db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.projectId, projectId))).all()) {
    if (row.vendorContactId) ids.add(row.vendorContactId);
  }
  for (const row of db.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.projectId, projectId))).all()) {
    ids.add(row.vendorContactId);
  }
  for (const row of db.select().from(punchItems).where(and(eq(punchItems.orgId, orgId), eq(punchItems.projectId, projectId))).all()) {
    if (row.assigneeContactId) ids.add(row.assigneeContactId);
  }
  const bids = db.select().from(bidRequests).where(and(eq(bidRequests.orgId, orgId), eq(bidRequests.projectId, projectId))).all();
  const bidIds = new Set(bids.map((row) => row.id));
  for (const row of db.select().from(bidInvites).where(eq(bidInvites.orgId, orgId)).all()) {
    if (bidIds.has(row.bidId)) ids.add(row.contactId);
  }
  const names = new Map<string, string>();
  for (const contactId of ids) {
    const contact = loadContact(db, orgId, contactId);
    if (!contact || !VENDOR_TYPES.has(contact.type)) continue;
    names.set(contact.id, contact.company?.trim() || contact.name);
  }
  return names;
}

function relatedLabel(db: AppDatabase, orgId: string, projectId: string, type: string | null, relatedId: string | null): string | null {
  if (!type || !relatedId) return null;
  if (type === "schedule") return db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.id, relatedId), eq(scheduleItems.projectId, projectId))).get()?.title ?? null;
  if (type === "selection") return db.select().from(selections).where(and(eq(selections.orgId, orgId), eq(selections.id, relatedId), eq(selections.projectId, projectId))).get()?.title ?? null;
  if (type === "purchase_order") return db.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.id, relatedId), eq(purchaseOrders.projectId, projectId))).get()?.number ?? null;
  if (type === "bid") return db.select().from(bidRequests).where(and(eq(bidRequests.orgId, orgId), eq(bidRequests.id, relatedId), eq(bidRequests.projectId, projectId))).get()?.title ?? null;
  return null;
}

function assertRelated(db: AppDatabase, orgId: string, projectId: string, value: string | null) {
  const text = (value ?? "").trim();
  if (!text) return { type: null as string | null, id: null as string | null };
  const split = text.indexOf(":");
  if (split < 1) throw new ServiceError("Pick a related item.");
  const type = text.slice(0, split);
  const relatedId = text.slice(split + 1);
  if (!(RELATED as readonly string[]).includes(type) || !relatedLabel(db, orgId, projectId, type, relatedId)) throw new ServiceError("That item is not on this job.");
  return { type, id: relatedId };
}

function parseAssignee(db: AppDatabase, orgId: string, projectId: string, value: string) {
  const project = projectIn(db, orgId, projectId);
  if (!project) throw new ServiceError("Job not found.");
  if (value === "client") {
    const contact = loadContact(db, orgId, project.contactId);
    if (!contact) throw new ServiceError("This job has no client.");
    return { kind: "client" as const, userId: null as string | null, contactId: contact.id };
  }
  const [kind, idValue] = value.split(":");
  if (kind === "user" && idValue) {
    if (!memberName(db, orgId, idValue)) throw new ServiceError("Assign someone in this company.");
    return { kind: "user" as const, userId: idValue, contactId: null as string | null };
  }
  if (kind === "vendor" && idValue) {
    if (!vendorsOnJob(db, orgId, projectId).has(idValue)) throw new ServiceError("That vendor is not on this job.");
    return { kind: "vendor" as const, userId: null as string | null, contactId: idValue };
  }
  throw new ServiceError("Assign someone.");
}

function assigneeName(db: AppDatabase, orgId: string, row: { assigneeKind: string; assigneeUserId: string | null; assigneeContactId: string | null }): string {
  if (row.assigneeKind === "user" && row.assigneeUserId) return memberName(db, orgId, row.assigneeUserId) ?? "Crew";
  if (row.assigneeContactId) {
    const contact = loadContact(db, orgId, row.assigneeContactId);
    if (!contact) return "Assignee";
    return row.assigneeKind === "vendor" ? contact.company?.trim() || contact.name : contact.name;
  }
  return "Assignee";
}

function rowsFor(db: AppDatabase, orgId: string, projectId?: string) {
  return db
    .select()
    .from(submittals)
    .where(projectId ? and(eq(submittals.orgId, orgId), eq(submittals.projectId, projectId)) : eq(submittals.orgId, orgId))
    .all()
    .sort((a, b) => a.number - b.number);
}

function listItem(db: AppDatabase, orgId: string, row: Row, today: string): SubmittalListItem {
  const createdDay = localDay(Date.parse(row.createdAt), orgRow(db, orgId).timeZone);
  return {
    id: row.id,
    number: row.number,
    label: submittalLabel(row.number),
    title: row.title,
    division: row.division || "",
    assigneeName: assigneeName(db, orgId, row),
    assigneeKind: row.assigneeKind,
    assigneeValue: row.assigneeUserId ? `user:${row.assigneeUserId}` : row.assigneeContactId ? `contact:${row.assigneeContactId}` : "",
    dueOn: row.dueOn,
    ageDays: submittalAge(createdDay, today),
    status: row.status,
    statusLabel: SUBMITTAL_STATUS_LABEL[row.status] ?? row.status,
    pending: pendingSubmittal(row.status),
    overdue: isOverdueSubmittal(row.status, row.dueOn, today),
    revision: row.revision,
    projectId: row.projectId,
    projectName: projectIn(db, orgId, row.projectId)?.name ?? "",
    href: `/projects/${row.projectId}/submittals/${row.id}`,
  };
}

function storeFile(db: AppDatabase, orgId: string, projectId: string, upload: SubmittalUpload, createdBy: string | null, contactId: string | null) {
  const error = attachmentUploadError(upload.filename, upload.bytes);
  if (error) throw new ServiceError(error);
  const documentId = id("doc");
  const ext = attachmentExtension(upload.bytes);
  const relative = path.join("uploads", orgId, `${documentId}.${ext}`);
  fs.mkdirSync(path.dirname(path.join(dataDir(), relative)), { recursive: true });
  fs.writeFileSync(path.join(dataDir(), relative), upload.bytes);
  const stem = path.basename(upload.filename).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80);
  db.insert(documents)
    .values({
      id: documentId,
      orgId,
      projectId,
      leadId: null,
      contactId,
      type: "submittal",
      filename: `${stem || "file"}.${ext}`,
      storagePath: relative,
      metadataJson: null,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy,
    })
    .run();
  return documentId;
}

function attachFiles(db: AppDatabase, orgId: string, projectId: string, submittalId: string, revisionId: string, uploads: SubmittalUpload[], createdBy: string | null, contactId: string | null) {
  for (const upload of uploads.slice(0, 4)) {
    const documentId = storeFile(db, orgId, projectId, upload, createdBy, contactId);
    db.insert(submittalFiles)
      .values({ id: id("subf"), orgId, submittalId, revisionId, documentId, createdAt: nowIso() })
      .run();
  }
}

function fileMap(db: AppDatabase, orgId: string, submittalId: string) {
  const files = db.select().from(submittalFiles).where(and(eq(submittalFiles.orgId, orgId), eq(submittalFiles.submittalId, submittalId))).all();
  const docs = db.select().from(documents).where(eq(documents.orgId, orgId)).all();
  const names = new Map(docs.filter((row) => !row.deletedAt).map((row) => [row.id, row.filename]));
  return files
    .filter((row) => names.has(row.documentId))
    .map((row) => ({ revisionId: row.revisionId, id: row.documentId, filename: names.get(row.documentId) ?? "file" }));
}

function revisionsFor(db: AppDatabase, orgId: string, submittalId: string): RevisionView[] {
  const files = fileMap(db, orgId, submittalId);
  return db
    .select()
    .from(submittalRevisions)
    .where(and(eq(submittalRevisions.orgId, orgId), eq(submittalRevisions.submittalId, submittalId)))
    .all()
    .sort((a, b) => a.revision - b.revision)
    .map((row) => ({
      id: row.id,
      revision: row.revision,
      note: row.note,
      reviewNote: row.reviewNote,
      authorName: row.authorName,
      reviewerName: row.reviewerName,
      createdAt: row.createdAt,
      reviewedAt: row.reviewedAt,
      files: files.filter((file) => file.revisionId === row.id).map((file) => ({ id: file.id, filename: file.filename })),
    }));
}

function choiceLists(db: AppDatabase, orgId: string, projectId: string) {
  const project = projectIn(db, orgId, projectId);
  const client = project ? loadContact(db, orgId, project.contactId) : null;
  const people = db
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    assignees: [
      ...people.map((person) => ({ value: `user:${person.id}`, label: person.name })),
      ...[...vendorsOnJob(db, orgId, projectId).entries()].map(([contactId, label]) => ({ value: `vendor:${contactId}`, label })).sort((a, b) => a.label.localeCompare(b.label)),
      ...(client ? [{ value: "client", label: client.name }] : []),
    ],
    related: [
      ...db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.projectId, projectId))).all().map((row) => ({ value: `schedule:${row.id}`, label: row.title })),
      ...db.select().from(selections).where(and(eq(selections.orgId, orgId), eq(selections.projectId, projectId))).all().map((row) => ({ value: `selection:${row.id}`, label: row.title })),
      ...db.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.projectId, projectId))).all().map((row) => ({ value: `purchase_order:${row.id}`, label: row.number })),
      ...db.select().from(bidRequests).where(and(eq(bidRequests.orgId, orgId), eq(bidRequests.projectId, projectId))).all().map((row) => ({ value: `bid:${row.id}`, label: row.title })),
    ],
  };
}

export type SubmittalCreateInput = {
  title: string;
  spec: string;
  division: string | null;
  dueOn: string;
  assignee: string;
  related: string | null;
  internalNote: string | null;
};

export function createSubmittal(actor: Actor, projectId: string, input: SubmittalCreateInput, files: SubmittalUpload[] = []) {
  if (!canAddFieldNotes(roleOf(actor))) throw new ServiceError("Your role cannot change this.");
  const db = dbFor(actor);
  const project = projectIn(db, actor.orgId, projectId);
  if (!project) throw new ServiceError("Job not found.");
  const title = cleanText(input.title, 80, "title", true);
  const spec = cleanText(input.spec, 2000, "spec", true);
  const division = cleanText(input.division, 40, "division", false) || null;
  const dueOn = cleanDate(input.dueOn);
  const assignee = parseAssignee(db, actor.orgId, projectId, input.assignee.trim());
  const related = assertRelated(db, actor.orgId, projectId, input.related);
  const internal = canEditCrm(roleOf(actor)) ? cleanText(input.internalNote, 500, "note", false) || null : null;
  const submittalId = id("sub");
  const revisionId = id("subv");
  const now = nowIso();
  const author = memberName(db, actor.orgId, actor.userId) ?? "Office";
  db.transaction((tx) => {
    const database = tx as unknown as AppDatabase;
    const numbers = database.select({ number: submittals.number }).from(submittals).where(and(eq(submittals.orgId, actor.orgId), eq(submittals.projectId, projectId))).all();
    const number = nextSubmittalNumber(numbers.map((row) => row.number));
    database.insert(submittals)
      .values({
        id: submittalId,
        orgId: actor.orgId,
        projectId,
        number,
        title,
        specNote: spec,
        division,
        status: "draft",
        dueOn,
        assigneeKind: assignee.kind,
        assigneeUserId: assignee.userId,
        assigneeContactId: assignee.contactId,
        relatedType: related.type,
        relatedId: related.id,
        internalNote: internal,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    database.insert(submittalRevisions)
      .values({ id: revisionId, orgId: actor.orgId, submittalId, revision: 1, note: "", reviewNote: null, authorName: author, reviewerName: null, createdAt: now, reviewedAt: null })
      .run();
    attachFiles(database, actor.orgId, projectId, submittalId, revisionId, files, actor.userId, assignee.contactId);
    writeAudit(database, actor.orgId, actor.userId, "submittal.create", submittalId, { number, title });
  });
  return submittalId;
}

function loadRow(db: AppDatabase, orgId: string, submittalId: string) {
  const row = db.select().from(submittals).where(and(eq(submittals.id, submittalId), eq(submittals.orgId, orgId))).get();
  if (!row) throw new ServiceError("Submittal not found.");
  return row;
}

function currentRevision(db: AppDatabase, orgId: string, row: Row) {
  const revision = db
    .select()
    .from(submittalRevisions)
    .where(and(eq(submittalRevisions.orgId, orgId), eq(submittalRevisions.submittalId, row.id), eq(submittalRevisions.revision, row.revision)))
    .get();
  if (!revision) throw new ServiceError("Submittal not found.");
  return revision;
}

export function submitSubmittal(actor: Actor, submittalId: string, note: string, files: SubmittalUpload[]) {
  if (!canAddFieldNotes(roleOf(actor))) throw new ServiceError("Your role cannot change this.");
  const db = dbFor(actor);
  const row = loadRow(db, actor.orgId, submittalId);
  if (!canMoveSubmittal(row.status, "submitted")) throw new ServiceError("This submittal cannot be submitted.");
  const text = cleanText(note, 2000, "note", false);
  const now = nowIso();
  const author = memberName(db, actor.orgId, actor.userId) ?? "Office";
  db.transaction((tx) => {
    const database = tx as unknown as AppDatabase;
    let revisionId = currentRevision(database, actor.orgId, row).id;
    let revision = row.revision;
    if (row.status === "revise") {
      revision += 1;
      revisionId = id("subv");
      database.insert(submittalRevisions)
        .values({ id: revisionId, orgId: actor.orgId, submittalId: row.id, revision, note: text, reviewNote: null, authorName: author, reviewerName: null, createdAt: now, reviewedAt: null })
        .run();
    } else {
      database.update(submittalRevisions).set({ note: text, authorName: author }).where(and(eq(submittalRevisions.orgId, actor.orgId), eq(submittalRevisions.id, revisionId))).run();
    }
    attachFiles(database, actor.orgId, row.projectId, row.id, revisionId, files, actor.userId, row.assigneeContactId);
    const saved = database.select().from(submittalFiles).where(and(eq(submittalFiles.orgId, actor.orgId), eq(submittalFiles.revisionId, revisionId))).all();
    if (saved.length === 0) throw new ServiceError("Add a file.");
    database.update(submittals).set({ status: "submitted", revision, updatedAt: now }).where(and(eq(submittals.orgId, actor.orgId), eq(submittals.id, row.id))).run();
    writeAudit(database, actor.orgId, actor.userId, "submittal.submit", row.id, { from: row.status, to: "submitted", revision, note: text });
  });
}

export function reviewSubmittal(actor: Actor, submittalId: string, status: string, note: string) {
  if (!canEditCrm(roleOf(actor))) throw new ServiceError("Your role cannot change this.");
  const db = dbFor(actor);
  const row = loadRow(db, actor.orgId, submittalId);
  if (!canMoveSubmittal(row.status, status)) throw new ServiceError("That status is not next.");
  const required = status === "noted" || status === "revise" || status === "rejected";
  const text = cleanText(note, 2000, "note", required);
  const now = nowIso();
  const name = memberName(db, actor.orgId, actor.userId) ?? "Office";
  db.transaction((tx) => {
    const database = tx as unknown as AppDatabase;
    const revision = currentRevision(database, actor.orgId, row);
    if (status !== "void") {
      database.update(submittalRevisions)
        .set({ reviewNote: text || revision.reviewNote, reviewerName: name, reviewedAt: now })
        .where(and(eq(submittalRevisions.orgId, actor.orgId), eq(submittalRevisions.id, revision.id)))
        .run();
    }
    database.update(submittals).set({ status, updatedAt: now }).where(and(eq(submittals.orgId, actor.orgId), eq(submittals.id, row.id))).run();
    writeAudit(database, actor.orgId, actor.userId, status === "void" ? "submittal.void" : "submittal.review", row.id, { from: row.status, to: status, revision: row.revision, note: text });
  });
}

function decisionsFor(status: string) {
  const next = ["review", ...DECISIONS].filter((value) => canMoveSubmittal(status, value));
  return next.map((value) => ({ value, label: SUBMITTAL_STATUS_LABEL[value] ?? value }));
}

export function jobSubmittals(actor: Actor, projectId: string): JobSubmittalBoard | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const project = projectIn(db, actor.orgId, projectId);
  if (!project) return null;
  const today = todayFor(db, actor.orgId);
  const choices = choiceLists(db, actor.orgId, projectId);
  return {
    projectId,
    projectName: project.name,
    canAdd: canAddFieldNotes(roleOf(actor)),
    canReview: canEditCrm(roleOf(actor)),
    items: rowsFor(db, actor.orgId, projectId).map((row) => listItem(db, actor.orgId, row, today)),
    assignees: choices.assignees,
    related: choices.related,
  };
}

export function submittalDetail(actor: Actor, submittalId: string): SubmittalDetail | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const row = db.select().from(submittals).where(and(eq(submittals.id, submittalId), eq(submittals.orgId, actor.orgId))).get();
  if (!row) return null;
  const today = todayFor(db, actor.orgId);
  const office = canEditCrm(roleOf(actor));
  const base = listItem(db, actor.orgId, row, today);
  return {
    ...base,
    specNote: row.specNote,
    internalNote: office ? row.internalNote : null,
    relatedLabel: relatedLabel(db, actor.orgId, row.projectId, row.relatedType, row.relatedId),
    canSubmit: canAddFieldNotes(roleOf(actor)) && canMoveSubmittal(row.status, "submitted"),
    canReview: office && decisionsFor(row.status).length > 0,
    canVoid: office && canMoveSubmittal(row.status, "void"),
    decisions: office ? decisionsFor(row.status) : [],
    revisions: revisionsFor(db, actor.orgId, row.id),
  };
}

export function orgSubmittals(
  actor: Actor,
  filter: { projectId?: string | null; assignee?: string | null; status?: string | null; overdue?: boolean; division?: string | null; waiting?: boolean },
): SubmittalListItem[] {
  const db = officeDb(actor.orgId);
  if (!db) return [];
  const today = todayFor(db, actor.orgId);
  return rowsFor(db, actor.orgId)
    .filter((row) => {
      if (filter.projectId && row.projectId !== filter.projectId) return false;
      if (filter.status && row.status !== filter.status) return false;
      if (filter.division && (row.division || "") !== filter.division) return false;
      if (filter.overdue && !isOverdueSubmittal(row.status, row.dueOn, today)) return false;
      if (filter.waiting && !awaitingReview(row.status)) return false;
      if (filter.assignee?.startsWith("user:") && row.assigneeUserId !== filter.assignee.slice(5)) return false;
      if (filter.assignee?.startsWith("contact:") && row.assigneeContactId !== filter.assignee.slice(8)) return false;
      return true;
    })
    .map((row) => listItem(db, actor.orgId, row, today));
}

export function submittalQueue(actor: Actor): { overdue: { count: number; href: string | null }; awaiting: { count: number; href: string | null } } {
  const db = officeDb(actor.orgId);
  if (!db) return { overdue: { count: 0, href: null }, awaiting: { count: 0, href: null } };
  const today = todayFor(db, actor.orgId);
  const rows = rowsFor(db, actor.orgId);
  const overdue = rows.filter((row) => isOverdueSubmittal(row.status, row.dueOn, today)).length;
  const awaiting = rows.filter((row) => awaitingReview(row.status) && row.assigneeKind === "user" && row.assigneeUserId === actor.userId).length;
  return {
    overdue: { count: overdue, href: overdue ? "/submittals?overdue=1" : null },
    awaiting: { count: awaiting, href: awaiting ? `/submittals?assignee=user:${actor.userId}&waiting=1` : null },
  };
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function submittalCsv(actor: Actor, projectId?: string | null): string {
  const items = projectId ? (jobSubmittals(actor, projectId)?.items ?? []) : orgSubmittals(actor, {});
  const header = ["Number", "Title", "Division", "Job", "Assignee", "Due", "Age", "Status", "Revision"];
  const lines = items.map((item) =>
    [item.label, item.title, item.division, item.projectName, item.assigneeName, item.dueOn ?? "", String(item.ageDays), item.statusLabel, String(item.revision)].map(csvCell).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function submittalPrint(actor: Actor, projectId?: string | null) {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const org = orgRow(db, actor.orgId);
  const project = projectId ? projectIn(db, actor.orgId, projectId) : null;
  if (projectId && !project) return null;
  return {
    orgName: org.name,
    projectName: project?.name ?? "All jobs",
    address: project?.address ?? null,
    today: todayFor(db, actor.orgId),
    items: projectId ? (jobSubmittals(actor, projectId)?.items ?? []) : orgSubmittals(actor, {}),
  };
}

function attemptCount(db: AppDatabase, orgId: string, since: string, ip?: string) {
  return db
    .select()
    .from(submittalAttempts)
    .where(eq(submittalAttempts.orgId, orgId))
    .all()
    .filter((row) => row.createdAt >= since && (!ip || row.ip === ip)).length;
}

function guardPortal(db: AppDatabase, orgId: string, ip: string) {
  const nowMs = Date.now();
  const limited = rateLimitError({
    ipCount: attemptCount(db, orgId, new Date(nowMs - IP_WINDOW_MS).toISOString(), ip),
    orgCount: attemptCount(db, orgId, new Date(nowMs - ORG_WINDOW_MS).toISOString()),
  });
  if (limited) throw new ServiceError(limited);
  db.insert(submittalAttempts).values({ id: id("suba"), orgId, ip: ip.slice(0, 80) || "local", createdAt: new Date(nowMs).toISOString() }).run();
}

function portalCard(db: AppDatabase, orgId: string, row: Row, flags: { canSubmit: boolean; canReview: boolean }): PortalSubmittal {
  return {
    id: row.id,
    label: submittalLabel(row.number),
    title: row.title,
    spec: row.specNote,
    division: row.division || "",
    job: projectIn(db, orgId, row.projectId)?.name ?? "Job",
    dueOn: row.dueOn,
    status: row.status,
    statusLabel: SUBMITTAL_STATUS_LABEL[row.status] ?? row.status,
    revision: row.revision,
    canSubmit: flags.canSubmit,
    canReview: flags.canReview,
    revisions: revisionsFor(db, orgId, row.id),
  };
}

function vendorContext(token: string) {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const db = getDb();
  const portal = db.select().from(vendorPortals).where(eq(vendorPortals.tokenHash, hashVendorToken(trimmed))).get();
  if (!portal || !vendorTokenMatches(trimmed, portal.tokenHash)) return null;
  const contact = loadContact(db, portal.orgId, portal.contactId);
  if (!contact || !VENDOR_TYPES.has(contact.type)) return null;
  return { db, orgId: portal.orgId, contactId: contact.id, name: contact.company?.trim() || contact.name };
}

export function vendorPortalSubmittals(token: string): { items: PortalSubmittal[]; jobs: { id: string; name: string }[] } {
  const ctx = vendorContext(token);
  if (!ctx) return { items: [], jobs: [] };
  const rows = ctx.db
    .select()
    .from(submittals)
    .where(and(eq(submittals.orgId, ctx.orgId), eq(submittals.assigneeKind, "vendor"), eq(submittals.assigneeContactId, ctx.contactId)))
    .all()
    .filter((row) => row.status !== "void");
  const jobs = ctx.db
    .select()
    .from(projects)
    .where(eq(projects.orgId, ctx.orgId))
    .all()
    .filter((project) => vendorsOnJob(ctx.db, ctx.orgId, project.id).has(ctx.contactId))
    .map((project) => ({ id: project.id, name: project.name }));
  return {
    items: rows.map((row) => portalCard(ctx.db, ctx.orgId, row, { canSubmit: canMoveSubmittal(row.status, "submitted"), canReview: false })),
    jobs,
  };
}

export function vendorCreateSubmittal(input: { token: string; projectId: string; title: string; spec: string; division: string; dueOn: string; note: string; files: SubmittalUpload[]; ip: string }) {
  const ctx = vendorContext(input.token);
  if (!ctx) throw new ServiceError("Portal not found.");
  guardPortal(ctx.db, ctx.orgId, input.ip);
  if (!vendorsOnJob(ctx.db, ctx.orgId, input.projectId).has(ctx.contactId)) throw new ServiceError("That job is not yours.");
  const title = cleanText(input.title, 80, "title", true);
  const spec = cleanText(input.spec, 2000, "spec", true);
  const division = cleanText(input.division, 40, "division", false) || null;
  const dueOn = cleanDate(input.dueOn);
  const note = cleanText(input.note, 2000, "note", false);
  if (input.files.length === 0) throw new ServiceError("Add a file.");
  const submittalId = id("sub");
  const revisionId = id("subv");
  const now = nowIso();
  ctx.db.transaction((tx) => {
    const database = tx as unknown as AppDatabase;
    const numbers = database.select({ number: submittals.number }).from(submittals).where(and(eq(submittals.orgId, ctx.orgId), eq(submittals.projectId, input.projectId))).all();
    const number = nextSubmittalNumber(numbers.map((row) => row.number));
    database.insert(submittals)
      .values({
        id: submittalId,
        orgId: ctx.orgId,
        projectId: input.projectId,
        number,
        title,
        specNote: spec,
        division,
        status: "submitted",
        dueOn,
        assigneeKind: "vendor",
        assigneeUserId: null,
        assigneeContactId: ctx.contactId,
        relatedType: null,
        relatedId: null,
        internalNote: null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
      })
      .run();
    database.insert(submittalRevisions)
      .values({ id: revisionId, orgId: ctx.orgId, submittalId, revision: 1, note, reviewNote: null, authorName: ctx.name, reviewerName: null, createdAt: now, reviewedAt: null })
      .run();
    attachFiles(database, ctx.orgId, input.projectId, submittalId, revisionId, input.files, null, ctx.contactId);
    writeAudit(database, ctx.orgId, null, "submittal.create", submittalId, { number, title, portal: "vendor" }, input.ip);
    writeAudit(database, ctx.orgId, null, "submittal.submit", submittalId, { from: "draft", to: "submitted", revision: 1, note }, input.ip);
  });
  return submittalId;
}

export function vendorSubmitSubmittal(input: { token: string; submittalId: string; note: string; files: SubmittalUpload[]; ip: string }) {
  const ctx = vendorContext(input.token);
  if (!ctx) throw new ServiceError("Portal not found.");
  guardPortal(ctx.db, ctx.orgId, input.ip);
  const row = ctx.db
    .select()
    .from(submittals)
    .where(and(eq(submittals.id, input.submittalId), eq(submittals.orgId, ctx.orgId), eq(submittals.assigneeContactId, ctx.contactId), eq(submittals.assigneeKind, "vendor")))
    .get();
  if (!row) throw new ServiceError("Submittal not found.");
  if (!canMoveSubmittal(row.status, "submitted")) throw new ServiceError("This submittal cannot be submitted.");
  const note = cleanText(input.note, 2000, "note", false);
  if (input.files.length === 0) throw new ServiceError("Add a file.");
  const now = nowIso();
  ctx.db.transaction((tx) => {
    const database = tx as unknown as AppDatabase;
    let revision = row.revision;
    let revisionId = currentRevision(database, ctx.orgId, row).id;
    if (row.status === "revise") {
      revision += 1;
      revisionId = id("subv");
      database.insert(submittalRevisions)
        .values({ id: revisionId, orgId: ctx.orgId, submittalId: row.id, revision, note, reviewNote: null, authorName: ctx.name, reviewerName: null, createdAt: now, reviewedAt: null })
        .run();
    } else {
      database.update(submittalRevisions).set({ note, authorName: ctx.name }).where(and(eq(submittalRevisions.orgId, ctx.orgId), eq(submittalRevisions.id, revisionId))).run();
    }
    attachFiles(database, ctx.orgId, row.projectId, row.id, revisionId, input.files, null, ctx.contactId);
    database.update(submittals).set({ status: "submitted", revision, updatedAt: now }).where(and(eq(submittals.orgId, ctx.orgId), eq(submittals.id, row.id))).run();
    writeAudit(database, ctx.orgId, null, "submittal.submit", row.id, { from: row.status, to: "submitted", revision, note }, input.ip);
  });
}

function clientContext(token: string) {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, trimmed)).get();
  if (!project) return null;
  const contact = loadContact(db, project.orgId, project.contactId);
  if (!contact) return null;
  return { db, orgId: project.orgId, projectId: project.id, contactId: contact.id, name: contact.name };
}

export function clientPortalSubmittals(token: string): PortalSubmittal[] {
  const ctx = clientContext(token);
  if (!ctx) return [];
  return ctx.db
    .select()
    .from(submittals)
    .where(and(eq(submittals.orgId, ctx.orgId), eq(submittals.projectId, ctx.projectId), eq(submittals.assigneeKind, "client"), eq(submittals.assigneeContactId, ctx.contactId)))
    .all()
    .filter((row) => row.status !== "void")
    .map((row) => portalCard(ctx.db, ctx.orgId, row, { canSubmit: false, canReview: awaitingReview(row.status) }));
}

export function clientReviewSubmittal(input: { token: string; submittalId: string; status: string; note: string; ip: string }) {
  const ctx = clientContext(input.token);
  if (!ctx) throw new ServiceError("Portal not found.");
  guardPortal(ctx.db, ctx.orgId, input.ip);
  const row = ctx.db
    .select()
    .from(submittals)
    .where(and(eq(submittals.id, input.submittalId), eq(submittals.orgId, ctx.orgId), eq(submittals.projectId, ctx.projectId), eq(submittals.assigneeKind, "client"), eq(submittals.assigneeContactId, ctx.contactId)))
    .get();
  if (!row) throw new ServiceError("Submittal not found.");
  if (!(DECISIONS as readonly string[]).includes(input.status) || !canMoveSubmittal(row.status, input.status)) throw new ServiceError("That status is not next.");
  const required = input.status === "noted" || input.status === "revise" || input.status === "rejected";
  const note = cleanText(input.note, 2000, "note", required);
  const now = nowIso();
  ctx.db.transaction((tx) => {
    const database = tx as unknown as AppDatabase;
    const revision = currentRevision(database, ctx.orgId, row);
    database.update(submittalRevisions)
      .set({ reviewNote: note || revision.reviewNote, reviewerName: ctx.name, reviewedAt: now })
      .where(and(eq(submittalRevisions.orgId, ctx.orgId), eq(submittalRevisions.id, revision.id)))
      .run();
    database.update(submittals).set({ status: input.status, updatedAt: now }).where(and(eq(submittals.orgId, ctx.orgId), eq(submittals.id, row.id))).run();
    writeAudit(database, ctx.orgId, null, "submittal.review", row.id, { from: row.status, to: input.status, revision: row.revision, note, portal: "client" }, input.ip);
  });
}
