import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { certBucket, csvCertNumber, displayStatus, inCertAttention, maskCertNumber, statusLabel, type CertBucket, type CertDisplay } from "@/lib/certs/window";
import { dataDir, getDb } from "@/lib/db/client";
import { auditLogs, credentialTypes, crewCredentials, documents, memberships, organizations, users } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canManageMoney, type Role } from "@/lib/permissions";
import { attachmentExtension, attachmentUploadError } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { localDay } from "@/lib/time/calendar";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type CertUpload = { filename: string; bytes: Buffer };

export type CertInput = {
  userId?: string;
  typeId: string;
  number?: string;
  issuedOn: string;
  expiresOn?: string;
  doesNotExpire?: boolean;
  upload?: CertUpload | null;
};

export type CertListRow = {
  id: string;
  userId: string;
  personName: string;
  typeId: string;
  typeName: string;
  required: boolean;
  number: string | null;
  numberLabel: string;
  issuedOn: string;
  expiresOn: string | null;
  doesNotExpire: boolean;
  status: CertDisplay;
  statusLabel: string;
  bucket: CertBucket;
  requestedAt: string | null;
  requestedByName: string | null;
  documentId: string | null;
};

type CertRow = typeof crewCredentials.$inferSelect;
type TypeRow = typeof credentialTypes.$inferSelect;

function roleOf(actor: Actor): Role {
  return actor.role;
}

function assertOffice(actor: Actor) {
  if (!canManageMoney(roleOf(actor))) throw new ServiceError("Credential types are managed in the office.");
}

function assertWriter(actor: Actor) {
  if (roleOf(actor) === "viewer") throw new ServiceError("Your role cannot change credentials.");
}

function orgZone(orgId: string) {
  const org = getDb().select().from(organizations).where(eq(organizations.id, orgId)).get();
  return org?.timeZone || "America/New_York";
}

function todayFor(orgId: string) {
  return localDay(Date.now(), orgZone(orgId));
}

