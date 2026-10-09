import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  bidFiles,
  bidInvites,
  bidRequests,
  bills,
  contacts,
  dailyLogPhotos,
  dailyLogs,
  documents,
  fileFolderDefaults,
  fileFolders,
  jobFileAttempts,
  jobFiles,
  planRefs,
  projects,
  punchItems,
  purchaseOrders,
  rfiFiles,
  rfis,
  scheduleItems,
  submittalFiles,
  submittals,
  vendorPortals,
} from "@/lib/db/schema";
import {
  DEFAULT_JOB_FOLDERS,
  attachedVisible,
  displayFileName,
  effectiveVisibility,
  fieldMayAddPhoto,
  fileVisibleTo,
  folderVisible,
  formatFileSize,
  officeMayEditFiles,
  viewerForRole,
  visibilityLabel,
  type AttachedKind,
  type FileShape,
  type FileViewer,
  type FolderShape,
  type FolderVisibility,
} from "@/lib/files/format";
import { id, nowIso } from "@/lib/ids";
import { IP_WINDOW_MS, ORG_WINDOW_MS, rateLimitError } from "@/lib/lead-form/rules";
import { canManageMoney, canManageSettings, type Role } from "@/lib/permissions";
import { rfiLabel } from "@/lib/rfis/format";
import { attachmentExtension, attachmentUploadError } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { submittalLabel } from "@/lib/submittals/format";
import { hashVendorToken, vendorTokenMatches } from "@/lib/vendor/token";

export type FileUpload = { filename: string; bytes: Buffer };

export type JobFileRow = {
  id: string;
  documentId: string;
  name: string;
  folderId: string;
  folderName: string;
  revision: number;
  revisionGroupId: string;
  current: boolean;
  superseded: boolean;
  plans: boolean;
  shareHistory: boolean;
  visibility: string;
  visibilityLabel: string;
  visibilityOverride: string | null;
  uploadedBy: string;
  createdAt: string;
  sizeLabel: string;
};

export type JobFolderRow = {
  id: string;
  name: string;
  kind: string;
  visibility: string;
  visibilityLabel: string;
  vendor: boolean;
};

export type AttachedRow = {
  id: string;
  name: string;
  record: string;
  href: string;
  fileHref: string;
};

export type JobFileBoard = {
  projectId: string;
  projectName: string;
  address: string;
  folders: JobFolderRow[];
  files: JobFileRow[];
  attached: AttachedRow[];
  canEdit: boolean;
  canAddPhoto: boolean;
  photoFolderId: string | null;
};

export type FolderDefaultRow = {
  id: string;
  name: string;
  kind: string;
  visibility: string;
  visibilityLabel: string;
};

export type PlanLink = { documentId: string; name: string; revision: number };
export type PlanChoice = { groupId: string; name: string; revision: number };

export type PortalFile = {
  documentId: string;
  name: string;
  revision: number;
  current: boolean;
  sizeLabel: string;
  createdAt: string;
  uploadedBy: string;
};

export type VendorFileJob = {
  projectId: string;
  projectName: string;
  folders: { name: string; files: PortalFile[] }[];
};

const MONEY_DOC_TYPES = new Set(["bill", "bid", "receipt"]);

function roleOf(actor: Actor): Role {
  return actor.role as Role;
}

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function writeAudit(db: AppDatabase, orgId: string, actorId: string | null, action: string, entityId: string, payload: Record<string, unknown> | null) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "file",
      entityId,
      payloadJson: payload ? JSON.stringify(payload) : null,
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function cleanName(value: string) {
  const text = value.replace(/[\u0000-\u001F]/g, "").trim().replace(/\s+/g, " ");
  if (text.length < 2 || text.length > 40) throw new ServiceError("Name the folder.");
  return text;
}

function shareVisibility(value: string): Exclude<FolderVisibility, "vendor"> {
  if (value === "team" || value === "client" || value === "subs") return value;
  throw new ServiceError("Pick a visibility.");
}

function folderKind(value: string) {
  if (value === "plans" || value === "photos" || value === "general") return value;
  throw new ServiceError("Pick a folder type.");
}

function folderShape(row: { visibility: string; vendorContactId: string | null; archivedAt: string | null; kind: string }): FolderShape {
  return { visibility: row.visibility, vendorContactId: row.vendorContactId, archived: Boolean(row.archivedAt), kind: row.kind };
}

function fileShape(row: { visibilityOverride: string | null; isCurrent: number; shareHistory: number; deletedAt: string | null }): FileShape {
  return { visibilityOverride: row.visibilityOverride, isCurrent: row.isCurrent === 1, shareHistory: row.shareHistory === 1, deleted: Boolean(row.deletedAt) };
}

function projectIn(db: AppDatabase, orgId: string, projectId: string) {
  return db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
}

function storeDocument(db: AppDatabase, orgId: string, projectId: string, upload: FileUpload, createdBy: string | null, contactId: string | null) {
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
      type: "job_file",
      filename: `${stem || "file"}.${ext}`,
      storagePath: relative,
      metadataJson: null,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy,
    })
    .run();
  return { documentId, byteSize: upload.bytes.length };
}

