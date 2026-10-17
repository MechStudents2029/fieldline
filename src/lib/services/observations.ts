import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb, type AppDatabase } from "@/lib/db/client";
import {
  auditLogs,
  contacts,
  documents,
  inspections,
  memberships,
  notifications,
  observationEvents,
  observationPhotos,
  observations,
  organizations,
  planPins,
  projects,
  safetyCheckItems,
  safetyChecks,
  scheduleItems,
  users,
  vendorCredits,
  vendorPortals,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canAddFieldNotes, canEditCrm, type Role } from "@/lib/permissions";
import { addWorkdays } from "@/lib/schedule/workdays";
import { appOrigin, photoExtension, photoUploadError, rasterImageType } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { draftObservationBackcharge } from "@/lib/services/vendor-credits";
import { localDay } from "@/lib/time/calendar";

const TYPES = ["quality", "safety", "commissioning", "environmental", "work_to_complete"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const LOCKED = new Set(["closed", "void"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const TYPE_LABEL: Record<string, string> = {
  quality: "Quality",
  safety: "Safety",
  commissioning: "Commissioning",
  environmental: "Environmental",
  work_to_complete: "Work to complete",
};

const PRIORITY_LABEL: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  open: "Open",
  ready: "Ready for review",
  closed: "Closed",
  void: "Void",
};

const ACTION_LABEL: Record<string, string> = {
  create: "Create",
  open: "Open",
  ready: "Ready for review",
  not_accepted: "Not accepted",
  close: "Closed",
  void: "Void",
  note: "Note",
  photo: "Photo",
  share: "Mark shared",
  copy: "Copy link",
  backcharge: "Backcharge",
};

export type ObservationInput = {
  projectId: string;
  title: string;
  type: string;
  priority: string;
  hazard?: string | null;
  location?: string | null;
  costCode?: string | null;
  trade?: string | null;
  assigneeUserId?: string | null;
  assigneeContactId?: string | null;
  dueDate?: string | null;
  description?: string | null;
  planPinId?: string | null;
  scheduleItemId?: string | null;
  inspectionId?: string | null;
  safetyCheckItemId?: string | null;
};

export type ObservationFilter = {
  type?: string;
  status?: string;
  priority?: string;
  vendorContactId?: string;
  projectId?: string;
};

export type PhotoUpload = { filename: string; bytes: Buffer };

type Database = AppDatabase;
type Row = typeof observations.$inferSelect;

function clean(value: string | null | undefined, max: number) {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function emptyToNull(value: string | null | undefined) {
  const text = clean(value, 80);
  return text.length > 0 ? text : null;
}

function assertOffice(actor: Actor) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot change this.");
}

function assertWriter(actor: Actor) {
  if (!canAddFieldNotes(actor.role as Role)) throw new ServiceError("Your role cannot change this.");
}

function audit(db: Database, actor: Actor, action: string, entityId: string, payload: unknown) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action,
      entityType: "observation",
      entityId,
      payloadJson: payload ? JSON.stringify(payload) : null,
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function orgZone(db: Database, orgId: string) {
  return db.select().from(organizations).where(eq(organizations.id, orgId)).get()?.timeZone ?? "America/New_York";
}

function todayFor(db: Database, orgId: string) {
  return localDay(Date.now(), orgZone(db, orgId));
}

function dayOf(stamp: string | null, zone: string) {
  if (!stamp) return null;
  const parsed = Date.parse(stamp);
  if (Number.isNaN(parsed)) return stamp.slice(0, 10);
  return localDay(parsed, zone);
}

function projectOf(db: Database, orgId: string, projectId: string) {
  return db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
}

function crewOf(db: Database, orgId: string) {
  return db
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
}

function vendorsOf(db: Database, orgId: string) {
  return db
    .select({ id: contacts.id, name: contacts.name, company: contacts.company, type: contacts.type })
    .from(contacts)
    .where(eq(contacts.orgId, orgId))
    .all()
    .filter((row) => row.type === "sub" || row.type === "vendor")
    .map((row) => ({ id: row.id, name: row.company?.trim() || row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function namesFor(db: Database, orgId: string) {
  return {
    crew: new Map(crewOf(db, orgId).map((person) => [person.id, person.name])),
    vendors: new Map(vendorsOf(db, orgId).map((vendor) => [vendor.id, vendor.name])),
    jobs: new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row.name])),
  };
}

function actorName(db: Database, orgId: string, userId: string) {
  const row = db
    .select({ name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .get();
  return row?.name ?? "";
}

function load(db: Database, orgId: string, observationId: string) {
  return db.select().from(observations).where(and(eq(observations.id, observationId), eq(observations.orgId, orgId))).get();
}

function nextNumber(db: Database, orgId: string, projectId: string) {
  const rows = db
    .select({ number: observations.number })
    .from(observations)
    .where(and(eq(observations.orgId, orgId), eq(observations.projectId, projectId)))
    .all();
  return rows.reduce((max, row) => Math.max(max, row.number), 0) + 1;
}

function dueOf(value: string | null | undefined) {
  const day = clean(value, 10);
  if (!day) return null;
  if (!DAY.test(day)) throw new ServiceError("Enter a due date.");
  return day;
}

function linksOf(db: Database, orgId: string, projectId: string, input: ObservationInput, observationId: string | null) {
  const planPinId = emptyToNull(input.planPinId);
  const scheduleItemId = emptyToNull(input.scheduleItemId);
  const inspectionId = emptyToNull(input.inspectionId);
  const safetyCheckItemId = emptyToNull(input.safetyCheckItemId);
  if (planPinId) {
    const pin = db.select().from(planPins).where(and(eq(planPins.id, planPinId), eq(planPins.orgId, orgId), eq(planPins.projectId, projectId))).get();
    if (!pin) throw new ServiceError("That plan pin is not on this job.");
    if (pin.linkType === "punch" || pin.linkType === "rfi") throw new ServiceError("That pin is already linked.");
    if (pin.linkType === "observation" && pin.linkId && pin.linkId !== observationId) throw new ServiceError("That pin is already linked.");
  }
  if (scheduleItemId) {
    const item = db.select().from(scheduleItems).where(and(eq(scheduleItems.id, scheduleItemId), eq(scheduleItems.orgId, orgId), eq(scheduleItems.projectId, projectId))).get();
    if (!item) throw new ServiceError("That schedule item is not on this job.");
  }
  if (inspectionId) {
    const row = db.select().from(inspections).where(and(eq(inspections.id, inspectionId), eq(inspections.orgId, orgId), eq(inspections.projectId, projectId))).get();
    if (!row) throw new ServiceError("That inspection is not on this job.");
  }
  if (safetyCheckItemId) {
    const item = db.select().from(safetyCheckItems).where(and(eq(safetyCheckItems.id, safetyCheckItemId), eq(safetyCheckItems.orgId, orgId))).get();
    const check = item ? db.select().from(safetyChecks).where(and(eq(safetyChecks.id, item.checkId), eq(safetyChecks.orgId, orgId))).get() : null;
    if (!item || !check || check.projectId !== projectId) throw new ServiceError("That checklist item is not on this job.");
  }
  return { planPinId, scheduleItemId, inspectionId, safetyCheckItemId };
}

function assignOf(db: Database, orgId: string, userId: string | null, contactId: string | null) {
  if (userId && contactId) throw new ServiceError("Assign a person or a vendor.");
  if (userId && !crewOf(db, orgId).some((person) => person.id === userId)) throw new ServiceError("Assign someone in this company.");
  if (contactId && !vendorsOf(db, orgId).some((vendor) => vendor.id === contactId)) throw new ServiceError("Assign a vendor in this company.");
  return { assigneeUserId: userId, assigneeContactId: contactId };
}

function parsed(db: Database, orgId: string, input: ObservationInput, observationId: string | null) {
  const project = projectOf(db, orgId, input.projectId);
  if (!project) throw new ServiceError("That job is not in your company.");
  const title = clean(input.title, 140);
  if (title.length < 2) throw new ServiceError("Enter a title.");
  if (!TYPES.includes(input.type as (typeof TYPES)[number])) throw new ServiceError("Pick a type.");
  if (!PRIORITIES.includes(input.priority as (typeof PRIORITIES)[number])) throw new ServiceError("Pick a priority.");
  const assigned = assignOf(db, orgId, emptyToNull(input.assigneeUserId), emptyToNull(input.assigneeContactId));
  return {
    projectId: project.id,
    title,
    type: input.type,
    priority: input.priority,
    hazard: input.type === "safety" ? clean(input.hazard, 80) : "",
    location: clean(input.location, 80),
    costCode: emptyToNull(input.costCode),
    trade: clean(input.trade, 80),
    ...assigned,
    dueDate: dueOf(input.dueDate),
    description: clean(input.description, 2000),
    ...linksOf(db, orgId, project.id, input, observationId),
  };
}

function bindPin(db: Database, orgId: string, observationId: string, planPinId: string | null) {
  if (!planPinId) return;
  db.update(planPins)
    .set({ linkType: "observation", linkId: observationId })
    .where(and(eq(planPins.id, planPinId), eq(planPins.orgId, orgId)))
    .run();
}

function record(db: Database, orgId: string, observationId: string, action: string, note: string, actorId: string | null, name: string) {
  db.insert(observationEvents)
    .values({
      id: id("oev"),
      orgId,
      observationId,
      action,
      note,
      actorId,
      actorName: name,
      createdAt: nowIso(),
    })
    .run();
}

function storePhoto(db: Database, orgId: string, projectId: string, upload: PhotoUpload, createdBy: string | null) {
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

function attachPhoto(db: Database, orgId: string, observationId: string, documentId: string, createdBy: string | null, name: string) {
  db.insert(observationPhotos)
    .values({ id: id("oph"), orgId, observationId, documentId, createdAt: nowIso(), createdBy })
    .run();
  record(db, orgId, observationId, "photo", "", createdBy, name);
}

function notifyOffice(db: Database, orgId: string, projectId: string, observationId: string, vendorName: string, snippet: string) {
  const owners = db
    .select({ id: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.orgId, orgId))
    .all()
    .filter((row) => row.role === "owner" || row.role === "admin");
  const stamp = nowIso();
  for (const owner of owners) {
    db.insert(notifications)
      .values({
        id: id("note"),
        orgId,
        userId: owner.id,
        kind: "observation",
        commentId: null,
        entityType: "observation",
        entityId: observationId,
        projectId,
        actorId: null,
        actorName: vendorName,
        snippet,
        readAt: null,
        createdAt: stamp,
      })
      .run();
  }
}

function insertRow(db: Database, actor: Actor, input: ObservationInput, status: "draft" | "open", assigneeUserId: string | null) {
  const fields = parsed(db, actor.orgId, { ...input, assigneeUserId: assigneeUserId ?? input.assigneeUserId }, null);
  const now = nowIso();
  const observationId = id("obs");
  const number = nextNumber(db, actor.orgId, fields.projectId);
  db.insert(observations)
    .values({
      id: observationId,
      orgId: actor.orgId,
      projectId: fields.projectId,
      number,
      title: fields.title,
      type: fields.type,
      priority: fields.priority,
      hazard: fields.hazard,
      location: fields.location,
      costCode: fields.costCode,
      trade: fields.trade,
      assigneeUserId: fields.assigneeUserId,
      assigneeContactId: fields.assigneeContactId,
      dueDate: fields.dueDate,
      description: fields.description,
      planPinId: fields.planPinId,
      scheduleItemId: fields.scheduleItemId,
      inspectionId: fields.inspectionId,
      safetyCheckItemId: fields.safetyCheckItemId,
      status,
      rejectNote: "",
      voidReason: null,
      openedAt: status === "open" ? now : null,
      readyAt: null,
      closedAt: null,
      voidedAt: null,
      sharedAt: null,
      sharedBy: null,
      copiedAt: null,
      copiedBy: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  bindPin(db, actor.orgId, observationId, fields.planPinId);
  const name = actorName(db, actor.orgId, actor.userId);
  record(db, actor.orgId, observationId, "create", "", actor.userId, name);
  if (status === "open") record(db, actor.orgId, observationId, "open", "", actor.userId, name);
  audit(db, actor, "observation.create", observationId, { number, status });
  return { id: observationId, number };
}

export function createObservation(actor: Actor, input: ObservationInput) {
  assertWriter(actor);
  const db = getDb();
  if (canEditCrm(actor.role as Role)) return insertRow(db, actor, input, "draft", null);
  const userId = emptyToNull(input.assigneeUserId) ?? (emptyToNull(input.assigneeContactId) ? null : actor.userId);
  return insertRow(db, actor, input, "open", userId);
}

export function saveObservation(actor: Actor, observationId: string, input: ObservationInput) {
  assertOffice(actor);
  const db = getDb();
  const row = load(db, actor.orgId, observationId);
  if (!row) throw new ServiceError("Observation not found.");
  if (LOCKED.has(row.status)) throw new ServiceError("This observation is locked.");
  const fields = parsed(db, actor.orgId, { ...input, projectId: row.projectId }, row.id);
  db.update(observations)
    .set({
      title: fields.title,
      type: fields.type,
      priority: fields.priority,
      hazard: fields.hazard,
      location: fields.location,
      costCode: fields.costCode,
      trade: fields.trade,
      assigneeUserId: fields.assigneeUserId,
      assigneeContactId: fields.assigneeContactId,
      dueDate: fields.dueDate,
      description: fields.description,
      planPinId: fields.planPinId,
      scheduleItemId: fields.scheduleItemId,
      inspectionId: fields.inspectionId,
      safetyCheckItemId: fields.safetyCheckItemId,
      updatedAt: nowIso(),
    })
    .where(and(eq(observations.id, row.id), eq(observations.orgId, actor.orgId)))
    .run();
  bindPin(db, actor.orgId, row.id, fields.planPinId);
  audit(db, actor, "observation.save", row.id, { number: row.number });
  return { id: row.id };
}

function setStatus(db: Database, actor: Actor, row: Row, status: string, patch: Partial<Row>, action: string, note: string) {
  const now = nowIso();
  db.update(observations)
    .set({ status, ...patch, updatedAt: now })
    .where(and(eq(observations.id, row.id), eq(observations.orgId, actor.orgId)))
    .run();
  record(db, actor.orgId, row.id, action, note, actor.userId, actorName(db, actor.orgId, actor.userId));
  audit(db, actor, `observation.${action}`, row.id, { from: row.status, status });
}

export function openObservation(actor: Actor, observationId: string) {
  assertOffice(actor);
  const db = getDb();
  const row = load(db, actor.orgId, observationId);
  if (!row) throw new ServiceError("Observation not found.");
  if (row.status !== "draft") throw new ServiceError("Only a draft can be opened.");
  setStatus(db, actor, row, "open", { openedAt: nowIso(), rejectNote: "" }, "open", "");
  return { id: row.id };
}

export function markObservationReady(actor: Actor, observationId: string) {
  assertWriter(actor);
  const db = getDb();
  const row = load(db, actor.orgId, observationId);
  if (!row) throw new ServiceError("Observation not found.");
  if (row.status !== "open") throw new ServiceError("Only an open observation can be marked ready.");
  const office = canEditCrm(actor.role as Role);
  if (!office && row.assigneeUserId !== actor.userId) throw new ServiceError("Your role cannot change this.");
  setStatus(db, actor, row, "ready", { readyAt: nowIso() }, "ready", "");
  return { id: row.id };
}

export function notAcceptObservation(actor: Actor, observationId: string, note: string) {
  assertOffice(actor);
  const db = getDb();
  const row = load(db, actor.orgId, observationId);
  if (!row) throw new ServiceError("Observation not found.");
  if (row.status !== "ready") throw new ServiceError("Only a review can be sent back.");
  const text = clean(note, 500);
  if (text.length < 2) throw new ServiceError("Enter a note.");
  setStatus(db, actor, row, "open", { rejectNote: text, readyAt: null }, "not_accepted", text);
  return { id: row.id };
}

export function closeObservation(actor: Actor, observationId: string) {
  assertOffice(actor);
  const db = getDb();
  const row = load(db, actor.orgId, observationId);
  if (!row) throw new ServiceError("Observation not found.");
  if (row.status !== "ready") throw new ServiceError("Review it before closing.");
  setStatus(db, actor, row, "closed", { closedAt: nowIso() }, "close", "");
  return { id: row.id };
}

export function voidObservation(actor: Actor, observationId: string, reason: string) {
  assertOffice(actor);
  const db = getDb();
  const row = load(db, actor.orgId, observationId);
  if (!row) throw new ServiceError("Observation not found.");
  if (LOCKED.has(row.status)) throw new ServiceError("This observation is locked.");
  const text = clean(reason, 500);
  if (text.length < 2) throw new ServiceError("Enter a reason.");
  setStatus(db, actor, row, "void", { voidReason: text, voidedAt: nowIso() }, "void", text);
  return { id: row.id };
}

export function addObservationNote(actor: Actor, observationId: string, note: string) {
  assertWriter(actor);
  const db = getDb();
  const row = load(db, actor.orgId, observationId);
  if (!row) throw new ServiceError("Observation not found.");
  if (LOCKED.has(row.status)) throw new ServiceError("This observation is locked.");
  const text = clean(note, 500);
  if (text.length < 2) throw new ServiceError("Enter a note.");
  record(db, actor.orgId, row.id, "note", text, actor.userId, actorName(db, actor.orgId, actor.userId));
  audit(db, actor, "observation.note", row.id, {});
  return { id: row.id };
}

export function addObservationPhoto(actor: Actor, observationId: string, upload: PhotoUpload) {
  assertWriter(actor);
  const db = getDb();
  const row = load(db, actor.orgId, observationId);
  if (!row) throw new ServiceError("Observation not found.");
  if (LOCKED.has(row.status)) throw new ServiceError("This observation is locked.");
  const documentId = storePhoto(db, actor.orgId, row.projectId, upload, actor.userId);
  attachPhoto(db, actor.orgId, row.id, documentId, actor.userId, actorName(db, actor.orgId, actor.userId));
  audit(db, actor, "observation.photo", row.id, { documentId });
  return { id: row.id, documentId };
}

export function copyObservationLink(actor: Actor, observationId: string) {
  assertOffice(actor);
  const db = getDb();
  const row = load(db, actor.orgId, observationId);
  if (!row) throw new ServiceError("Observation not found.");
  const now = nowIso();
  db.update(observations).set({ copiedAt: now, copiedBy: actor.userId, updatedAt: now }).where(and(eq(observations.id, row.id), eq(observations.orgId, actor.orgId))).run();
  record(db, actor.orgId, row.id, "copy", "", actor.userId, actorName(db, actor.orgId, actor.userId));
  audit(db, actor, "observation.copy", row.id, {});
  return { id: row.id };
}

export function markObservationShared(actor: Actor, observationId: string) {
  assertOffice(actor);
  const db = getDb();
  const row = load(db, actor.orgId, observationId);
  if (!row) throw new ServiceError("Observation not found.");
  const now = nowIso();
  db.update(observations).set({ sharedAt: now, sharedBy: actor.userId, updatedAt: now }).where(and(eq(observations.id, row.id), eq(observations.orgId, actor.orgId))).run();
  record(db, actor.orgId, row.id, "share", "", actor.userId, actorName(db, actor.orgId, actor.userId));
  audit(db, actor, "observation.share", row.id, {});
  return { id: row.id };
}

export function createObservationBackcharge(actor: Actor, observationId: string) {
  assertOffice(actor);
  const db = getDb();
  const row = load(db, actor.orgId, observationId);
  if (!row) throw new ServiceError("Observation not found.");
  if (row.type !== "quality") throw new ServiceError("Only a quality observation can start a backcharge.");
  if (row.status !== "open" && row.status !== "closed") throw new ServiceError("Open or close it before a backcharge.");
  if (!row.assigneeContactId) throw new ServiceError("Assign a vendor first.");
  const photo = db
    .select()
    .from(observationPhotos)
    .where(and(eq(observationPhotos.orgId, actor.orgId), eq(observationPhotos.observationId, row.id)))
    .all()[0];
  const credit = draftObservationBackcharge(actor, {
    projectId: row.projectId,
    vendorContactId: row.assigneeContactId,
    reason: row.title,
    costCode: row.costCode,
    sourceKey: `observation:${row.id}`,
    documentId: photo?.documentId ?? null,
  });
  if (!credit.existing) record(db, actor.orgId, row.id, "backcharge", credit.number, actor.userId, actorName(db, actor.orgId, actor.userId));
  return credit;
}

function openFrom(actor: Actor, input: ObservationInput) {
  assertOffice(actor);
  return insertRow(getDb(), actor, input, "open", emptyToNull(input.assigneeUserId));
}

export function linkObservationFromCheck(actor: Actor, itemId: string) {
  assertOffice(actor);
  const db = getDb();
  const item = db.select().from(safetyCheckItems).where(and(eq(safetyCheckItems.id, itemId), eq(safetyCheckItems.orgId, actor.orgId))).get();
  if (!item) throw new ServiceError("That item is not in your company.");
  if (item.result !== "fail") throw new ServiceError("Only a failed item opens an observation.");
  const check = db.select().from(safetyChecks).where(and(eq(safetyChecks.id, item.checkId), eq(safetyChecks.orgId, actor.orgId))).get();
  if (!check || check.voidedAt) throw new ServiceError("That checklist is not in your company.");
  if (item.observationId) return { id: item.observationId, existing: true };
  const created = openFrom(actor, {
    projectId: check.projectId,
    title: item.title,
    type: "safety",
    priority: "high",
    description: item.title,
    safetyCheckItemId: item.id,
    assigneeUserId: actor.userId,
  });
  db.update(safetyCheckItems).set({ observationId: created.id }).where(and(eq(safetyCheckItems.id, item.id), eq(safetyCheckItems.orgId, actor.orgId))).run();
  return { id: created.id, existing: false };
}

export function linkObservationFromInspection(actor: Actor, inspectionId: string) {
  assertOffice(actor);
  const db = getDb();
  const row = db.select().from(inspections).where(and(eq(inspections.id, inspectionId), eq(inspections.orgId, actor.orgId))).get();
  if (!row) throw new ServiceError("That inspection is not on this job.");
  if (row.result !== "failed") throw new ServiceError("Only a failed inspection opens an observation.");
  if (row.observationId) return { id: row.observationId, existing: true };
  const created = openFrom(actor, {
    projectId: row.projectId,
    title: row.name,
    type: "quality",
    priority: "high",
    description: row.notes,
    inspectionId: row.id,
  });
  db.update(inspections).set({ observationId: created.id }).where(and(eq(inspections.id, row.id), eq(inspections.orgId, actor.orgId))).run();
  return { id: created.id, existing: false };
}

function reviewCutoff(db: Database, orgId: string) {
  return addWorkdays(todayFor(db, orgId), -2);
}

function rowView(row: Row, names: ReturnType<typeof namesFor>, zone: string, today: string, cutoff: string) {
  const readyDay = dayOf(row.readyAt, zone);
  const overdue = row.status === "open" && row.dueDate != null && row.dueDate < today;
  const reviewAged = row.status === "ready" && readyDay != null && readyDay < cutoff;
  return {
    id: row.id,
    number: row.number,
    projectId: row.projectId,
    job: names.jobs.get(row.projectId) ?? "",
    title: row.title,
    type: row.type,
    typeLabel: TYPE_LABEL[row.type] ?? row.type,
    priority: row.priority,
    priorityLabel: PRIORITY_LABEL[row.priority] ?? row.priority,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status] ?? row.status,
    hazard: row.hazard,
    location: row.location,
    costCode: row.costCode,
    trade: row.trade,
    assigneeUserId: row.assigneeUserId,
    assigneeContactId: row.assigneeContactId,
    assignee: row.assigneeUserId ? names.crew.get(row.assigneeUserId) ?? "" : "",
    vendor: row.assigneeContactId ? names.vendors.get(row.assigneeContactId) ?? "" : "",
    dueDate: row.dueDate,
    description: row.description,
    overdue,
    reviewAged,
    readyDay,
    rejectNote: row.rejectNote,
    voidReason: row.voidReason,
  };
}

export function listObservations(actor: Actor, filter: ObservationFilter = {}) {
  const db = getDb();
  const names = namesFor(db, actor.orgId);
  const zone = orgZone(db, actor.orgId);
  const today = todayFor(db, actor.orgId);
  const cutoff = reviewCutoff(db, actor.orgId);
  return db
    .select()
    .from(observations)
    .where(eq(observations.orgId, actor.orgId))
    .all()
    .map((row) => rowView(row, names, zone, today, cutoff))
    .filter((row) => {
      if (filter.projectId && row.projectId !== filter.projectId) return false;
      if (filter.type && row.type !== filter.type) return false;
      if (filter.priority && row.priority !== filter.priority) return false;
      if (filter.vendorContactId && row.assigneeContactId !== filter.vendorContactId) return false;
      if (filter.status === "overdue") return row.overdue;
      if (filter.status === "review") return row.reviewAged;
      if (filter.status && row.status !== filter.status) return false;
      return true;
    })
    .sort((a, b) => a.job.localeCompare(b.job) || a.number - b.number);
}

export function observationChoices(actor: Actor) {
  const db = getDb();
  return {
    jobs: db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.orgId, actor.orgId))
      .all()
      .sort((a, b) => a.name.localeCompare(b.name)),
    vendors: vendorsOf(db, actor.orgId),
    crew: crewOf(db, actor.orgId),
    types: TYPES.map((value) => ({ value, label: TYPE_LABEL[value] ?? value })),
    priorities: PRIORITIES.map((value) => ({ value, label: PRIORITY_LABEL[value] ?? value })),
  };
}

export function observationDetail(actor: Actor, observationId: string) {
  const db = getDb();
  const row = load(db, actor.orgId, observationId);
  if (!row) return null;
  const names = namesFor(db, actor.orgId);
  const zone = orgZone(db, actor.orgId);
  const view = rowView(row, names, zone, todayFor(db, actor.orgId), reviewCutoff(db, actor.orgId));
  const office = canEditCrm(actor.role as Role);
  const locked = LOCKED.has(row.status);
  const photos = db
    .select()
    .from(observationPhotos)
    .where(and(eq(observationPhotos.orgId, actor.orgId), eq(observationPhotos.observationId, row.id)))
    .all()
    .map((photo) => ({ id: photo.id, documentId: photo.documentId }));
  const events = db
    .select()
    .from(observationEvents)
    .where(and(eq(observationEvents.orgId, actor.orgId), eq(observationEvents.observationId, row.id)))
    .all()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((event) => ({
      id: event.id,
      action: event.action,
      label: ACTION_LABEL[event.action] ?? event.action,
      note: event.note,
      actorName: event.actorName,
      createdAt: event.createdAt,
    }));
  const credit = db
    .select()
    .from(vendorCredits)
    .where(and(eq(vendorCredits.orgId, actor.orgId), eq(vendorCredits.sourceKey, `observation:${row.id}`)))
    .all()
    .find((item) => item.status !== "void");
  const portal = row.assigneeContactId
    ? db.select().from(vendorPortals).where(and(eq(vendorPortals.orgId, actor.orgId), eq(vendorPortals.contactId, row.assigneeContactId))).get()
    : null;
  const origin = appOrigin(process.env);
  const pins = db.select().from(planPins).where(and(eq(planPins.orgId, actor.orgId), eq(planPins.projectId, row.projectId))).all();
  const schedule = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, row.projectId))).all();
  const inspectionRows = db.select().from(inspections).where(and(eq(inspections.orgId, actor.orgId), eq(inspections.projectId, row.projectId))).all();
  const checks = db.select().from(safetyChecks).where(and(eq(safetyChecks.orgId, actor.orgId), eq(safetyChecks.projectId, row.projectId))).all();
  const checkIds = new Set(checks.map((check) => check.id));
  const checkItems = db
    .select()
    .from(safetyCheckItems)
    .where(eq(safetyCheckItems.orgId, actor.orgId))
    .all()
    .filter((item) => checkIds.has(item.checkId));
  return {
    ...view,
    planPinId: row.planPinId,
    scheduleItemId: row.scheduleItemId,
    inspectionId: row.inspectionId,
    safetyCheckItemId: row.safetyCheckItemId,
    sharedAt: row.sharedAt,
    copiedAt: row.copiedAt,
    openedAt: row.openedAt,
    readyAt: row.readyAt,
    closedAt: row.closedAt,
    voidedAt: row.voidedAt,
    locked,
    canEdit: office && !locked,
    canOpen: office && row.status === "draft",
    canReady: !locked && row.status === "open" && (office || row.assigneeUserId === actor.userId),
    canReject: office && row.status === "ready",
    canClose: office && row.status === "ready",
    canVoid: office && !locked,
    canBackcharge: office && row.type === "quality" && (row.status === "open" || row.status === "closed") && row.assigneeContactId != null,
    backcharge: credit ? { id: credit.id, number: credit.number, status: credit.status } : null,
    portalUrl: portal?.issuedToken && origin ? `${origin}/v/${portal.issuedToken}` : null,
    photos,
    events,
    pins: pins.map((pin) => ({ id: pin.id, number: pin.number, note: pin.note })),
    schedule: schedule.map((item) => ({ id: item.id, title: item.title })).sort((a, b) => a.title.localeCompare(b.title)),
    inspections: inspectionRows.map((item) => ({ id: item.id, name: item.name })),
    checks: checkItems.map((item) => ({ id: item.id, title: item.title })),
    ...observationChoices(actor),
  };
}

export function observationsCsv(actor: Actor, filter: ObservationFilter = {}) {
  const rows = listObservations(actor, filter);
  const header = ["Number", "Job", "Title", "Type", "Priority", "Status", "Vendor", "Due", "Location"];
  const lines = rows.map((row) => [String(row.number), row.job, row.title, row.typeLabel, row.priorityLabel, row.statusLabel, row.vendor, row.dueDate ?? "", row.location]);
  return [header, ...lines]
    .map((line) => line.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","))
    .join("\n");
}

export function observationAttention(actor: Actor) {
  const empty = { count: 0, href: null as string | null };
  if (actor.role === "field") return { overdue: empty, review: empty };
  const rows = listObservations(actor, {});
  const overdue = rows.filter((row) => row.overdue);
  const review = rows.filter((row) => row.reviewAged);
  return {
    overdue: { count: overdue.length, href: overdue.length ? "/observations?filter=overdue" : null },
    review: { count: review.length, href: review.length ? "/observations?filter=review" : null },
  };
}

export function fieldObservations(actor: Actor) {
  const db = getDb();
  const rows = listObservations(actor, {}).filter((row) => row.assigneeUserId === actor.userId && (row.status === "open" || row.status === "ready"));
  return {
    items: rows,
    jobs: db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.orgId, actor.orgId))
      .all()
      .filter((row) => row.name.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name)),
    types: TYPES.map((value) => ({ value, label: TYPE_LABEL[value] ?? value })),
  };
}

