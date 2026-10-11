import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb } from "@/lib/db/client";
import {
  auditLogs,
  documents,
  equipment,
  incidentActions,
  incidentPeople,
  incidentPhotos,
  incidents,
  memberships,
  projects,
  punchItems,
  safetyCheckItems,
  safetyChecks,
  safetyTemplateItems,
  safetyTemplates,
  safetyTopics,
  scheduleAssignees,
  scheduleItems,
  taskAssignees,
  tasks,
  timeEntries,
  toolboxAttendees,
  toolboxTalks,
  users,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canAddFieldNotes, canEditCrm, type Role } from "@/lib/permissions";
import { photoExtension, photoUploadError, rasterImageType } from "@/lib/security";
import { emitAutomation } from "@/lib/services/automations";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { calendarForOrg } from "@/lib/services/time";
import { addCalendarDays, localDay, localWeek } from "@/lib/time/calendar";

export const INCIDENT_KINDS = ["near_miss", "first_aid", "recordable", "property", "equipment"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const CHECK_RESULTS = ["pass", "fail", "na"] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

const KIND_LABEL: Record<string, string> = {
  near_miss: "Near miss",
  first_aid: "First aid",
  recordable: "Recordable",
  property: "Property damage",
  equipment: "Equipment failure",
};

const STATUS_LABEL: Record<string, string> = {
  upcoming: "Upcoming",
  missed: "Missed",
  completed: "Completed",
  open: "Open",
  void: "Void",
};

const SIGN = /^data:image\/png;base64,[a-z0-9+/=\s]+$/i;

export type PhotoUpload = { filename: string; bytes: Buffer };

export type TalkStatus = "upcoming" | "missed" | "completed" | "void";

type TalkRow = typeof toolboxTalks.$inferSelect;

export function incidentKindLabel(kind: string) {
  return KIND_LABEL[kind] ?? kind;
}

export function safetyStatusLabel(status: string) {
  return STATUS_LABEL[status] ?? status;
}

export function talkStatus(talk: { completedAt: string | null; voidedAt: string | null; scheduledOn: string }, today: string): TalkStatus {
  if (talk.voidedAt) return "void";
  if (talk.completedAt) return "completed";
  if (talk.scheduledOn < today) return "missed";
  return "upcoming";
}

function todayFor(orgId: string) {
  return localDay(Date.now(), calendarForOrg(orgId).timeZone);
}

function weekStartFor(orgId: string, today: string) {
  const calendar = calendarForOrg(orgId);
  const [year, month, date] = today.split("-").map(Number);
  const instant = Date.UTC(year, month - 1, date, 12);
  return localWeek(instant, calendar).startDay;
}

function clean(value: string, max: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function assertWriter(actor: Actor) {
  if (!canAddFieldNotes(actor.role as Role)) throw new ServiceError("Viewers cannot change safety records.");
}

function assertOffice(actor: Actor) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Office schedules safety records.");
}

function projectOf(orgId: string, projectId: string) {
  return getDb().select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).get() ?? null;
}