function ensureJobFolders(db: AppDatabase, orgId: string, projectId: string) {
  const existing = db.select().from(fileFolders).where(and(eq(fileFolders.orgId, orgId), eq(fileFolders.projectId, projectId))).all();
  if (existing.length > 0) return;
  const defaults = db
    .select()
    .from(fileFolderDefaults)
    .where(eq(fileFolderDefaults.orgId, orgId))
    .all()
    .filter((row) => !row.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const source = defaults.length
    ? defaults.map((row) => ({ name: row.name, kind: row.kind, visibility: row.visibility, sort: row.sortOrder }))
    : DEFAULT_JOB_FOLDERS;
  const now = nowIso();
  for (const row of source) {
    db.insert(fileFolders)
      .values({
        id: id("ff"),
        orgId,
        projectId,
        name: row.name,
        kind: row.kind,
        visibility: row.visibility,
        vendorContactId: null,
        sortOrder: row.sort,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

function rowsFor(db: AppDatabase, orgId: string, projectId: string, viewer: FileViewer) {
  const folders = db
    .select()
    .from(fileFolders)
    .where(and(eq(fileFolders.orgId, orgId), eq(fileFolders.projectId, projectId)))
    .all()
    .filter((row) => folderVisible(viewer, folderShape(row)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const folderMap = new Map(folders.map((row) => [row.id, row]));
  const files = db
    .select()
    .from(jobFiles)
    .where(and(eq(jobFiles.orgId, orgId), eq(jobFiles.projectId, projectId)))
    .all()
    .filter((row) => {
      const folder = folderMap.get(row.folderId);
      return Boolean(folder && fileVisibleTo(viewer, folderShape(folder), fileShape(row)));
    })
    .sort((a, b) => {
      const folderA = folderMap.get(a.folderId);
      const folderB = folderMap.get(b.folderId);
      return (
        (folderA?.sortOrder ?? 0) - (folderB?.sortOrder ?? 0) ||
        a.name.localeCompare(b.name) ||
        b.revision - a.revision
      );
    });
  return { folders, files, folderMap };
}

function toFileRow(row: typeof jobFiles.$inferSelect, folder: typeof fileFolders.$inferSelect): JobFileRow {
  const visibility = effectiveVisibility(folder.visibility, row.visibilityOverride);
  const plans = folder.kind === "plans";
  return {
    id: row.id,
    documentId: row.documentId,
    name: row.name,
    folderId: folder.id,
    folderName: folder.name,
    revision: row.revision,
    revisionGroupId: row.revisionGroupId,
    current: row.isCurrent === 1,
    superseded: plans && row.isCurrent !== 1,
    plans,
    shareHistory: row.shareHistory === 1,
    visibility,
    visibilityLabel: visibilityLabel(visibility),
    visibilityOverride: row.visibilityOverride,
    uploadedBy: row.uploadedByName,
    createdAt: row.createdAt,
    sizeLabel: formatFileSize(row.byteSize),
  };
}

function vendorJobIds(db: AppDatabase, orgId: string, contactId: string) {
  const ids = new Set<string>();
  for (const row of db.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.vendorContactId, contactId))).all()) ids.add(row.projectId);
  for (const row of db.select().from(bills).where(and(eq(bills.orgId, orgId), eq(bills.vendorContactId, contactId))).all()) ids.add(row.projectId);
  for (const row of db.select().from(punchItems).where(and(eq(punchItems.orgId, orgId), eq(punchItems.assigneeContactId, contactId))).all()) ids.add(row.projectId);
  for (const row of db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.vendorContactId, contactId))).all()) ids.add(row.projectId);
  for (const row of db.select().from(submittals).where(and(eq(submittals.orgId, orgId), eq(submittals.assigneeContactId, contactId))).all()) ids.add(row.projectId);
  for (const row of db.select().from(rfis).where(and(eq(rfis.orgId, orgId), eq(rfis.assigneeContactId, contactId))).all()) ids.add(row.projectId);
  const invites = db.select().from(bidInvites).where(and(eq(bidInvites.orgId, orgId), eq(bidInvites.contactId, contactId))).all();
  const bids = new Map(db.select().from(bidRequests).where(eq(bidRequests.orgId, orgId)).all().map((row) => [row.id, row]));
  for (const invite of invites) {
    const bid = bids.get(invite.bidId);
    if (bid) ids.add(bid.projectId);
  }
  return ids;
}

function attachedRows(db: AppDatabase, orgId: string, projectId: string, viewer: FileViewer): AttachedRow[] {
  const docs = new Map(
    db
      .select()
      .from(documents)
      .where(and(eq(documents.orgId, orgId), eq(documents.projectId, projectId)))
      .all()
      .filter((row) => !row.deletedAt)
      .map((row) => [row.id, row]),
  );
  const out: AttachedRow[] = [];
  const push = (key: string, documentId: string, record: string, href: string, rule: Parameters<typeof attachedVisible>[1]) => {
    const doc = docs.get(documentId);
    if (!doc || !attachedVisible(viewer, rule)) return;
    out.push({ id: key, name: doc.filename, record, href, fileHref: `/api/files/${doc.id}` });
  };
  const invited = new Set(
    db
      .select()
      .from(bidInvites)
      .where(eq(bidInvites.orgId, orgId))
      .all()
      .filter((row) => viewer.kind === "vendor" && row.contactId === viewer.contactId)
      .map((row) => row.bidId),
  );
  for (const row of db.select().from(rfis).where(and(eq(rfis.orgId, orgId), eq(rfis.projectId, projectId))).all()) {
    for (const file of db.select().from(rfiFiles).where(and(eq(rfiFiles.orgId, orgId), eq(rfiFiles.rfiId, row.id))).all()) {
      push(`rfi-${file.id}`, file.documentId, rfiLabel(row.number), `/projects/${projectId}/rfis/${row.id}`, {
        kind: "rfi",
        vendorContactId: row.assigneeContactId,
        logVisibility: null,
        punchShared: false,
        invited: false,
      });
    }
  }
  for (const row of db.select().from(submittals).where(and(eq(submittals.orgId, orgId), eq(submittals.projectId, projectId))).all()) {
    for (const file of db.select().from(submittalFiles).where(and(eq(submittalFiles.orgId, orgId), eq(submittalFiles.submittalId, row.id))).all()) {
      push(`sub-${file.id}`, file.documentId, submittalLabel(row.number), `/projects/${projectId}/submittals/${row.id}`, {
        kind: "submittal",
        vendorContactId: row.assigneeContactId,
        logVisibility: null,
        punchShared: false,
        invited: false,
      });
    }
  }
  for (const row of db.select().from(bills).where(and(eq(bills.orgId, orgId), eq(bills.projectId, projectId))).all()) {
    if (!row.documentId) continue;
    push(`bill-${row.id}`, row.documentId, row.billNumber || "Bill", `/bills/${row.id}`, {
      kind: "bill",
      vendorContactId: row.vendorContactId,
      logVisibility: null,
      punchShared: false,
      invited: false,
    });
  }
  for (const row of db.select().from(punchItems).where(and(eq(punchItems.orgId, orgId), eq(punchItems.projectId, projectId))).all()) {
    const rule = { kind: "punch" as AttachedKind, vendorContactId: row.assigneeContactId, logVisibility: null, punchShared: row.shared === 1, invited: false };
    if (row.beforeDocumentId) push(`punch-b-${row.id}`, row.beforeDocumentId, row.title, `/projects/${projectId}/punch/${row.id}`, rule);
    if (row.afterDocumentId) push(`punch-a-${row.id}`, row.afterDocumentId, row.title, `/projects/${projectId}/punch/${row.id}`, rule);
  }
  const logs = new Map(db.select().from(dailyLogs).where(and(eq(dailyLogs.orgId, orgId), eq(dailyLogs.projectId, projectId))).all().map((row) => [row.id, row]));
  for (const row of db.select().from(dailyLogPhotos).where(eq(dailyLogPhotos.orgId, orgId)).all()) {
    const log = logs.get(row.logId);
    if (!log || log.status === "void") continue;
    push(`log-${row.id}`, row.documentId, "Daily log", `/projects/${projectId}/logs/${log.id}`, {
      kind: "log",
      vendorContactId: null,
      logVisibility: log.visibility,
      punchShared: false,
      invited: false,
    });
  }
  const jobBids = db.select().from(bidRequests).where(and(eq(bidRequests.orgId, orgId), eq(bidRequests.projectId, projectId))).all();
  for (const bid of jobBids) {
    for (const file of db.select().from(bidFiles).where(and(eq(bidFiles.orgId, orgId), eq(bidFiles.bidId, bid.id))).all()) {
      push(`bid-${file.id}`, file.documentId, bid.title, `/bids/${bid.id}`, {
        kind: "bid",
        vendorContactId: null,
        logVisibility: null,
        punchShared: false,
        invited: invited.has(bid.id),
      });
    }
  }
  return out.sort((a, b) => a.record.localeCompare(b.record) || a.name.localeCompare(b.name));
}

export function jobFileBoard(actor: Actor, projectId: string): JobFileBoard | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const project = projectIn(db, actor.orgId, projectId);
  if (!project) return null;
  ensureJobFolders(db, actor.orgId, projectId);
  const viewer = viewerForRole(roleOf(actor));
  const { folders, files, folderMap } = rowsFor(db, actor.orgId, projectId, viewer);
  const photo = folders.find((row) => row.kind === "photos");
  return {
    projectId: project.id,
    projectName: project.name,
    address: project.address ?? "",
    folders: folders.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      visibility: row.visibility,
      visibilityLabel: visibilityLabel(row.visibility),
      vendor: row.kind === "vendor",
    })),
    files: files.flatMap((row) => {
      const folder = folderMap.get(row.folderId);
      return folder ? [toFileRow(row, folder)] : [];
    }),
    attached: attachedRows(db, actor.orgId, projectId, viewer),
    canEdit: officeMayEditFiles(roleOf(actor)),
    canAddPhoto: Boolean(photo && fieldMayAddPhoto(viewer, folderShape(photo))),
    photoFolderId: photo?.id ?? null,
  };
}

