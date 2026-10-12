import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  memberships,
  notifications,
  organizations,
  projects,
  timeEntries,
  timeEntryEvents,
  timeGeoOverrides,
  users,
} from "@/lib/db/schema";
import {
  DEFAULT_RADIUS_M,
  describePunch,
  evaluateSite,
  formatE6,
  isFlaggedVerdict,
  isGeoMode,
  isGeoUnit,
  metersToUnit,
  parseAccuracy,
  siteColumn,
  unitToMeters,
  type GeoMode,
  type GeoUnit,
  type SiteEval,
} from "@/lib/geo/fence";
import { id, nowIso } from "@/lib/ids";
import { canManageMoney, canManageSettings, type Role } from "@/lib/permissions";
import { emitAutomation, type AutomationEvent } from "@/lib/services/automations";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";

type Writer = Pick<AppDatabase, "insert" | "select" | "update">;
type Entry = typeof timeEntries.$inferSelect;

export type PunchReading = {
  projectId: string;
  shiftType: string;
  lat?: string | null;
  lng?: string | null;
  accuracy?: string | null;
};

export function geoUnitFor(orgId: string): GeoUnit {
  const db = officeDb(orgId);
  if (!db) return "ft";
  return policy(db, orgId).unit;
}

export function stampEdge(tx: Writer, actor: Actor, entryId: string, edge: "in" | "out", input: PunchReading): AutomationEvent | null {
  const org = policy(tx, actor.orgId);
  const member = tx
    .select({ requireLocation: memberships.requireLocation })
    .from(memberships)
    .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, actor.userId)))
    .get();
  const project = input.projectId
    ? tx
        .select({
          id: projects.id,
          name: projects.name,
          siteLatE6: projects.siteLatE6,
          siteLngE6: projects.siteLngE6,
          siteRadiusM: projects.siteRadiusM,
          pmUserId: projects.pmUserId,
        })
        .from(projects)
        .where(and(eq(projects.orgId, actor.orgId), eq(projects.id, input.projectId)))
        .get()
    : undefined;
  const point = pair(input.lat, input.lng);
  const result = evaluateSite({
    mode: org.mode,
    userRequiresLocation: member?.requireLocation === 1,
    projectId: input.projectId,
    shiftType: input.shiftType,
    pinLatE6: project?.siteLatE6 ?? null,
    pinLngE6: project?.siteLngE6 ?? null,
    radiusM: project?.siteRadiusM ?? null,
    defaultRadiusM: org.radiusM,
    latE6: point.lat,
    lngE6: point.lng,
    accuracyM: parseAccuracy(input.accuracy),
  });
  const stamp = nowIso();
  tx.update(timeEntries)
    .set(edge === "in" ? inColumns(result) : outColumns(result))
    .where(and(eq(timeEntries.id, entryId), eq(timeEntries.orgId, actor.orgId)))
    .run();
  if (result.verdict !== "outside" || !project) return null;
  notifySite(tx, actor, {
    entryId,
    projectId: project.id,
    projectName: project.name,
    pmUserId: project.pmUserId,
    distanceM: result.distanceM,
    unit: org.unit,
    edge,
    stamp,
  });
  return {
    orgId: actor.orgId,
    kind: "clock_outside",
    recordType: "time_entry",
    recordId: entryId,
    recordLabel: project.name,
    projectId: project.id,
    name: project.name,
  };
}

export function flushSiteEvents(events: (AutomationEvent | null)[]) {
  for (const event of events) {
    if (event) emitAutomation(event);
  }
}

export function siteGate(db: Writer, actor: Actor, entry: Entry): "block" | "warn" | null {
  if (!isFlaggedVerdict(entry.geoInVerdict) && !isFlaggedVerdict(entry.geoOutVerdict)) return null;
  if (latestOverride(db, actor.orgId, entry.id)) return null;
  const org = policy(db, actor.orgId);
  const member = db
    .select({ requireLocation: memberships.requireLocation })
    .from(memberships)
    .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, entry.userId)))
    .get();
  const required = org.mode === "require" || member?.requireLocation === 1;
  if (org.mode === "off" && member?.requireLocation !== 1) return null;
  return required ? "block" : "warn";
}

