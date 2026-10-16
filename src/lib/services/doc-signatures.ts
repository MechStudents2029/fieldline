import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb } from "@/lib/db/client";
import {
  auditLogs,
  contacts,
  docSignAttempts,
  docSignRequests,
  docSigners,
  documents,
  jobFiles,
  memberships,
  organizations,
  projects,
  users,
} from "@/lib/db/schema";
import { id, nowIso, token } from "@/lib/ids";
import { fillTimeError, honeypotTripped, IP_WINDOW_MS, ORG_WINDOW_MS, rateLimitError } from "@/lib/lead-form/rules";
import { canEditCrm, canManageSettings, type Role } from "@/lib/permissions";
import { appOrigin, attachmentExtension, attachmentUploadError, resolveInside } from "@/lib/security";
import {
  fileSha256,
  isOverdue,
  sendError,
  statusAfter,
  statusLabel,
  tradePill,
  turnError,
  voidError,
  type SignerRole,
  type SignerState,
} from "@/lib/signatures/request";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { localDay } from "@/lib/time/calendar";

type Database = ReturnType<typeof getDb>;
type RequestRow = typeof docSignRequests.$inferSelect;
type SignerRow = typeof docSigners.$inferSelect;

export type SignatureFilter = {
  status?: string;
  projectId?: string;
  signerRole?: string;
  overdue?: boolean;
};

export type SignatureListRow = {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  kind: string;
  projectId: string | null;
  projectName: string | null;
  dueOn: string | null;
  overdue: boolean;
  signerRoles: string;
  version: number;
};

export type SignatureSignerView = {
  id: string;
  role: string;
  name: string;
  status: string;
  token: string;
  link: string;
  typedName: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  ip: string | null;
  userAgent: string | null;
  sortOrder: number;
};

export type SignatureView = SignatureListRow & {
  note: string;
  documentId: string | null;
  filename: string | null;
  docHash: string | null;
  ordered: boolean;
  vendorContactId: string | null;
  sentAt: string | null;
  sentBy: string | null;
  voidReason: string | null;
  declineReason: string | null;
  signers: SignatureSignerView[];
  canSend: boolean;
  canVoid: boolean;
  canReplace: boolean;
};

export type SignerChoice = { value: string; label: string };

export type PublicSign =
  | { state: "missing" }
  | { state: "closed"; title: string; orgName: string; line: string }
  | { state: "wait"; title: string; orgName: string }
  | { state: "done"; title: string; orgName: string; status: string; line: string }
  | { state: "open"; title: string; note: string; orgName: string; token: string; filename: string | null };

export type CertificateView = {
  title: string;
  hash: string;
  timeZone: string;
  status: string;
  signers: { name: string; role: string; at: string | null; ip: string | null; userAgent: string | null }[];
  audit: { action: string; at: string }[];
};

const TRADE_WARNING = "No approved trade agreement. It was still saved.";

function roleOf(actor: Actor): Role {
  return actor.role as Role;
}

function assertCreate(actor: Actor) {
  if (!canEditCrm(roleOf(actor))) throw new ServiceError("Your role cannot request a signature.");
}

function audit(db: Database, orgId: string, actorId: string | null, action: string, entityId: string, payload: unknown, ip: string | null = null) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "signature_request",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip,
      createdAt: nowIso(),
    })
    .run();
}

function signLink(signerToken: string): string {
  const origin = appOrigin(process.env);
  const href = `/sign/${signerToken}`;
  return origin ? `${origin}${href}` : href;
}

function orgToday(db: Database, orgId: string): string {
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  return localDay(Date.now(), org?.timeZone || "America/New_York");
}

function orgZone(db: Database, orgId: string): string {
  return db.select().from(organizations).where(eq(organizations.id, orgId)).get()?.timeZone || "America/New_York";
}

function bound(value: string, max: number, label: string): string {
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  if (text.length > max) throw new ServiceError(`${label} is too long.`);
  return text;
}

function requestsFor(db: Database, orgId: string): RequestRow[] {
  return db.select().from(docSignRequests).where(eq(docSignRequests.orgId, orgId)).all();
}

