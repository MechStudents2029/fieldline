import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  dailyLogPhotos,
  dailyLogs,
  documents,
  jobFiles,
  markups,
  messageThreads,
  messages,
  planPins,
  projects,
  punchItems,
  rfiFiles,
  rfis,
  taskAssignees,
  tasks,
  users,
  vendorPortals,
} from "@/lib/db/schema";
import { emptyMarkupLayer, parseMarkupLayer, type MarkupLayer } from "@/lib/markup/layer";
import { id, nowIso } from "@/lib/ids";
import { canAddFieldNotes, type Role } from "@/lib/permissions";
import { attachmentExtension, attachmentUploadError } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { hashVendorToken } from "@/lib/vendor/token";

export type PinLinkType = "punch" | "rfi" | "todo";

export type PinView = {
  id: string;
  number: number;
  xMilli: number;
  yMilli: number;
  linkType: PinLinkType;
  linkId: string;
  title: string;
  status: string;
  statusLabel: string;
  tone: "open" | "done" | "verified";
  href: string;
  cropDocumentId: string | null;
  note: string;
  reviewed: boolean;
  copied: boolean;
};

export type MarkupView = {
  id: string;
  layer: MarkupLayer;
  sourceDocumentId: string;
  flatDocumentId: string;
  sourceHref: string;
  flatHref: string;
  author: string;
  at: string;
};

export type PlanBoard = {
  projectId: string;
  projectName: string;
  fileId: string;
  name: string;
  revision: number;
  current: boolean;
  readOnly: boolean;
  documentHref: string;
  kind: "pdf" | "image";
  markup: MarkupView | null;
  pins: PinView[];
  unreviewed: number;
  punches: { id: string; title: string }[];
  rfis: { id: string; title: string }[];
  todos: { id: string; title: string }[];
  canEdit: boolean;
};

export type PhotoBoard = {
  projectId: string;
  projectName: string;
  documentId: string;
  name: string;
  href: string;
  markup: MarkupView | null;
  canEdit: boolean;
};

export type RecordVisual = {
  cropDocumentId: string | null;
  cropHref: string | null;
  pinNumber: number | null;
  planHref: string | null;
  photoDocumentId: string | null;
  flatDocumentId: string | null;
  flatHref: string | null;
  sourceHref: string | null;
  marked: boolean;
};

export type PortalPin = {
  id: string;
  number: number;
  projectId: string;
  linkType: PinLinkType;
  linkId: string;
  title: string;
  status: string;
  statusLabel: string;
  cropDocumentId: string | null;
};

export type PortalMarkup = {
  sourceDocumentId: string;
  flatDocumentId: string;
};

type LinkHit = {
  title: string;
  status: string;
  statusLabel: string;
  tone: "open" | "done" | "verified";
  href: string;
  contactId: string | null;
  shared: boolean;
};

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function assertEditor(actor: Actor) {
  if (!canAddFieldNotes(actor.role as Role)) throw new ServiceError("Your role cannot mark this up.");
}

function hrefFor(storagePath: string, documentId: string) {
  return storagePath.startsWith("/") ? storagePath : `/api/files/${documentId}`;
}

function storeVisual(db: AppDatabase, orgId: string, projectId: string, filename: string, bytes: Buffer, type: string, createdBy: string | null) {
  const error = attachmentUploadError(filename, bytes);
  if (error) throw new ServiceError(error);
  const documentId = id("doc");
  const ext = attachmentExtension(bytes);
  const relative = path.join("uploads", orgId, `${documentId}.${ext}`);
  fs.mkdirSync(path.dirname(path.join(dataDir(), relative)), { recursive: true });
  fs.writeFileSync(path.join(dataDir(), relative), bytes);
  db.insert(documents)
    .values({
      id: documentId,
      orgId,
      projectId,
      leadId: null,
      contactId: null,
      type,
      filename: path.basename(filename).slice(0, 80),
      storagePath: relative,
      metadataJson: null,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy,
    })
    .run();
  return documentId;
}

