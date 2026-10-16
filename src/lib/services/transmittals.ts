import fs from "node:fs";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb } from "@/lib/db/client";
import {
  auditLogs,
  bills,
  contacts,
  documents,
  fileFolders,
  jobFiles,
  jobSpecFiles,
  jobSpecLines,
  jobSpecs,
  memberships,
  organizations,
  projects,
  purchaseOrders,
  scheduleItems,
  submittalFiles,
  submittalRevisions,
  submittals,
  transmittalAttempts,
  transmittalCcs,
  transmittalLines,
  transmittals as transmittalRows,
  users,
  vendorPortals,
} from "@/lib/db/schema";
import { id, nowIso, token } from "@/lib/ids";
import { fillTimeError, honeypotTripped, IP_WINDOW_MS, ORG_WINDOW_MS, rateLimitError } from "@/lib/lead-form/rules";
import { canEditCrm, canManageSettings } from "@/lib/permissions";
import { appOrigin, resolveInside } from "@/lib/security";
import { hashVendorToken, vendorTokenMatches } from "@/lib/vendor/token";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { localDay } from "@/lib/time/calendar";

export type TransmittalQuery = { filter?: string; projectId?: string };

const PURPOSES = ["approval", "information", "construction", "requested", "other"] as const;
export const TRANSMITTAL_PURPOSES: { value: string; label: string }[] = [
  { value: "approval", label: "For approval" },
  { value: "information", label: "For information" },
  { value: "construction", label: "For construction" },
  { value: "requested", label: "As requested" },
  { value: "other", label: "Other" },
];
const PURPOSE_LABEL: Record<string, string> = {
  approval: "For approval",
  information: "For information",
  construction: "For construction",
  requested: "As requested",
  other: "Other",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  acknowledged: "Acknowledged",
  declined: "Declined",
  closed: "Closed",
  voided: "Voided",
};
const PUBLIC = new Set(["sent", "acknowledged", "declined", "closed"]);
const LINE_KINDS = new Set(["file", "plan", "spec", "submittal", "note"]);

type TxRow = typeof transmittalRows.$inferSelect;

export type TransmittalListRow = {
  id: string;
  projectId: string;
  job: string;
  number: number;
  subject: string;
  toName: string;
  purpose: string;
  purposeLabel: string;
  status: string;
  statusLabel: string;
  dueOn: string;
  pastDue: boolean;
  returnCount: number;
};

export type TransmittalLineView = {
  id: string;
  sortOrder: number;
  kind: string;
  title: string;
  note: string;
  sourceId: string | null;
  documentId: string | null;
  returnRequired: boolean;
};

export type TransmittalDetail = TransmittalListRow & {
  address: string;
  orgName: string;
  toKind: string;
  toId: string;
  cc: { id: string; userId: string; name: string }[];
  lines: TransmittalLineView[];
  shareToken: string;
  shareUrl: string;
  sentAt: string | null;
  sentBy: string | null;
  copiedAt: string | null;
  copiedBy: string | null;
  ackName: string;
  ackNote: string;
  ackAt: string;
  declineReason: string;
  declinedAt: string;
  voidReason: string;
  dateLabel: string;
  canEdit: boolean;
  canSend: boolean;
  canClose: boolean;
  canVoid: boolean;
  canCopy: boolean;
};

export type TransmittalChoice = { value: string; label: string };

export type PublicTransmittal =
  | { state: "missing" }
  | { state: "closed"; orgName: string; subject: string; line: string }
  | {
      state: "open" | "done";
      orgName: string;
      subject: string;
      toName: string;
      purposeLabel: string;
      dateLabel: string;
      status: string;
      token: string;
      lines: { id: string; title: string; returnRequired: boolean; href: string | null }[];
      ackName: string;
      ackNote: string;
      declineReason: string;
    };

export type PortalTransmittal = {
  id: string;
  subject: string;
  number: number;
  job: string;
  status: string;
  statusLabel: string;
  dueOn: string;
  href: string;
};

function office(actor: Actor) {
  if (!canEditCrm(actor.role)) throw new ServiceError("Your role cannot change this.");
}

function bound(value: string, max: number, label: string): string {
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().replace(/\s+/g, " ");
  if (text.length > max) throw new ServiceError(`${label} is too long.`);
  return text;
}

function dayOrNull(value: string | undefined): string | null {
  const day = (value ?? "").trim();
  if (!day) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ServiceError("Enter a date.");
  return day;
}

function todayFor(orgId: string): string {
  const org = getDb().select().from(organizations).where(eq(organizations.id, orgId)).get();
  return localDay(Date.now(), org?.timeZone || "America/New_York");
}

function dayLabel(iso: string | null, zone: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso.slice(0, 10);
  return localDay(ms, zone);
}

export function transmittalShareUrl(shareToken: string): string {
  const origin = appOrigin(process.env) ?? "";
  return `${origin}/t/${shareToken}`;
}