function signersFor(db: Database, orgId: string, requestId?: string): SignerRow[] {
  return db
    .select()
    .from(docSigners)
    .where(eq(docSigners.orgId, orgId))
    .all()
    .filter((row) => !requestId || row.requestId === requestId);
}

function fieldIds(db: Database, actor: Actor): Set<string> | null {
  if (roleOf(actor) !== "field") return null;
  return new Set(signersFor(db, actor.orgId).filter((row) => row.userId === actor.userId).map((row) => row.requestId));
}

function canSee(actor: Actor, requestId: string, allowed: Set<string> | null): boolean {
  return allowed == null || allowed.has(requestId);
}

function projectName(db: Database, orgId: string, projectId: string | null): string | null {
  if (!projectId) return null;
  return db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get()?.name ?? null;
}

function contactName(db: Database, orgId: string, contactId: string | null): string | null {
  if (!contactId) return null;
  const row = db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId))).get();
  return row ? row.company || row.name : null;
}

function userName(db: Database, userId: string | null): string | null {
  if (!userId) return null;
  return db.select().from(users).where(eq(users.id, userId)).get()?.name ?? null;
}

function signerLabel(db: Database, orgId: string, row: SignerRow): string {
  return contactName(db, orgId, row.contactId) || userName(db, row.userId) || row.role;
}

function listRow(db: Database, actor: Actor, row: RequestRow, signers: SignerRow[], today: string): SignatureListRow {
  const roles = [...new Set(signers.map((signer) => signer.role))].join(", ");
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    statusLabel: statusLabel(row.status),
    kind: row.kind,
    projectId: row.projectId,
    projectName: projectName(db, actor.orgId, row.projectId),
    dueOn: row.dueOn,
    overdue: isOverdue(row.status, row.dueOn, today),
    signerRoles: roles,
    version: row.version,
  };
}

function readBytes(storagePath: string): Buffer {
  const file = resolveInside(dataDir(), storagePath);
  if (!file || !fs.existsSync(file)) throw new ServiceError("That file is missing.");
  return fs.readFileSync(file);
}

function storeFile(orgId: string, actorId: string | null, upload: { filename: string; bytes: Buffer }, projectId: string | null, contactId: string | null, kind: "sign" | "sign_ink"): { documentId: string; hash: string } {
  const error = kind === "sign" ? attachmentUploadError(upload.filename, upload.bytes) : null;
  if (error) throw new ServiceError(error);
  if (kind === "sign_ink" && upload.bytes.length === 0) throw new ServiceError("Draw a signature.");
  const documentId = id("doc");
  const ext = kind === "sign" ? attachmentExtension(upload.bytes) : "png";
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
      projectId,
      leadId: null,
      contactId,
      type: kind,
      filename: `${stem || (kind === "sign_ink" ? "signature" : "file")}.${ext}`,
      storagePath: relative,
      metadataJson: null,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy: actorId,
    })
    .run();
  return { documentId, hash: fileSha256(upload.bytes) };
}

function signatureBytes(value: string | null | undefined): Buffer | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value ?? "");
  if (!match) return null;
  const bytes = Buffer.from(match[1], "base64");
  return bytes.length > 0 ? bytes : null;
}

function parseRole(value: string): SignerRole {
  if (value === "client" || value === "vendor" || value === "team") return value;
  throw new ServiceError("Pick a signer.");
}

function cleanSigner(db: Database, orgId: string, input: { role: string; contactId?: string | null; userId?: string | null }, sortOrder: number) {
  const role = parseRole(input.role);
  if (role === "team") {
    const userId = input.userId || "";
    const member = db.select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId))).get();
    if (!member) throw new ServiceError("That person is not on the team.");
    return { role, contactId: null as string | null, userId, sortOrder };
  }
  const contactId = input.contactId || "";
  const contact = db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId))).get();
  if (!contact) throw new ServiceError("Pick a signer.");
  if (role === "client" && contact.type !== "client") throw new ServiceError("Pick a client contact.");
  if (role === "vendor" && contact.type !== "sub" && contact.type !== "vendor") throw new ServiceError("Pick a vendor contact.");
  return { role, contactId, userId: null as string | null, sortOrder };
}