function writeAudit(db: AppDatabase, orgId: string, actorId: string | null, action: string, entityType: string, entityId: string, payload: Record<string, unknown>) {
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

function toneOf(status: string): "open" | "done" | "verified" {
  if (status === "verified") return "verified";
  if (status === "done" || status === "closed" || status === "answered") return "done";
  return "open";
}

function punchLabel(status: string) {
  if (status === "done") return "Done";
  if (status === "verified") return "Verified";
  return "Open";
}

function rfiLabel(status: string) {
  if (status === "answered") return "Answered";
  if (status === "closed") return "Closed";
  if (status === "void") return "Void";
  return "Open";
}

function todoLabel(status: string) {
  return status === "done" ? "Done" : "Open";
}

function resolveLink(db: AppDatabase, orgId: string, projectId: string, linkType: string, linkId: string): LinkHit | null {
  if (linkType === "punch") {
    const row = db.select().from(punchItems).where(and(eq(punchItems.id, linkId), eq(punchItems.orgId, orgId), eq(punchItems.projectId, projectId))).get();
    if (!row) return null;
    return {
      title: row.title,
      status: row.status,
      statusLabel: punchLabel(row.status),
      tone: toneOf(row.status),
      href: `/projects/${projectId}/punch/${row.id}`,
      contactId: row.assigneeContactId,
      shared: row.shared === 1,
    };
  }
  if (linkType === "rfi") {
    const row = db.select().from(rfis).where(and(eq(rfis.id, linkId), eq(rfis.orgId, orgId), eq(rfis.projectId, projectId))).get();
    if (!row || row.status === "void") return null;
    return {
      title: row.title,
      status: row.status,
      statusLabel: rfiLabel(row.status),
      tone: toneOf(row.status),
      href: `/projects/${projectId}/rfis/${row.id}`,
      contactId: row.assigneeContactId,
      shared: row.assigneeKind === "client",
    };
  }
  if (linkType === "todo") {
    const row = db.select().from(tasks).where(and(eq(tasks.id, linkId), eq(tasks.orgId, orgId))).get();
    if (!row || row.relatedType !== "project" || row.relatedId !== projectId) return null;
    const vendor = db
      .select()
      .from(taskAssignees)
      .where(and(eq(taskAssignees.orgId, orgId), eq(taskAssignees.taskId, row.id)))
      .all()
      .find((assignee) => assignee.contactId);
    return {
      title: row.title,
      status: row.status,
      statusLabel: todoLabel(row.status),
      tone: toneOf(row.status),
      href: `/todos`,
      contactId: vendor?.contactId ?? null,
      shared: false,
    };
  }
  return null;
}

function markupView(db: AppDatabase, row: typeof markups.$inferSelect): MarkupView {
  const source = db.select().from(documents).where(and(eq(documents.id, row.sourceDocumentId), eq(documents.orgId, row.orgId))).get();
  const flat = db.select().from(documents).where(and(eq(documents.id, row.flatDocumentId), eq(documents.orgId, row.orgId))).get();
  const actorId = row.updatedBy ?? row.createdBy;
  const person = actorId ? db.select().from(users).where(eq(users.id, actorId)).get() : undefined;
  const layer = parseMarkupLayer(JSON.parse(row.layerJson)) ?? emptyMarkupLayer();
  return {
    id: row.id,
    layer,
    sourceDocumentId: row.sourceDocumentId,
    flatDocumentId: row.flatDocumentId,
    sourceHref: source ? hrefFor(source.storagePath, source.id) : `/api/files/${row.sourceDocumentId}`,
    flatHref: flat ? hrefFor(flat.storagePath, flat.id) : `/api/files/${row.flatDocumentId}`,
    author: person?.name ?? "",
    at: row.updatedAt,
  };
}

function pinsOnFile(db: AppDatabase, orgId: string, projectId: string, jobFileId: string, office: boolean): PinView[] {
  return db
    .select()
    .from(planPins)
    .where(and(eq(planPins.orgId, orgId), eq(planPins.jobFileId, jobFileId)))
    .all()
    .sort((a, b) => a.number - b.number)
    .flatMap((row) => {
      const link = resolveLink(db, orgId, projectId, row.linkType, row.linkId);
      if (!link || (row.linkType !== "punch" && row.linkType !== "rfi" && row.linkType !== "todo")) return [];
      return [
        {
          id: row.id,
          number: row.number,
          xMilli: row.xMilli,
          yMilli: row.yMilli,
          linkType: row.linkType,
          linkId: row.linkId,
          title: link.title,
          status: link.status,
          statusLabel: link.statusLabel,
          tone: link.tone,
          href: link.href,
          cropDocumentId: row.cropDocumentId,
          note: office ? row.note : "",
          reviewed: row.reviewed === 1,
          copied: Boolean(row.copiedFromId),
        },
      ];
    });
}

export function saveMarkup(
  actor: Actor,
  input: { projectId: string; targetType: string; targetId: string; page?: number; layer: unknown; flat: { filename: string; bytes: Buffer } },
) {
  assertEditor(actor);
  const layer = parseMarkupLayer(input.layer);
  if (!layer) throw new ServiceError("That markup could not be saved.");
  const db = dbFor(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  const page = input.page && input.page > 0 ? input.page : 1;
  let sourceId = input.targetId;
  if (input.targetType === "plan") {
    const file = db.select().from(jobFiles).where(and(eq(jobFiles.id, input.targetId), eq(jobFiles.orgId, actor.orgId), eq(jobFiles.projectId, project.id))).get();
    if (!file || file.deletedAt) throw new ServiceError("Plan not found.");
    if (file.isCurrent !== 1) throw new ServiceError("This revision is read-only.");
    sourceId = file.documentId;
  } else if (input.targetType === "photo") {
    const document = db.select().from(documents).where(and(eq(documents.id, input.targetId), eq(documents.orgId, actor.orgId), eq(documents.projectId, project.id))).get();
    if (!document || document.deletedAt) throw new ServiceError("Photo not found.");
  } else {
    throw new ServiceError("Pick a photo or a plan.");
  }
  const sourceBefore = db.select().from(documents).where(and(eq(documents.id, sourceId), eq(documents.orgId, actor.orgId))).get();
  if (!sourceBefore) throw new ServiceError("Photo not found.");
  const flatId = storeVisual(db, actor.orgId, project.id, input.flat.filename, input.flat.bytes, "markup", actor.userId);
  const now = nowIso();
  const existing = db
    .select()
    .from(markups)
    .where(and(eq(markups.orgId, actor.orgId), eq(markups.targetType, input.targetType), eq(markups.targetId, input.targetId), eq(markups.page, page)))
    .get();
  const markupId = existing?.id ?? id("mk");
  if (existing) {
    db.update(markups)
      .set({ layerJson: JSON.stringify(layer), flatDocumentId: flatId, updatedAt: now, updatedBy: actor.userId })
      .where(and(eq(markups.id, existing.id), eq(markups.orgId, actor.orgId)))
      .run();
  } else {
    db.insert(markups)
      .values({
        id: markupId,
        orgId: actor.orgId,
        projectId: project.id,
        targetType: input.targetType,
        targetId: input.targetId,
        sourceDocumentId: sourceId,
        page,
        layerJson: JSON.stringify(layer),
        flatDocumentId: flatId,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .run();
  }
  const sourceAfter = db.select().from(documents).where(and(eq(documents.id, sourceId), eq(documents.orgId, actor.orgId))).get();
  if (!sourceAfter || sourceAfter.storagePath !== sourceBefore.storagePath || sourceAfter.filename !== sourceBefore.filename) {
    throw new ServiceError("The original file changed.");
  }
  writeAudit(db, actor.orgId, actor.userId, "markup.save", "markup", markupId, { targetType: input.targetType, targetId: input.targetId, page });
  return { id: markupId, flatDocumentId: flatId };
}

export function placePin(
  actor: Actor,
  input: {
    projectId: string;
    jobFileId: string;
    xMilli: number;
    yMilli: number;
    linkType: string;
    linkId: string;
    note?: string;
    crop?: { filename: string; bytes: Buffer } | null;
  },
) {
  assertEditor(actor);
  if (!Number.isInteger(input.xMilli) || !Number.isInteger(input.yMilli) || input.xMilli < 0 || input.yMilli < 0 || input.xMilli > 1000 || input.yMilli > 1000) {
    throw new ServiceError("Drop the pin on the plan.");
  }
  if (input.linkType !== "punch" && input.linkType !== "rfi" && input.linkType !== "todo") throw new ServiceError("Link a punch item, an RFI, or a to-do.");
  const db = dbFor(actor);
  const file = db.select().from(jobFiles).where(and(eq(jobFiles.id, input.jobFileId), eq(jobFiles.orgId, actor.orgId), eq(jobFiles.projectId, input.projectId))).get();
  if (!file || file.deletedAt) throw new ServiceError("Plan not found.");
  if (file.isCurrent !== 1) throw new ServiceError("This revision is read-only.");
  const link = resolveLink(db, actor.orgId, input.projectId, input.linkType, input.linkId);
  if (!link) throw new ServiceError("That item is not on this job.");
  const note = (input.note ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
  const cropId = input.crop && input.crop.bytes.length > 0 ? storeVisual(db, actor.orgId, input.projectId, input.crop.filename, input.crop.bytes, "plan_crop", actor.userId) : null;
  const numbers = db.select().from(planPins).where(and(eq(planPins.orgId, actor.orgId), eq(planPins.jobFileId, file.id))).all();
  const number = numbers.reduce((max, row) => Math.max(max, row.number), 0) + 1;
  const pinId = id("pin");
  db.insert(planPins)
    .values({
      id: pinId,
      orgId: actor.orgId,
      projectId: input.projectId,
      jobFileId: file.id,
      number,
      xMilli: input.xMilli,
      yMilli: input.yMilli,
      linkType: input.linkType,
      linkId: input.linkId,
      note,
      cropDocumentId: cropId,
      copiedFromId: null,
      reviewed: 1,
      createdAt: nowIso(),
      createdBy: actor.userId,
    })
    .run();
  writeAudit(db, actor.orgId, actor.userId, "pin.place", "plan_pin", pinId, { jobFileId: file.id, linkType: input.linkType, linkId: input.linkId, number });
  return { id: pinId, number, cropDocumentId: cropId };
}

export function carryPlanPins(db: AppDatabase, orgId: string, fromFileId: string, toFileId: string, actorId: string | null) {
  const rows = db.select().from(planPins).where(and(eq(planPins.orgId, orgId), eq(planPins.jobFileId, fromFileId))).all();
  const now = nowIso();
  for (const row of rows) {
    db.insert(planPins)
      .values({
        id: id("pin"),
        orgId,
        projectId: row.projectId,
        jobFileId: toFileId,
        number: row.number,
        xMilli: row.xMilli,
        yMilli: row.yMilli,
        linkType: row.linkType,
        linkId: row.linkId,
        note: row.note,
        cropDocumentId: row.cropDocumentId,
        copiedFromId: row.id,
        reviewed: 0,
        createdAt: now,
        createdBy: actorId,
      })
      .run();
  }
  return rows.length;
}

export function reviewPins(actor: Actor, input: { projectId: string; jobFileId: string }) {
  assertEditor(actor);
  const db = dbFor(actor);
  const file = db.select().from(jobFiles).where(and(eq(jobFiles.id, input.jobFileId), eq(jobFiles.orgId, actor.orgId), eq(jobFiles.projectId, input.projectId))).get();
  if (!file || file.deletedAt || file.isCurrent !== 1) throw new ServiceError("Plan not found.");
  db.update(planPins)
    .set({ reviewed: 1 })
    .where(and(eq(planPins.orgId, actor.orgId), eq(planPins.jobFileId, file.id), eq(planPins.reviewed, 0)))
    .run();
  writeAudit(db, actor.orgId, actor.userId, "pin.review", "plan_pin", file.id, { jobFileId: file.id });
  return { id: file.id };
}

export function planBoard(actor: Actor, projectId: string, fileId: string): PlanBoard | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  const file = db.select().from(jobFiles).where(and(eq(jobFiles.id, fileId), eq(jobFiles.orgId, actor.orgId), eq(jobFiles.projectId, projectId))).get();
  if (!project || !file || file.deletedAt) return null;
  const document = db.select().from(documents).where(and(eq(documents.id, file.documentId), eq(documents.orgId, actor.orgId))).get();
  if (!document) return null;
  const markupRow = db
    .select()
    .from(markups)
    .where(and(eq(markups.orgId, actor.orgId), eq(markups.targetType, "plan"), eq(markups.targetId, file.id)))
    .get();
  const pins = pinsOnFile(db, actor.orgId, project.id, file.id, true);
  const punches = db
    .select()
    .from(punchItems)
    .where(and(eq(punchItems.orgId, actor.orgId), eq(punchItems.projectId, project.id)))
    .all()
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((row) => ({ id: row.id, title: row.title }));
  const rfiRows = db
    .select()
    .from(rfis)
    .where(and(eq(rfis.orgId, actor.orgId), eq(rfis.projectId, project.id)))
    .all()
    .filter((row) => row.status !== "void")
    .sort((a, b) => a.number - b.number)
    .map((row) => ({ id: row.id, title: row.title }));
  const todoRows = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.orgId, actor.orgId), eq(tasks.relatedType, "project"), eq(tasks.relatedId, project.id)))
    .all()
    .filter((row) => row.status !== "done")
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((row) => ({ id: row.id, title: row.title }));
  const kind = document.filename.toLowerCase().endsWith(".pdf") || document.storagePath.toLowerCase().endsWith(".pdf") ? "pdf" : "image";
  return {
    projectId: project.id,
    projectName: project.name,
    fileId: file.id,
    name: file.name,
    revision: file.revision,
    current: file.isCurrent === 1,
    readOnly: file.isCurrent !== 1,
    documentHref: hrefFor(document.storagePath, document.id),
    kind,
    markup: markupRow ? markupView(db, markupRow) : null,
    pins,
    unreviewed: pins.filter((pin) => !pin.reviewed).length,
    punches,
    rfis: rfiRows,
    todos: todoRows,
    canEdit: file.isCurrent === 1 && canAddFieldNotes(actor.role as Role),
  };
}

export function photoBoard(actor: Actor, projectId: string, documentId: string): PhotoBoard | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  const document = db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.orgId, actor.orgId), eq(documents.projectId, projectId))).get();
  if (!project || !document || document.deletedAt) return null;
  const markupRow = db
    .select()
    .from(markups)
    .where(and(eq(markups.orgId, actor.orgId), eq(markups.targetType, "photo"), eq(markups.targetId, document.id)))
    .get();
  return {
    projectId: project.id,
    projectName: project.name,
    documentId: document.id,
    name: document.filename,
    href: hrefFor(document.storagePath, document.id),
    markup: markupRow ? markupView(db, markupRow) : null,
    canEdit: canAddFieldNotes(actor.role as Role),
  };
}