function audit(orgId: string, actorId: string | null, action: string, entityId: string, payload: unknown, ip: string | null = null) {
  getDb()
    .insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "transmittal",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip,
      createdAt: nowIso(),
    })
    .run();
}

function projectOf(orgId: string, projectId: string) {
  const project = getDb().select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
  if (!project) throw new ServiceError("That job is not here.");
  return project;
}

function rowOf(orgId: string, transmittalId: string) {
  return getDb().select().from(transmittalRows).where(and(eq(transmittalRows.id, transmittalId), eq(transmittalRows.orgId, orgId))).get();
}

function requireRow(orgId: string, transmittalId: string) {
  const row = rowOf(orgId, transmittalId);
  if (!row) throw new ServiceError("That package is not here.");
  return row;
}

function requireDraft(row: TxRow) {
  if (row.status !== "draft") throw new ServiceError("This package is locked.");
}

function linesFor(orgId: string, transmittalId: string) {
  return getDb()
    .select()
    .from(transmittalLines)
    .where(and(eq(transmittalLines.orgId, orgId), eq(transmittalLines.transmittalId, transmittalId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
}

function ccsFor(orgId: string, transmittalId?: string) {
  return getDb()
    .select()
    .from(transmittalCcs)
    .where(eq(transmittalCcs.orgId, orgId))
    .all()
    .filter((row) => !transmittalId || row.transmittalId === transmittalId);
}

function memberIds(orgId: string) {
  return new Set(getDb().select().from(memberships).where(eq(memberships.orgId, orgId)).all().map((row) => row.userId));
}

function people(orgId: string) {
  const contactsById = new Map(getDb().select().from(contacts).where(eq(contacts.orgId, orgId)).all().map((row) => [row.id, row]));
  const usersById = new Map(getDb().select().from(users).all().map((row) => [row.id, row]));
  return { contactsById, usersById };
}

function contactLabel(row: { company: string | null; name: string }) {
  return row.company || row.name;
}

function vendorIds(orgId: string, projectId: string) {
  const db = getDb();
  const ids = new Set<string>();
  for (const row of db.select().from(bills).where(and(eq(bills.orgId, orgId), eq(bills.projectId, projectId))).all()) {
    if (row.vendorContactId) ids.add(row.vendorContactId);
  }
  for (const row of db.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.projectId, projectId))).all()) {
    if (row.vendorContactId) ids.add(row.vendorContactId);
  }
  for (const row of db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.projectId, projectId))).all()) {
    if (row.vendorContactId) ids.add(row.vendorContactId);
  }
  return ids;
}

function recipientOf(orgId: string, project: { contactId: string; id: string }, toKind: string, toId: string) {
  const kind = toKind.trim();
  const target = toId.trim();
  if (!target) throw new ServiceError("Pick who this goes to.");
  if (kind === "client") {
    if (target !== project.contactId) throw new ServiceError("That client is not on this job.");
    return { toKind: "client", toContactId: target, toUserId: null as string | null };
  }
  if (kind === "vendor") {
    if (!vendorIds(orgId, project.id).has(target)) throw new ServiceError("That vendor is not on this job.");
    return { toKind: "vendor", toContactId: target, toUserId: null as string | null };
  }
  if (kind === "user") {
    if (!memberIds(orgId).has(target)) throw new ServiceError("That teammate is not here.");
    return { toKind: "user", toContactId: null as string | null, toUserId: target };
  }
  throw new ServiceError("Pick who this goes to.");
}

function purposeOf(value: string) {
  if (!(PURPOSES as readonly string[]).includes(value)) throw new ServiceError("Pick a purpose.");
  return value;
}

function ccIds(orgId: string, raw: string[] | undefined, toUserId: string | null) {
  const members = memberIds(orgId);
  const next = [...new Set((raw ?? []).map((item) => item.trim()).filter(Boolean))];
  if (next.length > 12) throw new ServiceError("Too many copies.");
  for (const userId of next) {
    if (!members.has(userId)) throw new ServiceError("That teammate is not here.");
  }
  return next.filter((userId) => userId !== toUserId);
}

function replaceCcs(orgId: string, transmittalId: string, userIds: string[]) {
  const db = getDb();
  const existing = ccsFor(orgId, transmittalId);
  for (const row of existing) {
    db.delete(transmittalCcs).where(and(eq(transmittalCcs.id, row.id), eq(transmittalCcs.orgId, orgId))).run();
  }
  for (const userId of userIds) {
    db.insert(transmittalCcs).values({ id: id("txcc"), orgId, transmittalId, userId }).run();
  }
}

function toName(row: TxRow, names: ReturnType<typeof people>) {
  if (row.toKind === "user" && row.toUserId) return names.usersById.get(row.toUserId)?.name || "Teammate";
  if (row.toContactId) {
    const contact = names.contactsById.get(row.toContactId);
    if (contact) return contactLabel(contact);
  }
  return "";
}

function pastDue(row: TxRow, today: string) {
  return row.status === "sent" && Boolean(row.dueOn) && (row.dueOn as string) < today;
}