function attachDocument(db: Database, orgId: string, actorId: string, input: { projectId?: string | null; jobFileId?: string | null; file?: { filename: string; bytes: Buffer } | null; contactId?: string | null }) {
  if (input.file && input.file.bytes.length > 0) {
    const stored = storeFile(orgId, actorId, input.file, input.projectId || null, input.contactId || null, "sign");
    return { documentId: stored.documentId, hash: stored.hash, projectId: input.projectId || null, jobFileId: null as string | null };
  }
  if (input.jobFileId) {
    const job = db
      .select()
      .from(jobFiles)
      .where(and(eq(jobFiles.id, input.jobFileId), eq(jobFiles.orgId, orgId)))
      .all()
      .find((row) => !row.deletedAt);
    if (!job) throw new ServiceError("That file is not on this job.");
    const document = db.select().from(documents).where(and(eq(documents.id, job.documentId), eq(documents.orgId, orgId))).get();
    if (!document || document.deletedAt) throw new ServiceError("That file is not on this job.");
    const bytes = readBytes(document.storagePath);
    return { documentId: document.id, hash: fileSha256(bytes), projectId: job.projectId, jobFileId: job.id };
  }
  throw new ServiceError("Add a document.");
}

export function signerChoices(actor: Actor): SignerChoice[] {
  const db = getDb();
  const contactsRows = db.select().from(contacts).where(eq(contacts.orgId, actor.orgId)).all();
  const members = db.select().from(memberships).where(eq(memberships.orgId, actor.orgId)).all();
  const names = new Map(db.select().from(users).all().map((row) => [row.id, row.name]));
  const choices: SignerChoice[] = [];
  for (const contact of contactsRows) {
    if (contact.type === "client") choices.push({ value: `client:${contact.id}`, label: contact.name });
    if (contact.type === "sub" || contact.type === "vendor") choices.push({ value: `vendor:${contact.id}`, label: contact.company || contact.name });
  }
  for (const member of members) {
    choices.push({ value: `team:${member.userId}`, label: names.get(member.userId) || "Team" });
  }
  return choices.sort((a, b) => a.label.localeCompare(b.label));
}