function currentPins(db: AppDatabase, orgId: string, projectId: string) {
  const files = db
    .select()
    .from(jobFiles)
    .where(and(eq(jobFiles.orgId, orgId), eq(jobFiles.projectId, projectId), eq(jobFiles.isCurrent, 1)))
    .all();
  const current = new Set(files.map((file) => file.id));
  return db
    .select()
    .from(planPins)
    .where(and(eq(planPins.orgId, orgId), eq(planPins.projectId, projectId)))
    .all()
    .filter((row) => current.has(row.jobFileId));
}

export function recordVisual(actor: Actor, projectId: string, linkType: PinLinkType, linkId: string): RecordVisual {
  const empty: RecordVisual = {
    cropDocumentId: null,
    cropHref: null,
    pinNumber: null,
    planHref: null,
    photoDocumentId: null,
    flatDocumentId: null,
    flatHref: null,
    sourceHref: null,
    marked: false,
  };
  const db = officeDb(actor.orgId);
  if (!db) return empty;
  const pin = currentPins(db, actor.orgId, projectId).find((row) => row.linkType === linkType && row.linkId === linkId);
  const crop = pin?.cropDocumentId
    ? db.select().from(documents).where(and(eq(documents.id, pin.cropDocumentId), eq(documents.orgId, actor.orgId))).get()
    : undefined;
  let photoId: string | null = null;
  if (linkType === "punch") {
    const punch = db.select().from(punchItems).where(and(eq(punchItems.id, linkId), eq(punchItems.orgId, actor.orgId))).get();
    photoId = punch?.beforeDocumentId ?? punch?.afterDocumentId ?? null;
  }
  const markup = photoId
    ? db.select().from(markups).where(and(eq(markups.orgId, actor.orgId), eq(markups.targetType, "photo"), eq(markups.sourceDocumentId, photoId))).get()
    : undefined;
  const flat = markup ? db.select().from(documents).where(and(eq(documents.id, markup.flatDocumentId), eq(documents.orgId, actor.orgId))).get() : undefined;
  const source = photoId ? db.select().from(documents).where(and(eq(documents.id, photoId), eq(documents.orgId, actor.orgId))).get() : undefined;
  return {
    cropDocumentId: pin?.cropDocumentId ?? null,
    cropHref: crop ? hrefFor(crop.storagePath, crop.id) : null,
    pinNumber: pin?.number ?? null,
    planHref: pin ? `/projects/${projectId}/plans/${pin.jobFileId}` : null,
    photoDocumentId: photoId,
    flatDocumentId: markup?.flatDocumentId ?? null,
    flatHref: flat ? hrefFor(flat.storagePath, flat.id) : null,
    sourceHref: source ? hrefFor(source.storagePath, source.id) : null,
    marked: Boolean(markup),
  };
}