export function siteWarningText(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 site flag still open." : `${count} site flags still open.`;
}

export function saveGeoSettings(
  actor: Actor,
  input: { mode: string; radius: number; unit: string; requireUserIds: string[] },
) {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("Only an owner or admin can change these.");
  if (!isGeoMode(input.mode)) throw new ServiceError("Pick a geofence mode.");
  if (!isGeoUnit(input.unit)) throw new ServiceError("Pick feet or meters.");
  if (!Number.isFinite(input.radius) || input.radius <= 0) throw new ServiceError("Enter a radius.");
  const radiusM = unitToMeters(input.radius, input.unit);
  if (radiusM < 10 || radiusM > 100_000) throw new ServiceError("Radius must be between 10 m and 100 km.");
  const db = officeOrThrow(actor);
  const members = db.select().from(memberships).where(eq(memberships.orgId, actor.orgId)).all();
  const known = new Set(members.map((member) => member.userId));
  const required = new Set(input.requireUserIds.filter((userId) => known.has(userId)));
  const stamp = nowIso();
  db.transaction((tx) => {
    tx.update(organizations)
      .set({ geoMode: input.mode, geoRadiusM: radiusM, geoUnit: input.unit, updatedAt: stamp })
      .where(eq(organizations.id, actor.orgId))
      .run();
    for (const member of members) {
      tx.update(memberships)
        .set({ requireLocation: required.has(member.userId) ? 1 : 0 })
        .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, member.userId)))
        .run();
    }
  });
}

export function geoBoard(actor: Actor) {
  if (!canManageSettings(actor.role as Role)) return null;
  const db = officeOrThrow(actor);
  const org = policy(db, actor.orgId);
  const people = db
    .select({ userId: users.id, name: users.name, requireLocation: memberships.requireLocation })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    mode: org.mode,
    unit: org.unit,
    radius: metersToUnit(org.radiusM, org.unit),
    people,
  };
}

export function setSitePin(actor: Actor, projectId: string, input: { lat: string; lng: string; radius: string }) {
  assertOffice(actor);
  const db = officeOrThrow(actor);
  const project = requireProject(db, actor.orgId, projectId);
  const point = pair(input.lat, input.lng);
  if (point.lat == null || point.lng == null) throw new ServiceError("Enter a latitude and longitude.");
  const org = policy(db, actor.orgId);
  const radiusRaw = input.radius.trim();
  let radiusM: number | null = null;
  if (radiusRaw) {
    const value = Number(radiusRaw);
    if (!Number.isFinite(value) || value <= 0) throw new ServiceError("Enter a radius.");
    radiusM = unitToMeters(value, org.unit);
    if (radiusM < 10 || radiusM > 100_000) throw new ServiceError("Radius must be between 10 m and 100 km.");
  }
  db.update(projects)
    .set({ siteLatE6: point.lat, siteLngE6: point.lng, siteRadiusM: radiusM, updatedAt: nowIso() })
    .where(and(eq(projects.id, project.id), eq(projects.orgId, actor.orgId)))
    .run();
}

export function adoptSitePin(actor: Actor, projectId: string, entryId: string) {
  assertOffice(actor);
  const db = officeOrThrow(actor);
  const project = requireProject(db, actor.orgId, projectId);
  const entry = db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, actor.orgId), eq(timeEntries.id, entryId), eq(timeEntries.projectId, project.id)))
    .get();
  if (!entry || entry.clockInLatE6 == null || entry.clockInLngE6 == null) throw new ServiceError("That clock-in has no location.");
  db.update(projects)
    .set({ siteLatE6: entry.clockInLatE6, siteLngE6: entry.clockInLngE6, updatedAt: nowIso() })
    .where(and(eq(projects.id, project.id), eq(projects.orgId, actor.orgId)))
    .run();
}