export function createSignatureRequest(
  actor: Actor,
  input: {
    title: string;
    note?: string;
    kind?: string;
    projectId?: string | null;
    jobFileId?: string | null;
    vendorContactId?: string | null;
    dueOn?: string | null;
    ordered?: boolean;
    replacesId?: string | null;
    signers: { role: string; contactId?: string | null; userId?: string | null }[];
    file?: { filename: string; bytes: Buffer } | null;
  },
): { id: string } {
  assertCreate(actor);
  const title = bound(input.title || "", 120, "Title");
  if (!title) throw new ServiceError("Add a title.");
  const note = bound(input.note || "", 400, "Note");
  const dueOn = (input.dueOn || "").trim();
  if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) throw new ServiceError("Use a due date.");
  const kind = input.kind === "trade" ? "trade" : "file";
  const db = getDb();
  if (input.projectId) {
    const project = db.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.orgId, actor.orgId))).get();
    if (!project) throw new ServiceError("That job is not here.");
  }
  const signers = input.signers.map((signer, index) => cleanSigner(db, actor.orgId, signer, index));
  if (signers.length < 1) throw new ServiceError("Pick a signer.");
  const vendorFromSigner = signers.find((signer) => signer.role === "vendor")?.contactId ?? null;
  let vendorContactId = input.vendorContactId || vendorFromSigner;
  if (kind === "trade") {
    if (!vendorContactId) throw new ServiceError("Pick a vendor.");
    const vendor = db.select().from(contacts).where(and(eq(contacts.id, vendorContactId), eq(contacts.orgId, actor.orgId))).get();
    if (!vendor || (vendor.type !== "sub" && vendor.type !== "vendor")) throw new ServiceError("Pick a vendor.");
  } else if (vendorContactId) {
    const vendor = db.select().from(contacts).where(and(eq(contacts.id, vendorContactId), eq(contacts.orgId, actor.orgId))).get();
    if (!vendor) vendorContactId = null;
  }
  let version = 1;
  let replacesId: string | null = null;
  if (input.replacesId) {
    const previous = requestsFor(db, actor.orgId).find((row) => row.id === input.replacesId);
    if (!previous || previous.kind !== "trade") throw new ServiceError("That agreement is not here.");
    version = previous.version + 1;
    replacesId = previous.id;
    vendorContactId = previous.vendorContactId;
  } else if (kind === "trade" && vendorContactId) {
    const versions = requestsFor(db, actor.orgId).filter((row) => row.kind === "trade" && row.vendorContactId === vendorContactId);
    version = versions.reduce((max, row) => Math.max(max, row.version), 0) + 1;
  }
  const attached = attachDocument(db, actor.orgId, actor.userId, {
    projectId: input.projectId,
    jobFileId: input.jobFileId,
    file: input.file,
    contactId: vendorContactId,
  });
  const requestId = id("dsr");
  const now = nowIso();
  db.transaction((tx) => {
    tx.insert(docSignRequests)
      .values({
        id: requestId,
        orgId: actor.orgId,
        title,
        note,
        status: "draft",
        kind,
        projectId: attached.projectId,
        jobFileId: attached.jobFileId,
        vendorContactId: vendorContactId || null,
        documentId: attached.documentId,
        docHash: attached.hash,
        dueOn: dueOn || null,
        ordered: input.ordered ? 1 : 0,
        version,
        replacesId,
        sentAt: null,
        sentBy: null,
        voidReason: null,
        voidedAt: null,
        voidedBy: null,
        declineReason: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    for (const signer of signers) {
      tx.insert(docSigners)
        .values({
          id: id("dss"),
          orgId: actor.orgId,
          requestId,
          role: signer.role,
          contactId: signer.contactId,
          userId: signer.userId,
          sortOrder: signer.sortOrder,
          token: token(),
          status: "waiting",
          typedName: null,
          signatureDocumentId: null,
          signedAt: null,
          declinedAt: null,
          declineReason: null,
          ip: null,
          userAgent: null,
        })
        .run();
    }
  });
  audit(db, actor.orgId, actor.userId, "signature.create", requestId, { title, kind, hash: attached.hash });
  return { id: requestId };
}

export function markSignatureSent(actor: Actor, requestId: string) {
  assertCreate(actor);
  const db = getDb();
  const row = requestsFor(db, actor.orgId).find((item) => item.id === requestId);
  if (!row) throw new ServiceError("That request is not here.");
  const signers = signersFor(db, actor.orgId, row.id);
  const now = nowIso();
  if (row.status === "draft") {
    const error = sendError(row.status, Boolean(row.documentId), signers.length);
    if (error) throw new ServiceError(error);
    db.update(docSignRequests)
      .set({ status: "out", sentAt: now, sentBy: actor.userId, updatedAt: now })
      .where(and(eq(docSignRequests.id, row.id), eq(docSignRequests.orgId, actor.orgId)))
      .run();
  } else if (row.status === "out") {
    db.update(docSignRequests)
      .set({ sentAt: now, sentBy: actor.userId, updatedAt: now })
      .where(and(eq(docSignRequests.id, row.id), eq(docSignRequests.orgId, actor.orgId)))
      .run();
  } else {
    throw new ServiceError("This request can no longer be sent.");
  }
  audit(db, actor.orgId, actor.userId, "signature.link", row.id, { sentAt: now });
}

export function voidSignatureRequest(actor: Actor, requestId: string, reason: string) {
  const db = getDb();
  const row = requestsFor(db, actor.orgId).find((item) => item.id === requestId);
  if (!row) throw new ServiceError("That request is not here.");
  const error = voidError(row.status, reason, canManageSettings(roleOf(actor)));
  if (error) throw new ServiceError(error);
  const now = nowIso();
  db.update(docSignRequests)
    .set({ status: "voided", voidReason: bound(reason, 400, "Reason"), voidedAt: now, voidedBy: actor.userId, updatedAt: now })
    .where(and(eq(docSignRequests.id, row.id), eq(docSignRequests.orgId, actor.orgId)))
    .run();
  audit(db, actor.orgId, actor.userId, "signature.void", row.id, { reason: reason.trim() });
}

export function signatureRequests(actor: Actor, filter: SignatureFilter = {}): SignatureListRow[] {
  const db = getDb();
  const today = orgToday(db, actor.orgId);
  const allowed = fieldIds(db, actor);
  const signers = signersFor(db, actor.orgId);
  return requestsFor(db, actor.orgId)
    .filter((row) => canSee(actor, row.id, allowed))
    .filter((row) => !filter.status || row.status === filter.status)
    .filter((row) => !filter.projectId || row.projectId === filter.projectId)
    .filter((row) => {
      if (!filter.signerRole) return true;
      return signers.some((signer) => signer.requestId === row.id && signer.role === filter.signerRole);
    })
    .filter((row) => !filter.overdue || isOverdue(row.status, row.dueOn, today))
    .map((row) => listRow(db, actor, row, signers.filter((signer) => signer.requestId === row.id), today))
    .sort((a, b) => (a.dueOn || "9999").localeCompare(b.dueOn || "9999") || a.title.localeCompare(b.title));
}

export function signatureRequest(actor: Actor, requestId: string): SignatureView | null {
  const db = getDb();
  const row = requestsFor(db, actor.orgId).find((item) => item.id === requestId);
  if (!row) return null;
  const allowed = fieldIds(db, actor);
  if (!canSee(actor, row.id, allowed)) return null;
  const today = orgToday(db, actor.orgId);
  const signers = signersFor(db, actor.orgId, row.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const document = row.documentId ? db.select().from(documents).where(and(eq(documents.id, row.documentId), eq(documents.orgId, actor.orgId))).get() : null;
  const role = roleOf(actor);
  const base = listRow(db, actor, row, signers, today);
  return {
    ...base,
    note: row.note,
    documentId: row.documentId,
    filename: document?.filename ?? null,
    docHash: row.docHash,
    ordered: row.ordered === 1,
    vendorContactId: row.vendorContactId,
    sentAt: row.sentAt,
    sentBy: row.sentBy,
    voidReason: row.voidReason,
    declineReason: row.declineReason,
    signers: signers.map((signer) => ({
      id: signer.id,
      role: signer.role,
      name: signerLabel(db, actor.orgId, signer),
      status: signer.status,
      token: signer.token,
      link: signLink(signer.token),
      typedName: signer.typedName,
      signedAt: signer.signedAt,
      declinedAt: signer.declinedAt,
      declineReason: signer.declineReason,
      ip: signer.ip,
      userAgent: signer.userAgent,
      sortOrder: signer.sortOrder,
    })),
    canSend: canEditCrm(role) && (row.status === "draft" || row.status === "out"),
    canVoid: canManageSettings(role) && row.status !== "voided",
    canReplace: canEditCrm(role) && row.kind === "trade",
  };
}

export function signatureAttention(actor: Actor): { count: number; href: string | null } {
  const count = signatureRequests(actor, { overdue: true }).length;
  return { count, href: count > 0 ? "/signatures?overdue=1" : null };
}

export function signatureCsv(actor: Actor, filter: SignatureFilter = {}): string {
  const rows = signatureRequests(actor, filter);
  const header = "title,status,job,signer,due,overdue";
  const body = rows.map((row) => [row.title, row.statusLabel, row.projectName || "", row.signerRoles, row.dueOn || "", row.overdue ? "1" : "0"].map(csvCell).join(","));
  return [header, ...body].join("\n");
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function attemptCount(db: Database, orgId: string, sinceIso: string, ip?: string) {
  return db
    .select()
    .from(docSignAttempts)
    .where(eq(docSignAttempts.orgId, orgId))
    .all()
    .filter((row) => row.createdAt >= sinceIso && (!ip || row.ip === ip)).length;
}

function recordAttempt(db: Database, orgId: string, requestId: string, ip: string, atIso: string) {
  const cutoff = new Date(Date.parse(atIso) - ORG_WINDOW_MS).toISOString();
  const stale = db.select().from(docSignAttempts).where(eq(docSignAttempts.orgId, orgId)).all().filter((row) => row.createdAt < cutoff);
  for (const row of stale) {
    db.delete(docSignAttempts).where(and(eq(docSignAttempts.id, row.id), eq(docSignAttempts.orgId, orgId))).run();
  }
  db.insert(docSignAttempts)
    .values({ id: id("dsa"), orgId, requestId, ip: ip.slice(0, 80) || "local", createdAt: atIso })
    .run();
}

function loadByToken(db: Database, signerToken: string): { signer: SignerRow; request: RequestRow } | null {
  const signer = db.select().from(docSigners).where(eq(docSigners.token, signerToken)).get();
  if (!signer) return null;
  const request = db.select().from(docSignRequests).where(and(eq(docSignRequests.id, signer.requestId), eq(docSignRequests.orgId, signer.orgId))).get();
  if (!request) return null;
  return { signer, request };
}

function guardPublic(db: Database, signerToken: string, input: { startedAt: string; companyUrl: string; ip: string; nowMs?: number }) {
  const loaded = loadByToken(db, signerToken);
  if (!loaded) throw new ServiceError("That request is not here.");
  const nowMs = input.nowMs ?? Date.now();
  const atIso = new Date(nowMs).toISOString();
  const ip = input.ip.slice(0, 80) || "local";
  if (honeypotTripped(input.companyUrl)) {
    recordAttempt(db, loaded.request.orgId, loaded.request.id, ip, atIso);
    return { dropped: "honeypot" as const, loaded };
  }
  const timing = fillTimeError(Number(input.startedAt), nowMs);
  if (timing) {
    recordAttempt(db, loaded.request.orgId, loaded.request.id, ip, atIso);
    throw new ServiceError(timing);
  }
  const limited = rateLimitError({
    ipCount: attemptCount(db, loaded.request.orgId, new Date(nowMs - IP_WINDOW_MS).toISOString(), ip),
    orgCount: attemptCount(db, loaded.request.orgId, new Date(nowMs - ORG_WINDOW_MS).toISOString()),
  });
  if (limited) {
    recordAttempt(db, loaded.request.orgId, loaded.request.id, ip, atIso);
    throw new ServiceError(limited);
  }
  recordAttempt(db, loaded.request.orgId, loaded.request.id, ip, atIso);
  return { dropped: null, loaded };
}

function states(signers: SignerRow[]): SignerState[] {
  return signers.map((row) => ({ id: row.id, sortOrder: row.sortOrder, status: row.status === "signed" || row.status === "declined" ? row.status : "waiting" }));
}

export function signByToken(input: { token: string; typedName: string; drawn: string; startedAt: string; companyUrl: string; ip: string; userAgent: string; nowMs?: number }): { id: string } | { dropped: "honeypot" } {
  const db = getDb();
  const guarded = guardPublic(db, input.token, input);
  if (guarded.dropped) return { dropped: "honeypot" };
  const { signer, request } = guarded.loaded;
  if (request.status !== "out") throw new ServiceError("This request is not out for signature.");
  const signers = signersFor(db, request.orgId, request.id);
  const blocked = turnError(request.ordered === 1, states(signers), signer.id);
  if (blocked) throw new ServiceError(blocked);
  const name = bound(input.typedName || "", 80, "Name");
  if (!name || !/[A-Za-z]/.test(name)) throw new ServiceError("Type your name.");
  const bytes = signatureBytes(input.drawn);
  if (!bytes) throw new ServiceError("Draw a signature.");
  const before = request.documentId ? db.select().from(documents).where(eq(documents.id, request.documentId)).get() : null;
  const beforeBytes = before ? readBytes(before.storagePath) : null;
  const ink = storeFile(request.orgId, null, { filename: "signature.png", bytes }, request.projectId, signer.contactId, "sign_ink");
  if (before && beforeBytes) {
    const after = db.select().from(documents).where(eq(documents.id, before.id)).get();
    const afterBytes = readBytes(before.storagePath);
    if (!after || after.storagePath !== before.storagePath || !afterBytes.equals(beforeBytes) || fileSha256(afterBytes) !== request.docHash) {
      throw new ServiceError("The file changed.");
    }
  }
  const now = nowIso();
  const nextSigners = states(signers).map((row) => (row.id === signer.id ? { ...row, status: "signed" as const } : row));
  const status = statusAfter(nextSigners, "sign");
  db.update(docSigners)
    .set({
      status: "signed",
      typedName: name,
      signatureDocumentId: ink.documentId,
      signedAt: now,
      ip: input.ip.slice(0, 80) || "local",
      userAgent: input.userAgent.slice(0, 300),
    })
    .where(and(eq(docSigners.id, signer.id), eq(docSigners.orgId, request.orgId)))
    .run();
  db.update(docSignRequests)
    .set({ status, updatedAt: now })
    .where(and(eq(docSignRequests.id, request.id), eq(docSignRequests.orgId, request.orgId)))
    .run();
  audit(db, request.orgId, signer.userId, "signature.sign", request.id, { signerId: signer.id, name }, input.ip.slice(0, 80));
  return { id: request.id };
}

export function declineByToken(input: { token: string; reason: string; startedAt: string; companyUrl: string; ip: string; userAgent: string; nowMs?: number }): { id: string } | { dropped: "honeypot" } {
  const db = getDb();
  const guarded = guardPublic(db, input.token, input);
  if (guarded.dropped) return { dropped: "honeypot" };
  const { signer, request } = guarded.loaded;
  if (request.status !== "out") throw new ServiceError("This request is not out for signature.");
  const signers = signersFor(db, request.orgId, request.id);
  const blocked = turnError(request.ordered === 1, states(signers), signer.id);
  if (blocked) throw new ServiceError(blocked);
  const reason = bound(input.reason || "", 400, "Reason");
  if (!reason) throw new ServiceError("Add a reason.");
  const now = nowIso();
  db.update(docSigners)
    .set({
      status: "declined",
      declinedAt: now,
      declineReason: reason,
      ip: input.ip.slice(0, 80) || "local",
      userAgent: input.userAgent.slice(0, 300),
    })
    .where(and(eq(docSigners.id, signer.id), eq(docSigners.orgId, request.orgId)))
    .run();
  db.update(docSignRequests)
    .set({ status: "declined", declineReason: reason, updatedAt: now })
    .where(and(eq(docSignRequests.id, request.id), eq(docSignRequests.orgId, request.orgId)))
    .run();
  audit(db, request.orgId, signer.userId, "signature.decline", request.id, { signerId: signer.id, reason }, input.ip.slice(0, 80));
  return { id: request.id };
}

export function publicSignature(signerToken: string): PublicSign {
  const db = getDb();
  const loaded = loadByToken(db, signerToken);
  if (!loaded) return { state: "missing" };
  const org = db.select().from(organizations).where(eq(organizations.id, loaded.request.orgId)).get();
  const orgName = org?.name || "Fieldline";
  const title = loaded.request.title;
  if (loaded.request.status === "voided") return { state: "closed", title, orgName, line: "This request was voided." };
  if (loaded.request.status === "draft") return { state: "closed", title, orgName, line: "This request has not been sent." };
  if (loaded.signer.status === "signed" || loaded.request.status === "signed") {
    return { state: "done", title, orgName, status: "signed", line: "Signed." };
  }
  if (loaded.signer.status === "declined" || loaded.request.status === "declined") {
    return { state: "done", title, orgName, status: "declined", line: loaded.signer.declineReason || loaded.request.declineReason || "Declined." };
  }
  const signers = signersFor(db, loaded.request.orgId, loaded.request.id);
  const blocked = turnError(loaded.request.ordered === 1, states(signers), loaded.signer.id);
  if (blocked) return { state: "wait", title, orgName };
  const document = loaded.request.documentId
    ? db.select().from(documents).where(and(eq(documents.id, loaded.request.documentId), eq(documents.orgId, loaded.request.orgId))).get()
    : null;
  return { state: "open", title, note: loaded.request.note, orgName, token: signerToken, filename: document?.filename ?? null };
}

export function signatureFileByToken(signerToken: string): { filename: string; bytes: Buffer } | null {
  const db = getDb();
  const loaded = loadByToken(db, signerToken);
  if (!loaded?.request.documentId) return null;
  const document = db.select().from(documents).where(and(eq(documents.id, loaded.request.documentId), eq(documents.orgId, loaded.request.orgId))).get();
  if (!document || document.deletedAt) return null;
  const file = resolveInside(dataDir(), document.storagePath);
  if (!file || !fs.existsSync(file)) return null;
  return { filename: document.filename, bytes: fs.readFileSync(file) };
}

function certificateFor(request: RequestRow): CertificateView | null {
  if (request.status !== "signed" || !request.docHash) return null;
  const db = getDb();
  const signers = signersFor(db, request.orgId, request.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const auditRows = db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.orgId, request.orgId), eq(auditLogs.entityId, request.id)))
    .all()
    .filter((row) => row.entityType === "signature_request")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    title: request.title,
    hash: request.docHash,
    timeZone: orgZone(db, request.orgId),
    status: request.status,
    signers: signers.map((signer) => ({
      name: signer.typedName || signerLabel(db, request.orgId, signer),
      role: signer.role,
      at: signer.signedAt,
      ip: signer.ip,
      userAgent: signer.userAgent,
    })),
    audit: auditRows.map((row) => ({ action: row.action, at: row.createdAt })),
  };
}

