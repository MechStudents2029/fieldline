import { and, desc, eq } from "drizzle-orm";
import { clientUpdateFromFacts, clientUpdateModelSchema } from "@/lib/ai/client-update";
import { getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import { auditLogs, clientUpdateVersions, clientUpdates, organizations, projects } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canEditCrm, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { calendarForOrg } from "@/lib/services/time";
import { addCalendarDays, localDay } from "@/lib/time/calendar";
import { renderUpdateBody, type ClientUpdateDraft } from "@/lib/updates/draft";
import { gatherClientUpdateFacts } from "@/lib/updates/gather";
import { defaultRange, parseRange, type DayRange } from "@/lib/updates/range";

type UpdateRow = typeof clientUpdates.$inferSelect;

function assertOffice(actor: Actor) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Office writes client updates.");
}

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function requireProject(db: AppDatabase, orgId: string, projectId: string) {
  const project = db
    .select({ id: projects.id, name: projects.name, portalToken: projects.portalToken })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .get();
  if (!project) throw new ServiceError("That job is not in this company.");
  return project;
}

function requireUpdate(db: AppDatabase, orgId: string, updateId: string) {
  const row = db
    .select()
    .from(clientUpdates)
    .where(and(eq(clientUpdates.id, updateId), eq(clientUpdates.orgId, orgId)))
    .get();
  if (!row) throw new ServiceError("That update is not in this company.");
  return row;
}

function writeAudit(db: AppDatabase, orgId: string, actorId: string | null, action: string, entityId: string, payload: Record<string, unknown>, ip: string | null) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "client_update",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip,
      createdAt: nowIso(),
    })
    .run();
}