export function sitePinView(actor: Actor, projectId: string) {
  if (!canManageMoney(actor.role as Role)) return null;
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const project = db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, projectId))).get();
  if (!project) return null;
  const org = policy(db, actor.orgId);
  const names = new Map(db.select({ id: users.id, name: users.name }).from(users).all().map((user) => [user.id, user.name]));
  const punches = db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, actor.orgId), eq(timeEntries.projectId, project.id)))
    .all()
    .filter((entry) => entry.clockInLatE6 != null && entry.clockInLngE6 != null)
    .sort((a, b) => b.clockInAt.localeCompare(a.clockInAt))
    .slice(0, 8)
    .map((entry) => ({
      id: entry.id,
      label: `${(names.get(entry.userId) || "Crew").split(" ")[0]} · ${formatE6(entry.clockInLatE6!)}`,
    }));
  return {
    lat: project.siteLatE6 == null ? "" : (project.siteLatE6 / 1_000_000).toFixed(6),
    lng: project.siteLngE6 == null ? "" : (project.siteLngE6 / 1_000_000).toFixed(6),
    radius: project.siteRadiusM == null ? "" : String(metersToUnit(project.siteRadiusM, org.unit)),
    unit: org.unit,
    punches,
  };
}

export function overrideSite(actor: Actor, entryId: string, reason: string) {
  assertOffice(actor);
  const why = reason.trim().replace(/\s+/g, " ");
  if (why.length < 3 || why.length > 200) throw new ServiceError("Add a short reason.");
  const db = officeOrThrow(actor);
  const entry = db.select().from(timeEntries).where(and(eq(timeEntries.orgId, actor.orgId), eq(timeEntries.id, entryId))).get();
  if (!entry || entry.status === "void") throw new ServiceError("That punch is not in this company.");
  if (!isFlaggedVerdict(entry.geoInVerdict) && !isFlaggedVerdict(entry.geoOutVerdict)) throw new ServiceError("No site flag on this punch.");
  const stamp = nowIso();
  const overrideId = id("tgeo");
  db.transaction((tx) => {
    tx.insert(timeGeoOverrides)
      .values({ id: overrideId, orgId: actor.orgId, entryId: entry.id, reason: why, createdAt: stamp, createdBy: actor.userId })
      .run();
    tx.insert(timeEntryEvents)
      .values({
        id: id("tev"),
        orgId: actor.orgId,
        entryId: entry.id,
        actorId: actor.userId,
        type: "site_override",
        reason: why,
        beforeJson: null,
        afterJson: JSON.stringify({ reason: why }),
        createdAt: stamp,
      })
      .run();
  });
  return { id: overrideId };
}

export function overrideReason(db: Writer, orgId: string, entryId: string): string | null {
  return latestOverride(db, orgId, entryId)?.reason ?? null;
}

export function overriddenIds(db: Writer, orgId: string): Set<string> {
  return new Set(db.select({ entryId: timeGeoOverrides.entryId }).from(timeGeoOverrides).where(eq(timeGeoOverrides.orgId, orgId)).all().map((row) => row.entryId));
}

export function punchSite(entry: Entry, unit: GeoUnit, overridden: boolean) {
  return describePunch({
    inVerdict: entry.geoInVerdict,
    outVerdict: entry.geoOutVerdict,
    inDistanceM: entry.geoInDistanceM,
    outDistanceM: entry.geoOutDistanceM,
    unit,
    overridden,
  });
}

export function punchSiteColumn(entry: Entry, unit: GeoUnit, overridden: boolean): string {
  const described = punchSite(entry, unit, overridden);
  return siteColumn(described.pill, described.overridden);
}

