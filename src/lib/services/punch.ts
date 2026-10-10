import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  bills,
  changeOrders,
  contacts,
  costItems,
  documents,
  invoices,
  memberships,
  organizations,
  priceBookItems,
  projects,
  punchItems,
  purchaseOrders,
  scheduleAssignees,
  scheduleItems,
  timeEntries,
  users,
  warrantyAttempts,
  warrantyPhotos,
  warrantyRequests,
} from "@/lib/db/schema";
import { addMonths, closeoutChecklist, finalInvoiceState, openBlockers, warrantyOpen, type CloseoutBlocker } from "@/lib/closeout/check";
import { closeoutPermitFacts } from "@/lib/services/permits";
import { id, nowIso } from "@/lib/ids";
import { MAX_MONEY_CENTS } from "@/lib/money";
import { canAddFieldNotes, canEditCrm, canManageMoney, canManageSettings, canSeeMoney, type Role } from "@/lib/permissions";
import { photoExtension, photoUploadError, rasterImageType } from "@/lib/security";
import { notifyAssignment } from "@/lib/services/comments";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import {
  fillTimeError,
  honeypotTripped,
  IP_WINDOW_MS,
  MAX_PHOTOS,
  ORG_WINDOW_MS,
  rateLimitError,
} from "@/lib/lead-form/rules";
import { localDay } from "@/lib/time/calendar";

const PUNCH_STATUS = ["open", "done", "verified"] as const;
const WARRANTY_STATUS = ["submitted", "scheduled", "resolved", "declined"] as const;
const URGENCY = ["normal", "soon", "urgent"] as const;

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  done: "Done",
  verified: "Verified",
  submitted: "Submitted",
  scheduled: "Scheduled",
  resolved: "Resolved",
  declined: "Declined",
  normal: "Normal",
  soon: "Soon",
  urgent: "Urgent",
};

export type PhotoUpload = { filename: string; bytes: Buffer };

export type PunchItemView = {
  id: string;
  title: string;
  location: string;
  dueDate: string | null;
  status: string;
  statusLabel: string;
  shared: boolean;
  assigneeName: string;
  costCode: string | null;
  beforeDocumentId: string | null;
  afterDocumentId: string | null;
};

export type WarrantyRequestView = {
  id: string;
  title: string;
  description: string;
  urgency: string;
  urgencyLabel: string;
  status: string;
  statusLabel: string;
  visitDate: string | null;
  assigneeUserId: string | null;
  assigneeName: string;
  clientNote: string;
  internalNote: string | null;
  costCode: string | null;
  amountCents: number | null;
  photos: string[];
  visitNote: string | null;
};

export type CloseoutView = {
  substantial: boolean;
  closed: boolean;
  endsOn: string | null;
  months: number;
  checklist: CloseoutBlocker[];
  blocked: boolean;
};

export type PunchBoard = {
  projectId: string;
  projectName: string;
  today: string;
  showMoney: boolean;
  canEdit: boolean;
  canAdd: boolean;
  counts: { open: number; done: number; verified: number };
  items: PunchItemView[];
  closeout: CloseoutView;
  warranty: WarrantyRequestView[];
  crew: { id: string; name: string }[];
  vendors: { id: string; name: string }[];
  codes: string[];
};

export type FieldPunch = {
  items: { id: string; projectId: string; projectName: string; title: string; location: string; status: string; statusLabel: string }[];
  jobs: { id: string; name: string }[];
};

export type PortalWarranty = {
  closed: boolean;
  open: boolean;
  endsOn: string | null;
  punch: { id: string; title: string; location: string; status: string; statusLabel: string; beforeDocumentId: string | null; afterDocumentId: string | null }[];
  requests: { id: string; title: string; description: string; urgency: string; urgencyLabel: string; status: string; statusLabel: string; visitDate: string | null; clientNote: string; photos: string[] }[];
};

type PunchInput = {
  title: string;
  location: string;
  dueDate: string | null;
  costCode: string | null;
  assigneeUserId: string | null;
  assigneeContactId: string | null;
  shared: boolean;
};

function dbFor(actor: Actor): AppDatabase {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("That job is not in your company.");
  return db;
}

function role(actor: Actor): Role {
  return actor.role as Role;
}

function assertAdd(actor: Actor) {
  if (!canAddFieldNotes(role(actor))) throw new ServiceError("Your role cannot change this.");
}

