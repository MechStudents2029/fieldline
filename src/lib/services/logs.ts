import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  activities,
  dailyLogEvents,
  dailyLogPhotos,
  dailyLogs,
  documents,
  projects,
  tasks,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canAddFieldNotes, canManageMoney, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { tagLogEquipment } from "@/lib/services/equipment";
import { calendarForOrg, formatHours, timeBoard, workedMinutes } from "@/lib/services/time";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

/**
 * Visibility is internal or client. There is no private-to-author flag.
 * The client portal receives published client logs only: work notes, planned
 * next, hand-entered weather, deliveries, visitors, and that log's photos.
 * Delays, safety notes, crew names, hours, and costs stay off the portal.
 * After a log is client-visible, only the office can edit it.
 * A log date is the company-local calendar day. A punch counts on the local
 * day of its clock-in, including a shift that crosses midnight. lookupWeather is a stub.
 */

type LogRow = typeof dailyLogs.$inferSelect;
type Writer = Pick<ReturnType<typeof getDb>, "insert" | "select" | "update" | "delete">;

export type LogInput = {
  notes?: string | null;
  plannedNext?: string | null;
  weatherSky?: string | null;
  weatherHighF?: string | null;
  weatherLowF?: string | null;
  weatherLostHours?: string | null;
  weatherImpact?: string | null;
  delayCause?: string | null;
  delayHours?: string | null;
  deliveries?: string | null;
  visitors?: string | null;
  safetyNote?: string | null;
};

export type ClientDailyLog = {
  id: string;
  logDate: string;
  notes: string;
  plannedNext: string | null;
  weatherSky: string | null;
  weatherHighF: number | null;
  weatherLowF: number | null;
  weatherLostMinutes: number | null;
  weatherImpact: string | null;
  deliveries: string | null;
  visitors: string | null;
  photos: { id: string; caption: string }[];
};

/** Stub. Crew type the sky and temperature. This does not call a weather service. */
export function lookupWeather(): null {
  return null;
}