function peopleOf(orgId: string) {
  return getDb()
    .select({ userId: memberships.userId, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all();
}

function typesOf(orgId: string) {
  return getDb()
    .select()
    .from(credentialTypes)
    .where(eq(credentialTypes.orgId, orgId))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function rowsOf(orgId: string) {
  return getDb().select().from(crewCredentials).where(eq(crewCredentials.orgId, orgId)).all();
}

function visibleRows(actor: Actor) {
  const rows = rowsOf(actor.orgId);
  if (roleOf(actor) === "field") return rows.filter((row) => row.userId === actor.userId);
  return rows;
}

function audit(actor: Actor, action: string, entityId: string, payload: Record<string, unknown>) {
  getDb()
    .insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action,
      entityType: "crew_credential",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function cleanDay(value: string | undefined, label: string) {
  const text = (value ?? "").trim();
  if (!DAY.test(text)) throw new ServiceError(`Enter ${label}.`);
  return text;
}

function cleanNumber(value: string | undefined) {
  const text = (value ?? "").trim();
  if (text.length > 40) throw new ServiceError("Keep the number under 40 characters.");
  return text || null;
}

function seesFullNumber(actor: Actor, userId: string) {
  if (roleOf(actor) === "owner" || roleOf(actor) === "admin") return true;
  if (canManageMoney(roleOf(actor))) return true;
  return actor.userId === userId && roleOf(actor) === "field";
}

function numberLabel(actor: Actor, row: CertRow) {
  if (!row.number) return "";
  if (seesFullNumber(actor, row.userId)) return row.number;
  return maskCertNumber(row.number);
}

function listed(actor: Actor, rows: CertRow[]): CertListRow[] {
  const today = todayFor(actor.orgId);
  const types = new Map(typesOf(actor.orgId).map((row) => [row.id, row]));
  const people = new Map(peopleOf(actor.orgId).map((row) => [row.userId, row.name]));
  return rows
    .map((row) => {
      const type = types.get(row.typeId);
      const bucket = certBucket(row.expiresOn, row.doesNotExpire === 1, today);
      const status = displayStatus(row.status, bucket);
      return {
        id: row.id,
        userId: row.userId,
        personName: people.get(row.userId) ?? "Crew",
        typeId: row.typeId,
        typeName: type?.name ?? "Credential",
        required: type?.required === 1,
        number: seesFullNumber(actor, row.userId) ? row.number : null,
        numberLabel: numberLabel(actor, row),
        issuedOn: row.issuedOn,
        expiresOn: row.doesNotExpire === 1 ? null : row.expiresOn,
        doesNotExpire: row.doesNotExpire === 1,
        status,
        statusLabel: statusLabel(status),
        bucket,
        requestedAt: row.requestedAt,
        requestedByName: row.requestedBy ? (people.get(row.requestedBy) ?? null) : null,
        documentId: row.documentId,
      };
    })
    .sort((a, b) => (a.expiresOn ?? "9999").localeCompare(b.expiresOn ?? "9999") || a.personName.localeCompare(b.personName) || a.id.localeCompare(b.id));
}

export function credentialTypesFor(actor: Actor) {
  return typesOf(actor.orgId).map((row) => ({
    id: row.id,
    name: row.name,
    required: row.required === 1,
    archived: row.archived === 1,
  }));
}

export function credentialPeople(actor: Actor) {
  const people = peopleOf(actor.orgId);
  if (roleOf(actor) === "field") {
    const self = people.find((row) => row.userId === actor.userId);
    return [{ id: actor.userId, name: self?.name ?? actor.name }];
  }
  return people.map((row) => ({ id: row.userId, name: row.name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function listCredentials(
  actor: Actor,
  filters: { personId?: string | null; typeId?: string | null; status?: string | null; window?: string | null; by?: string | null } = {},
): CertListRow[] {
  let rows = listed(actor, visibleRows(actor));
  const personId = (filters.personId ?? "").trim();
  if (personId && roleOf(actor) !== "field") rows = rows.filter((row) => row.userId === personId);
  const typeId = (filters.typeId ?? "").trim();
  if (typeId) rows = rows.filter((row) => row.typeId === typeId);
  const status = (filters.status ?? "").trim();
  if (status === "active" || status === "expired" || status === "revoked") rows = rows.filter((row) => row.status === status);
  const window = (filters.window ?? "").trim();
  if (window === "due") rows = rows.filter((row) => inCertAttention(row.bucket, row.status === "revoked" ? "revoked" : "active"));
  else if (window === "expired" || window === "7" || window === "30" || window === "90") rows = rows.filter((row) => row.bucket === window && row.status !== "revoked");
  const by = (filters.by ?? "").trim();
  if (DAY.test(by)) rows = rows.filter((row) => row.status !== "revoked" && !row.doesNotExpire && row.expiresOn != null && row.expiresOn <= by);
  return rows;
}

export function credentialDetail(actor: Actor, credentialId: string) {
  const row = listed(actor, visibleRows(actor)).find((item) => item.id === credentialId);
  if (!row) throw new ServiceError("Credential not found.");
  const office = canManageMoney(roleOf(actor));
  const own = row.userId === actor.userId;
  return {
    ...row,
    canEdit: row.status !== "revoked" && (office || (own && roleOf(actor) !== "viewer")),
    canRevoke: office && row.status !== "revoked",
    canRequest: office && !row.requestedAt && row.status !== "revoked",
    selfPath: `/certifications/${row.id}`,
  };
}

export function credentialAttention(actor: Actor): { count: number; href: string | null } {
  const count = listed(actor, visibleRows(actor)).filter((row) => inCertAttention(row.bucket, row.status === "revoked" ? "revoked" : "active")).length;
  return { count, href: count > 0 ? "/certifications?window=due" : null };
}

export function credentialCounts(actor: Actor) {
  const rows = listed(actor, visibleRows(actor)).filter((row) => row.status !== "revoked");
  return {
    expired: rows.filter((row) => row.bucket === "expired").length,
    d7: rows.filter((row) => row.bucket === "7").length,
    d30: rows.filter((row) => row.bucket === "30").length,
    d90: rows.filter((row) => row.bucket === "90").length,
  };
}

function requireType(orgId: string, typeId: string, allowArchived: boolean) {
  const row = typesOf(orgId).find((item) => item.id === typeId);
  if (!row) throw new ServiceError("Pick a credential type.");
  if (row.archived === 1 && !allowArchived) throw new ServiceError("That type is archived.");
  return row;
}

function assertPerson(actor: Actor, requested: string | undefined) {
  const people = peopleOf(actor.orgId);
  const userId = canManageMoney(roleOf(actor)) ? (requested || "").trim() || actor.userId : actor.userId;
  if (!people.some((row) => row.userId === userId)) throw new ServiceError("Person not found.");
  return userId;
}

function storeCard(actor: Actor, upload: CertUpload) {
  const error = attachmentUploadError(upload.filename, upload.bytes);
  if (error) throw new ServiceError(error);
  const documentId = id("doc");
  const ext = attachmentExtension(upload.bytes);
  const relative = path.join("uploads", actor.orgId, `${documentId}.${ext}`);
  const absolute = path.join(dataDir(), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, upload.bytes);
  const stem = path.basename(upload.filename).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80);
  getDb()
    .insert(documents)
    .values({
      id: documentId,
      orgId: actor.orgId,
      projectId: null,
      leadId: null,
      contactId: null,
      type: "credential",
      filename: `${stem || "card"}.${ext}`,
      storagePath: relative,
      metadataJson: null,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy: actor.userId,
    })
    .run();
  return documentId;
}

function datesOf(input: CertInput) {
  const issuedOn = cleanDay(input.issuedOn, "the issued date");
  const doesNotExpire = Boolean(input.doesNotExpire);
  const expiresOn = doesNotExpire ? null : cleanDay(input.expiresOn, "the expiration date");
  if (expiresOn && expiresOn < issuedOn) throw new ServiceError("Expiration is on or after the issued date.");
  return { issuedOn, expiresOn, doesNotExpire };
}

export function createCredential(actor: Actor, input: CertInput) {
  assertWriter(actor);
  const type = requireType(actor.orgId, input.typeId.trim(), false);
  const userId = assertPerson(actor, input.userId);
  const dates = datesOf(input);
  const now = nowIso();
  const credentialId = id("cred");
  const documentId = input.upload ? storeCard(actor, input.upload) : null;
  getDb()
    .insert(crewCredentials)
    .values({
      id: credentialId,
      orgId: actor.orgId,
      userId,
      typeId: type.id,
      number: cleanNumber(input.number),
      issuedOn: dates.issuedOn,
      expiresOn: dates.expiresOn,
      doesNotExpire: dates.doesNotExpire ? 1 : 0,
      status: "active",
      documentId,
      requestedAt: null,
      requestedBy: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  audit(actor, "credential.create", credentialId, { userId, typeId: type.id });
  return { id: credentialId };
}

export function editCredential(actor: Actor, credentialId: string, input: CertInput) {
  const current = requireOwn(actor, credentialId);
  if (current.status === "revoked") throw new ServiceError("That credential is revoked.");
  const office = canManageMoney(roleOf(actor));
  if (!office && current.userId !== actor.userId) throw new ServiceError("Credential not found.");
  if (roleOf(actor) === "viewer") throw new ServiceError("Your role cannot change credentials.");
  const type = requireType(actor.orgId, input.typeId.trim(), true);
  const userId = office ? assertPerson(actor, input.userId) : current.userId;
  const dates = datesOf(input);
  const documentId = input.upload ? storeCard(actor, input.upload) : current.documentId;
  const now = nowIso();
  getDb()
    .update(crewCredentials)
    .set({
      userId,
      typeId: type.id,
      number: cleanNumber(input.number),
      issuedOn: dates.issuedOn,
      expiresOn: dates.expiresOn,
      doesNotExpire: dates.doesNotExpire ? 1 : 0,
      documentId,
      updatedAt: now,
    })
    .where(and(eq(crewCredentials.id, current.id), eq(crewCredentials.orgId, actor.orgId)))
    .run();
  audit(actor, "credential.edit", current.id, { userId, typeId: type.id });
  return { id: current.id };
}

function requireOwn(actor: Actor, credentialId: string) {
  const row = getDb()
    .select()
    .from(crewCredentials)
    .where(and(eq(crewCredentials.id, credentialId), eq(crewCredentials.orgId, actor.orgId)))
    .get();
  if (!row) throw new ServiceError("Credential not found.");
  if (roleOf(actor) === "field" && row.userId !== actor.userId) throw new ServiceError("Credential not found.");
  return row;
}

export function revokeCredential(actor: Actor, credentialId: string) {
  assertOffice(actor);
  const row = requireOwn(actor, credentialId);
  if (row.status === "revoked") throw new ServiceError("That credential is revoked.");
  const now = nowIso();
  getDb()
    .update(crewCredentials)
    .set({ status: "revoked", updatedAt: now })
    .where(and(eq(crewCredentials.id, row.id), eq(crewCredentials.orgId, actor.orgId)))
    .run();
  audit(actor, "credential.revoke", row.id, { userId: row.userId });
  return { id: row.id };
}

export function markCredentialRequested(actor: Actor, credentialId: string) {
  assertOffice(actor);
  const row = requireOwn(actor, credentialId);
  if (row.requestedAt) throw new ServiceError("Already requested.");
  const now = nowIso();
  getDb()
    .update(crewCredentials)
    .set({ requestedAt: now, requestedBy: actor.userId, updatedAt: now })
    .where(and(eq(crewCredentials.id, row.id), eq(crewCredentials.orgId, actor.orgId)))
    .run();
  audit(actor, "credential.request", row.id, { userId: row.userId });
  return { id: row.id, requestedAt: now };
}

export function saveCredentialTypes(actor: Actor, rows: { id?: string; name: string; required: boolean; archived: boolean }[]) {
  assertOffice(actor);
  const existing = new Map(typesOf(actor.orgId).map((row) => [row.id, row]));
  const now = nowIso();
  let order = 0;
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    if (name.length > 80) throw new ServiceError("Keep the type name under 80 characters.");
    const idValue = (row.id ?? "").trim();
    if (idValue) {
      const prior = existing.get(idValue);
      if (!prior) throw new ServiceError("That type is not in your company.");
      getDb()
        .update(credentialTypes)
        .set({ name, required: row.required ? 1 : 0, archived: row.archived ? 1 : 0, sortOrder: order, updatedAt: now })
        .where(and(eq(credentialTypes.id, prior.id), eq(credentialTypes.orgId, actor.orgId)))
        .run();
    } else {
      getDb()
        .insert(credentialTypes)
        .values({
          id: id("ctype"),
          orgId: actor.orgId,
          name,
          required: row.required ? 1 : 0,
          archived: row.archived ? 1 : 0,
          sortOrder: order,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    order += 1;
  }
  audit(actor, "credential.type", actor.orgId, { count: order });
}

export function certAssignWarning(actor: Actor, userIds: string[]): string | null {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return null;
  const today = todayFor(actor.orgId);
  const types = new Map(typesOf(actor.orgId).map((row) => [row.id, row]));
  const people = new Map(peopleOf(actor.orgId).map((row) => [row.userId, row.name]));
  const notes: string[] = [];
  for (const userId of ids) {
    const hit = rowsOf(actor.orgId).find((row) => {
      if (row.userId !== userId || row.status === "revoked") return false;
      const type = types.get(row.typeId);
      if (!type || type.required !== 1) return false;
      return certBucket(row.expiresOn, row.doesNotExpire === 1, today) === "expired";
    });
    if (!hit) continue;
    const type = types.get(hit.typeId);
    notes.push(`${people.get(userId) ?? "Crew"} · ${type?.name ?? "Credential"}`);
  }
  return notes.length ? notes.join(", ") : null;
}

export function fieldOwnsCredentialFile(orgId: string, userId: string, documentId: string) {
  const row = getDb()
    .select()
    .from(crewCredentials)
    .where(and(eq(crewCredentials.orgId, orgId), eq(crewCredentials.documentId, documentId), eq(crewCredentials.userId, userId)))
    .get();
  return Boolean(row);
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

export function credentialCsv(actor: Actor) {
  const rows = listCredentials(actor);
  const header = ["Person", "Type", "Number", "Issued", "Expires", "Status", "Requested"];
  const body = rows.map((row) =>
    [row.personName, row.typeName, csvCertNumber(roleOf(actor), row.number), row.issuedOn, row.expiresOn ?? "", row.statusLabel, row.requestedAt ? row.requestedAt.slice(0, 10) : ""]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...body].join("\n");
}

export type { TypeRow };