function assertOffice(actor: Actor) {
  if (!canEditCrm(role(actor))) throw new ServiceError("Your role cannot change this.");
}

function cleanText(value: string | null | undefined, max: number, label: string, required: boolean): string {
  const text = (value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  if (required && !text) throw new ServiceError(`Add a ${label}.`);
  if (text.length > max) throw new ServiceError(`${label} is too long.`);
  return text;
}

function cleanDate(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ServiceError("Use a date.");
  return text;
}

function label(value: string): string {
  return STATUS_LABEL[value] ?? value;
}

function writeAudit(
  tx: AppDatabase,
  orgId: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown> | null,
  ip?: string,
) {
  tx.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType,
      entityId,
      payloadJson: payload ? JSON.stringify(payload) : null,
      ip: ip ?? null,
      createdAt: nowIso(),
    })
    .run();
}

function storePhoto(orgId: string, projectId: string, upload: PhotoUpload, createdBy: string | null, db: AppDatabase): string {
  const error = photoUploadError(upload.filename, upload.bytes);
  if (error) throw new ServiceError(error);
  const type = rasterImageType(upload.bytes);
  if (!type) throw new ServiceError("Use a JPEG, PNG, or WebP photo.");
  const documentId = id("doc");
  const ext = photoExtension(type);
  const relative = path.join("uploads", orgId, `${documentId}.${ext}`);
  const absolute = path.join(dataDir(), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, upload.bytes);
  const stem = path.basename(upload.filename).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80);
  db.insert(documents)
    .values({
      id: documentId,
      orgId,
      projectId,
      leadId: null,
      contactId: null,
      type: "photo",
      filename: `${stem || "photo"}.${ext}`,
      storagePath: relative,
      metadataJson: null,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy,
    })
    .run();
  return documentId;
}

function projectIn(db: AppDatabase, orgId: string, projectId: string) {
  return db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
}

function orgRow(db: AppDatabase, orgId: string) {
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) throw new ServiceError("Company not found.");
  return org;
}

function todayFor(db: AppDatabase, orgId: string, now = Date.now()) {
  return localDay(now, orgRow(db, orgId).timeZone);
}

function crewOf(db: AppDatabase, orgId: string) {
  return db
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
}

function vendorsOf(db: AppDatabase, orgId: string) {
  return db
    .select({ id: contacts.id, name: contacts.name, company: contacts.company, type: contacts.type })
    .from(contacts)
    .where(eq(contacts.orgId, orgId))
    .all()
    .filter((row) => row.type === "sub" || row.type === "vendor")
    .map((row) => ({ id: row.id, name: row.company || row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function assertAssignee(db: AppDatabase, orgId: string, userId: string | null, contactId: string | null) {
  if (userId && contactId) throw new ServiceError("Assign a person or a vendor.");
  if (userId && !crewOf(db, orgId).some((person) => person.id === userId)) throw new ServiceError("Assign someone in this company.");
  if (contactId && !vendorsOf(db, orgId).some((vendor) => vendor.id === contactId)) throw new ServiceError("Assign a vendor in this company.");
}

function namesFor(db: AppDatabase, orgId: string) {
  const crew = new Map(crewOf(db, orgId).map((person) => [person.id, person.name]));
  const vendors = new Map(vendorsOf(db, orgId).map((vendor) => [vendor.id, vendor.name]));
  return { crew, vendors };
}

function factsFor(db: AppDatabase, orgId: string, projectId: string) {
  const punches = db.select().from(punchItems).where(and(eq(punchItems.orgId, orgId), eq(punchItems.projectId, projectId))).all();
  const finals = db
    .select({ status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.projectId, projectId), eq(invoices.type, "final")))
    .all();
  const drafts = db
    .select({ id: changeOrders.id })
    .from(changeOrders)
    .where(and(eq(changeOrders.orgId, orgId), eq(changeOrders.projectId, projectId), eq(changeOrders.status, "draft")))
    .all();
  const draftBills = db
    .select({ id: bills.id })
    .from(bills)
    .where(and(eq(bills.orgId, orgId), eq(bills.projectId, projectId), eq(bills.status, "draft")))
    .all();
  const openOrders = db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.projectId, projectId), eq(purchaseOrders.status, "issued")))
    .all();
  const time = db
    .select({ status: timeEntries.status })
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.projectId, projectId)))
    .all();
  return {
    punchOpen: punches.filter((row) => row.status === "open").length,
    punchDone: punches.filter((row) => row.status === "done").length,
    finalInvoice: finalInvoiceState(finals.map((row) => row.status)),
    draftChangeOrders: drafts.length,
    draftBills: draftBills.length,
    openPurchaseOrders: openOrders.length,
    unapprovedTime: time.filter((row) => row.status === "pending" || row.status === "open" || row.status === "break").length,
    ...closeoutPermitFacts(orgId, projectId),
  };
}