function requireFolder(db: AppDatabase, orgId: string, projectId: string, folderId: string) {
  const folder = db.select().from(fileFolders).where(and(eq(fileFolders.id, folderId), eq(fileFolders.orgId, orgId), eq(fileFolders.projectId, projectId))).get();
  if (!folder || folder.archivedAt) throw new ServiceError("Folder not found.");
  return folder;
}

export function uploadJobFile(actor: Actor, input: { projectId: string; folderId: string; file: FileUpload }) {
  const db = dbFor(actor);
  const project = projectIn(db, actor.orgId, input.projectId);
  if (!project) throw new ServiceError("Job not found.");
  const folder = requireFolder(db, actor.orgId, project.id, input.folderId);
  const viewer = viewerForRole(roleOf(actor));
  const office = officeMayEditFiles(roleOf(actor));
  if (!office && !fieldMayAddPhoto(viewer, folderShape(folder))) throw new ServiceError("Your role cannot add this file.");
  if (!folderVisible(viewer, folderShape(folder))) throw new ServiceError("Folder not found.");
  const stored = storeDocument(db, actor.orgId, project.id, input.file, actor.userId, null);
  const fileId = id("jf");
  db.insert(jobFiles)
    .values({
      id: fileId,
      orgId: actor.orgId,
      projectId: project.id,
      folderId: folder.id,
      documentId: stored.documentId,
      name: displayFileName(input.file.filename),
      revisionGroupId: id("grp"),
      revision: 1,
      isCurrent: 1,
      visibilityOverride: null,
      shareHistory: 0,
      byteSize: stored.byteSize,
      uploadedByName: actor.name,
      uploadedByUserId: actor.userId,
      uploadedByContactId: null,
      deletedAt: null,
      createdAt: nowIso(),
    })
    .run();
  writeAudit(db, actor.orgId, actor.userId, "file.upload", fileId, { folderId: folder.id, name: displayFileName(input.file.filename) });
  return { id: fileId };
}