export function signatureCertificateByToken(signerToken: string): CertificateView | null {
  const loaded = loadByToken(getDb(), signerToken);
  if (!loaded) return null;
  return certificateFor(loaded.request);
}

export function officeCertificate(actor: Actor, requestId: string): CertificateView | null {
  const row = signatureRequest(actor, requestId);
  if (!row) return null;
  const request = requestsFor(getDb(), actor.orgId).find((item) => item.id === requestId);
  return request ? certificateFor(request) : null;
}

export function tradePills(orgId: string): Record<string, "Approved" | "Pending"> {
  const db = getDb();
  const grouped = new Map<string, { status: string; version: number }[]>();
  for (const row of requestsFor(db, orgId)) {
    if (row.kind !== "trade" || !row.vendorContactId) continue;
    const list = grouped.get(row.vendorContactId) ?? [];
    list.push({ status: row.status, version: row.version });
    grouped.set(row.vendorContactId, list);
  }
  const pills: Record<string, "Approved" | "Pending"> = {};
  for (const [contactId, versions] of grouped) {
    const pill = tradePill(versions);
    if (pill) pills[contactId] = pill;
  }
  return pills;
}

export function vendorHasApprovedTrade(orgId: string, vendorContactId: string): boolean {
  return tradePills(orgId)[vendorContactId] === "Approved";
}