function parseDraft(json: string): ClientUpdateDraft | null {
  try {
    const parsed = clientUpdateModelSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function reasonOf(value: string) {
  const reason = value.trim().replace(/\s+/g, " ");
  if (reason.length < 3 || reason.length > 200) throw new ServiceError("Add a short reason.");
  return reason;
}

function snapshot(db: AppDatabase, row: UpdateRow, version: number, actorId: string | null) {
  db.insert(clientUpdateVersions)
    .values({
      id: id("upv"),
      orgId: row.orgId,
      updateId: row.id,
      version,
      body: row.body,
      sourcesJson: row.sourcesJson,
      photoIdsJson: row.photoIdsJson,
      createdAt: nowIso(),
      createdBy: actorId,
    })
    .run();
}

function zoneFor(orgId: string) {
  return calendarForOrg(orgId).timeZone;
}

export function listClientUpdates(actor: Actor, projectId: string) {
  const db = dbFor(actor);
  const project = requireProject(db, actor.orgId, projectId);
  const rows = db
    .select()
    .from(clientUpdates)
    .where(and(eq(clientUpdates.orgId, actor.orgId), eq(clientUpdates.projectId, projectId)))
    .orderBy(desc(clientUpdates.createdAt))
    .all();
  return { project, rows };
}

export function clientUpdateDetail(actor: Actor, projectId: string, updateId: string) {
  if (!canEditCrm(actor.role as Role)) return null;
  const db = dbFor(actor);
  const project = requireProject(db, actor.orgId, projectId);
  const row = db
    .select()
    .from(clientUpdates)
    .where(and(eq(clientUpdates.id, updateId), eq(clientUpdates.orgId, actor.orgId), eq(clientUpdates.projectId, projectId)))
    .get();
  if (!row) return null;
  const zone = zoneFor(actor.orgId);
  const facts = gatherClientUpdateFacts(db, actor.orgId, projectId, { start: row.rangeStart, end: row.rangeEnd }, zone);
  const versions = db
    .select()
    .from(clientUpdateVersions)
    .where(and(eq(clientUpdateVersions.orgId, actor.orgId), eq(clientUpdateVersions.updateId, row.id)))
    .orderBy(desc(clientUpdateVersions.version))
    .all();
  const photos = facts.logs.flatMap((log) => log.photos);
  const seen = new Set<string>();
  const unique = photos.filter((photo) => {
    if (seen.has(photo.id)) return false;
    seen.add(photo.id);
    return true;
  });
  return { project, update: row, versions, photos: unique, sources: parseDraft(row.sourcesJson) };
}

export function createClientUpdate(actor: Actor, projectId: string, range: DayRange | null, ip: string | null) {
  assertOffice(actor);
  const db = dbFor(actor);
  requireProject(db, actor.orgId, projectId);
  const zone = zoneFor(actor.orgId);
  let window: DayRange;
  try {
    window = range ? parseRange(range.start, range.end) : defaultRange(Date.now(), zone);
  } catch (error) {
    throw new ServiceError(error instanceof Error ? error.message : "Choose a start and end date.");
  }
  const facts = gatherClientUpdateFacts(db, actor.orgId, projectId, window, zone);
  const draft = clientUpdateFromFacts(facts);
  const updateId = id("upd");
  const now = nowIso();
  db.insert(clientUpdates)
    .values({
      id: updateId,
      orgId: actor.orgId,
      projectId,
      rangeStart: window.start,
      rangeEnd: window.end,
      status: "draft",
      body: renderUpdateBody(draft),
      sourcesJson: JSON.stringify(draft),
      photoIdsJson: JSON.stringify(draft.photoIds),
      publishedAt: null,
      viewedAt: null,
      unpublishedAt: null,
      unpublishReason: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  writeAudit(db, actor.orgId, actor.userId, "client_update.draft", updateId, { rangeStart: window.start, rangeEnd: window.end }, ip);
  return { id: updateId };
}

export function saveClientUpdate(actor: Actor, updateId: string, body: string, photoIds: string[], ip: string | null) {
  assertOffice(actor);
  const db = dbFor(actor);
  const row = requireUpdate(db, actor.orgId, updateId);
  const text = body.trim();
  if (!text) throw new ServiceError("Write the update.");
  if (text.length > 8000) throw new ServiceError("Shorten the update.");
  const zone = zoneFor(actor.orgId);
  const facts = gatherClientUpdateFacts(db, actor.orgId, row.projectId, { start: row.rangeStart, end: row.rangeEnd }, zone);
  const allowed = new Set(facts.logs.flatMap((log) => log.photos.map((photo) => photo.id)));
  const picked = [...new Set(photoIds.filter((photoId) => allowed.has(photoId)))];
  const nextVersion = row.status === "published" ? row.version + 1 : row.version;
  const now = nowIso();
  const next = {
    ...row,
    body: text,
    photoIdsJson: JSON.stringify(picked),
    version: nextVersion,
    updatedAt: now,
  };
  db.update(clientUpdates)
    .set({ body: text, photoIdsJson: JSON.stringify(picked), version: nextVersion, updatedAt: now })
    .where(and(eq(clientUpdates.id, row.id), eq(clientUpdates.orgId, actor.orgId)))
    .run();
  if (row.status === "published") snapshot(db, next, nextVersion, actor.userId);
  writeAudit(db, actor.orgId, actor.userId, "client_update.edit", row.id, { version: nextVersion }, ip);
  return { id: row.id, projectId: row.projectId };
}

export function publishClientUpdate(actor: Actor, updateId: string, ip: string | null) {
  assertOffice(actor);
  const db = dbFor(actor);
  const row = requireUpdate(db, actor.orgId, updateId);
  if (row.status === "published") return { id: row.id, projectId: row.projectId };
  const now = nowIso();
  const version = row.status === "unpublished" ? row.version + 1 : row.version;
  const published = { ...row, version, body: row.body, photoIdsJson: row.photoIdsJson, sourcesJson: row.sourcesJson };
  snapshot(db, published, version, actor.userId);
  db.update(clientUpdates)
    .set({
      status: "published",
      version,
      publishedAt: now,
      unpublishedAt: null,
      unpublishReason: null,
      viewedAt: row.status === "unpublished" ? null : row.viewedAt,
      updatedAt: now,
    })
    .where(and(eq(clientUpdates.id, row.id), eq(clientUpdates.orgId, actor.orgId)))
    .run();
  writeAudit(db, actor.orgId, actor.userId, "client_update.publish", row.id, { version }, ip);
  return { id: row.id, projectId: row.projectId };
}

export function unpublishClientUpdate(actor: Actor, updateId: string, reason: string, ip: string | null) {
  assertOffice(actor);
  const db = dbFor(actor);
  const row = requireUpdate(db, actor.orgId, updateId);
  if (row.status !== "published") throw new ServiceError("This update is not published.");
  const clean = reasonOf(reason);
  const now = nowIso();
  db.update(clientUpdates)
    .set({ status: "unpublished", unpublishedAt: now, unpublishReason: clean, updatedAt: now })
    .where(and(eq(clientUpdates.id, row.id), eq(clientUpdates.orgId, actor.orgId)))
    .run();
  writeAudit(db, actor.orgId, actor.userId, "client_update.unpublish", row.id, { reason: clean, version: row.version }, ip);
  return { id: row.id, projectId: row.projectId };
}

export type PortalUpdate = {
  id: string;
  rangeStart: string;
  rangeEnd: string;
  body: string;
  publishedAt: string;
  photos: { id: string; caption: string }[];
};

function photoIdsOf(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function portalClientUpdates(token: string, ip: string | null): { projectName: string; orgName: string; updates: PortalUpdate[] } | null {
  const owner = getDb();
  const project = owner
    .select({ id: projects.id, orgId: projects.orgId, name: projects.name })
    .from(projects)
    .where(eq(projects.portalToken, token))
    .get();
  if (!project) return null;
  const db = officeDb(project.orgId);
  if (!db) return null;
  const company = db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, project.orgId)).get();
  const rows = db
    .select()
    .from(clientUpdates)
    .where(and(eq(clientUpdates.orgId, project.orgId), eq(clientUpdates.projectId, project.id), eq(clientUpdates.status, "published")))
    .orderBy(desc(clientUpdates.publishedAt))
    .all();
  const now = nowIso();
  for (const row of rows) {
    if (row.viewedAt) continue;
    db.update(clientUpdates)
      .set({ viewedAt: now })
      .where(and(eq(clientUpdates.id, row.id), eq(clientUpdates.orgId, project.orgId)))
      .run();
    writeAudit(db, project.orgId, null, "client_update.view", row.id, { version: row.version }, ip);
    row.viewedAt = now;
  }
  const zone = zoneFor(project.orgId);
  return {
    projectName: project.name,
    orgName: company?.name ?? "",
    updates: rows.map((row) => {
      const facts = gatherClientUpdateFacts(db, project.orgId, project.id, { start: row.rangeStart, end: row.rangeEnd }, zone);
      const captions = new Map(facts.logs.flatMap((log) => log.photos.map((photo) => [photo.id, photo.caption])));
      return {
        id: row.id,
        rangeStart: row.rangeStart,
        rangeEnd: row.rangeEnd,
        body: row.body,
        publishedAt: row.publishedAt || row.updatedAt,
        photos: photoIdsOf(row.photoIdsJson)
          .filter((photoId) => captions.has(photoId))
          .map((photoId) => ({ id: photoId, caption: captions.get(photoId) || "" })),
      };
    }),
  };
}

export function staleClientUpdates(orgId: string, today: string, timeZone: string): { count: number; href: string | null } {
  const db = officeDb(orgId);
  if (!db) return { count: 0, href: null };
  const jobs = db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.status, "active")))
    .all();
  const published = db
    .select({ projectId: clientUpdates.projectId, publishedAt: clientUpdates.publishedAt })
    .from(clientUpdates)
    .where(and(eq(clientUpdates.orgId, orgId), eq(clientUpdates.status, "published")))
    .all();
  const cutoff = addCalendarDays(today, -7);
  const latest = new Map<string, string>();
  for (const row of published) {
    if (!row.publishedAt) continue;
    const day = localDay(Date.parse(row.publishedAt), timeZone);
    const prev = latest.get(row.projectId);
    if (!prev || day > prev) latest.set(row.projectId, day);
  }
  const stale = jobs
    .filter((job) => {
      const day = latest.get(job.id);
      return !day || day <= cutoff;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { count: stale.length, href: stale[0] ? `/projects/${stale[0].id}/updates` : null };
}