export function reviseJobFile(actor: Actor, input: { projectId: string; fileId: string; file: FileUpload }) {
  if (!officeMayEditFiles(roleOf(actor))) throw new ServiceError("Your role cannot revise a plan.");
  const db = dbFor(actor);
  const current = db.select().from(jobFiles).where(and(eq(jobFiles.id, input.fileId), eq(jobFiles.orgId, actor.orgId), eq(jobFiles.projectId, input.projectId))).get();
  if (!current || current.deletedAt || current.isCurrent !== 1) throw new ServiceError("Plan not found.");
  const folder = requireFolder(db, actor.orgId, input.projectId, current.folderId);
  if (folder.kind !== "plans") throw new ServiceError("Revisions are for plans.");
  const stored = storeDocument(db, actor.orgId, input.projectId, input.file, actor.userId, null);
  const now = nowIso();
  db.update(jobFiles).set({ isCurrent: 0 }).where(and(eq(jobFiles.orgId, actor.orgId), eq(jobFiles.revisionGroupId, current.revisionGroupId))).run();
  const fileId = id("jf");
  db.insert(jobFiles)
    .values({
      id: fileId,
      orgId: actor.orgId,
      projectId: input.projectId,
      folderId: folder.id,
      documentId: stored.documentId,
      name: current.name,
      revisionGroupId: current.revisionGroupId,
      revision: current.revision + 1,
      isCurrent: 1,
      visibilityOverride: current.visibilityOverride,
      shareHistory: current.shareHistory,
      byteSize: stored.byteSize,
      uploadedByName: actor.name,
      uploadedByUserId: actor.userId,
      uploadedByContactId: null,
      deletedAt: null,
      createdAt: now,
    })
    .run();
  writeAudit(db, actor.orgId, actor.userId, "file.revision", fileId, { groupId: current.revisionGroupId, revision: current.revision + 1 });
  return { id: fileId, revision: current.revision + 1 };
}

export function setFileVisibility(actor: Actor, input: { projectId: string; fileId: string; visibility: string }) {
  if (!officeMayEditFiles(roleOf(actor))) throw new ServiceError("Your role cannot change visibility.");
  const db = dbFor(actor);
  const row = db.select().from(jobFiles).where(and(eq(jobFiles.id, input.fileId), eq(jobFiles.orgId, actor.orgId), eq(jobFiles.projectId, input.projectId))).get();
  if (!row || row.deletedAt) throw new ServiceError("File not found.");
  const override = input.visibility === "inherit" || input.visibility === "" ? null : shareVisibility(input.visibility);
  db.update(jobFiles).set({ visibilityOverride: override }).where(and(eq(jobFiles.id, row.id), eq(jobFiles.orgId, actor.orgId))).run();
  writeAudit(db, actor.orgId, actor.userId, "file.visibility", row.id, { visibility: override ?? "inherit" });
  return { id: row.id };
}