function closeoutOf(db: AppDatabase, orgId: string, project: typeof projects.$inferSelect): CloseoutView {
  const facts = factsFor(db, orgId, project.id);
  const checklist = closeoutChecklist(facts);
  const org = orgRow(db, orgId);
  return {
    substantial: Boolean(project.substantialAt),
    closed: Boolean(project.closedAt),
    endsOn: project.warrantyEndsOn,
    months: project.warrantyMonths ?? org.warrantyMonths ?? 12,
    checklist,
    blocked: openBlockers(facts).length > 0,
  };
}

function visitNote(title: string, visitDate: string | null): string | null {
  if (!visitDate) return null;
  return `Warranty visit ${visitDate} · ${title}`;
}

function warrantyViews(db: AppDatabase, orgId: string, projectId: string, money: boolean, office: boolean): WarrantyRequestView[] {
  const rows = db
    .select()
    .from(warrantyRequests)
    .where(and(eq(warrantyRequests.orgId, orgId), eq(warrantyRequests.projectId, projectId)))
    .all()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const photos = db.select().from(warrantyPhotos).where(eq(warrantyPhotos.orgId, orgId)).all();
  const costs = money
    ? db.select().from(costItems).where(and(eq(costItems.orgId, orgId), eq(costItems.projectId, projectId), eq(costItems.source, "warranty"))).all()
    : [];
  const { crew } = namesFor(db, orgId);
  return rows.map((row) => {
    const cost = row.costItemId ? costs.find((item) => item.id === row.costItemId) : undefined;
    return {
      id: row.id,
      title: row.title,
      description: row.description ?? "",
      urgency: row.urgency,
      urgencyLabel: label(row.urgency),
      status: row.status,
      statusLabel: label(row.status),
      visitDate: row.visitDate,
      assigneeUserId: row.assigneeUserId,
      assigneeName: row.assigneeUserId ? crew.get(row.assigneeUserId) ?? "" : "",
      clientNote: row.clientNote ?? "",
      internalNote: office ? row.internalNote : null,
      costCode: money ? row.costCode : null,
      amountCents: money && cost ? cost.amountCents : null,
      photos: photos.filter((photo) => photo.requestId === row.id).sort((a, b) => a.sortOrder - b.sortOrder).map((photo) => photo.documentId),
      visitNote: visitNote(row.title, row.visitDate),
    };
  });
}

export function punchBoard(actor: Actor, projectId: string): PunchBoard | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const project = projectIn(db, actor.orgId, projectId);
  if (!project) return null;
  const money = canSeeMoney(role(actor));
  const office = canEditCrm(role(actor));
  const { crew, vendors } = namesFor(db, actor.orgId);
  const items = db
    .select()
    .from(punchItems)
    .where(and(eq(punchItems.orgId, actor.orgId), eq(punchItems.projectId, projectId)))
    .all()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title));
  const counts = { open: 0, done: 0, verified: 0 };
  for (const item of items) {
    if (item.status === "open" || item.status === "done" || item.status === "verified") counts[item.status] += 1;
  }
  const codes = money
    ? db
        .select({ code: priceBookItems.code })
        .from(priceBookItems)
        .where(eq(priceBookItems.orgId, actor.orgId))
        .all()
        .map((row) => row.code)
        .filter((code, index, list) => list.indexOf(code) === index)
        .sort()
    : [];
  return {
    projectId: project.id,
    projectName: project.name,
    today: todayFor(db, actor.orgId),
    showMoney: money,
    canEdit: office,
    canAdd: canAddFieldNotes(role(actor)),
    counts,
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      location: item.location ?? "",
      dueDate: item.dueDate,
      status: item.status,
      statusLabel: label(item.status),
      shared: item.shared === 1,
      assigneeName: item.assigneeUserId ? crew.get(item.assigneeUserId) ?? "" : item.assigneeContactId ? vendors.get(item.assigneeContactId) ?? "" : "",
      costCode: money ? item.costCode : null,
      beforeDocumentId: item.beforeDocumentId,
      afterDocumentId: item.afterDocumentId,
    })),
    closeout: closeoutOf(db, actor.orgId, project),
    warranty: warrantyViews(db, actor.orgId, projectId, money, office),
    crew: crewOf(db, actor.orgId),
    vendors: vendorsOf(db, actor.orgId),
    codes,
  };
}