export function siteAttention(actor: Actor): { count: number; href: string | null } {
  const db = officeDb(actor.orgId);
  if (!db) return { count: 0, href: null };
  const org = policy(db, actor.orgId);
  if (org.mode === "off") return { count: 0, href: null };
  const office = canManageMoney(actor.role as Role);
  const pmJobs = new Set(
    db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.orgId, actor.orgId), eq(projects.pmUserId, actor.userId)))
      .all()
      .map((row) => row.id),
  );
  if (!office && pmJobs.size === 0) return { count: 0, href: null };
  const overrides = overriddenIds(db, actor.orgId);
  const count = db
    .select()
    .from(timeEntries)
    .where(eq(timeEntries.orgId, actor.orgId))
    .all()
    .filter((entry) => entry.status !== "void")
    .filter((entry) => office || pmJobs.has(entry.projectId))
    .filter((entry) => !overrides.has(entry.id))
    .filter((entry) => entry.geoInVerdict === "outside" || entry.geoOutVerdict === "outside").length;
  if (count === 0) return { count: 0, href: null };
  return { count, href: office ? "/time" : "/inbox" };
}

function notifySite(
  tx: Writer,
  actor: Actor,
  input: { entryId: string; projectId: string; projectName: string; pmUserId: string | null; distanceM: number | null; unit: GeoUnit; edge: "in" | "out"; stamp: string },
) {
  const pill = describePunch({
    inVerdict: input.edge === "in" ? "outside" : null,
    outVerdict: input.edge === "out" ? "outside" : null,
    inDistanceM: input.distanceM,
    outDistanceM: input.distanceM,
    unit: input.unit,
    overridden: false,
  }).pill;
  const snippet = `${input.edge === "in" ? "Clock in" : "Clock out"} · ${pill ?? "Outside"}`;
  const members = tx.select().from(memberships).where(eq(memberships.orgId, actor.orgId)).all();
  const recipients = new Set(members.filter((member) => member.role === "owner" || member.role === "admin").map((member) => member.userId));
  if (input.pmUserId) recipients.add(input.pmUserId);
  for (const userId of recipients) {
    tx.insert(notifications)
      .values({
        id: id("note"),
        orgId: actor.orgId,
        userId,
        kind: "site",
        commentId: null,
        entityType: "time_entry",
        entityId: input.entryId,
        projectId: input.projectId,
        actorId: actor.userId,
        actorName: actor.name,
        snippet,
        readAt: null,
        createdAt: input.stamp,
      })
      .run();
  }
}

function latestOverride(db: Writer, orgId: string, entryId: string) {
  return db
    .select()
    .from(timeGeoOverrides)
    .where(and(eq(timeGeoOverrides.orgId, orgId), eq(timeGeoOverrides.entryId, entryId)))
    .all()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
}

function policy(db: Writer, orgId: string): { mode: GeoMode; radiusM: number; unit: GeoUnit } {
  const org = db
    .select({ geoMode: organizations.geoMode, geoRadiusM: organizations.geoRadiusM, geoUnit: organizations.geoUnit })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .get();
  return {
    mode: org && isGeoMode(org.geoMode) ? org.geoMode : "off",
    radiusM: org && Number.isInteger(org.geoRadiusM) && org.geoRadiusM >= 10 ? org.geoRadiusM : DEFAULT_RADIUS_M,
    unit: org && isGeoUnit(org.geoUnit) ? org.geoUnit : "ft",
  };
}

function inColumns(result: SiteEval) {
  return {
    geoInVerdict: result.verdict,
    geoInDistanceM: result.distanceM,
    geoInAccuracyM: result.accuracyM,
    updatedAt: nowIso(),
  };
}

function outColumns(result: SiteEval) {
  return {
    geoOutVerdict: result.verdict,
    geoOutDistanceM: result.distanceM,
    geoOutAccuracyM: result.accuracyM,
    updatedAt: nowIso(),
  };
}

function pair(lat: string | null | undefined, lng: string | null | undefined) {
  const latitude = coord(lat, 90);
  const longitude = coord(lng, 180);
  if (latitude == null || longitude == null) return { lat: null, lng: null };
  return { lat: latitude, lng: longitude };
}

function coord(value: string | null | undefined, max: number) {
  if (value == null || value.trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < -max || number > max) return null;
  return Math.round(number * 1_000_000);
}

function requireProject(db: Writer, orgId: string, projectId: string) {
  const project = db.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).get();
  if (!project) throw new ServiceError("Job not found.");
  return project;
}

function assertOffice(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Only the office can review time.");
}

function officeOrThrow(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}