export function updateJobFiles(actor: Actor, input: { projectId: string; fileIds: string[]; visibility?: string; folderId?: string }) {
  if (!officeMayEditFiles(roleOf(actor))) throw new ServiceError("Your role cannot change these files.");
  const ids = [...new Set(input.fileIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) return { count: 0 };
  const db = dbFor(actor);
  const project = projectIn(db, actor.orgId, input.projectId);
  if (!project) throw new ServiceError("Job not found.");
  let folder: ReturnType<typeof requireFolder> | null = null;
  if (input.folderId) {
    folder = requireFolder(db, actor.orgId, project.id, input.folderId);
    if (folder.visibility === "vendor" || folder.kind === "vendor" || folder.vendorContactId) throw new ServiceError("That folder is for the vendor.");
  }
  const override = !input.visibility ? undefined : input.visibility === "inherit" ? null : shareVisibility(input.visibility);
  const moved = new Set<string>();
  for (const fileId of ids) {
    const row = db.select().from(jobFiles).where(and(eq(jobFiles.id, fileId), eq(jobFiles.orgId, actor.orgId), eq(jobFiles.projectId, project.id))).get();
    if (!row || row.deletedAt) throw new ServiceError("File not found.");
    const home = requireFolder(db, actor.orgId, project.id, row.folderId);
    if (home.visibility === "vendor" || home.kind === "vendor" || home.vendorContactId) throw new ServiceError("Vendor files stay in the vendor folder.");
    if (override !== undefined) {
      db.update(jobFiles).set({ visibilityOverride: override }).where(and(eq(jobFiles.id, row.id), eq(jobFiles.orgId, actor.orgId))).run();
      writeAudit(db, actor.orgId, actor.userId, "file.visibility", row.id, { visibility: override ?? "inherit" });
    }
    if (folder && folder.id !== row.folderId && !moved.has(row.revisionGroupId)) {
      moved.add(row.revisionGroupId);
      db.update(jobFiles).set({ folderId: folder.id }).where(and(eq(jobFiles.orgId, actor.orgId), eq(jobFiles.revisionGroupId, row.revisionGroupId), eq(jobFiles.projectId, project.id))).run();
      writeAudit(db, actor.orgId, actor.userId, "file.visibility", row.id, { folderId: folder.id });
    }
  }
  return { count: ids.length };
}

export function setShareHistory(actor: Actor, input: { projectId: string; fileId: string; share: boolean }) {
  if (!officeMayEditFiles(roleOf(actor))) throw new ServiceError("Your role cannot change visibility.");
  const db = dbFor(actor);
  const row = db.select().from(jobFiles).where(and(eq(jobFiles.id, input.fileId), eq(jobFiles.orgId, actor.orgId), eq(jobFiles.projectId, input.projectId))).get();
  if (!row || row.deletedAt) throw new ServiceError("File not found.");
  db.update(jobFiles)
    .set({ shareHistory: input.share ? 1 : 0 })
    .where(and(eq(jobFiles.orgId, actor.orgId), eq(jobFiles.revisionGroupId, row.revisionGroupId)))
    .run();
  writeAudit(db, actor.orgId, actor.userId, "file.visibility", row.id, { shareHistory: input.share });
  return { id: row.id };
}

export function deleteJobFile(actor: Actor, input: { projectId: string; fileId: string }) {
  if (!officeMayEditFiles(roleOf(actor))) throw new ServiceError("Your role cannot delete a file.");
  const db = dbFor(actor);
  const row = db.select().from(jobFiles).where(and(eq(jobFiles.id, input.fileId), eq(jobFiles.orgId, actor.orgId), eq(jobFiles.projectId, input.projectId))).get();
  if (!row || row.deletedAt) throw new ServiceError("File not found.");
  const now = nowIso();
  db.update(jobFiles).set({ deletedAt: now, isCurrent: 0 }).where(and(eq(jobFiles.id, row.id), eq(jobFiles.orgId, actor.orgId))).run();
  db.update(documents).set({ deletedAt: now }).where(and(eq(documents.id, row.documentId), eq(documents.orgId, actor.orgId))).run();
  if (row.isCurrent === 1) {
    const older = db
      .select()
      .from(jobFiles)
      .where(and(eq(jobFiles.orgId, actor.orgId), eq(jobFiles.revisionGroupId, row.revisionGroupId)))
      .all()
      .filter((item) => !item.deletedAt)
      .sort((a, b) => b.revision - a.revision)[0];
    if (older) db.update(jobFiles).set({ isCurrent: 1 }).where(and(eq(jobFiles.id, older.id), eq(jobFiles.orgId, actor.orgId))).run();
  }
  writeAudit(db, actor.orgId, actor.userId, "file.delete", row.id, { name: row.name });
  return { id: row.id };
}

export function addJobFolder(actor: Actor, input: { projectId: string; name: string; kind: string; visibility: string }) {
  if (!officeMayEditFiles(roleOf(actor))) throw new ServiceError("Your role cannot add a folder.");
  const db = dbFor(actor);
  const project = projectIn(db, actor.orgId, input.projectId);
  if (!project) throw new ServiceError("Job not found.");
  const now = nowIso();
  const folderId = id("ff");
  const count = db.select().from(fileFolders).where(and(eq(fileFolders.orgId, actor.orgId), eq(fileFolders.projectId, project.id))).all().length;
  db.insert(fileFolders)
    .values({
      id: folderId,
      orgId: actor.orgId,
      projectId: project.id,
      name: cleanName(input.name),
      kind: folderKind(input.kind),
      visibility: shareVisibility(input.visibility),
      vendorContactId: null,
      sortOrder: count,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { id: folderId };
}

export function renameJobFolder(actor: Actor, input: { projectId: string; folderId: string; name: string }) {
  if (!officeMayEditFiles(roleOf(actor))) throw new ServiceError("Your role cannot rename a folder.");
  const db = dbFor(actor);
  const folder = requireFolder(db, actor.orgId, input.projectId, input.folderId);
  if (folder.kind === "vendor") throw new ServiceError("Folder not found.");
  db.update(fileFolders)
    .set({ name: cleanName(input.name), updatedAt: nowIso() })
    .where(and(eq(fileFolders.id, folder.id), eq(fileFolders.orgId, actor.orgId)))
    .run();
  return { id: folder.id };
}

export function setFolderVisibility(actor: Actor, input: { projectId: string; folderId: string; visibility: string }) {
  if (!officeMayEditFiles(roleOf(actor))) throw new ServiceError("Your role cannot change visibility.");
  const db = dbFor(actor);
  const folder = requireFolder(db, actor.orgId, input.projectId, input.folderId);
  if (folder.kind === "vendor") throw new ServiceError("Folder not found.");
  const visibility = shareVisibility(input.visibility);
  db.update(fileFolders)
    .set({ visibility, updatedAt: nowIso() })
    .where(and(eq(fileFolders.id, folder.id), eq(fileFolders.orgId, actor.orgId)))
    .run();
  writeAudit(db, actor.orgId, actor.userId, "file.visibility", folder.id, { folder: true, visibility });
  return { id: folder.id };
}

export function archiveJobFolder(actor: Actor, input: { projectId: string; folderId: string }) {
  if (!officeMayEditFiles(roleOf(actor))) throw new ServiceError("Your role cannot archive a folder.");
  const db = dbFor(actor);
  const folder = requireFolder(db, actor.orgId, input.projectId, input.folderId);
  if (folder.kind === "vendor") throw new ServiceError("Folder not found.");
  db.update(fileFolders)
    .set({ archivedAt: nowIso(), updatedAt: nowIso() })
    .where(and(eq(fileFolders.id, folder.id), eq(fileFolders.orgId, actor.orgId)))
    .run();
  return { id: folder.id };
}

export function folderDefaults(actor: Actor): FolderDefaultRow[] | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  return db
    .select()
    .from(fileFolderDefaults)
    .where(eq(fileFolderDefaults.orgId, actor.orgId))
    .all()
    .filter((row) => !row.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((row) => ({ id: row.id, name: row.name, kind: row.kind, visibility: row.visibility, visibilityLabel: visibilityLabel(row.visibility) }));
}

export function saveFolderDefault(actor: Actor, input: { id?: string; name: string; kind: string; visibility: string; archive?: boolean }) {
  if (!canManageSettings(roleOf(actor))) throw new ServiceError("Your role cannot change settings.");
  const db = dbFor(actor);
  if (input.id) {
    const row = db.select().from(fileFolderDefaults).where(and(eq(fileFolderDefaults.id, input.id), eq(fileFolderDefaults.orgId, actor.orgId))).get();
    if (!row) throw new ServiceError("Folder not found.");
    db.update(fileFolderDefaults)
      .set({
        name: cleanName(input.name),
        kind: folderKind(input.kind),
        visibility: shareVisibility(input.visibility),
        archivedAt: input.archive ? nowIso() : null,
      })
      .where(and(eq(fileFolderDefaults.id, row.id), eq(fileFolderDefaults.orgId, actor.orgId)))
      .run();
    return { id: row.id };
  }
  const count = db.select().from(fileFolderDefaults).where(eq(fileFolderDefaults.orgId, actor.orgId)).all().length;
  const folderId = id("fd");
  db.insert(fileFolderDefaults)
    .values({
      id: folderId,
      orgId: actor.orgId,
      name: cleanName(input.name),
      kind: folderKind(input.kind),
      visibility: shareVisibility(input.visibility),
      sortOrder: count,
      archivedAt: null,
    })
    .run();
  return { id: folderId };
}

function currentPlan(db: AppDatabase, orgId: string, groupId: string) {
  return db
    .select()
    .from(jobFiles)
    .where(and(eq(jobFiles.orgId, orgId), eq(jobFiles.revisionGroupId, groupId), eq(jobFiles.isCurrent, 1)))
    .all()
    .find((row) => !row.deletedAt);
}

export function officeTargetPlans(actor: Actor, targetType: string, targetId: string): PlanLink[] {
  const db = officeDb(actor.orgId);
  if (!db) return [];
  return targetPlans(db, actor.orgId, targetType, targetId);
}

export function planChoices(actor: Actor, projectId: string): PlanChoice[] {
  const db = officeDb(actor.orgId);
  if (!db || !canManageMoney(roleOf(actor))) return [];
  const project = projectIn(db, actor.orgId, projectId);
  if (!project) return [];
  const folders = new Map(
    db
      .select()
      .from(fileFolders)
      .where(and(eq(fileFolders.orgId, actor.orgId), eq(fileFolders.projectId, projectId)))
      .all()
      .map((row) => [row.id, row]),
  );
  return db
    .select()
    .from(jobFiles)
    .where(and(eq(jobFiles.orgId, actor.orgId), eq(jobFiles.projectId, projectId), eq(jobFiles.isCurrent, 1)))
    .all()
    .filter((row) => !row.deletedAt && folders.get(row.folderId)?.kind === "plans")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => ({ groupId: row.revisionGroupId, name: row.name, revision: row.revision }));
}

export function targetPlans(db: AppDatabase, orgId: string, targetType: string, targetId: string): PlanLink[] {
  const refs = db
    .select()
    .from(planRefs)
    .where(and(eq(planRefs.orgId, orgId), eq(planRefs.targetType, targetType), eq(planRefs.targetId, targetId)))
    .all();
  return refs.flatMap((ref) => {
    const current = currentPlan(db, orgId, ref.revisionGroupId);
    return current ? [{ documentId: current.documentId, name: current.name, revision: current.revision }] : [];
  });
}

export function referencePlan(actor: Actor, input: { targetType: "bid" | "purchase_order"; targetId: string; groupId: string }) {
  if (!canManageMoney(roleOf(actor))) throw new ServiceError("Your role cannot add a plan.");
  const db = dbFor(actor);
  const current = currentPlan(db, actor.orgId, input.groupId);
  if (!current) throw new ServiceError("Plan not found.");
  const folder = db.select().from(fileFolders).where(and(eq(fileFolders.id, current.folderId), eq(fileFolders.orgId, actor.orgId))).get();
  if (!folder || folder.kind !== "plans") throw new ServiceError("Plan not found.");
  if (input.targetType === "bid") {
    const bid = db.select().from(bidRequests).where(and(eq(bidRequests.id, input.targetId), eq(bidRequests.orgId, actor.orgId), eq(bidRequests.projectId, current.projectId))).get();
    if (!bid) throw new ServiceError("Bid not found.");
  } else {
    const order = db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, input.targetId), eq(purchaseOrders.orgId, actor.orgId), eq(purchaseOrders.projectId, current.projectId)))
      .get();
    if (!order) throw new ServiceError("Purchase order not found.");
  }
  const existing = db
    .select()
    .from(planRefs)
    .where(and(eq(planRefs.orgId, actor.orgId), eq(planRefs.targetType, input.targetType), eq(planRefs.targetId, input.targetId), eq(planRefs.revisionGroupId, input.groupId)))
    .get();
  if (existing) return { id: existing.id };
  const refId = id("pref");
  db.insert(planRefs)
    .values({ id: refId, orgId: actor.orgId, targetType: input.targetType, targetId: input.targetId, revisionGroupId: input.groupId, createdAt: nowIso() })
    .run();
  return { id: refId };
}