export function tradeWarning(orgId: string, vendorContactId: string | null | undefined): string | null {
  if (!vendorContactId) return null;
  const db = getDb();
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org?.tradeWarn) return null;
  if (vendorHasApprovedTrade(orgId, vendorContactId)) return null;
  return TRADE_WARNING;
}

export function setTradeWarn(actor: Actor, on: boolean) {
  if (!canManageSettings(roleOf(actor))) throw new ServiceError("Only an owner or admin can change this.");
  getDb()
    .update(organizations)
    .set({ tradeWarn: on ? 1 : 0, updatedAt: nowIso() })
    .where(eq(organizations.id, actor.orgId))
    .run();
}

export function vendorTrades(actor: Actor, contactId: string): { canSend: boolean; rows: { id: string; title: string; status: string; statusLabel: string; version: number }[] } {
  const db = getDb();
  const rows = requestsFor(db, actor.orgId)
    .filter((row) => row.kind === "trade" && row.vendorContactId === contactId)
    .sort((a, b) => b.version - a.version)
    .map((row) => ({ id: row.id, title: row.title, status: row.status, statusLabel: statusLabel(row.status), version: row.version }));
  return { canSend: canEditCrm(roleOf(actor)), rows };
}

export function replaceTradeAgreement(actor: Actor, requestId: string, file: { filename: string; bytes: Buffer }): { id: string } {
  assertCreate(actor);
  const db = getDb();
  const previous = requestsFor(db, actor.orgId).find((row) => row.id === requestId);
  if (!previous || previous.kind !== "trade" || !previous.vendorContactId) throw new ServiceError("That agreement is not here.");
  const signers = signersFor(db, actor.orgId, previous.id);
  const vendor = signers.find((row) => row.role === "vendor");
  return createSignatureRequest(actor, {
    title: previous.title,
    note: previous.note,
    kind: "trade",
    vendorContactId: previous.vendorContactId,
    dueOn: previous.dueOn,
    ordered: previous.ordered === 1,
    replacesId: previous.id,
    signers: [{ role: "vendor", contactId: vendor?.contactId || previous.vendorContactId }],
    file,
  });
}