export function projectVisuals(actor: Actor, projectId: string) {
  const db = officeDb(actor.orgId);
  if (!db) return [] as { linkType: PinLinkType; linkId: string; visual: RecordVisual }[];
  const pins = currentPins(db, actor.orgId, projectId);
  const seen = new Set<string>();
  const rows: { linkType: PinLinkType; linkId: string; visual: RecordVisual }[] = [];
  for (const pin of pins) {
    if (pin.linkType !== "punch" && pin.linkType !== "rfi" && pin.linkType !== "todo") continue;
    const key = `${pin.linkType}:${pin.linkId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ linkType: pin.linkType, linkId: pin.linkId, visual: recordVisual(actor, projectId, pin.linkType, pin.linkId) });
  }
  return rows;
}

function clientSeesPhoto(db: AppDatabase, orgId: string, projectId: string, contactId: string, documentId: string) {
  const punch = db
    .select()
    .from(punchItems)
    .where(and(eq(punchItems.orgId, orgId), eq(punchItems.projectId, projectId), eq(punchItems.shared, 1)))
    .all();
  if (punch.some((row) => row.beforeDocumentId === documentId || row.afterDocumentId === documentId)) return true;
  const logs = db
    .select()
    .from(dailyLogs)
    .where(and(eq(dailyLogs.orgId, orgId), eq(dailyLogs.projectId, projectId), eq(dailyLogs.visibility, "client"), eq(dailyLogs.status, "published")))
    .all();
  const logIds = new Set(logs.map((row) => row.id));
  const photos = db.select().from(dailyLogPhotos).where(and(eq(dailyLogPhotos.orgId, orgId), eq(dailyLogPhotos.documentId, documentId))).all();
  if (photos.some((row) => logIds.has(row.logId))) return true;
  const document = db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.orgId, orgId))).get();
  if (document?.metadataJson) {
    try {
      const parsed = JSON.parse(document.metadataJson) as { portal?: unknown; messageId?: unknown };
      if (parsed.portal === true && typeof parsed.messageId === "string") {
        const message = db.select().from(messages).where(and(eq(messages.id, parsed.messageId), eq(messages.orgId, orgId))).get();
        const thread = message ? db.select().from(messageThreads).where(and(eq(messageThreads.id, message.threadId), eq(messageThreads.orgId, orgId))).get() : undefined;
        if (thread?.contactId === contactId) return true;
      }
    } catch {
      return false;
    }
  }
  const rfiFile = db.select().from(rfiFiles).where(and(eq(rfiFiles.orgId, orgId), eq(rfiFiles.documentId, documentId))).all();
  for (const file of rfiFile) {
    const rfi = db.select().from(rfis).where(and(eq(rfis.id, file.rfiId), eq(rfis.orgId, orgId))).get();
    if (rfi && rfi.projectId === projectId && rfi.assigneeKind === "client" && rfi.assigneeContactId === contactId && rfi.status !== "void") return true;
  }
  return false;
}

function vendorSeesLink(db: AppDatabase, orgId: string, contactId: string, linkType: string, linkId: string) {
  if (linkType === "punch") {
    const row = db.select().from(punchItems).where(and(eq(punchItems.id, linkId), eq(punchItems.orgId, orgId), eq(punchItems.assigneeContactId, contactId))).get();
    return Boolean(row);
  }
  if (linkType === "rfi") {
    const row = db.select().from(rfis).where(and(eq(rfis.id, linkId), eq(rfis.orgId, orgId), eq(rfis.assigneeContactId, contactId), eq(rfis.assigneeKind, "vendor"))).get();
    return Boolean(row && row.status !== "void");
  }
  if (linkType === "todo") {
    const row = db.select().from(taskAssignees).where(and(eq(taskAssignees.orgId, orgId), eq(taskAssignees.taskId, linkId), eq(taskAssignees.contactId, contactId))).get();
    return Boolean(row);
  }
  return false;
}

function portalProject(token: string) {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, token)).get();
  if (!project) return null;
  return { db, project };
}

export function clientPortalPins(token: string): PortalPin[] {
  const ctx = portalProject(token);
  if (!ctx) return [];
  return currentPins(ctx.db, ctx.project.orgId, ctx.project.id).flatMap((row) => {
    const link = resolveLink(ctx.db, ctx.project.orgId, ctx.project.id, row.linkType, row.linkId);
    if (!link) return [];
    const sharedPunch = row.linkType === "punch" && link.shared;
    const sharedRfi = row.linkType === "rfi" && link.shared && link.contactId === ctx.project.contactId;
    if (!sharedPunch && !sharedRfi) return [];
    return [
      {
        id: row.id,
        number: row.number,
        projectId: ctx.project.id,
        linkType: row.linkType as PinLinkType,
        linkId: row.linkId,
        title: link.title,
        status: link.status,
        statusLabel: link.statusLabel,
        cropDocumentId: row.cropDocumentId,
      },
    ];
  });
}

export function clientPortalMarkups(token: string): PortalMarkup[] {
  const ctx = portalProject(token);
  if (!ctx) return [];
  return ctx.db
    .select()
    .from(markups)
    .where(and(eq(markups.orgId, ctx.project.orgId), eq(markups.projectId, ctx.project.id), eq(markups.targetType, "photo")))
    .all()
    .filter((row) => clientSeesPhoto(ctx.db, ctx.project.orgId, ctx.project.id, ctx.project.contactId, row.sourceDocumentId))
    .map((row) => ({ sourceDocumentId: row.sourceDocumentId, flatDocumentId: row.flatDocumentId }));
}

export function vendorPortalPins(token: string): PortalPin[] {
  const db = getDb();
  const portal = db.select().from(vendorPortals).where(eq(vendorPortals.tokenHash, hashVendorToken(token))).get();
  if (!portal) return [];
  const rows = db.select().from(planPins).where(eq(planPins.orgId, portal.orgId)).all();
  const files = db.select().from(jobFiles).where(and(eq(jobFiles.orgId, portal.orgId), eq(jobFiles.isCurrent, 1))).all();
  const current = new Set(files.map((file) => file.id));
  return rows.flatMap((row) => {
    if (!current.has(row.jobFileId)) return [];
    if (!vendorSeesLink(db, portal.orgId, portal.contactId, row.linkType, row.linkId)) return [];
    const link = resolveLink(db, portal.orgId, row.projectId, row.linkType, row.linkId);
    if (!link || (row.linkType !== "punch" && row.linkType !== "rfi" && row.linkType !== "todo")) return [];
    return [
      {
        id: row.id,
        number: row.number,
        projectId: row.projectId,
        linkType: row.linkType,
        linkId: row.linkId,
        title: link.title,
        status: link.status,
        statusLabel: link.statusLabel,
        cropDocumentId: row.cropDocumentId,
      },
    ];
  });
}

export function vendorPortalMarkups(token: string): PortalMarkup[] {
  const db = getDb();
  const portal = db.select().from(vendorPortals).where(eq(vendorPortals.tokenHash, hashVendorToken(token))).get();
  if (!portal) return [];
  const punch = db.select().from(punchItems).where(and(eq(punchItems.orgId, portal.orgId), eq(punchItems.assigneeContactId, portal.contactId))).all();
  const photos = new Set(punch.flatMap((row) => [row.beforeDocumentId, row.afterDocumentId].filter((id): id is string => Boolean(id))));
  return db
    .select()
    .from(markups)
    .where(and(eq(markups.orgId, portal.orgId), eq(markups.targetType, "photo")))
    .all()
    .filter((row) => photos.has(row.sourceDocumentId))
    .map((row) => ({ sourceDocumentId: row.sourceDocumentId, flatDocumentId: row.flatDocumentId }));
}

export function clientMayReadVisual(db: AppDatabase, documentId: string) {
  const document = db.select().from(documents).where(eq(documents.id, documentId)).get();
  if (!document || document.deletedAt || !document.projectId) return false;
  if (document.type !== "markup" && document.type !== "plan_crop") return false;
  const project = db.select().from(projects).where(and(eq(projects.id, document.projectId), eq(projects.orgId, document.orgId))).get();
  if (!project) return false;
  const markup = db.select().from(markups).where(and(eq(markups.orgId, document.orgId), eq(markups.flatDocumentId, document.id))).get();
  if (markup?.targetType === "photo") return clientSeesPhoto(db, document.orgId, project.id, project.contactId, markup.sourceDocumentId);
  const pin = db.select().from(planPins).where(and(eq(planPins.orgId, document.orgId), eq(planPins.cropDocumentId, document.id))).all();
  return pin.some((row) => {
    const link = resolveLink(db, document.orgId, row.projectId, row.linkType, row.linkId);
    if (!link) return false;
    if (row.linkType === "punch") return link.shared;
    if (row.linkType === "rfi") return link.shared && link.contactId === project.contactId;
    return false;
  });
}

export function vendorMayReadVisual(db: AppDatabase, orgId: string, contactId: string, documentId: string) {
  const document = db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.orgId, orgId))).get();
  if (!document || document.deletedAt) return false;
  if (document.type !== "markup" && document.type !== "plan_crop") return false;
  const markup = db.select().from(markups).where(and(eq(markups.orgId, orgId), eq(markups.flatDocumentId, document.id))).get();
  if (markup?.targetType === "photo") {
    const punch = db.select().from(punchItems).where(and(eq(punchItems.orgId, orgId), eq(punchItems.assigneeContactId, contactId))).all();
    return punch.some((row) => row.beforeDocumentId === markup.sourceDocumentId || row.afterDocumentId === markup.sourceDocumentId);
  }
  const pins = db.select().from(planPins).where(and(eq(planPins.orgId, orgId), eq(planPins.cropDocumentId, document.id))).all();
  return pins.some((row) => vendorSeesLink(db, orgId, contactId, row.linkType, row.linkId));
}