function portalVendor(token: string) {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const db = getDb();
  const portal = db.select().from(vendorPortals).where(eq(vendorPortals.tokenHash, hashVendorToken(trimmed))).get();
  if (!portal || !vendorTokenMatches(trimmed, portal.tokenHash)) return null;
  const contact = db.select().from(contacts).where(and(eq(contacts.id, portal.contactId), eq(contacts.orgId, portal.orgId))).get();
  if (!contact || contact.deletedAt) return null;
  return { db, orgId: portal.orgId, contactId: contact.id, name: contact.company || contact.name };
}

function guardUpload(db: AppDatabase, orgId: string, ip: string) {
  const rows = db.select().from(jobFileAttempts).where(eq(jobFileAttempts.orgId, orgId)).all();
  const now = Date.now();
  const error = rateLimitError({
    ipCount: rows.filter((row) => row.ip === ip && now - new Date(row.createdAt).getTime() < IP_WINDOW_MS).length,
    orgCount: rows.filter((row) => now - new Date(row.createdAt).getTime() < ORG_WINDOW_MS).length,
  });
  if (error) throw new ServiceError(error);
  db.insert(jobFileAttempts).values({ id: id("jfa"), orgId, ip, createdAt: nowIso() }).run();
}

function vendorFolderFor(db: AppDatabase, orgId: string, projectId: string, contactId: string, name: string) {
  const existing = db
    .select()
    .from(fileFolders)
    .where(and(eq(fileFolders.orgId, orgId), eq(fileFolders.projectId, projectId), eq(fileFolders.vendorContactId, contactId)))
    .all()
    .find((row) => !row.archivedAt);
  if (existing) return existing;
  const now = nowIso();
  const folderId = id("ff");
  db.insert(fileFolders)
    .values({
      id: folderId,
      orgId,
      projectId,
      name: cleanName(name),
      kind: "vendor",
      visibility: "vendor",
      vendorContactId: contactId,
      sortOrder: 50,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const created = db.select().from(fileFolders).where(and(eq(fileFolders.id, folderId), eq(fileFolders.orgId, orgId))).get();
  if (!created) throw new ServiceError("Folder not found.");
  return created;
}

export function vendorPortalFiles(token: string): VendorFileJob[] | null {
  const ctx = portalVendor(token);
  if (!ctx) return null;
  const viewer: FileViewer = { kind: "vendor", contactId: ctx.contactId };
  const jobs = ctx.db.select().from(projects).where(eq(projects.orgId, ctx.orgId)).all();
  const onJob = vendorJobIds(ctx.db, ctx.orgId, ctx.contactId);
  return jobs
    .filter((job) => onJob.has(job.id))
    .map((job) => {
      const { folders, files, folderMap } = rowsFor(ctx.db, ctx.orgId, job.id, viewer);
      return {
        projectId: job.id,
        projectName: job.name,
        folders: folders
          .map((folder) => ({
            name: folder.name,
            files: files.flatMap((row) => {
              if (row.folderId !== folder.id) return [];
              const match = folderMap.get(row.folderId);
              return match
                ? [
                    {
                      documentId: row.documentId,
                      name: row.name,
                      revision: row.revision,
                      current: row.isCurrent === 1,
                      sizeLabel: formatFileSize(row.byteSize),
                      createdAt: row.createdAt,
                      uploadedBy: row.uploadedByName,
                    },
                  ]
                : [];
            }),
          }))
          .filter((folder) => folder.files.length > 0 || folders.some((row) => row.name === folder.name)),
      };
    })
    .filter((job) => job.folders.length > 0)
    .sort((a, b) => a.projectName.localeCompare(b.projectName));
}

export function uploadVendorJobFile(input: { token: string; projectId: string; file: FileUpload; ip: string }) {
  const ctx = portalVendor(input.token);
  if (!ctx) throw new ServiceError("Portal not found.");
  if (!vendorJobIds(ctx.db, ctx.orgId, ctx.contactId).has(input.projectId)) throw new ServiceError("Job not found.");
  const project = projectIn(ctx.db, ctx.orgId, input.projectId);
  if (!project) throw new ServiceError("Job not found.");
  guardUpload(ctx.db, ctx.orgId, input.ip);
  const folder = vendorFolderFor(ctx.db, ctx.orgId, project.id, ctx.contactId, ctx.name);
  const stored = storeDocument(ctx.db, ctx.orgId, project.id, input.file, null, ctx.contactId);
  const fileId = id("jf");
  ctx.db
    .insert(jobFiles)
    .values({
      id: fileId,
      orgId: ctx.orgId,
      projectId: project.id,
      folderId: folder.id,
      documentId: stored.documentId,
      name: displayFileName(input.file.filename),
      revisionGroupId: id("grp"),
      revision: 1,
      isCurrent: 1,
      visibilityOverride: null,
      shareHistory: 0,
      byteSize: stored.byteSize,
      uploadedByName: ctx.name,
      uploadedByUserId: null,
      uploadedByContactId: ctx.contactId,
      deletedAt: null,
      createdAt: nowIso(),
    })
    .run();
  writeAudit(ctx.db, ctx.orgId, null, "file.upload", fileId, { vendor: ctx.contactId, folderId: folder.id });
  return { id: fileId };
}

export function clientPortalFiles(token: string): { projectName: string; folders: { name: string; files: PortalFile[] }[] } | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, trimmed)).get();
  if (!project) return null;
  const viewer: FileViewer = { kind: "client" };
  const { folders, files, folderMap } = rowsFor(db, project.orgId, project.id, viewer);
  return {
    projectName: project.name,
    folders: folders.map((folder) => ({
      name: folder.name,
      files: files.flatMap((row) => {
        if (row.folderId !== folder.id) return [];
        return folderMap.get(row.folderId)
          ? [
              {
                documentId: row.documentId,
                name: row.name,
                revision: row.revision,
                current: row.isCurrent === 1,
                sizeLabel: formatFileSize(row.byteSize),
                createdAt: row.createdAt,
                uploadedBy: row.uploadedByName,
              },
            ]
          : [];
      }),
    })),
  };
}