function listRow(row: TxRow, job: string, names: ReturnType<typeof people>, today: string, returnCount: number): TransmittalListRow {
  return {
    id: row.id,
    projectId: row.projectId,
    job,
    number: row.number,
    subject: row.subject,
    toName: toName(row, names),
    purpose: row.purpose,
    purposeLabel: PURPOSE_LABEL[row.purpose] || row.purpose,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status] || row.status,
    dueOn: row.dueOn || "",
    pastDue: pastDue(row, today),
    returnCount,
  };
}

function lineView(row: typeof transmittalLines.$inferSelect): TransmittalLineView {
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    kind: row.kind,
    title: row.title,
    note: row.note,
    sourceId: row.sourceId,
    documentId: row.documentId,
    returnRequired: row.returnRequired === 1,
  };
}

export function listTransmittals(actor: Actor, query: TransmittalQuery = {}): TransmittalListRow[] {
  const db = getDb();
  const today = todayFor(actor.orgId);
  const names = people(actor.orgId);
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  const lines = db.select().from(transmittalLines).where(eq(transmittalLines.orgId, actor.orgId)).all();
  const filter = query.filter || "";
  return db
    .select()
    .from(transmittalRows)
    .where(eq(transmittalRows.orgId, actor.orgId))
    .all()
    .filter((row) => !query.projectId || row.projectId === query.projectId)
    .filter((row) => {
      if (!filter || filter === "all") return true;
      if (filter === "due") return pastDue(row, today);
      return row.status === filter;
    })
    .map((row) => listRow(row, jobs.get(row.projectId) || "", names, today, lines.filter((line) => line.transmittalId === row.id && line.returnRequired === 1).length))
    .sort((a, b) => a.job.localeCompare(b.job) || a.number - b.number);
}

export function transmittalDetail(actor: Actor, transmittalId: string): TransmittalDetail | null {
  const row = rowOf(actor.orgId, transmittalId);
  if (!row) return null;
  const db = getDb();
  const project = db.select().from(projects).where(and(eq(projects.id, row.projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) return null;
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  const zone = org?.timeZone || "America/New_York";
  const names = people(actor.orgId);
  const today = localDay(Date.now(), zone);
  const lines = linesFor(actor.orgId, row.id);
  const officeRole = canEditCrm(actor.role);
  const base = listRow(row, project.name, names, today, lines.filter((line) => line.returnRequired === 1).length);
  return {
    ...base,
    address: project.address || "",
    orgName: org?.name || "",
    toKind: row.toKind,
    toId: row.toUserId || row.toContactId || "",
    cc: ccsFor(actor.orgId, row.id).map((cc) => ({ id: cc.id, userId: cc.userId, name: names.usersById.get(cc.userId)?.name || "" })),
    lines: lines.map(lineView),
    shareToken: row.shareToken,
    shareUrl: transmittalShareUrl(row.shareToken),
    sentAt: row.sentAt,
    sentBy: row.sentBy,
    copiedAt: row.copiedAt,
    copiedBy: row.copiedBy,
    ackName: row.ackName || "",
    ackNote: row.ackNote || "",
    ackAt: dayLabel(row.ackAt, zone),
    declineReason: row.declineReason || "",
    declinedAt: dayLabel(row.declinedAt, zone),
    voidReason: row.voidReason || "",
    dateLabel: dayLabel(row.sentAt || row.createdAt, zone),
    canEdit: officeRole && row.status === "draft",
    canSend: officeRole && row.status === "draft",
    canClose: officeRole && (row.status === "sent" || row.status === "acknowledged" || row.status === "declined"),
    canVoid: canManageSettings(actor.role) && row.status !== "voided",
    canCopy: officeRole && row.status !== "voided",
  };
}

export function transmittalOptions(actor: Actor, projectId: string): { recipients: TransmittalChoice[]; teammates: TransmittalChoice[]; attachments: TransmittalChoice[] } | null {
  const db = getDb();
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) return null;
  const names = people(actor.orgId);
  const recipients: TransmittalChoice[] = [];
  const client = names.contactsById.get(project.contactId);
  if (client) recipients.push({ value: `client:${client.id}`, label: client.name });
  for (const contactId of [...vendorIds(actor.orgId, projectId)].sort()) {
    const contact = names.contactsById.get(contactId);
    if (contact) recipients.push({ value: `vendor:${contact.id}`, label: contactLabel(contact) });
  }
  const members = memberIds(actor.orgId);
  const teammates = [...members]
    .map((userId) => ({ value: userId, label: names.usersById.get(userId)?.name || "" }))
    .filter((row) => row.label)
    .sort((a, b) => a.label.localeCompare(b.label));
  for (const teammate of teammates) recipients.push({ value: `user:${teammate.value}`, label: teammate.label });

  const folders = db.select().from(fileFolders).where(and(eq(fileFolders.orgId, actor.orgId), eq(fileFolders.projectId, projectId))).all();
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const files = db
    .select()
    .from(jobFiles)
    .where(and(eq(jobFiles.orgId, actor.orgId), eq(jobFiles.projectId, projectId)))
    .all()
    .filter((file) => file.isCurrent === 1 && !file.deletedAt);
  const attachments: TransmittalChoice[] = [];
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
    const folder = folderById.get(file.folderId);
    if (!folder || folder.archivedAt) continue;
    const kind = folder.kind === "plans" ? "plan" : "file";
    attachments.push({ value: `${kind}:${file.id}`, label: file.name });
  }
  const specs = db.select().from(jobSpecs).where(and(eq(jobSpecs.orgId, actor.orgId), eq(jobSpecs.projectId, projectId))).all();
  const replaced = new Set(specs.map((row) => row.replacesId).filter((value): value is string => Boolean(value)));
  const published = specs.filter((row) => row.status === "published" && !replaced.has(row.id));
  const latest = published.reduce((max, row) => Math.max(max, row.version), 0);
  for (const spec of published.filter((row) => row.version === latest).sort((a, b) => a.title.localeCompare(b.title))) {
    attachments.push({ value: `spec:${spec.id}`, label: spec.title });
  }
  const approved = db
    .select()
    .from(submittals)
    .where(and(eq(submittals.orgId, actor.orgId), eq(submittals.projectId, projectId), eq(submittals.status, "approved")))
    .all()
    .sort((a, b) => a.number - b.number);
  for (const row of approved) attachments.push({ value: `submittal:${row.id}`, label: row.title });
  return { recipients, teammates, attachments };
}