export function portalObservationRows(orgId: string, contactId: string) {
  const db = getDb();
  const names = namesFor(db, orgId);
  return db
    .select()
    .from(observations)
    .where(and(eq(observations.orgId, orgId), eq(observations.assigneeContactId, contactId), eq(observations.status, "open")))
    .all()
    .sort((a, b) => a.number - b.number)
    .map((row) => ({
      id: row.id,
      number: row.number,
      job: names.jobs.get(row.projectId) ?? "",
      title: row.title,
      typeLabel: TYPE_LABEL[row.type] ?? row.type,
      priorityLabel: PRIORITY_LABEL[row.priority] ?? row.priority,
      dueDate: row.dueDate,
      location: row.location,
      hazard: row.hazard,
      description: row.description,
      rejectNote: row.rejectNote,
      statusLabel: STATUS_LABEL[row.status] ?? row.status,
    }));
}

export function portalReadyObservation(
  orgId: string,
  contactId: string,
  vendorName: string,
  observationId: string,
  input: { note: string; photo?: PhotoUpload | null },
) {
  const db = getDb();
  const row = db
    .select()
    .from(observations)
    .where(and(eq(observations.id, observationId), eq(observations.orgId, orgId), eq(observations.assigneeContactId, contactId)))
    .get();
  if (!row || row.status !== "open") throw new ServiceError("Observation not found.");
  const note = clean(input.note, 500);
  if (note.length < 2) throw new ServiceError("Enter a note.");
  const now = nowIso();
  record(db, orgId, row.id, "note", note, null, vendorName);
  if (input.photo && input.photo.bytes.length > 0) {
    const documentId = storePhoto(db, orgId, row.projectId, input.photo, null);
    db.update(documents).set({ contactId }).where(and(eq(documents.id, documentId), eq(documents.orgId, orgId))).run();
    attachPhoto(db, orgId, row.id, documentId, null, vendorName);
  }
  db.update(observations)
    .set({ status: "ready", readyAt: now, rejectNote: "", updatedAt: now })
    .where(and(eq(observations.id, row.id), eq(observations.orgId, orgId)))
    .run();
  record(db, orgId, row.id, "ready", note, null, vendorName);
  notifyOffice(db, orgId, row.projectId, row.id, vendorName, note);
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId: null,
      action: "observation.ready",
      entityType: "observation",
      entityId: row.id,
      payloadJson: JSON.stringify({ vendor: vendorName }),
      ip: null,
      createdAt: now,
    })
    .run();
  return { id: row.id };
}

export function observationPrintRows(actor: Actor, filter: ObservationFilter = {}) {
  return listObservations(actor, filter);
}