export function fieldMayReadDocument(db: AppDatabase, orgId: string, documentId: string): boolean {
  const document = db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.orgId, orgId))).get();
  if (!document || document.deletedAt) return false;
  if (MONEY_DOC_TYPES.has(document.type)) return false;
  const bill = db.select().from(bills).where(and(eq(bills.orgId, orgId), eq(bills.documentId, documentId))).get();
  if (bill) return false;
  const bid = db.select().from(bidFiles).where(and(eq(bidFiles.orgId, orgId), eq(bidFiles.documentId, documentId))).get();
  if (bid) return false;
  const file = db.select().from(jobFiles).where(and(eq(jobFiles.orgId, orgId), eq(jobFiles.documentId, documentId))).get();
  if (!file) return true;
  const folder = db.select().from(fileFolders).where(and(eq(fileFolders.id, file.folderId), eq(fileFolders.orgId, orgId))).get();
  if (!folder) return false;
  return fileVisibleTo({ kind: "field" }, folderShape(folder), fileShape(file));
}

export function clientMayReadDocument(db: AppDatabase, documentId: string): boolean {
  const document = db.select().from(documents).where(eq(documents.id, documentId)).get();
  if (!document || document.deletedAt) return false;
  if (MONEY_DOC_TYPES.has(document.type)) return false;
  const file = db.select().from(jobFiles).where(and(eq(jobFiles.orgId, document.orgId), eq(jobFiles.documentId, documentId))).get();
  if (!file) return true;
  const folder = db.select().from(fileFolders).where(and(eq(fileFolders.id, file.folderId), eq(fileFolders.orgId, document.orgId))).get();
  if (!folder) return false;
  return fileVisibleTo({ kind: "client" }, folderShape(folder), fileShape(file));
}

export function vendorMayReadJobFile(db: AppDatabase, orgId: string, contactId: string, documentId: string): boolean {
  const file = db.select().from(jobFiles).where(and(eq(jobFiles.orgId, orgId), eq(jobFiles.documentId, documentId))).get();
  if (!file || file.deletedAt) return false;
  const folder = db.select().from(fileFolders).where(and(eq(fileFolders.id, file.folderId), eq(fileFolders.orgId, orgId))).get();
  if (!folder) return false;
  if (folder.kind !== "vendor" && folder.visibility !== "vendor" && !vendorJobIds(db, orgId, contactId).has(file.projectId)) return false;
  return fileVisibleTo({ kind: "vendor", contactId }, folderShape(folder), fileShape(file));
}