function nextNumber(orgId: string, projectId: string) {
  const rows = getDb().select().from(transmittalRows).where(and(eq(transmittalRows.orgId, orgId), eq(transmittalRows.projectId, projectId))).all();
  return rows.reduce((max, row) => Math.max(max, row.number), 0) + 1;
}

export function createTransmittal(actor: Actor, projectId: string, input: { subject: string; toKind: string; toId: string; purpose: string; dueOn?: string; ccUserIds?: string[] }): string {
  office(actor);
  const project = projectOf(actor.orgId, projectId);
  const subject = bound(input.subject || "", 140, "Subject");
  if (!subject) throw new ServiceError("Add a subject.");
  const recipient = recipientOf(actor.orgId, project, input.toKind, input.toId);
  const purpose = purposeOf(input.purpose);
  const dueOn = dayOrNull(input.dueOn);
  const copies = ccIds(actor.orgId, input.ccUserIds, recipient.toUserId);
  const now = nowIso();
  const transmittalId = id("tx");
  getDb()
    .insert(transmittalRows)
    .values({
      id: transmittalId,
      orgId: actor.orgId,
      projectId,
      number: nextNumber(actor.orgId, projectId),
      subject,
      toKind: recipient.toKind,
      toContactId: recipient.toContactId,
      toUserId: recipient.toUserId,
      purpose,
      dueOn,
      status: "draft",
      shareToken: token(),
      sentAt: null,
      sentBy: null,
      copiedAt: null,
      copiedBy: null,
      ackName: null,
      ackNote: null,
      ackAt: null,
      ackIp: null,
      declineReason: null,
      declinedAt: null,
      closedAt: null,
      closedBy: null,
      voidReason: null,
      voidedAt: null,
      voidedBy: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  replaceCcs(actor.orgId, transmittalId, copies);
  audit(actor.orgId, actor.userId, "transmittal.create", transmittalId, { subject, number: nextNumber(actor.orgId, projectId) - 1 });
  return transmittalId;
}

export function saveTransmittal(actor: Actor, transmittalId: string, input: { subject: string; toKind: string; toId: string; purpose: string; dueOn?: string; ccUserIds?: string[] }) {
  office(actor);
  const row = requireRow(actor.orgId, transmittalId);
  requireDraft(row);
  const project = projectOf(actor.orgId, row.projectId);
  const subject = bound(input.subject || "", 140, "Subject");
  if (!subject) throw new ServiceError("Add a subject.");
  const recipient = recipientOf(actor.orgId, project, input.toKind, input.toId);
  const purpose = purposeOf(input.purpose);
  const dueOn = dayOrNull(input.dueOn);
  const copies = ccIds(actor.orgId, input.ccUserIds, recipient.toUserId);
  const now = nowIso();
  getDb()
    .update(transmittalRows)
    .set({
      subject,
      toKind: recipient.toKind,
      toContactId: recipient.toContactId,
      toUserId: recipient.toUserId,
      purpose,
      dueOn,
      updatedAt: now,
    })
    .where(and(eq(transmittalRows.id, row.id), eq(transmittalRows.orgId, actor.orgId)))
    .run();
  replaceCcs(actor.orgId, row.id, copies);
  audit(actor.orgId, actor.userId, "transmittal.save", row.id, { subject });
}

function specDocument(orgId: string, specId: string): string | null {
  const db = getDb();
  const lines = db.select().from(jobSpecLines).where(and(eq(jobSpecLines.orgId, orgId), eq(jobSpecLines.specId, specId))).all().sort((a, b) => a.sortOrder - b.sortOrder);
  const files = db.select().from(jobSpecFiles).where(eq(jobSpecFiles.orgId, orgId)).all();
  for (const line of lines) {
    const file = files.find((item) => item.lineId === line.id);
    if (file) return file.documentId;
  }
  return null;
}

function submittalDocument(orgId: string, submittalId: string): string | null {
  const db = getDb();
  const revisions = db.select().from(submittalRevisions).where(eq(submittalRevisions.orgId, orgId)).all();
  const revisionNumber = new Map(revisions.map((row) => [row.id, row.revision]));
  const files = db
    .select()
    .from(submittalFiles)
    .where(and(eq(submittalFiles.orgId, orgId), eq(submittalFiles.submittalId, submittalId)))
    .all()
    .sort((a, b) => (revisionNumber.get(b.revisionId) ?? 0) - (revisionNumber.get(a.revisionId) ?? 0));
  return files[0]?.documentId ?? null;
}

function resolveAttachment(orgId: string, projectId: string, kind: string, sourceId: string) {
  if (!LINE_KINDS.has(kind) || kind === "note") throw new ServiceError("Pick a file.");
  const db = getDb();
  if (kind === "file" || kind === "plan") {
    const file = db.select().from(jobFiles).where(and(eq(jobFiles.id, sourceId), eq(jobFiles.orgId, orgId), eq(jobFiles.projectId, projectId))).get();
    if (!file || file.deletedAt || file.isCurrent !== 1) throw new ServiceError("That file is not on this job.");
    const folder = db.select().from(fileFolders).where(and(eq(fileFolders.id, file.folderId), eq(fileFolders.orgId, orgId))).get();
    if (!folder || folder.archivedAt) throw new ServiceError("That file is not on this job.");
    if (kind === "plan" && folder.kind !== "plans") throw new ServiceError("That file is not on this job.");
    if (kind === "file" && folder.kind === "plans") throw new ServiceError("That file is not on this job.");
    return { kind, title: file.name, sourceId: file.id, documentId: file.documentId };
  }
  if (kind === "spec") {
    const specs = db.select().from(jobSpecs).where(and(eq(jobSpecs.orgId, orgId), eq(jobSpecs.projectId, projectId))).all();
    const replaced = new Set(specs.map((row) => row.replacesId).filter((value): value is string => Boolean(value)));
    const spec = specs.find((row) => row.id === sourceId);
    const published = specs.filter((row) => row.status === "published" && !replaced.has(row.id));
    const latest = published.reduce((max, row) => Math.max(max, row.version), 0);
    if (!spec || spec.status !== "published" || replaced.has(spec.id) || spec.version !== latest) throw new ServiceError("That spec is not on this job.");
    return { kind, title: spec.title, sourceId: spec.id, documentId: specDocument(orgId, spec.id) };
  }
  const submittal = db.select().from(submittals).where(and(eq(submittals.id, sourceId), eq(submittals.orgId, orgId), eq(submittals.projectId, projectId))).get();
  if (!submittal || submittal.status !== "approved") throw new ServiceError("That submittal is not on this job.");
  return { kind: "submittal", title: submittal.title, sourceId: submittal.id, documentId: submittalDocument(orgId, submittal.id) };
}

function insertLine(orgId: string, transmittalId: string, input: { kind: string; title: string; sourceId: string | null; documentId: string | null; returnRequired: boolean }) {
  const lines = linesFor(orgId, transmittalId);
  if (input.sourceId && lines.some((line) => line.sourceId === input.sourceId && line.kind === input.kind)) throw new ServiceError("Already attached.");
  const sortOrder = lines.reduce((max, line) => Math.max(max, line.sortOrder), -1) + 1;
  const lineId = id("txl");
  getDb()
    .insert(transmittalLines)
    .values({
      id: lineId,
      orgId,
      transmittalId,
      sortOrder,
      kind: input.kind,
      title: input.title,
      note: "",
      sourceId: input.sourceId,
      documentId: input.documentId,
      returnRequired: input.returnRequired ? 1 : 0,
    })
    .run();
  return lineId;
}

export function addTransmittalNote(actor: Actor, transmittalId: string, title: string, returnRequired: boolean) {
  office(actor);
  const row = requireRow(actor.orgId, transmittalId);
  requireDraft(row);
  const text = bound(title || "", 200, "Note");
  if (!text) throw new ServiceError("Add a note.");
  const lineId = insertLine(actor.orgId, row.id, { kind: "note", title: text, sourceId: null, documentId: null, returnRequired });
  audit(actor.orgId, actor.userId, "transmittal.line", row.id, { lineId, kind: "note" });
  return lineId;
}

export function addTransmittalFile(actor: Actor, transmittalId: string, kind: string, sourceId: string, returnRequired: boolean) {
  office(actor);
  const row = requireRow(actor.orgId, transmittalId);
  requireDraft(row);
  const attached = resolveAttachment(actor.orgId, row.projectId, kind, sourceId);
  const lineId = insertLine(actor.orgId, row.id, { ...attached, returnRequired });
  audit(actor.orgId, actor.userId, "transmittal.line", row.id, { lineId, kind: attached.kind });
  return lineId;
}

export function setTransmittalReturn(actor: Actor, lineId: string, returnRequired: boolean) {
  office(actor);
  const db = getDb();
  const line = db.select().from(transmittalLines).where(and(eq(transmittalLines.id, lineId), eq(transmittalLines.orgId, actor.orgId))).get();
  if (!line) throw new ServiceError("That line is not here.");
  const row = requireRow(actor.orgId, line.transmittalId);
  requireDraft(row);
  db.update(transmittalLines)
    .set({ returnRequired: returnRequired ? 1 : 0 })
    .where(and(eq(transmittalLines.id, line.id), eq(transmittalLines.orgId, actor.orgId)))
    .run();
}

export function moveTransmittalLine(actor: Actor, lineId: string, direction: "up" | "down") {
  office(actor);
  const db = getDb();
  const line = db.select().from(transmittalLines).where(and(eq(transmittalLines.id, lineId), eq(transmittalLines.orgId, actor.orgId))).get();
  if (!line) throw new ServiceError("That line is not here.");
  const row = requireRow(actor.orgId, line.transmittalId);
  requireDraft(row);
  const lines = linesFor(actor.orgId, row.id);
  const index = lines.findIndex((item) => item.id === line.id);
  const neighbor = lines[index + (direction === "up" ? -1 : 1)];
  if (!neighbor) return;
  db.update(transmittalLines).set({ sortOrder: neighbor.sortOrder }).where(and(eq(transmittalLines.id, line.id), eq(transmittalLines.orgId, actor.orgId))).run();
  db.update(transmittalLines).set({ sortOrder: line.sortOrder }).where(and(eq(transmittalLines.id, neighbor.id), eq(transmittalLines.orgId, actor.orgId))).run();
}

export function removeTransmittalLine(actor: Actor, lineId: string) {
  office(actor);
  const db = getDb();
  const line = db.select().from(transmittalLines).where(and(eq(transmittalLines.id, lineId), eq(transmittalLines.orgId, actor.orgId))).get();
  if (!line) throw new ServiceError("That line is not here.");
  const row = requireRow(actor.orgId, line.transmittalId);
  requireDraft(row);
  db.delete(transmittalLines).where(and(eq(transmittalLines.id, line.id), eq(transmittalLines.orgId, actor.orgId))).run();
}

export function copyTransmittal(actor: Actor, transmittalId: string) {
  office(actor);
  const row = requireRow(actor.orgId, transmittalId);
  if (row.status === "voided") throw new ServiceError("This package is locked.");
  const now = nowIso();
  getDb()
    .update(transmittalRows)
    .set({ copiedAt: now, copiedBy: actor.userId, updatedAt: now })
    .where(and(eq(transmittalRows.id, row.id), eq(transmittalRows.orgId, actor.orgId)))
    .run();
  audit(actor.orgId, actor.userId, "transmittal.copy", row.id, { copiedAt: now });
}

export function markTransmittalSent(actor: Actor, transmittalId: string) {
  office(actor);
  const row = requireRow(actor.orgId, transmittalId);
  if (row.status !== "draft") throw new ServiceError("This package is locked.");
  if (!row.subject.trim()) throw new ServiceError("Add a subject.");
  if (!row.toContactId && !row.toUserId) throw new ServiceError("Pick who this goes to.");
  if (linesFor(actor.orgId, row.id).length === 0) throw new ServiceError("Add a line.");
  const now = nowIso();
  getDb()
    .update(transmittalRows)
    .set({ status: "sent", sentAt: now, sentBy: actor.userId, updatedAt: now })
    .where(and(eq(transmittalRows.id, row.id), eq(transmittalRows.orgId, actor.orgId)))
    .run();
  audit(actor.orgId, actor.userId, "transmittal.send", row.id, { sentAt: now });
}

export function closeTransmittal(actor: Actor, transmittalId: string) {
  office(actor);
  const row = requireRow(actor.orgId, transmittalId);
  if (row.status !== "sent" && row.status !== "acknowledged" && row.status !== "declined") throw new ServiceError("This package is locked.");
  const now = nowIso();
  getDb()
    .update(transmittalRows)
    .set({ status: "closed", closedAt: now, closedBy: actor.userId, updatedAt: now })
    .where(and(eq(transmittalRows.id, row.id), eq(transmittalRows.orgId, actor.orgId)))
    .run();
  audit(actor.orgId, actor.userId, "transmittal.close", row.id, {});
}

export function voidTransmittal(actor: Actor, transmittalId: string, reason: string) {
  const row = requireRow(actor.orgId, transmittalId);
  if (!canManageSettings(actor.role)) throw new ServiceError("Your role cannot void this.");
  if (row.status === "voided") throw new ServiceError("This package is locked.");
  const text = bound(reason || "", 400, "Reason");
  if (!text) throw new ServiceError("Add a reason.");
  const now = nowIso();
  getDb()
    .update(transmittalRows)
    .set({ status: "voided", voidReason: text, voidedAt: now, voidedBy: actor.userId, updatedAt: now })
    .where(and(eq(transmittalRows.id, row.id), eq(transmittalRows.orgId, actor.orgId)))
    .run();
  audit(actor.orgId, actor.userId, "transmittal.void", row.id, { reason: text });
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function transmittalsCsv(actor: Actor, query: TransmittalQuery = {}): string {
  const rows = listTransmittals(actor, query);
  const header = "job,number,subject,to,purpose,status,due,return";
  const body = rows.map((row) => [row.job, String(row.number), row.subject, row.toName, row.purposeLabel, row.statusLabel, row.dueOn, String(row.returnCount)].map(csvCell).join(","));
  return [header, ...body].join("\n");
}

export function transmittalAttention(actor: Actor): { count: number; href: string | null } {
  const count = listTransmittals(actor, { filter: "due" }).length;
  return { count, href: count > 0 ? "/transmittals?filter=due" : null };
}

function attemptCount(orgId: string, sinceIso: string, ip?: string) {
  return getDb()
    .select()
    .from(transmittalAttempts)
    .where(eq(transmittalAttempts.orgId, orgId))
    .all()
    .filter((row) => row.createdAt >= sinceIso && (!ip || row.ip === ip)).length;
}

function recordAttempt(orgId: string, transmittalId: string, ip: string, atIso: string) {
  const db = getDb();
  const cutoff = new Date(Date.parse(atIso) - ORG_WINDOW_MS).toISOString();
  const stale = db.select().from(transmittalAttempts).where(eq(transmittalAttempts.orgId, orgId)).all().filter((row) => row.createdAt < cutoff);
  for (const row of stale) {
    db.delete(transmittalAttempts).where(and(eq(transmittalAttempts.id, row.id), eq(transmittalAttempts.orgId, orgId))).run();
  }
  db.insert(transmittalAttempts).values({ id: id("txa"), orgId, transmittalId, ip: ip.slice(0, 80) || "local", createdAt: atIso }).run();
}

function loadByToken(shareToken: string) {
  const trimmed = shareToken.trim();
  if (!trimmed || trimmed.length > 200) return null;
  return getDb().select().from(transmittalRows).where(eq(transmittalRows.shareToken, trimmed)).get() ?? null;
}

function guardPublic(shareToken: string, input: { startedAt: string; companyUrl: string; ip: string; nowMs?: number }) {
  const row = loadByToken(shareToken);
  if (!row) throw new ServiceError("That package is not here.");
  const nowMs = input.nowMs ?? Date.now();
  const atIso = new Date(nowMs).toISOString();
  const ip = input.ip.slice(0, 80) || "local";
  if (honeypotTripped(input.companyUrl)) {
    recordAttempt(row.orgId, row.id, ip, atIso);
    return { dropped: "honeypot" as const, row };
  }
  const timing = fillTimeError(Number(input.startedAt), nowMs);
  if (timing) {
    recordAttempt(row.orgId, row.id, ip, atIso);
    throw new ServiceError(timing);
  }
  const limited = rateLimitError({
    ipCount: attemptCount(row.orgId, new Date(nowMs - IP_WINDOW_MS).toISOString(), ip),
    orgCount: attemptCount(row.orgId, new Date(nowMs - ORG_WINDOW_MS).toISOString()),
  });
  if (limited) {
    recordAttempt(row.orgId, row.id, ip, atIso);
    throw new ServiceError(limited);
  }
  recordAttempt(row.orgId, row.id, ip, atIso);
  return { dropped: null, row };
}

function publicLines(row: TxRow) {
  return linesFor(row.orgId, row.id).map((line) => ({
    id: line.id,
    title: line.title,
    returnRequired: line.returnRequired === 1,
    href: line.documentId && PUBLIC.has(row.status) ? `/t/${row.shareToken}/file/${line.id}` : null,
  }));
}

export function publicTransmittal(shareToken: string): PublicTransmittal {
  const row = loadByToken(shareToken);
  if (!row) return { state: "missing" };
  const db = getDb();
  const org = db.select().from(organizations).where(eq(organizations.id, row.orgId)).get();
  const orgName = org?.name || "Fieldline";
  if (row.status === "voided") return { state: "closed", orgName, subject: row.subject, line: "This package was voided." };
  if (row.status === "draft") return { state: "closed", orgName, subject: row.subject, line: "This package has not been sent." };
  const names = people(row.orgId);
  const zone = org?.timeZone || "America/New_York";
  const body = {
    orgName,
    subject: row.subject,
    toName: toName(row, names),
    purposeLabel: PURPOSE_LABEL[row.purpose] || row.purpose,
    dateLabel: dayLabel(row.sentAt || row.createdAt, zone),
    status: row.status,
    token: row.shareToken,
    lines: publicLines(row),
    ackName: row.ackName || "",
    ackNote: row.ackNote || "",
    declineReason: row.declineReason || "",
  };
  if (row.status === "sent") return { state: "open", ...body };
  return { state: "done", ...body };
}

export function acknowledgeByToken(input: { token: string; name: string; note?: string; startedAt: string; companyUrl: string; ip: string; nowMs?: number }): { id: string } | { dropped: "honeypot" } {
  const db = getDb();
  const guarded = guardPublic(input.token, input);
  if (guarded.dropped) return { dropped: "honeypot" };
  const row = guarded.row;
  if (row.status !== "sent") throw new ServiceError("This package is not waiting.");
  const name = bound(input.name || "", 80, "Name");
  if (!name || !/[A-Za-z]/.test(name)) throw new ServiceError("Type your name.");
  const note = bound(input.note || "", 400, "Note");
  const now = input.nowMs ? new Date(input.nowMs).toISOString() : nowIso();
  const ip = input.ip.slice(0, 80) || "local";
  db.update(transmittalRows)
    .set({ status: "acknowledged", ackName: name, ackNote: note, ackAt: now, ackIp: ip, updatedAt: now })
    .where(and(eq(transmittalRows.id, row.id), eq(transmittalRows.orgId, row.orgId)))
    .run();
  audit(row.orgId, null, "transmittal.ack", row.id, { name }, ip);
  return { id: row.id };
}

export function declineTransmittalByToken(input: { token: string; reason: string; startedAt: string; companyUrl: string; ip: string; nowMs?: number }): { id: string } | { dropped: "honeypot" } {
  const db = getDb();
  const guarded = guardPublic(input.token, input);
  if (guarded.dropped) return { dropped: "honeypot" };
  const row = guarded.row;
  if (row.status !== "sent") throw new ServiceError("This package is not waiting.");
  const reason = bound(input.reason || "", 400, "Reason");
  if (!reason) throw new ServiceError("Add a reason.");
  const now = input.nowMs ? new Date(input.nowMs).toISOString() : nowIso();
  const ip = input.ip.slice(0, 80) || "local";
  db.update(transmittalRows)
    .set({ status: "declined", declineReason: reason, declinedAt: now, updatedAt: now })
    .where(and(eq(transmittalRows.id, row.id), eq(transmittalRows.orgId, row.orgId)))
    .run();
  audit(row.orgId, null, "transmittal.decline", row.id, { reason }, ip);
  return { id: row.id };
}

export function transmittalFileByToken(shareToken: string, lineId: string): { filename: string; bytes: Buffer } | null {
  const row = loadByToken(shareToken);
  if (!row || !PUBLIC.has(row.status)) return null;
  const line = linesFor(row.orgId, row.id).find((item) => item.id === lineId);
  if (!line?.documentId) return null;
  const document = getDb().select().from(documents).where(and(eq(documents.id, line.documentId), eq(documents.orgId, row.orgId))).get();
  if (!document || document.deletedAt) return null;
  const file = resolveInside(dataDir(), document.storagePath);
  if (!file || !fs.existsSync(file)) return null;
  return { filename: document.filename, bytes: fs.readFileSync(file) };
}

function portalRows(orgId: string, match: (row: TxRow) => boolean): PortalTransmittal[] {
  const db = getDb();
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row.name]));
  return db
    .select()
    .from(transmittalRows)
    .where(eq(transmittalRows.orgId, orgId))
    .all()
    .filter((row) => PUBLIC.has(row.status) && match(row))
    .map((row) => ({
      id: row.id,
      subject: row.subject,
      number: row.number,
      job: jobs.get(row.projectId) || "",
      status: row.status,
      statusLabel: STATUS_LABEL[row.status] || row.status,
      dueOn: row.dueOn || "",
      href: `/t/${row.shareToken}`,
    }))
    .sort((a, b) => a.number - b.number);
}

export function portalTransmittalsForClient(portalToken: string): PortalTransmittal[] {
  const trimmed = portalToken.trim();
  if (!trimmed || trimmed.length > 200) return [];
  const project = getDb().select().from(projects).where(eq(projects.portalToken, trimmed)).get();
  if (!project) return [];
  return portalRows(project.orgId, (row) => row.projectId === project.id && row.toKind === "client" && row.toContactId === project.contactId);
}

export function portalTransmittalsForVendor(portalToken: string): PortalTransmittal[] {
  const trimmed = portalToken.trim();
  if (!trimmed || trimmed.length > 200) return [];
  const db = getDb();
  const portal = db.select().from(vendorPortals).where(eq(vendorPortals.tokenHash, hashVendorToken(trimmed))).get();
  if (!portal || !vendorTokenMatches(trimmed, portal.tokenHash)) return [];
  return portalRows(portal.orgId, (row) => row.toKind === "vendor" && row.toContactId === portal.contactId);
}