export function fieldPunch(actor: Actor): FieldPunch {
  assertAdd(actor);
  const db = dbFor(actor);
  const jobs = db
    .select({ id: projects.id, name: projects.name, status: projects.status })
    .from(projects)
    .where(eq(projects.orgId, actor.orgId))
    .all()
    .filter((job) => job.status === "active")
    .map((job) => ({ id: job.id, name: job.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const names = new Map(jobs.map((job) => [job.id, job.name]));
  const allJobs = db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, actor.orgId)).all();
  for (const job of allJobs) names.set(job.id, job.name);
  const items = db
    .select()
    .from(punchItems)
    .where(and(eq(punchItems.orgId, actor.orgId), eq(punchItems.assigneeUserId, actor.userId)))
    .all()
    .filter((item) => item.status !== "verified")
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((item) => ({
      id: item.id,
      projectId: item.projectId,
      projectName: names.get(item.projectId) ?? "",
      title: item.title,
      location: item.location ?? "",
      status: item.status,
      statusLabel: label(item.status),
    }));
  return { items, jobs };
}

export function warrantyQueue(orgId: string): { count: number; href: string | null } {
  const db = officeDb(orgId);
  if (!db) return { count: 0, href: null };
  const rows = db
    .select()
    .from(warrantyRequests)
    .where(eq(warrantyRequests.orgId, orgId))
    .all()
    .filter((row) => row.status === "submitted" || row.status === "scheduled")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (rows.length === 0) return { count: 0, href: null };
  return { count: rows.length, href: `/projects/${rows[0].projectId}#warranty` };
}

export function addPunchItem(actor: Actor, projectId: string, input: PunchInput, photo?: PhotoUpload | null) {
  assertAdd(actor);
  const db = dbFor(actor);
  const project = projectIn(db, actor.orgId, projectId);
  if (!project) throw new ServiceError("That job is not in your company.");
  const office = canEditCrm(role(actor));
  const title = cleanText(input.title, 160, "title", true);
  const location = cleanText(input.location, 120, "Room", false);
  const dueDate = cleanDate(input.dueDate);
  const costCode = office ? cleanText(input.costCode, 40, "Cost code", false) || null : null;
  const assigneeUserId = office ? input.assigneeUserId || null : actor.userId;
  const assigneeContactId = office ? input.assigneeContactId || null : null;
  const shared = office && input.shared ? 1 : 0;
  assertAssignee(db, actor.orgId, assigneeUserId, assigneeContactId);
  const stamp = nowIso();
  const itemId = id("punch");
  const beforeDocumentId = photo && photo.bytes.length > 0 ? storePhoto(actor.orgId, projectId, photo, actor.userId, db) : null;
  db.transaction((tx) => {
    tx.insert(punchItems)
      .values({
        id: itemId,
        orgId: actor.orgId,
        projectId,
        title,
        location: location || null,
        costCode,
        assigneeUserId,
        assigneeContactId,
        dueDate,
        status: "open",
        shared,
        beforeDocumentId,
        afterDocumentId: null,
        doneAt: null,
        verifiedAt: null,
        createdBy: actor.userId,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .run();
    writeAudit(tx, actor.orgId, actor.userId, "punch.create", "punch_item", itemId, { status: "open", shared: shared === 1 });
  });
  if (assigneeUserId) notifyAssignment(actor, { entityType: "punch_item", entityId: itemId, userIds: [assigneeUserId] });
  return itemId;
}

export function markPunchDone(actor: Actor, itemId: string, photo: PhotoUpload | null) {
  assertAdd(actor);
  if (!photo || photo.bytes.length === 0) throw new ServiceError("Choose a photo.");
  const db = dbFor(actor);
  const item = db.select().from(punchItems).where(and(eq(punchItems.id, itemId), eq(punchItems.orgId, actor.orgId))).get();
  if (!item) throw new ServiceError("That punch item is not in your company.");
  if (item.status === "verified") throw new ServiceError("Already verified.");
  const documentId = storePhoto(actor.orgId, item.projectId, photo, actor.userId, db);
  const stamp = nowIso();
  db.transaction((tx) => {
    tx.update(punchItems)
      .set({ status: "done", afterDocumentId: documentId, doneAt: stamp, updatedAt: stamp })
      .where(and(eq(punchItems.id, item.id), eq(punchItems.orgId, actor.orgId)))
      .run();
    writeAudit(tx, actor.orgId, actor.userId, "punch.done", "punch_item", item.id, { from: item.status, status: "done" });
  });
}

export function verifyPunch(actor: Actor, itemId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const item = db.select().from(punchItems).where(and(eq(punchItems.id, itemId), eq(punchItems.orgId, actor.orgId))).get();
  if (!item) throw new ServiceError("That punch item is not in your company.");
  if (item.status === "verified") throw new ServiceError("Already verified.");
  const stamp = nowIso();
  db.transaction((tx) => {
    tx.update(punchItems)
      .set({ status: "verified", verifiedAt: stamp, updatedAt: stamp })
      .where(and(eq(punchItems.id, item.id), eq(punchItems.orgId, actor.orgId)))
      .run();
    writeAudit(tx, actor.orgId, actor.userId, "punch.verify", "punch_item", item.id, { from: item.status, status: "verified" });
  });
}

export function setPunchShared(actor: Actor, itemId: string, shared: boolean) {
  assertOffice(actor);
  const db = dbFor(actor);
  const item = db.select().from(punchItems).where(and(eq(punchItems.id, itemId), eq(punchItems.orgId, actor.orgId))).get();
  if (!item) throw new ServiceError("That punch item is not in your company.");
  const stamp = nowIso();
  db.transaction((tx) => {
    tx.update(punchItems)
      .set({ shared: shared ? 1 : 0, updatedAt: stamp })
      .where(and(eq(punchItems.id, item.id), eq(punchItems.orgId, actor.orgId)))
      .run();
    writeAudit(tx, actor.orgId, actor.userId, "punch.share", "punch_item", item.id, { shared });
  });
}

export function markSubstantial(actor: Actor, projectId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const project = projectIn(db, actor.orgId, projectId);
  if (!project) throw new ServiceError("That job is not in your company.");
  if (project.substantialAt) return;
  const stamp = nowIso();
  db.transaction((tx) => {
    tx.update(projects)
      .set({ substantialAt: stamp, updatedAt: stamp })
      .where(and(eq(projects.id, project.id), eq(projects.orgId, actor.orgId)))
      .run();
    writeAudit(tx, actor.orgId, actor.userId, "job.substantial", "project", project.id, null);
  });
}

export function closeJob(actor: Actor, projectId: string, input: { months: number | null; reason: string }) {
  assertOffice(actor);
  const db = dbFor(actor);
  const project = projectIn(db, actor.orgId, projectId);
  if (!project) throw new ServiceError("That job is not in your company.");
  if (project.closedAt) throw new ServiceError("Already closed.");
  if (!project.substantialAt) throw new ServiceError("Mark the job substantially complete first.");
  const facts = factsFor(db, actor.orgId, projectId);
  const blockers = openBlockers(facts);
  const reason = cleanText(input.reason, 500, "reason", false);
  if (blockers.length > 0 && !reason) throw new ServiceError("Clear the blockers, or add a reason.");
  const org = orgRow(db, actor.orgId);
  const months = input.months ?? project.warrantyMonths ?? org.warrantyMonths ?? 12;
  if (!Number.isInteger(months) || months < 1 || months > 120) throw new ServiceError("Warranty months must be from 1 to 120.");
  const stamp = nowIso();
  const endsOn = addMonths(todayFor(db, actor.orgId), months);
  db.transaction((tx) => {
    tx.update(projects)
      .set({
        status: "complete",
        closedAt: stamp,
        warrantyEndsOn: endsOn,
        warrantyMonths: months,
        closeOverrideReason: reason || null,
        updatedAt: stamp,
      })
      .where(and(eq(projects.id, project.id), eq(projects.orgId, actor.orgId)))
      .run();
    writeAudit(tx, actor.orgId, actor.userId, "job.close", "project", project.id, {
      endsOn,
      months,
      reason: reason || null,
      blockers: blockers.map((row) => row.key),
    });
  });
}

export function reopenJob(actor: Actor, projectId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const project = projectIn(db, actor.orgId, projectId);
  if (!project) throw new ServiceError("That job is not in your company.");
  if (!project.closedAt) throw new ServiceError("That job is open.");
  const stamp = nowIso();
  db.transaction((tx) => {
    tx.update(projects)
      .set({ status: "active", closedAt: null, warrantyEndsOn: null, closeOverrideReason: null, updatedAt: stamp })
      .where(and(eq(projects.id, project.id), eq(projects.orgId, actor.orgId)))
      .run();
    writeAudit(tx, actor.orgId, actor.userId, "job.reopen", "project", project.id, null);
  });
}

export function setWarrantyMonths(actor: Actor, months: number) {
  if (!canManageSettings(role(actor))) throw new ServiceError("Only an owner or admin can change company settings.");
  if (!Number.isInteger(months) || months < 1 || months > 120) throw new ServiceError("Warranty months must be from 1 to 120.");
  const db = dbFor(actor);
  const stamp = nowIso();
  db.transaction((tx) => {
    tx.update(organizations).set({ warrantyMonths: months, updatedAt: stamp }).where(eq(organizations.id, actor.orgId)).run();
    writeAudit(tx, actor.orgId, actor.userId, "warranty.months", "organization", actor.orgId, { months });
  });
}

function requestIn(db: AppDatabase, orgId: string, requestId: string) {
  return db.select().from(warrantyRequests).where(and(eq(warrantyRequests.id, requestId), eq(warrantyRequests.orgId, orgId))).get();
}

export function scheduleWarranty(actor: Actor, requestId: string, input: { assigneeUserId: string; visitDate: string }) {
  assertOffice(actor);
  const db = dbFor(actor);
  const request = requestIn(db, actor.orgId, requestId);
  if (!request) throw new ServiceError("That request is not in your company.");
  if (request.status === "resolved" || request.status === "declined") throw new ServiceError("That request is closed.");
  const visitDate = cleanDate(input.visitDate);
  if (!visitDate) throw new ServiceError("Use a date.");
  assertAssignee(db, actor.orgId, input.assigneeUserId, null);
  if (!input.assigneeUserId) throw new ServiceError("Assign someone in this company.");
  const stamp = nowIso();
  const itemId = request.scheduleItemId ?? id("sch");
  db.transaction((tx) => {
    const existing = request.scheduleItemId
      ? tx.select().from(scheduleItems).where(and(eq(scheduleItems.id, request.scheduleItemId), eq(scheduleItems.orgId, actor.orgId))).get()
      : null;
    if (existing) {
      tx.update(scheduleItems)
        .set({ title: request.title, startDate: visitDate, endDate: visitDate, status: "confirmed", updatedAt: stamp })
        .where(and(eq(scheduleItems.id, existing.id), eq(scheduleItems.orgId, actor.orgId)))
        .run();
      tx.delete(scheduleAssignees).where(and(eq(scheduleAssignees.orgId, actor.orgId), eq(scheduleAssignees.itemId, existing.id))).run();
    } else {
      tx.insert(scheduleItems)
        .values({
          id: itemId,
          orgId: actor.orgId,
          projectId: request.projectId,
          title: request.title,
          startDate: visitDate,
          endDate: visitDate,
          startTime: null,
          status: "confirmed",
          note: null,
          createdAt: stamp,
          updatedAt: stamp,
          createdBy: actor.userId,
        })
        .run();
    }
    tx.insert(scheduleAssignees)
      .values({ id: id("scha"), orgId: actor.orgId, itemId, userId: input.assigneeUserId })
      .run();
    tx.update(warrantyRequests)
      .set({ status: "scheduled", visitDate, assigneeUserId: input.assigneeUserId, scheduleItemId: itemId, updatedAt: stamp })
      .where(and(eq(warrantyRequests.id, request.id), eq(warrantyRequests.orgId, actor.orgId)))
      .run();
    writeAudit(tx, actor.orgId, actor.userId, "warranty.schedule", "warranty_request", request.id, {
      from: request.status,
      status: "scheduled",
      visitDate,
    });
  });
  return visitNote(request.title, visitDate);
}

export function resolveWarranty(actor: Actor, requestId: string, input: { clientNote: string; internalNote: string; costCode: string | null; amountCents: number | null }) {
  assertOffice(actor);
  const db = dbFor(actor);
  const request = requestIn(db, actor.orgId, requestId);
  if (!request) throw new ServiceError("That request is not in your company.");
  if (request.status === "resolved" || request.status === "declined") throw new ServiceError("That request is closed.");
  const clientNote = cleanText(input.clientNote, 500, "note", true);
  const internalNote = cleanText(input.internalNote, 500, "Internal", false) || null;
  const costCode = cleanText(input.costCode, 40, "Cost code", false) || null;
  const amount = input.amountCents;
  if (amount != null && (!Number.isInteger(amount) || amount < 0 || amount > MAX_MONEY_CENTS)) throw new ServiceError("That amount is not valid.");
  if (amount != null && amount > 0 && !canManageMoney(role(actor))) throw new ServiceError("Your role cannot change prices or invoices.");
  if (amount != null && amount > 0 && !costCode) throw new ServiceError("Add a cost code.");
  const stamp = nowIso();
  db.transaction((tx) => {
    let costItemId = request.costItemId;
    if (amount != null && amount > 0 && costCode) {
      costItemId = id("cost");
      tx.insert(costItems)
        .values({
          id: costItemId,
          orgId: actor.orgId,
          projectId: request.projectId,
          budgetLineId: null,
          costCode,
          amountCents: amount,
          vendorName: null,
          memo: request.title,
          source: "warranty",
          aiExtracted: 0,
          documentId: null,
          createdAt: stamp,
          updatedAt: stamp,
          createdBy: actor.userId,
        })
        .run();
    }
    tx.update(warrantyRequests)
      .set({ status: "resolved", clientNote, internalNote: internalNote ?? request.internalNote, costCode: costCode ?? request.costCode, costItemId, updatedAt: stamp })
      .where(and(eq(warrantyRequests.id, request.id), eq(warrantyRequests.orgId, actor.orgId)))
      .run();
    writeAudit(tx, actor.orgId, actor.userId, "warranty.resolve", "warranty_request", request.id, { from: request.status, status: "resolved" });
  });
}

export function declineWarranty(actor: Actor, requestId: string, input: { clientNote: string; internalNote: string }) {
  assertOffice(actor);
  const db = dbFor(actor);
  const request = requestIn(db, actor.orgId, requestId);
  if (!request) throw new ServiceError("That request is not in your company.");
  if (request.status === "resolved" || request.status === "declined") throw new ServiceError("That request is closed.");
  const clientNote = cleanText(input.clientNote, 500, "note", true);
  const internalNote = cleanText(input.internalNote, 500, "Internal", false) || request.internalNote;
  const stamp = nowIso();
  db.transaction((tx) => {
    tx.update(warrantyRequests)
      .set({ status: "declined", clientNote, internalNote, updatedAt: stamp })
      .where(and(eq(warrantyRequests.id, request.id), eq(warrantyRequests.orgId, actor.orgId)))
      .run();
    writeAudit(tx, actor.orgId, actor.userId, "warranty.decline", "warranty_request", request.id, { from: request.status, status: "declined" });
  });
}

function attemptCount(db: AppDatabase, orgId: string, sinceIso: string, ip?: string) {
  return db
    .select()
    .from(warrantyAttempts)
    .where(eq(warrantyAttempts.orgId, orgId))
    .all()
    .filter((row) => row.createdAt >= sinceIso && (!ip || row.ip === ip)).length;
}

function recordAttempt(db: AppDatabase, orgId: string, ip: string, atIso: string) {
  const cutoff = new Date(Date.parse(atIso) - ORG_WINDOW_MS).toISOString();
  const stale = db.select().from(warrantyAttempts).where(eq(warrantyAttempts.orgId, orgId)).all().filter((row) => row.createdAt < cutoff);
  for (const row of stale) db.delete(warrantyAttempts).where(eq(warrantyAttempts.id, row.id)).run();
  db.insert(warrantyAttempts).values({ id: id("wat"), orgId, ip, createdAt: atIso }).run();
}

export function portalWarranty(token: string, now = Date.now()): PortalWarranty | null {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, token)).get();
  if (!project) return null;
  const org = orgRow(db, project.orgId);
  const today = localDay(now, org.timeZone);
  const closed = Boolean(project.closedAt);
  const punch = db
    .select()
    .from(punchItems)
    .where(and(eq(punchItems.orgId, project.orgId), eq(punchItems.projectId, project.id), eq(punchItems.shared, 1)))
    .all()
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((item) => ({
      id: item.id,
      title: item.title,
      location: item.location ?? "",
      status: item.status,
      statusLabel: label(item.status),
      beforeDocumentId: item.beforeDocumentId,
      afterDocumentId: item.afterDocumentId,
    }));
  const rows = closed
    ? db.select().from(warrantyRequests).where(and(eq(warrantyRequests.orgId, project.orgId), eq(warrantyRequests.projectId, project.id))).all()
    : [];
  const photos = db.select().from(warrantyPhotos).where(eq(warrantyPhotos.orgId, project.orgId)).all();
  return {
    closed,
    open: closed && warrantyOpen(project.warrantyEndsOn, today),
    endsOn: closed ? project.warrantyEndsOn : null,
    punch,
    requests: rows
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description ?? "",
        urgency: row.urgency,
        urgencyLabel: label(row.urgency),
        status: row.status,
        statusLabel: label(row.status),
        visitDate: row.visitDate,
        clientNote: row.clientNote ?? "",
        photos: photos.filter((photo) => photo.requestId === row.id).sort((a, b) => a.sortOrder - b.sortOrder).map((photo) => photo.documentId),
      })),
  };
}