function memberName(orgId: string, userId: string) {
  const row = getDb()
    .select({ name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .get();
  return row?.name ?? null;
}

function audit(actor: Actor, action: string, entityType: string, entityId: string, payload: unknown) {
  getDb()
    .insert(auditLogs)
    .values({
      id: id("aud"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action,
      entityType,
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function storePhoto(orgId: string, projectId: string, upload: PhotoUpload, createdBy: string): string {
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
  getDb()
    .insert(documents)
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

function insertTodo(orgId: string, projectId: string, title: string, assigneeUserId: string | null, createdBy: string | null) {
  const now = nowIso();
  const taskId = id("task");
  getDb()
    .insert(tasks)
    .values({
      id: taskId,
      orgId,
      title,
      assigneeUserId,
      dueAt: null,
      relatedType: "project",
      relatedId: projectId,
      status: "open",
      notes: "",
      priority: "normal",
      tags: "",
      scheduleItemId: null,
      deadlineEdge: null,
      deadlineOffset: null,
      deadlineUnlinked: 0,
      remindDays: null,
      remindedFor: null,
      createdAt: now,
      updatedAt: now,
      createdBy,
    })
    .run();
  if (assigneeUserId) {
    getDb().insert(taskAssignees).values({ id: id("tasg"), orgId, taskId, userId: assigneeUserId, contactId: null }).run();
  }
  return taskId;
}

function taskOpen(orgId: string, taskId: string | null) {
  if (!taskId) return false;
  const task = getDb().select().from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.id, taskId))).get();
  return Boolean(task && task.status === "open");
}

function punchOpen(orgId: string, punchId: string | null) {
  if (!punchId) return false;
  const punch = getDb().select().from(punchItems).where(and(eq(punchItems.orgId, orgId), eq(punchItems.id, punchId))).get();
  return Boolean(punch && punch.status === "open");
}

function failedItemOpen(orgId: string, item: { result: string; todoId: string | null; punchId: string | null }) {
  if (item.result !== "fail") return false;
  if (!item.todoId && !item.punchId) return true;
  return taskOpen(orgId, item.todoId) || punchOpen(orgId, item.punchId);
}

export function canReadIncident(actor: Actor, createdBy: string) {
  if (canEditCrm(actor.role as Role)) return true;
  return actor.role === "field" && createdBy === actor.userId;
}

function talksIn(orgId: string) {
  return getDb().select().from(toolboxTalks).where(eq(toolboxTalks.orgId, orgId)).all();
}

function checksIn(orgId: string) {
  return getDb().select().from(safetyChecks).where(eq(safetyChecks.orgId, orgId)).all();
}

function itemsFor(orgId: string, checkId: string) {
  return getDb().select().from(safetyCheckItems).where(and(eq(safetyCheckItems.orgId, orgId), eq(safetyCheckItems.checkId, checkId))).all();
}

function incidentsIn(orgId: string) {
  return getDb().select().from(incidents).where(eq(incidents.orgId, orgId)).all();
}

function actionsFor(orgId: string, incidentId: string) {
  return getDb().select().from(incidentActions).where(and(eq(incidentActions.orgId, orgId), eq(incidentActions.incidentId, incidentId))).all();
}

function incidentOpen(orgId: string, incidentId: string) {
  return actionsFor(orgId, incidentId).some((action) => taskOpen(orgId, action.todoId));
}

export function safetyCounts(orgId: string, projectId: string) {
  const today = todayFor(orgId);
  const talks = talksIn(orgId).filter((talk) => talk.projectId === projectId && talkStatus(talk, today) === "missed").length;
  const checks = checksIn(orgId)
    .filter((check) => check.projectId === projectId && !check.voidedAt)
    .reduce((sum, check) => sum + itemsFor(orgId, check.id).filter((item) => failedItemOpen(orgId, item)).length, 0);
  const incidentCount = incidentsIn(orgId).filter((row) => row.projectId === projectId && !row.voidedAt && incidentOpen(orgId, row.id)).length;
  return { talks, checks, incidents: incidentCount };
}

export function safetyQueue(orgId: string, today: string) {
  const start = weekStartFor(orgId, today);
  const end = addCalendarDays(start, 7);
  const missed = talksIn(orgId).filter((talk) => {
    const status = talkStatus(talk, today);
    return status === "missed" && talk.scheduledOn >= start && talk.scheduledOn < end;
  });
  const failed = checksIn(orgId)
    .filter((check) => !check.voidedAt)
    .filter((check) => itemsFor(orgId, check.id).some((item) => failedItemOpen(orgId, item)));
  const openIncidents = incidentsIn(orgId).filter((row) => !row.voidedAt && incidentOpen(orgId, row.id));
  return {
    missed: { count: missed.length, href: missed.length ? "/safety?type=talk&status=missed" : null },
    failed: { count: failed.length, href: failed.length ? "/safety?type=check&status=open" : null },
    actions: { count: openIncidents.length, href: openIncidents.length ? "/safety?type=incident&status=open" : null },
  };
}

export type SafetyRow = {
  id: string;
  type: "talk" | "check" | "incident";
  typeLabel: string;
  title: string;
  status: string;
  statusLabel: string;
  projectId: string;
  projectName: string;
  when: string;
  href: string;
};

function projectNames(orgId: string) {
  return new Map(getDb().select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row.name]));
}

function topicTitle(orgId: string, topicId: string) {
  return getDb().select().from(safetyTopics).where(and(eq(safetyTopics.orgId, orgId), eq(safetyTopics.id, topicId))).get()?.title ?? "Toolbox talk";
}

export function listSafety(actor: Actor, filter: { type?: string; status?: string; job?: string; q?: string } = {}): SafetyRow[] {
  const today = todayFor(actor.orgId);
  const names = projectNames(actor.orgId);
  const rows: SafetyRow[] = [];
  for (const talk of talksIn(actor.orgId)) {
    const status = talkStatus(talk, today);
    rows.push({
      id: talk.id,
      type: "talk",
      typeLabel: "Talk",
      title: topicTitle(actor.orgId, talk.topicId),
      status,
      statusLabel: safetyStatusLabel(status),
      projectId: talk.projectId,
      projectName: names.get(talk.projectId) ?? "Job",
      when: talk.scheduledOn,
      href: `/projects/${talk.projectId}/safety/talks/${talk.id}`,
    });
  }
  for (const check of checksIn(actor.orgId)) {
    const open = !check.voidedAt && itemsFor(actor.orgId, check.id).some((item) => failedItemOpen(actor.orgId, item));
    const status = check.voidedAt ? "void" : open ? "open" : "completed";
    rows.push({
      id: check.id,
      type: "check",
      typeLabel: "Checklist",
      title: check.name,
      status,
      statusLabel: safetyStatusLabel(status),
      projectId: check.projectId,
      projectName: names.get(check.projectId) ?? "Job",
      when: check.completedAt.slice(0, 10),
      href: `/projects/${check.projectId}/safety?check=${check.id}`,
    });
  }
  for (const incident of incidentsIn(actor.orgId)) {
    if (!canReadIncident(actor, incident.createdBy)) continue;
    const status = incident.voidedAt ? "void" : incidentOpen(actor.orgId, incident.id) ? "open" : "completed";
    rows.push({
      id: incident.id,
      type: "incident",
      typeLabel: incidentKindLabel(incident.kind),
      title: incident.description,
      status,
      statusLabel: safetyStatusLabel(status),
      projectId: incident.projectId,
      projectName: names.get(incident.projectId) ?? "Job",
      when: incident.occurredAt.slice(0, 10),
      href: `/safety/incidents/${incident.id}`,
    });
  }
  const type = filter.type || "";
  const status = filter.status || "";
  const job = filter.job || "";
  const q = (filter.q || "").trim().toLowerCase();
  return rows
    .filter((row) => !type || row.type === type)
    .filter((row) => !status || row.status === status)
    .filter((row) => !job || row.projectId === job)
    .filter((row) => !q || `${row.title} ${row.projectName} ${row.typeLabel}`.toLowerCase().includes(q))
    .sort((a, b) => b.when.localeCompare(a.when) || a.title.localeCompare(b.title));
}

export function safetyCsv(actor: Actor, filter: { type?: string; status?: string; job?: string }) {
  const lines = ["Type,Title,Status,Job,When"];
  for (const row of listSafety(actor, filter)) {
    const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    lines.push([row.typeLabel, row.title, row.statusLabel, row.projectName, row.when].map(cell).join(","));
  }
  return { filename: "safety.csv", body: `${lines.join("\n")}\n` };
}

export function safetyJobs(orgId: string) {
  return getDb()
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .all()
    .filter((row) => row.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function leaderTalks(actor: Actor) {
  const today = todayFor(actor.orgId);
  const names = projectNames(actor.orgId);
  return talksIn(actor.orgId)
    .filter((talk) => talk.leaderUserId === actor.userId)
    .map((talk) => ({ talk, status: talkStatus(talk, today) }))
    .filter((row) => row.status === "upcoming" || row.status === "missed")
    .sort((a, b) => a.talk.scheduledOn.localeCompare(b.talk.scheduledOn))
    .map((row) => ({
      id: row.talk.id,
      title: topicTitle(actor.orgId, row.talk.topicId),
      status: row.status,
      statusLabel: safetyStatusLabel(row.status),
      projectName: names.get(row.talk.projectId) ?? "Job",
      scheduledOn: row.talk.scheduledOn,
      href: `/projects/${row.talk.projectId}/safety/talks/${row.talk.id}`,
    }));
}

export function listTopics(orgId: string) {
  return getDb().select().from(safetyTopics).where(eq(safetyTopics.orgId, orgId)).all().sort((a, b) => a.sortOrder - b.sortOrder);
}

export function listTemplates(orgId: string) {
  const templates = getDb().select().from(safetyTemplates).where(eq(safetyTemplates.orgId, orgId)).all().sort((a, b) => a.name.localeCompare(b.name));
  return templates.map((template) => ({
    ...template,
    items: getDb()
      .select()
      .from(safetyTemplateItems)
      .where(and(eq(safetyTemplateItems.orgId, orgId), eq(safetyTemplateItems.templateId, template.id)))
      .all()
      .sort((a, b) => a.sortOrder - b.sortOrder),
  }));
}

export function crewForTalk(orgId: string, projectId: string, leaderUserId: string) {
  const ids = new Set<string>();
  if (leaderUserId) ids.add(leaderUserId);
  const scheduled = getDb()
    .select({ userId: scheduleAssignees.userId })
    .from(scheduleAssignees)
    .innerJoin(scheduleItems, and(eq(scheduleItems.id, scheduleAssignees.itemId), eq(scheduleItems.orgId, scheduleAssignees.orgId)))
    .where(and(eq(scheduleAssignees.orgId, orgId), eq(scheduleItems.projectId, projectId)))
    .all();
  for (const row of scheduled) ids.add(row.userId);
  const timed = getDb().select().from(timeEntries).where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.projectId, projectId))).all();
  for (const row of timed) {
    if (row.status !== "void") ids.add(row.userId);
  }
  return [...ids]
    .map((userId) => ({ id: userId, name: memberName(orgId, userId) }))
    .filter((row): row is { id: string; name: string } => Boolean(row.name))
    .sort((a, b) => {
      if (a.id === leaderUserId) return -1;
      if (b.id === leaderUserId) return 1;
      return a.name.localeCompare(b.name);
    });
}

export function peopleFor(orgId: string) {
  return getDb()
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function scheduleTalk(actor: Actor, input: { projectId: string; topicId: string; scheduledOn: string; leaderUserId: string }) {
  assertOffice(actor);
  const project = projectOf(actor.orgId, input.projectId);
  if (!project) throw new ServiceError("That job is not in your company.");
  const topic = getDb().select().from(safetyTopics).where(and(eq(safetyTopics.orgId, actor.orgId), eq(safetyTopics.id, input.topicId))).get();
  if (!topic) throw new ServiceError("That topic is not in your company.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledOn)) throw new ServiceError("Pick a date.");
  if (!memberName(actor.orgId, input.leaderUserId)) throw new ServiceError("Pick a leader.");
  const now = nowIso();
  const talkId = id("talk");
  getDb()
    .insert(toolboxTalks)
    .values({
      id: talkId,
      orgId: actor.orgId,
      projectId: project.id,
      topicId: topic.id,
      scheduledOn: input.scheduledOn,
      leaderUserId: input.leaderUserId,
      completedAt: null,
      voidedAt: null,
      notes: "",
      clientEventId: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  audit(actor, "Scheduled toolbox talk", "toolbox_talk", talkId, { topicId: topic.id, scheduledOn: input.scheduledOn });
  return talkId;
}

export type AttendeeSign = { userId: string; visitorName: string; typedName: string; drawnDataUrl: string };

function signatureOk(value: string) {
  return value.length > 24 && value.length < 200_000 && SIGN.test(value.replace(/\s+/g, ""));
}

export function completeTalk(actor: Actor, talkId: string, input: { attendees: AttendeeSign[]; clientEventId?: string | null }) {
  assertWriter(actor);
  const db = getDb();
  const talk = db.select().from(toolboxTalks).where(and(eq(toolboxTalks.orgId, actor.orgId), eq(toolboxTalks.id, talkId))).get();
  if (!talk || talk.voidedAt) throw new ServiceError("That talk is not in your company.");
  if (talk.leaderUserId !== actor.userId && !canEditCrm(actor.role as Role)) throw new ServiceError("The leader signs this talk.");
  if (talk.completedAt) {
    if (input.clientEventId && talk.clientEventId === input.clientEventId) return talk.id;
    throw new ServiceError("This talk is locked.");
  }
  const attendees = input.attendees
    .map((row) => ({
      userId: row.userId.trim(),
      visitorName: clean(row.visitorName, 80),
      typedName: clean(row.typedName, 80),
      drawnDataUrl: row.drawnDataUrl.trim(),
    }))
    .filter((row) => row.userId || row.visitorName);
  if (attendees.length === 0) throw new ServiceError("Mark who was there.");
  for (const row of attendees) {
    if (!row.typedName) throw new ServiceError("Type each name.");
    if (!signatureOk(row.drawnDataUrl)) throw new ServiceError("Each person signs on the device.");
    if (row.userId && !memberName(actor.orgId, row.userId)) throw new ServiceError("That person is not in your company.");
    if (!row.userId && !row.visitorName) throw new ServiceError("Name the visitor.");
  }
  const now = nowIso();
  for (const row of attendees) {
    db.insert(toolboxAttendees)
      .values({
        id: id("tatt"),
        orgId: actor.orgId,
        talkId: talk.id,
        userId: row.userId,
        visitorName: row.userId ? "" : row.visitorName,
        typedName: row.typedName,
        drawnDataUrl: row.drawnDataUrl,
        signedAt: now,
      })
      .run();
  }
  db.update(toolboxTalks)
    .set({ completedAt: now, updatedAt: now, clientEventId: input.clientEventId || null })
    .where(and(eq(toolboxTalks.orgId, actor.orgId), eq(toolboxTalks.id, talk.id)))
    .run();
  audit(actor, "Completed toolbox talk", "toolbox_talk", talk.id, { attendees: attendees.length });
  return talk.id;
}

export function voidTalk(actor: Actor, talkId: string) {
  assertOffice(actor);
  const talk = getDb().select().from(toolboxTalks).where(and(eq(toolboxTalks.orgId, actor.orgId), eq(toolboxTalks.id, talkId))).get();
  if (!talk) throw new ServiceError("That talk is not in your company.");
  if (talk.voidedAt) return;
  const now = nowIso();
  getDb().update(toolboxTalks).set({ voidedAt: now, updatedAt: now }).where(and(eq(toolboxTalks.orgId, actor.orgId), eq(toolboxTalks.id, talkId))).run();
  audit(actor, "Voided toolbox talk", "toolbox_talk", talkId, {});
}

export function talkView(actor: Actor, talkId: string) {
  const talk = getDb().select().from(toolboxTalks).where(and(eq(toolboxTalks.orgId, actor.orgId), eq(toolboxTalks.id, talkId))).get();
  if (!talk) return null;
  const topic = getDb().select().from(safetyTopics).where(and(eq(safetyTopics.orgId, actor.orgId), eq(safetyTopics.id, talk.topicId))).get();
  const project = projectOf(actor.orgId, talk.projectId);
  if (!topic || !project) return null;
  const today = todayFor(actor.orgId);
  const status = talkStatus(talk, today);
  const signed = getDb().select().from(toolboxAttendees).where(and(eq(toolboxAttendees.orgId, actor.orgId), eq(toolboxAttendees.talkId, talk.id))).all();
  const leader = memberName(actor.orgId, talk.leaderUserId) ?? "Leader";
  return {
    id: talk.id,
    projectId: project.id,
    projectName: project.name,
    title: topic.title,
    body: topic.body,
    bodyEs: topic.bodyEs,
    scheduledOn: talk.scheduledOn,
    leader,
    leaderUserId: talk.leaderUserId,
    status,
    statusLabel: safetyStatusLabel(status),
    locked: Boolean(talk.completedAt || talk.voidedAt),
    canSign: !talk.completedAt && !talk.voidedAt && (talk.leaderUserId === actor.userId || canEditCrm(actor.role as Role)),
    crew: crewForTalk(actor.orgId, project.id, talk.leaderUserId),
    attendees: signed.map((row) => ({ id: row.id, name: row.typedName, visitor: !row.userId })),
  };
}

export function runChecklist(
  actor: Actor,
  input: { projectId: string; templateId: string; items: { templateItemId: string; result: string; photo?: PhotoUpload | null }[] },
) {
  assertWriter(actor);
  const project = projectOf(actor.orgId, input.projectId);
  if (!project) throw new ServiceError("That job is not in your company.");
  const template = listTemplates(actor.orgId).find((row) => row.id === input.templateId);
  if (!template) throw new ServiceError("That checklist is not in your company.");
  const byId = new Map(input.items.map((row) => [row.templateItemId, row]));
  if (template.items.some((item) => !byId.get(item.id) || !CHECK_RESULTS.includes(byId.get(item.id)!.result as CheckResult))) {
    throw new ServiceError("Mark each item Pass, Fail, or N/A.");
  }
  const now = nowIso();
  const checkId = id("sck");
  const db = getDb();
  db.insert(safetyChecks)
    .values({
      id: checkId,
      orgId: actor.orgId,
      projectId: project.id,
      templateId: template.id,
      name: template.name,
      completedBy: actor.userId,
      completedAt: now,
      voidedAt: null,
      createdAt: now,
    })
    .run();
  const failed: string[] = [];
  for (const item of template.items) {
    const answer = byId.get(item.id)!;
    const itemId = id("scki");
    const documentId = answer.photo ? storePhoto(actor.orgId, project.id, answer.photo, actor.userId) : null;
    db.insert(safetyCheckItems)
      .values({
        id: itemId,
        orgId: actor.orgId,
        checkId,
        title: item.title,
        result: answer.result,
        documentId,
        todoId: null,
        punchId: null,
      })
      .run();
    if (answer.result === "fail") failed.push(itemId);
  }
  audit(actor, "Completed safety checklist", "safety_check", checkId, { name: template.name, failed: failed.length });
  for (const itemId of failed) {
    const item = db.select().from(safetyCheckItems).where(and(eq(safetyCheckItems.orgId, actor.orgId), eq(safetyCheckItems.id, itemId))).get();
    emitAutomation({
      orgId: actor.orgId,
      kind: "checklist_failed",
      recordType: "safety_check_item",
      recordId: itemId,
      recordLabel: item?.title ?? template.name,
      projectId: project.id,
      name: item?.title ?? template.name,
    });
  }
  return checkId;
}

function checkItemOf(actor: Actor, itemId: string) {
  const item = getDb().select().from(safetyCheckItems).where(and(eq(safetyCheckItems.orgId, actor.orgId), eq(safetyCheckItems.id, itemId))).get();
  if (!item) throw new ServiceError("That item is not in your company.");
  const check = getDb().select().from(safetyChecks).where(and(eq(safetyChecks.orgId, actor.orgId), eq(safetyChecks.id, item.checkId))).get();
  if (!check || check.voidedAt) throw new ServiceError("That checklist is not in your company.");
  if (item.result !== "fail") throw new ServiceError("Only a failed item opens follow-up.");
  return { item, check };
}

export function linkCheckTodo(actor: Actor, itemId: string) {
  assertWriter(actor);
  const { item, check } = checkItemOf(actor, itemId);
  if (item.todoId) return item.todoId;
  const taskId = insertTodo(actor.orgId, check.projectId, item.title, actor.userId, actor.userId);
  getDb().update(safetyCheckItems).set({ todoId: taskId }).where(and(eq(safetyCheckItems.orgId, actor.orgId), eq(safetyCheckItems.id, item.id))).run();
  audit(actor, "Linked safety to-do", "safety_check_item", item.id, { todoId: taskId });
  return taskId;
}

export function linkCheckPunch(actor: Actor, itemId: string) {
  assertWriter(actor);
  const { item, check } = checkItemOf(actor, itemId);
  if (item.punchId) return item.punchId;
  const now = nowIso();
  const punchId = id("punch");
  getDb()
    .insert(punchItems)
    .values({
      id: punchId,
      orgId: actor.orgId,
      projectId: check.projectId,
      title: item.title,
      location: null,
      costCode: null,
      assigneeUserId: actor.userId,
      assigneeContactId: null,
      dueDate: null,
      status: "open",
      shared: 0,
      beforeDocumentId: item.documentId,
      afterDocumentId: null,
      doneAt: null,
      verifiedAt: null,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  getDb().update(safetyCheckItems).set({ punchId }).where(and(eq(safetyCheckItems.orgId, actor.orgId), eq(safetyCheckItems.id, item.id))).run();
  audit(actor, "Linked safety punch", "safety_check_item", item.id, { punchId });
  return punchId;
}

export type IncidentInput = {
  projectId: string;
  equipmentId?: string | null;
  kind: string;
  occurredAt: string;
  description: string;
  factors: string;
  people: string[];
  actions: { title: string; assigneeUserId: string }[];
  photos?: PhotoUpload[];
};

function markOutOfService(actor: Actor, equipmentId: string) {
  const item = getDb().select().from(equipment).where(and(eq(equipment.orgId, actor.orgId), eq(equipment.id, equipmentId))).get();
  if (!item) throw new ServiceError("That equipment is not in your company.");
  if (item.status !== "in_service") {
    getDb()
      .update(equipment)
      .set({ status: "in_service", updatedAt: nowIso() })
      .where(and(eq(equipment.orgId, actor.orgId), eq(equipment.id, item.id)))
      .run();
    audit(actor, "Marked equipment out of service", "equipment", item.id, { status: "in_service" });
  }
  return item.id;
}

export function createIncident(actor: Actor, input: IncidentInput) {
  assertWriter(actor);
  const project = projectOf(actor.orgId, input.projectId);
  if (!project) throw new ServiceError("That job is not in your company.");
  if (!INCIDENT_KINDS.includes(input.kind as IncidentKind)) throw new ServiceError("Pick an incident type.");
  const description = clean(input.description, 2000);
  if (!description) throw new ServiceError("Describe what happened.");
  if (!input.occurredAt || Number.isNaN(Date.parse(input.occurredAt))) throw new ServiceError("Pick a date and time.");
  const people = input.people.map((name) => clean(name, 80)).filter(Boolean);
  if (people.length === 0) throw new ServiceError("Name who was involved.");
  const actions = input.actions.map((row) => ({ title: clean(row.title, 120), assigneeUserId: row.assigneeUserId })).filter((row) => row.title);
  for (const action of actions) {
    if (!memberName(actor.orgId, action.assigneeUserId)) throw new ServiceError("Assign each corrective action.");
  }
  const now = nowIso();
  const incidentId = id("inc");
  const db = getDb();
  db.insert(incidents)
    .values({
      id: incidentId,
      orgId: actor.orgId,
      projectId: project.id,
      equipmentId: input.equipmentId || null,
      kind: input.kind,
      occurredAt: new Date(input.occurredAt).toISOString(),
      description,
      factors: clean(input.factors, 2000),
      voidedAt: null,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  for (const name of people) {
    const userId = peopleFor(actor.orgId).find((person) => person.name === name)?.id ?? "";
    db.insert(incidentPeople).values({ id: id("incp"), orgId: actor.orgId, incidentId, name, userId }).run();
  }
  for (const photo of input.photos ?? []) {
    const documentId = storePhoto(actor.orgId, project.id, photo, actor.userId);
    db.insert(incidentPhotos).values({ id: id("inch"), orgId: actor.orgId, incidentId, documentId, createdAt: now }).run();
  }
  for (const action of actions) {
    const taskId = insertTodo(actor.orgId, project.id, action.title, action.assigneeUserId, actor.userId);
    db.insert(incidentActions)
      .values({
        id: id("inca"),
        orgId: actor.orgId,
        incidentId,
        title: action.title,
        assigneeUserId: action.assigneeUserId,
        todoId: taskId,
        createdAt: now,
      })
      .run();
  }
  if (input.equipmentId) markOutOfService(actor, input.equipmentId);
  audit(actor, "Logged incident", "incident", incidentId, { kind: input.kind });
  emitAutomation({
    orgId: actor.orgId,
    kind: "incident_logged",
    recordType: "incident",
    recordId: incidentId,
    recordLabel: description.slice(0, 80),
    projectId: project.id,
    name: description,
  });
  return incidentId;
}

export function updateIncident(actor: Actor, incidentId: string, input: { description: string; factors: string }) {
  const incident = incidentOrThrow(actor, incidentId);
  if (incident.voidedAt) throw new ServiceError("This incident is void.");
  if (!canEditCrm(actor.role as Role) && incident.createdBy !== actor.userId) throw new ServiceError("That incident is not yours.");
  const description = clean(input.description, 2000);
  if (!description) throw new ServiceError("Describe what happened.");
  getDb()
    .update(incidents)
    .set({ description, factors: clean(input.factors, 2000), updatedAt: nowIso() })
    .where(and(eq(incidents.orgId, actor.orgId), eq(incidents.id, incident.id)))
    .run();
  audit(actor, "Edited incident", "incident", incident.id, {});
}

export function voidIncident(actor: Actor, incidentId: string) {
  const incident = incidentOrThrow(actor, incidentId);
  if (!canEditCrm(actor.role as Role) && incident.createdBy !== actor.userId) throw new ServiceError("That incident is not yours.");
  if (incident.voidedAt) return;
  const now = nowIso();
  getDb().update(incidents).set({ voidedAt: now, updatedAt: now }).where(and(eq(incidents.orgId, actor.orgId), eq(incidents.id, incident.id))).run();
  audit(actor, "Voided incident", "incident", incident.id, {});
}

function incidentOrThrow(actor: Actor, incidentId: string) {
  assertWriter(actor);
  const incident = getDb().select().from(incidents).where(and(eq(incidents.orgId, actor.orgId), eq(incidents.id, incidentId))).get();
  if (!incident || !canReadIncident(actor, incident.createdBy)) throw new ServiceError("That incident is not in your company.");
  return incident;
}

export function incidentView(actor: Actor, incidentId: string) {
  const incident = getDb().select().from(incidents).where(and(eq(incidents.orgId, actor.orgId), eq(incidents.id, incidentId))).get();
  if (!incident || !canReadIncident(actor, incident.createdBy)) return null;
  const project = projectOf(actor.orgId, incident.projectId);
  if (!project) return null;
  const gear = incident.equipmentId
    ? getDb().select().from(equipment).where(and(eq(equipment.orgId, actor.orgId), eq(equipment.id, incident.equipmentId))).get()
    : null;
  const people = getDb().select().from(incidentPeople).where(and(eq(incidentPeople.orgId, actor.orgId), eq(incidentPeople.incidentId, incident.id))).all();
  const photos = getDb().select().from(incidentPhotos).where(and(eq(incidentPhotos.orgId, actor.orgId), eq(incidentPhotos.incidentId, incident.id))).all();
  const actions = actionsFor(actor.orgId, incident.id).map((action) => ({
    id: action.id,
    title: action.title,
    assignee: action.assigneeUserId ? memberName(actor.orgId, action.assigneeUserId) ?? "" : "",
    todoId: action.todoId,
    open: taskOpen(actor.orgId, action.todoId),
  }));
  return {
    id: incident.id,
    projectId: project.id,
    projectName: project.name,
    kind: incident.kind,
    kindLabel: incidentKindLabel(incident.kind),
    occurredAt: incident.occurredAt,
    description: incident.description,
    factors: incident.factors,
    voided: Boolean(incident.voidedAt),
    equipment: gear ? { id: gear.id, name: gear.name, status: gear.status } : null,
    people: people.map((row) => row.name),
    photos: photos.map((row) => row.documentId),
    actions,
    canEdit: !incident.voidedAt && (canEditCrm(actor.role as Role) || incident.createdBy === actor.userId),
  };
}

export function safetyTabCount(board: { talks: unknown[]; checks: unknown[]; incidents: unknown[] }) {
  return board.talks.length + board.checks.length + board.incidents.length;
}

export function jobSafety(actor: Actor, projectId: string) {
  const project = projectOf(actor.orgId, projectId);
  if (!project) return null;
  const today = todayFor(actor.orgId);
  const talks = talksIn(actor.orgId)
    .filter((talk) => talk.projectId === projectId)
    .map((talk) => {
      const status = talkStatus(talk, today);
      return {
        id: talk.id,
        title: topicTitle(actor.orgId, talk.topicId),
        status,
        statusLabel: safetyStatusLabel(status),
        when: talk.scheduledOn,
        href: `/projects/${projectId}/safety/talks/${talk.id}`,
      };
    })
    .sort((a, b) => b.when.localeCompare(a.when));
  const checks = checksIn(actor.orgId)
    .filter((check) => check.projectId === projectId)
    .map((check) => {
      const items = itemsFor(actor.orgId, check.id);
      const openFails = items.filter((item) => failedItemOpen(actor.orgId, item));
      const status = check.voidedAt ? "void" : openFails.length ? "open" : "completed";
      return {
        id: check.id,
        title: check.name,
        status,
        statusLabel: safetyStatusLabel(status),
        when: check.completedAt.slice(0, 10),
        who: memberName(actor.orgId, check.completedBy) ?? "",
        items: items.map((item) => ({
          id: item.id,
          title: item.title,
          result: item.result,
          todoId: item.todoId,
          punchId: item.punchId,
          open: failedItemOpen(actor.orgId, item),
        })),
      };
    })
    .sort((a, b) => b.when.localeCompare(a.when));
  const incidentRows = incidentsIn(actor.orgId)
    .filter((row) => row.projectId === projectId && canReadIncident(actor, row.createdBy))
    .map((row) => {
      const status = row.voidedAt ? "void" : incidentOpen(actor.orgId, row.id) ? "open" : "completed";
      return {
        id: row.id,
        title: row.description,
        kindLabel: incidentKindLabel(row.kind),
        status,
        statusLabel: safetyStatusLabel(status),
        when: row.occurredAt.slice(0, 10),
        href: `/safety/incidents/${row.id}`,
      };
    })
    .sort((a, b) => b.when.localeCompare(a.when));
  return {
    project,
    talks,
    checks,
    incidents: incidentRows,
    counts: safetyCounts(actor.orgId, projectId),
    topics: listTopics(actor.orgId),
    templates: listTemplates(actor.orgId),
    people: peopleFor(actor.orgId),
    gear: getDb().select().from(equipment).where(eq(equipment.orgId, actor.orgId)).all().sort((a, b) => a.name.localeCompare(b.name)),
    canSchedule: canEditCrm(actor.role as Role),
    canWrite: canAddFieldNotes(actor.role as Role),
  };
}

export function checkDetail(actor: Actor, checkId: string) {
  const check = getDb().select().from(safetyChecks).where(and(eq(safetyChecks.orgId, actor.orgId), eq(safetyChecks.id, checkId))).get();
  if (!check) return null;
  const board = jobSafety(actor, check.projectId);
  return board?.checks.find((row) => row.id === checkId) ?? null;
}

export type { TalkRow };