export function mapLink(address: string): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(address)}`;
}

export function openDailyLog(actor: Actor, projectId: string, logDate: string, now = Date.now()) {
  assertWriter(actor);
  const zone = calendarForOrg(actor.orgId).timeZone;
  const day = logDate.trim() ? requireDay(logDate, now, zone) : localDay(now, zone);
  const db = officeOrThrow(actor);
  requireProject(db, actor.orgId, projectId);
  const existing = activeLog(db, actor.orgId, projectId, actor.userId, day);
  if (existing) return existing;
  const stamp = new Date(now).toISOString();
  const logId = id("dlog");
  const after = { status: "draft", visibility: "internal", logDate: day, projectId, notes: null };
  db.transaction((tx) => {
    tx.insert(dailyLogs)
      .values({
        id: logId,
        orgId: actor.orgId,
        projectId,
        authorId: actor.userId,
        logDate: day,
        status: "draft",
        visibility: "internal",
        notes: null,
        plannedNext: null,
        weatherSky: null,
        weatherHighF: null,
        weatherLowF: null,
        weatherLostMinutes: null,
        weatherImpact: null,
        delayCause: null,
        delayMinutes: null,
        deliveries: null,
        visitors: null,
        safetyNote: null,
        publishedAt: null,
        voidReason: null,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .run();
    record(tx, actor, logId, "created", null, after, null, stamp);
  });
  return db.select().from(dailyLogs).where(eq(dailyLogs.id, logId)).get()!;
}

export function saveDailyLog(actor: Actor, logId: string, input: LogInput, equipmentIds?: string[]) {
  const db = officeOrThrow(actor);
  const log = requireEditable(db, actor, logId);
  const next = normalize(input, log.notes);
  const stamp = nowIso();
  db.transaction((tx) => {
    tx.update(dailyLogs)
      .set({ ...next, updatedAt: stamp })
      .where(and(eq(dailyLogs.id, log.id), eq(dailyLogs.orgId, actor.orgId)))
      .run();
    record(tx, actor, log.id, "edited", snapshot(log), snapshot({ ...log, ...next }), null, stamp);
  });
  if (equipmentIds) tagLogEquipment(actor, logId, equipmentIds);
}

export function publishDailyLog(actor: Actor, logId: string, input: LogInput, now = Date.now(), equipmentIds?: string[]) {
  const db = officeOrThrow(actor);
  const log = requireEditable(db, actor, logId);
  const next = normalize(input, log.notes);
  if (!next.notes) throw new ServiceError("Add a note before publishing.");
  if (log.status === "published") {
    saveDailyLog(actor, logId, input, equipmentIds);
    return;
  }
  const stamp = new Date(now).toISOString();
  db.transaction((tx) => {
    tx.update(dailyLogs)
      .set({ ...next, status: "published", publishedAt: stamp, updatedAt: stamp })
      .where(and(eq(dailyLogs.id, log.id), eq(dailyLogs.orgId, actor.orgId), eq(dailyLogs.status, "draft")))
      .run();
    record(tx, actor, log.id, "published", snapshot(log), snapshot({ ...log, ...next, status: "published" }), null, stamp);
    tx.insert(activities)
      .values({
        id: id("act"),
        orgId: actor.orgId,
        entityType: "project",
        entityId: log.projectId,
        type: "note",
        actorType: "user",
        actorId: actor.userId,
        summary: `Published the daily log for ${log.logDate}.`,
        payloadJson: null,
        createdAt: stamp,
      })
      .run();
  });
  if (equipmentIds) tagLogEquipment(actor, logId, equipmentIds);
}

export function setLogVisibility(actor: Actor, logId: string, visibility: string) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Only the office can change who sees a log.");
  const next = visibility === "client" ? "client" : visibility === "internal" ? "internal" : null;
  if (!next) throw new ServiceError("Pick internal or client.");
  const db = officeOrThrow(actor);
  const log = requireLog(db, actor.orgId, logId);
  if (log.status === "void") throw new ServiceError("Voided logs stay on the record.");
  if (log.status !== "published") throw new ServiceError("Publish the log before sharing it with the client.");
  if (log.visibility === next) return;
  const stamp = nowIso();
  db.transaction((tx) => {
    tx.update(dailyLogs)
      .set({ visibility: next, updatedAt: stamp })
      .where(and(eq(dailyLogs.id, log.id), eq(dailyLogs.orgId, actor.orgId)))
      .run();
    record(tx, actor, log.id, "visibility", snapshot(log), snapshot({ ...log, visibility: next }), null, stamp);
    tx.insert(activities)
      .values({
        id: id("act"),
        orgId: actor.orgId,
        entityType: "project",
        entityId: log.projectId,
        type: "note",
        actorType: "user",
        actorId: actor.userId,
        summary:
          next === "client"
            ? `Shared the ${log.logDate} daily log on the client portal.`
            : `Removed the ${log.logDate} daily log from the client portal.`,
        payloadJson: null,
        createdAt: stamp,
      })
      .run();
  });
}

export function voidDailyLog(actor: Actor, logId: string, reason: string) {
  const why = requireReason(reason);
  const db = officeOrThrow(actor);
  const log = requireLog(db, actor.orgId, logId);
  if (log.status === "void") throw new ServiceError("That log is already void.");
  if (log.authorId !== actor.userId && !canManageMoney(actor.role as Role)) {
    throw new ServiceError("You can void your own log.");
  }
  if (log.visibility === "client" && !canManageMoney(actor.role as Role)) {
    throw new ServiceError("The office owns this log once it is on the client portal.");
  }
  const stamp = nowIso();
  db.transaction((tx) => {
    tx.update(dailyLogs)
      .set({ status: "void", voidReason: why, updatedAt: stamp })
      .where(and(eq(dailyLogs.id, log.id), eq(dailyLogs.orgId, actor.orgId)))
      .run();
    record(tx, actor, log.id, "voided", snapshot(log), snapshot({ ...log, status: "void" }), why, stamp);
  });
}

export function linkLogPhoto(actor: Actor, logId: string, documentId: string) {
  const db = officeOrThrow(actor);
  const log = requireEditable(db, actor, logId);
  const document = db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.orgId, actor.orgId), eq(documents.projectId, log.projectId)))
    .get();
  if (!document) throw new ServiceError("Photo not found on this job.");
  const stamp = nowIso();
  db.insert(dailyLogPhotos)
    .values({ id: id("dlph"), orgId: actor.orgId, logId: log.id, documentId, createdAt: stamp })
    .run();
  record(db, actor, log.id, "photo", null, { documentId }, null, stamp);
}

export function crewForLog(orgId: string, projectId: string, logDate: string) {
  const db = officeDb(orgId) ?? getDb();
  const rows = db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.projectId, projectId)))
    .all()
    .filter((entry) => entry.status !== "void" && localDay(Date.parse(entry.clockInAt), calendarForOrg(orgId).timeZone) === logDate);
  const byCode = new Map<string, number>();
  const people = new Set<string>();
  let includesUnapproved = false;
  for (const entry of rows) {
    people.add(entry.userId);
    if (entry.status !== "approved") includesUnapproved = true;
    const minutes = workedMinutes(entry);
    byCode.set(entry.costCode, (byCode.get(entry.costCode) ?? 0) + minutes);
  }
  const codes = [...byCode.entries()]
    .map(([costCode, minutes]) => ({ costCode, minutes }))
    .sort((a, b) => a.costCode.localeCompare(b.costCode));
  return {
    headcount: people.size,
    minutes: codes.reduce((sum, row) => sum + row.minutes, 0),
    includesUnapproved,
    byCode: codes,
    hoursLabel: formatHours(codes.reduce((sum, row) => sum + row.minutes, 0)),
  };
}

export function jobLogs(actor: Actor, projectId: string) {
  const db = officeOrThrow(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) return null;
  const rows = db
    .select({ log: dailyLogs, author: users.name })
    .from(dailyLogs)
    .innerJoin(users, eq(users.id, dailyLogs.authorId))
    .where(and(eq(dailyLogs.orgId, actor.orgId), eq(dailyLogs.projectId, project.id)))
    .all()
    .sort((a, b) => b.log.logDate.localeCompare(a.log.logDate) || b.log.createdAt.localeCompare(a.log.createdAt));
  const calendar = calendarForOrg(actor.orgId);
  return { project, logs: rows, today: localDay(Date.now(), calendar.timeZone), timeZone: calendar.timeZone };
}

export function logDetail(actor: Actor, logId: string) {
  const db = officeOrThrow(actor);
  const log = db.select().from(dailyLogs).where(and(eq(dailyLogs.id, logId), eq(dailyLogs.orgId, actor.orgId))).get();
  if (!log) return null;
  const project = db.select().from(projects).where(and(eq(projects.id, log.projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) return null;
  const author = db.select().from(users).where(eq(users.id, log.authorId)).get();
  const photos = db
    .select({ id: documents.id, filename: documents.filename, metadataJson: documents.metadataJson })
    .from(dailyLogPhotos)
    .innerJoin(documents, eq(documents.id, dailyLogPhotos.documentId))
    .where(and(eq(dailyLogPhotos.logId, log.id), eq(dailyLogPhotos.orgId, actor.orgId)))
    .all();
  const events = db
    .select({ event: dailyLogEvents, actorName: users.name })
    .from(dailyLogEvents)
    .leftJoin(users, eq(users.id, dailyLogEvents.actorId))
    .where(and(eq(dailyLogEvents.logId, log.id), eq(dailyLogEvents.orgId, actor.orgId)))
    .all()
    .sort((a, b) => a.event.createdAt.localeCompare(b.event.createdAt));
  const office = canManageMoney(actor.role as Role);
  const canEdit = log.status !== "void" && (office || (log.authorId === actor.userId && log.visibility === "internal"));
  return {
    log,
    project: { id: project.id, name: project.name, address: project.address },
    authorName: author?.name || "Crew",
    photos,
    events,
    crew: crewForLog(actor.orgId, log.projectId, log.logDate),
    canEdit,
    canShare: office && log.status === "published",
  };
}

/** Published client logs for the portal. No names, hours, delays, or safety. */
export function clientDailyLogs(projectId: string): ClientDailyLog[] {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return [];
  const logs = db
    .select()
    .from(dailyLogs)
    .where(
      and(
        eq(dailyLogs.orgId, project.orgId),
        eq(dailyLogs.projectId, project.id),
        eq(dailyLogs.status, "published"),
        eq(dailyLogs.visibility, "client"),
      ),
    )
    .all()
    .sort((a, b) => b.logDate.localeCompare(a.logDate));
  return logs.map((log) => {
    const photos = db
      .select({ id: documents.id, metadataJson: documents.metadataJson })
      .from(dailyLogPhotos)
      .innerJoin(documents, eq(documents.id, dailyLogPhotos.documentId))
      .where(and(eq(dailyLogPhotos.logId, log.id), eq(dailyLogPhotos.orgId, project.orgId)))
      .all();
    return {
      id: log.id,
      logDate: log.logDate,
      notes: log.notes || "",
      plannedNext: log.plannedNext,
      weatherSky: log.weatherSky,
      weatherHighF: log.weatherHighF,
      weatherLowF: log.weatherLowF,
      weatherLostMinutes: log.weatherLostMinutes,
      weatherImpact: log.weatherImpact,
      deliveries: log.deliveries,
      visitors: log.visitors,
      photos: photos.map((photo) => ({ id: photo.id, caption: captionOf(photo.metadataJson) })),
    };
  });
}

export function missingDailyLogs(orgId: string, now = Date.now()) {
  const db = officeDb(orgId);
  if (!db) return [];
  const calendar = calendarForOrg(orgId);
  const day = addCalendarDays(localDay(now, calendar.timeZone), -1);
  const punches = db
    .select()
    .from(timeEntries)
    .where(eq(timeEntries.orgId, orgId))
    .all()
    .filter((entry) => entry.status !== "void" && localDay(Date.parse(entry.clockInAt), calendar.timeZone) === day);
  const covered = new Set(
    db
      .select()
      .from(dailyLogs)
      .where(and(eq(dailyLogs.orgId, orgId), eq(dailyLogs.logDate, day), eq(dailyLogs.status, "published")))
      .all()
      .map((log) => log.projectId),
  );
  const ids = [...new Set(punches.map((entry) => entry.projectId))].filter((projectId) => !covered.has(projectId));
  if (ids.length === 0) return [];
  const names = new Map(
    db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.orgId, orgId))
      .all()
      .map((project) => [project.id, project.name]),
  );
  return ids.map((projectId) => ({ projectId, projectName: names.get(projectId) || "Job", logDate: day }));
}

export function jobLogAnswer(orgId: string, question: string, now = Date.now()) {
  const match = question.match(/what happened on\s+(.+?)\s+yesterday\??/i);
  const calendar = calendarForOrg(orgId);
  const day = addCalendarDays(localDay(now, calendar.timeZone), -1);
  if (!match) {
    return {
      answer: "Ask it as: what happened on Okonkwo yesterday?",
      rows: [] as { label: string; amountCents: null; detail: string }[],
    };
  }
  const db = officeDb(orgId);
  if (!db) return { answer: "This company is not on the signed-in account.", rows: [] };
  const needle = match[1].trim().toLowerCase();
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .all()
    .find((row) => row.name.toLowerCase().includes(needle));
  if (!project) return { answer: "No job matches that name.", rows: [] };
  const logs = db
    .select({ log: dailyLogs, author: users.name })
    .from(dailyLogs)
    .innerJoin(users, eq(users.id, dailyLogs.authorId))
    .where(
      and(
        eq(dailyLogs.orgId, orgId),
        eq(dailyLogs.projectId, project.id),
        eq(dailyLogs.logDate, day),
        eq(dailyLogs.status, "published"),
      ),
    )
    .all();
  if (logs.length === 0) {
    return { answer: `No published log for ${project.name} yesterday (${day}).`, rows: [] };
  }
  const rows = logs.map((row) => ({
    label: project.name,
    amountCents: null as null,
    detail: `${row.log.logDate} · ${row.author} · published log ${row.log.id}`,
  }));
  const answer = logs
    .map((row) => `${row.author} published a log on ${row.log.logDate}: ${row.log.notes || "No note."}`)
    .join(" ");
  return { answer, rows };
}

export function myDay(actor: Actor, now = Date.now()) {
  const db = officeOrThrow(actor);
  const board = timeBoard(actor, now);
  const calendar = calendarForOrg(actor.orgId);
  const day = localDay(now, calendar.timeZone);
  const taskRows = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.orgId, actor.orgId), eq(tasks.assigneeUserId, actor.userId), eq(tasks.status, "open")))
    .all()
    .sort((a, b) => (a.dueAt || "").localeCompare(b.dueAt || ""));
  const projectIds = new Set<string>();
  if (board.open) projectIds.add(board.open.projectId);
  for (const task of taskRows) {
    if (task.relatedType === "project" && task.relatedId) projectIds.add(task.relatedId);
  }
  for (const entry of board.entries) {
    if (localDay(Date.parse(entry.clockInAt), calendar.timeZone) === day) projectIds.add(entry.projectId);
  }
  const jobs = db
    .select({ id: projects.id, name: projects.name, address: projects.address, status: projects.status })
    .from(projects)
    .where(eq(projects.orgId, actor.orgId))
    .all()
    .filter((project) => projectIds.has(project.id) && project.status !== "cancelled")
    .sort((a, b) => a.name.localeCompare(b.name));
  const todayLog = board.open ? activeLog(db, actor.orgId, board.open.projectId, actor.userId, day) : null;
  return {
    day,
    timeZone: calendar.timeZone,
    weekStartsOn: calendar.weekStartsOn,
    open: board.open
      ? {
          projectId: board.open.projectId,
          projectName: board.jobs.find((job) => job.id === board.open?.projectId)?.name || "Job",
          costCode: board.open.costCode,
          status: board.open.status,
          clockInAt: board.open.clockInAt,
        }
      : null,
    jobs: jobs.map((job) => ({ ...job, map: job.address ? mapLink(job.address) : null })),
    tasks: taskRows.map((task) => ({ id: task.id, title: task.title, relatedId: task.relatedType === "project" ? task.relatedId : null })),
    flags: board.flags.map((flag) => flag.detail),
    clockJobs: board.jobs,
    codes: board.codes,
    todayLogId: todayLog?.id ?? null,
    todayLogStatus: todayLog?.status ?? null,
  };
}

function activeLog(db: Writer, orgId: string, projectId: string, authorId: string, logDate: string) {
  return db
    .select()
    .from(dailyLogs)
    .where(
      and(
        eq(dailyLogs.orgId, orgId),
        eq(dailyLogs.projectId, projectId),
        eq(dailyLogs.authorId, authorId),
        eq(dailyLogs.logDate, logDate),
        ne(dailyLogs.status, "void"),
      ),
    )
    .get();
}

function requireEditable(db: Writer, actor: Actor, logId: string) {
  assertWriter(actor);
  const log = requireLog(db, actor.orgId, logId);
  if (log.status === "void") throw new ServiceError("Voided logs stay on the record.");
  const office = canManageMoney(actor.role as Role);
  if (log.authorId !== actor.userId && !office) throw new ServiceError("You can edit your own log.");
  if (log.visibility === "client" && !office) throw new ServiceError("The office owns this log once it is on the client portal.");
  return log;
}

function requireLog(db: Writer, orgId: string, logId: string) {
  const log = db.select().from(dailyLogs).where(and(eq(dailyLogs.id, logId), eq(dailyLogs.orgId, orgId))).get();
  if (!log) throw new ServiceError("Daily log not found.");
  return log;
}

function requireProject(db: Writer, orgId: string, projectId: string) {
  const project = db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  return project;
}

function snapshot(log: {
  status: string;
  visibility: string;
  notes: string | null;
  plannedNext: string | null;
  weatherSky: string | null;
  weatherHighF: number | null;
  weatherLowF: number | null;
  weatherLostMinutes: number | null;
  weatherImpact: string | null;
  delayCause: string | null;
  delayMinutes: number | null;
  deliveries: string | null;
  visitors: string | null;
  safetyNote: string | null;
}) {
  return {
    status: log.status,
    visibility: log.visibility,
    notes: log.notes,
    plannedNext: log.plannedNext,
    weatherSky: log.weatherSky,
    weatherHighF: log.weatherHighF,
    weatherLowF: log.weatherLowF,
    weatherLostMinutes: log.weatherLostMinutes,
    weatherImpact: log.weatherImpact,
    delayCause: log.delayCause,
    delayMinutes: log.delayMinutes,
    deliveries: log.deliveries,
    visitors: log.visitors,
    safetyNote: log.safetyNote,
  };
}

function record(tx: Writer, actor: Actor, logId: string, type: string, before: unknown, after: unknown, reason: string | null, stamp: string) {
  tx.insert(dailyLogEvents)
    .values({
      id: id("dlev"),
      orgId: actor.orgId,
      logId,
      actorId: actor.userId,
      type,
      reason,
      beforeJson: before == null ? null : JSON.stringify(before),
      afterJson: JSON.stringify(after),
      createdAt: stamp,
    })
    .run();
}

function normalize(input: LogInput, previousNotes: string | null) {
  const notes = textBlock(input.notes ?? previousNotes, 4000);
  return {
    notes,
    plannedNext: textBlock(input.plannedNext, 2000),
    weatherSky: shortText(input.weatherSky, 80),
    weatherHighF: temp(input.weatherHighF),
    weatherLowF: temp(input.weatherLowF),
    weatherLostMinutes: hoursToMinutes(input.weatherLostHours),
    weatherImpact: textBlock(input.weatherImpact, 2000),
    delayCause: textBlock(input.delayCause, 500),
    delayMinutes: hoursToMinutes(input.delayHours),
    deliveries: textBlock(input.deliveries, 2000),
    visitors: textBlock(input.visitors, 2000),
    safetyNote: textBlock(input.safetyNote, 2000),
  };
}

function textBlock(value: string | null | undefined, max: number) {
  const text = (value ?? "").trim();
  if (!text) return null;
  if (text.length > max) throw new ServiceError("Keep that note shorter.");
  return text;
}

function shortText(value: string | null | undefined, max: number) {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (text.length > max) throw new ServiceError("Keep that note shorter.");
  return text;
}

function temp(value: string | null | undefined) {
  if (value == null || value.trim() === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < -80 || number > 140) throw new ServiceError("Enter the temperature in whole degrees.");
  return number;
}

function hoursToMinutes(value: string | null | undefined) {
  if (value == null || value.trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 24) throw new ServiceError("Hours have to be between 0 and 24.");
  return Math.round(number * 60);
}

function requireDay(value: string, now: number, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new ServiceError("Pick a date.");
  }
  if (value > localDay(now, timeZone)) throw new ServiceError("A log can't be dated in the future.");
  return value;
}

function requireReason(value: string) {
  const reason = value.trim().replace(/\s+/g, " ");
  if (reason.length < 3 || reason.length > 200) throw new ServiceError("Add a short reason.");
  return reason;
}

function assertWriter(actor: Actor) {
  if (!canAddFieldNotes(actor.role as Role)) throw new ServiceError("Viewers cannot write a daily log.");
}

function officeOrThrow(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function captionOf(metadataJson: string | null) {
  if (!metadataJson) return "";
  try {
    const parsed = JSON.parse(metadataJson) as { caption?: unknown };
    return typeof parsed.caption === "string" ? parsed.caption.trim() : "";
  } catch {
    return "";
  }
}

export type { LogRow };