export function submitWarranty(input: {
  token: string;
  ip: string;
  honeypot: string;
  startedAt: string;
  title: string;
  description: string;
  urgency: string;
  photos: PhotoUpload[];
  now?: number;
}): { id: string } | { dropped: "honeypot" } {
  const nowMs = input.now ?? Date.now();
  const atIso = new Date(nowMs).toISOString();
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, input.token)).get();
  if (!project || !project.closedAt) throw new ServiceError("Warranty is closed.");
  const orgId = project.orgId;
  const org = orgRow(db, orgId);
  const today = localDay(nowMs, org.timeZone);
  if (!warrantyOpen(project.warrantyEndsOn, today)) throw new ServiceError("Warranty ended.");
  const ip = input.ip.slice(0, 80) || "local";
  if (honeypotTripped(input.honeypot)) {
    recordAttempt(db, orgId, ip, atIso);
    return { dropped: "honeypot" };
  }
  const fill = fillTimeError(Number(input.startedAt), nowMs);
  if (fill) {
    recordAttempt(db, orgId, ip, atIso);
    throw new ServiceError(fill);
  }
  const limited = rateLimitError({
    ipCount: attemptCount(db, orgId, new Date(nowMs - IP_WINDOW_MS).toISOString(), ip),
    orgCount: attemptCount(db, orgId, new Date(nowMs - ORG_WINDOW_MS).toISOString()),
  });
  if (limited) throw new ServiceError(limited);
  recordAttempt(db, orgId, ip, atIso);
  const title = cleanText(input.title, 160, "title", true);
  const description = cleanText(input.description, 4000, "Description", false);
  const urgency = (URGENCY as readonly string[]).includes(input.urgency) ? input.urgency : "normal";
  const photos = input.photos.filter((photo) => photo.bytes.length > 0);
  if (photos.length > MAX_PHOTOS) throw new ServiceError("Three photos at most.");
  for (const photo of photos) {
    const error = photoUploadError(photo.filename, photo.bytes);
    if (error) throw new ServiceError(error);
  }
  const requestId = id("wr");
  const stamp = nowIso();
  const stored = photos.map((photo) => storePhoto(orgId, project.id, photo, null, db));
  db.transaction((tx) => {
    tx.insert(warrantyRequests)
      .values({
        id: requestId,
        orgId,
        projectId: project.id,
        title,
        description: description || null,
        urgency,
        status: "submitted",
        visitDate: null,
        scheduleItemId: null,
        assigneeUserId: null,
        costCode: null,
        costItemId: null,
        clientNote: null,
        internalNote: null,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .run();
    stored.forEach((documentId, index) => {
      tx.insert(warrantyPhotos)
        .values({ id: id("wph"), orgId, requestId, documentId, sortOrder: index })
        .run();
    });
    writeAudit(tx, orgId, null, "warranty.submit", "warranty_request", requestId, { status: "submitted" }, ip);
  });
  return { id: requestId };
}

export const PUNCH_STATUSES = PUNCH_STATUS;
export const WARRANTY_STATUSES = WARRANTY_STATUS;
