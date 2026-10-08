import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  contacts,
  documents,
  memberships,
  notifications,
  organizations,
  projects,
  scheduleItems,
  taskAssignees,
  taskChecks,
  taskFiles,
  tasks,
  templateTodoChecks,
  templateTodos,
  todoAttempts,
  users,
  vendorPortals,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canAddFieldNotes, canEditCrm, type Role } from "@/lib/permissions";
import { checklistFraction, linkedDeadline, reminderDay, type DeadlineEdge } from "@/lib/todos/deadline";
import { photoExtension, photoUploadError, rasterImageType } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { calendarForOrg, workdaysForOrg } from "@/lib/services/time";
import { addCalendarDays, localDay } from "@/lib/time/calendar";
import { weekStartDay } from "@/lib/time/grid";
import { hashVendorToken, vendorTokenMatches } from "@/lib/vendor/token";

const LIMIT = 20;
const WINDOW_MS = 10 * 60 * 1000;

export type TodoFilter = {
  assignee?: string | null;
  projectId?: string | null;
  priority?: string | null;
  due?: string | null;
  status?: string | null;
};

export type TodoCheck = {
  id: string;
  title: string;
  status: string;
  assigneeUserId: string | null;
  assigneeContactId: string | null;
  assigneeName: string;
  dueAt: string | null;
  sortOrder: number;
};

export type TodoRow = {
  id: string;
  title: string;
  notes: string;
  priority: string;
  tags: string;
  status: string;
  dueAt: string | null;
  projectId: string | null;
  projectName: string;
  scheduleItemId: string | null;
  scheduleTitle: string;
  deadlineEdge: string | null;
  deadlineOffset: number | null;
  unlinked: boolean;
  remindDays: number | null;
  progress: string;
  done: number;
  total: number;
  offerDone: boolean;
  assignees: { userId: string | null; contactId: string | null; name: string }[];
  checks: TodoCheck[];
  files: { id: string; filename: string }[];
};

type Bundle = {
  task: typeof tasks.$inferSelect;
  checks: (typeof taskChecks.$inferSelect)[];
  assignees: (typeof taskAssignees.$inferSelect)[];
};

function dbFor(actor: Actor): AppDatabase {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function guardRate(db: AppDatabase, actor: Actor) {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const recent = db
    .select()
    .from(todoAttempts)
    .where(and(eq(todoAttempts.orgId, actor.orgId), eq(todoAttempts.userId, actor.userId)))
    .all()
    .filter((row) => row.createdAt >= since);
  if (recent.length >= LIMIT) throw new ServiceError("Wait a few minutes");
  db.insert(todoAttempts).values({ id: id("tatt"), orgId: actor.orgId, userId: actor.userId, createdAt: nowIso() }).run();
}

function audit(db: AppDatabase, orgId: string, actorId: string, action: string, entityId: string, payload: Record<string, unknown>) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "task",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function cleanTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, " ");
  if (!title || title.length > 120) throw new ServiceError("Add a title.");
  return title;
}

function cleanPriority(value: string | null | undefined): "low" | "normal" | "high" {
  if (value === "low" || value === "high") return value;
  return "normal";
}

function cleanTags(value: string | null | undefined): string {
  const tags = (value ?? "")
    .split(",")
    .map((tag) => tag.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, 5)
    .map((tag) => tag.slice(0, 24));
  return tags.join(", ");
}

function cleanEdge(value: string | null | undefined): DeadlineEdge | null {
  if (value === "start" || value === "finish") return value;
  return null;
}

function cleanOffset(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  if (!Number.isInteger(value) || value < -60 || value > 60) throw new ServiceError("Offset is -60 to 60 workdays.");
  return value;
}

function dayOf(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

function loadOrg(db: AppDatabase, orgId: string) {
  const rows = db.select().from(tasks).where(eq(tasks.orgId, orgId)).all();
  const checks = db.select().from(taskChecks).where(eq(taskChecks.orgId, orgId)).all();
  const assignees = db.select().from(taskAssignees).where(eq(taskAssignees.orgId, orgId)).all();
  return rows.map((task) => ({
    task,
    checks: checks.filter((row) => row.taskId === task.id).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)),
    assignees: assignees.filter((row) => row.taskId === task.id),
  }));
}

function userAssigned(bundle: Bundle, userId: string): boolean {
  if (bundle.task.assigneeUserId === userId) return true;
  if (bundle.assignees.some((row) => row.userId === userId)) return true;
  return bundle.checks.some((row) => row.assigneeUserId === userId);
}

function visibleTo(actor: Actor, bundle: Bundle): boolean {
  if (actor.role !== "field") return true;
  return userAssigned(bundle, actor.userId);
}

function visibleChecks(actor: Actor, bundle: Bundle): (typeof taskChecks.$inferSelect)[] {
  if (actor.role !== "field") return bundle.checks;
  const parentMine = bundle.task.assigneeUserId === actor.userId || bundle.assignees.some((row) => row.userId === actor.userId);
  return bundle.checks.filter((row) => {
    if (row.assigneeUserId === actor.userId) return true;
    if (row.assigneeUserId || row.assigneeContactId) return false;
    return parentMine;
  });
}

function canTick(actor: Actor, bundle: Bundle, check: (typeof taskChecks.$inferSelect)[]): boolean {
  if (canEditCrm(actor.role as Role)) return true;
  if (actor.role !== "field") return false;
  const row = check[0];
  if (!row) return false;
  if (row.assigneeContactId) return false;
  if (row.assigneeUserId === actor.userId) return true;
  if (!row.assigneeUserId && (bundle.task.assigneeUserId === actor.userId || bundle.assignees.some((item) => item.userId === actor.userId))) return true;
  return false;
}

function present(db: AppDatabase, orgId: string, actor: Actor, bundle: Bundle): TodoRow {
  const names = new Map(db.select().from(users).all().map((user) => [user.id, user.name]));
  const vendors = new Map(
    db
      .select()
      .from(contacts)
      .where(eq(contacts.orgId, orgId))
      .all()
      .map((row) => [row.id, row.company || row.name]),
  );
  const projectId = bundle.task.relatedType === "project" ? bundle.task.relatedId : null;
  const project = projectId ? db.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).get() : null;
  const schedule = bundle.task.scheduleItemId
    ? db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.id, bundle.task.scheduleItemId))).get()
    : null;
  const checks = visibleChecks(actor, bundle);
  const done = checks.filter((row) => row.status === "done").length;
  const allDone = bundle.checks.length > 0 && bundle.checks.every((row) => row.status === "done");
  const parentMine = bundle.task.assigneeUserId === actor.userId || bundle.assignees.some((row) => row.userId === actor.userId);
  const people = [
    ...bundle.assignees.map((row) => ({
      userId: row.userId,
      contactId: row.contactId,
      name: row.userId ? names.get(row.userId) || "Teammate" : vendors.get(row.contactId || "") || "Vendor",
    })),
  ];
  if (people.length === 0 && bundle.task.assigneeUserId) {
    people.push({ userId: bundle.task.assigneeUserId, contactId: null, name: names.get(bundle.task.assigneeUserId) || "Teammate" });
  }
  const files = db
    .select()
    .from(taskFiles)
    .where(and(eq(taskFiles.orgId, orgId), eq(taskFiles.taskId, bundle.task.id)))
    .all();
  const docs = files.length
    ? db
        .select()
        .from(documents)
        .where(eq(documents.orgId, orgId))
        .all()
        .filter((row) => files.some((file) => file.documentId === row.id))
    : [];
  return {
    id: bundle.task.id,
    title: bundle.task.title,
    notes: bundle.task.notes || "",
    priority: bundle.task.priority || "normal",
    tags: bundle.task.tags || "",
    status: bundle.task.status,
    dueAt: dayOf(bundle.task.dueAt) || null,
    projectId,
    projectName: project?.name || "",
    scheduleItemId: schedule ? schedule.id : null,
    scheduleTitle: schedule?.title || "",
    deadlineEdge: bundle.task.deadlineEdge,
    deadlineOffset: bundle.task.deadlineOffset,
    unlinked: bundle.task.deadlineUnlinked === 1,
    remindDays: bundle.task.remindDays,
    progress: checks.length ? checklistFraction(done, checks.length) : "",
    done,
    total: checks.length,
    offerDone: allDone && bundle.task.status === "open" && (actor.role !== "field" || parentMine),
    assignees: people,
    checks: checks.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      assigneeUserId: row.assigneeUserId,
      assigneeContactId: row.assigneeContactId,
      assigneeName: row.assigneeUserId ? names.get(row.assigneeUserId) || "" : row.assigneeContactId ? vendors.get(row.assigneeContactId) || "" : "",
      dueAt: row.dueAt,
      sortOrder: row.sortOrder,
    })),
    files: docs.map((row) => ({ id: row.id, filename: row.filename })),
  };
}

function bundleOf(db: AppDatabase, orgId: string, taskId: string): Bundle | null {
  return loadOrg(db, orgId).find((row) => row.task.id === taskId) ?? null;
}

export function listTodos(actor: Actor, filter: TodoFilter = {}): TodoRow[] {
  const db = dbFor(actor);
  sweepTodoReminders(db, actor.orgId);
  const calendar = calendarForOrg(actor.orgId);
  const today = localDay(Date.now(), calendar.timeZone);
  const weekStart = weekStartDay(today, calendar.weekStartsOn);
  const weekEnd = addCalendarDays(weekStart, 6);
  const rows = loadOrg(db, actor.orgId)
    .filter((bundle) => visibleTo(actor, bundle))
    .map((bundle) => present(db, actor.orgId, actor, bundle))
    .filter((row) => {
      if (filter.projectId && row.projectId !== filter.projectId) return false;
      if (filter.priority && filter.priority !== "all" && row.priority !== filter.priority) return false;
      if (filter.status === "done" && row.status !== "done") return false;
      if (filter.status !== "done" && filter.status !== "all" && row.status !== "open") return false;
      if (filter.assignee) {
        const hit =
          row.assignees.some((person) => person.userId === filter.assignee || person.contactId === filter.assignee) ||
          row.checks.some((item) => item.assigneeUserId === filter.assignee || item.assigneeContactId === filter.assignee);
        if (!hit) return false;
      }
      const due = row.dueAt || "";
      if (filter.due === "overdue" && !(row.status === "open" && due && due < today)) return false;
      if (filter.due === "week" && !(due && due >= today && due <= weekEnd)) return false;
      if (filter.due === "later" && !(due && due > weekEnd)) return false;
      return true;
    })
    .sort((a, b) => (a.dueAt || "9999").localeCompare(b.dueAt || "9999") || a.title.localeCompare(b.title));
  return rows;
}

export function todoDetail(actor: Actor, taskId: string): TodoRow | null {
  const db = dbFor(actor);
  const bundle = bundleOf(db, actor.orgId, taskId);
  if (!bundle || !visibleTo(actor, bundle)) return null;
  return present(db, actor.orgId, actor, bundle);
}

export function overdueTodoCount(actor: Actor): number {
  const db = officeDb(actor.orgId);
  if (!db) return 0;
  const calendar = calendarForOrg(actor.orgId);
  const today = localDay(Date.now(), calendar.timeZone);
  return loadOrg(db, actor.orgId).filter((bundle) => {
    if (!visibleTo(actor, bundle)) return false;
    const due = dayOf(bundle.task.dueAt);
    return bundle.task.status === "open" && due !== "" && due < today;
  }).length;
}

export function createTodo(
  actor: Actor,
  input: {
    title: string;
    projectId: string;
    notes?: string;
    priority?: string;
    tags?: string;
    dueAt?: string | null;
    scheduleItemId?: string | null;
    deadlineEdge?: string | null;
    deadlineOffset?: number | null;
    remindDays?: number | null;
    userIds?: string[];
    contactIds?: string[];
    checks?: { title: string }[];
  },
): string {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot add a to-do.");
  const db = dbFor(actor);
  guardRate(db, actor);
  const project = db.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("That job is not in your company.");
  const title = cleanTitle(input.title);
  const edge = cleanEdge(input.deadlineEdge);
  const offset = edge ? cleanOffset(input.deadlineOffset ?? 0) : null;
  const schedule = input.scheduleItemId
    ? db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, input.scheduleItemId), eq(scheduleItems.projectId, project.id))).get()
    : null;
  if (input.scheduleItemId && !schedule) throw new ServiceError("That schedule item is not on this job.");
  const remind = input.remindDays == null || input.remindDays === ("" as unknown as number) ? null : input.remindDays;
  if (remind != null && (!Number.isInteger(remind) || remind < 0 || remind > 60)) throw new ServiceError("Reminder is 0 to 60 days.");
  const due = schedule && edge && offset != null ? linkedDeadline(edge === "start" ? schedule.startDate : schedule.endDate, offset, workdaysForOrg(actor.orgId)) : dayOf(input.dueAt) || null;
  const usersIn = new Set(
    db
      .select({ id: users.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, actor.orgId))
      .all()
      .map((row) => row.id),
  );
  const vendorsIn = new Set(
    db
      .select()
      .from(contacts)
      .where(eq(contacts.orgId, actor.orgId))
      .all()
      .filter((row) => !row.deletedAt && (row.type === "vendor" || row.type === "sub"))
      .map((row) => row.id),
  );
  const userIds = [...new Set(input.userIds ?? [])].filter((userId) => usersIn.has(userId));
  const contactIds = [...new Set(input.contactIds ?? [])].filter((contactId) => vendorsIn.has(contactId));
  const taskId = id("task");
  const now = nowIso();
  db.transaction((tx) => {
    tx.insert(tasks)
      .values({
        id: taskId,
        orgId: actor.orgId,
        title,
        assigneeUserId: userIds[0] ?? null,
        dueAt: due,
        relatedType: "project",
        relatedId: project.id,
        status: "open",
        notes: (input.notes ?? "").trim().slice(0, 2000),
        priority: cleanPriority(input.priority),
        tags: cleanTags(input.tags),
        scheduleItemId: schedule?.id ?? null,
        deadlineEdge: schedule && edge ? edge : null,
        deadlineOffset: schedule && edge ? offset : null,
        deadlineUnlinked: 0,
        remindDays: remind,
        remindedFor: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    const assigneeRows = [
      ...userIds.map((userId) => ({ id: id("tasn"), orgId: actor.orgId, taskId, userId, contactId: null })),
      ...contactIds.map((contactId) => ({ id: id("tasn"), orgId: actor.orgId, taskId, userId: null, contactId })),
    ];
    if (assigneeRows.length) tx.insert(taskAssignees).values(assigneeRows).run();
    (input.checks ?? []).forEach((check, index) => {
      const label = check.title.trim();
      if (!label) return;
      tx.insert(taskChecks)
        .values({
          id: id("tchk"),
          orgId: actor.orgId,
          taskId,
          title: label.slice(0, 120),
          sortOrder: index,
          status: "open",
          assigneeUserId: null,
          assigneeContactId: null,
          dueAt: null,
          completedAt: null,
          completedBy: null,
        })
        .run();
    });
    audit(tx as unknown as AppDatabase, actor.orgId, actor.userId, "todo.create", taskId, { title });
  });
  return taskId;
}

export function addTodoCheck(actor: Actor, taskId: string, title: string): string {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot change this.");
  const db = dbFor(actor);
  guardRate(db, actor);
  const bundle = bundleOf(db, actor.orgId, taskId);
  if (!bundle) throw new ServiceError("That to-do is not in your company.");
  const checkId = id("tchk");
  const order = bundle.checks.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
  db.insert(taskChecks)
    .values({
      id: checkId,
      orgId: actor.orgId,
      taskId,
      title: cleanTitle(title),
      sortOrder: order,
      status: "open",
      assigneeUserId: null,
      assigneeContactId: null,
      dueAt: null,
      completedAt: null,
      completedBy: null,
    })
    .run();
  return checkId;
}

export function renameTodoCheck(actor: Actor, checkId: string, title: string) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot change this.");
  const db = dbFor(actor);
  const row = db.select().from(taskChecks).where(and(eq(taskChecks.orgId, actor.orgId), eq(taskChecks.id, checkId))).get();
  if (!row) throw new ServiceError("That item is not in your company.");
  db.update(taskChecks).set({ title: cleanTitle(title) }).where(and(eq(taskChecks.id, checkId), eq(taskChecks.orgId, actor.orgId))).run();
}

export function updateTodoCheck(
  actor: Actor,
  checkId: string,
  input: { assigneeUserId?: string | null; assigneeContactId?: string | null; dueAt?: string | null },
) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot change this.");
  const db = dbFor(actor);
  const row = db.select().from(taskChecks).where(and(eq(taskChecks.orgId, actor.orgId), eq(taskChecks.id, checkId))).get();
  if (!row) throw new ServiceError("That item is not in your company.");
  const userId = input.assigneeUserId || null;
  let contactId = input.assigneeContactId || null;
  if (userId && contactId) contactId = null;
  if (userId) {
    const member = db
      .select({ id: users.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, userId)))
      .get();
    if (!member) throw new ServiceError("That person is not in your company.");
  }
  if (contactId) {
    const contact = db.select().from(contacts).where(and(eq(contacts.orgId, actor.orgId), eq(contacts.id, contactId))).get();
    if (!contact || contact.deletedAt || (contact.type !== "vendor" && contact.type !== "sub")) throw new ServiceError("That vendor is not in your company.");
  }
  const due = input.dueAt === undefined ? row.dueAt : dayOf(input.dueAt) || null;
  db.update(taskChecks)
    .set({ assigneeUserId: userId, assigneeContactId: contactId, dueAt: due })
    .where(and(eq(taskChecks.id, checkId), eq(taskChecks.orgId, actor.orgId)))
    .run();
}

export function deleteTodoCheck(actor: Actor, checkId: string) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot change this.");
  const db = dbFor(actor);
  const row = db.select().from(taskChecks).where(and(eq(taskChecks.orgId, actor.orgId), eq(taskChecks.id, checkId))).get();
  if (!row) throw new ServiceError("That item is not in your company.");
  db.delete(taskChecks).where(and(eq(taskChecks.id, checkId), eq(taskChecks.orgId, actor.orgId))).run();
}

export function reorderTodoChecks(actor: Actor, taskId: string, orderedIds: string[]) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot change this.");
  const db = dbFor(actor);
  const bundle = bundleOf(db, actor.orgId, taskId);
  if (!bundle) throw new ServiceError("That to-do is not in your company.");
  const known = new Set(bundle.checks.map((row) => row.id));
  if (orderedIds.length !== known.size || orderedIds.some((checkId) => !known.has(checkId))) throw new ServiceError("That list does not match.");
  orderedIds.forEach((checkId, index) => {
    db.update(taskChecks).set({ sortOrder: index }).where(and(eq(taskChecks.orgId, actor.orgId), eq(taskChecks.id, checkId))).run();
  });
}

export function setTodoCheck(actor: Actor, checkId: string, done: boolean): { offerDone: boolean } {
  if (!canAddFieldNotes(actor.role as Role)) throw new ServiceError("Your role cannot change this.");
  const db = dbFor(actor);
  const row = db.select().from(taskChecks).where(and(eq(taskChecks.orgId, actor.orgId), eq(taskChecks.id, checkId))).get();
  if (!row) throw new ServiceError("That item is not in your company.");
  const bundle = bundleOf(db, actor.orgId, row.taskId);
  if (!bundle || !visibleTo(actor, bundle) || !canTick(actor, bundle, [row])) throw new ServiceError("That item is not assigned to you.");
  const now = nowIso();
  const next = done ? "done" : "open";
  db.transaction((tx) => {
    tx.update(taskChecks)
      .set({ status: next, completedAt: done ? now : null, completedBy: done ? actor.userId : null })
      .where(and(eq(taskChecks.id, checkId), eq(taskChecks.orgId, actor.orgId)))
      .run();
    if (!done && bundle.task.status === "done") {
      tx.update(tasks).set({ status: "open", updatedAt: now }).where(and(eq(tasks.id, bundle.task.id), eq(tasks.orgId, actor.orgId))).run();
      audit(tx as unknown as AppDatabase, actor.orgId, actor.userId, "todo.reopen", bundle.task.id, { checkId });
    }
    audit(tx as unknown as AppDatabase, actor.orgId, actor.userId, done ? "todo.check" : "todo.uncheck", checkId, { taskId: bundle.task.id, who: actor.userId, when: now });
  });
  const fresh = bundleOf(db, actor.orgId, bundle.task.id);
  const openParent = fresh?.task.status === "open";
  const allDone = fresh ? fresh.checks.length > 0 && fresh.checks.every((item) => (item.id === checkId ? done : item.status === "done")) : false;
  return { offerDone: Boolean(openParent && allDone) };
}

export function completeTodos(actor: Actor, taskIds: string[]) {
  if (!canAddFieldNotes(actor.role as Role)) throw new ServiceError("Your role cannot change this.");
  const db = dbFor(actor);
  const now = nowIso();
  db.transaction((tx) => {
    for (const taskId of taskIds) {
      const bundle = bundleOf(tx as unknown as AppDatabase, actor.orgId, taskId);
      if (!bundle || !visibleTo(actor, bundle)) throw new ServiceError("That to-do is not in your company.");
      if (actor.role === "field" && bundle.task.assigneeUserId !== actor.userId && !bundle.assignees.some((row) => row.userId === actor.userId)) {
        throw new ServiceError("That to-do is not assigned to you.");
      }
      tx.update(tasks).set({ status: "done", updatedAt: now }).where(and(eq(tasks.id, taskId), eq(tasks.orgId, actor.orgId))).run();
      audit(tx as unknown as AppDatabase, actor.orgId, actor.userId, "todo.complete", taskId, { who: actor.userId, when: now });
    }
  });
}

export function attachTodoFile(actor: Actor, taskId: string, upload: { filename: string; bytes: Buffer }, checkId?: string | null) {
  if (!canAddFieldNotes(actor.role as Role)) throw new ServiceError("Your role cannot change this.");
  const db = dbFor(actor);
  guardRate(db, actor);
  const bundle = bundleOf(db, actor.orgId, taskId);
  if (!bundle || !visibleTo(actor, bundle)) throw new ServiceError("That to-do is not in your company.");
  const error = photoUploadError(upload.filename, upload.bytes);
  if (error) throw new ServiceError(error);
  const type = rasterImageType(upload.bytes);
  if (!type) throw new ServiceError("Use a JPEG, PNG, or WebP photo.");
  const documentId = id("doc");
  const ext = photoExtension(type);
  const relative = path.join("uploads", actor.orgId, `${documentId}.${ext}`);
  fs.mkdirSync(path.dirname(path.join(dataDir(), relative)), { recursive: true });
  fs.writeFileSync(path.join(dataDir(), relative), upload.bytes);
  const projectId = bundle.task.relatedType === "project" ? bundle.task.relatedId : null;
  db.transaction((tx) => {
    tx.insert(documents)
      .values({
        id: documentId,
        orgId: actor.orgId,
        projectId,
        leadId: null,
        contactId: null,
        type: "photo",
        filename: `photo.${ext}`,
        storagePath: relative,
        metadataJson: null,
        deletedAt: null,
        createdAt: nowIso(),
        createdBy: actor.userId,
      })
      .run();
    tx.insert(taskFiles)
      .values({ id: id("tfile"), orgId: actor.orgId, taskId, checkId: checkId || null, documentId })
      .run();
  });
}

export function refreshLinkedTodos(db: AppDatabase, orgId: string, shifts: { id: string; start: string; end: string }[], mask: number): number {
  if (shifts.length === 0) return 0;
  const moved = new Map(shifts.map((shift) => [shift.id, shift]));
  const rows = db
    .select()
    .from(tasks)
    .where(eq(tasks.orgId, orgId))
    .all()
    .filter((row) => row.scheduleItemId && moved.has(row.scheduleItemId) && (row.deadlineEdge === "start" || row.deadlineEdge === "finish") && row.deadlineOffset != null);
  let count = 0;
  const now = nowIso();
  for (const row of rows) {
    const shift = moved.get(row.scheduleItemId as string);
    if (!shift) continue;
    const anchor = row.deadlineEdge === "start" ? shift.start : shift.end;
    const next = linkedDeadline(anchor, row.deadlineOffset ?? 0, mask);
    if (dayOf(row.dueAt) === next) continue;
    db.update(tasks)
      .set({ dueAt: next, remindedFor: null, updatedAt: now })
      .where(and(eq(tasks.id, row.id), eq(tasks.orgId, orgId)))
      .run();
    count += 1;
  }
  return count;
}

export function unlinkScheduleTodos(db: AppDatabase, orgId: string, itemId: string, actorId: string): number {
  const rows = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.orgId, orgId), eq(tasks.scheduleItemId, itemId)))
    .all();
  const now = nowIso();
  for (const row of rows) {
    db.update(tasks)
      .set({ scheduleItemId: null, deadlineEdge: null, deadlineOffset: null, deadlineUnlinked: 1, updatedAt: now })
      .where(and(eq(tasks.id, row.id), eq(tasks.orgId, orgId)))
      .run();
    audit(db, orgId, actorId, "todo.unlink", row.id, { scheduleItemId: itemId, dueAt: row.dueAt });
  }
  return rows.length;
}

export function sweepTodoReminders(db: AppDatabase, orgId: string, today = ""): number {
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  const day = today || localDay(Date.now(), org?.timeZone || "America/New_York");
  const bundles = loadOrg(db, orgId);
  let sent = 0;
  for (const bundle of bundles) {
    const due = dayOf(bundle.task.dueAt);
    if (bundle.task.status !== "open" || bundle.task.remindDays == null || !due) continue;
    if (bundle.task.remindedFor === due) continue;
    const fire = reminderDay(due, bundle.task.remindDays);
    if (day < fire || day > due) continue;
    const userIds = new Set<string>();
    if (typeof bundle.task.assigneeUserId === "string" && bundle.task.assigneeUserId) userIds.add(bundle.task.assigneeUserId);
    for (const row of bundle.assignees) {
      if (typeof row.userId === "string" && row.userId) userIds.add(row.userId);
    }
    for (const row of bundle.checks) {
      if (typeof row.assigneeUserId === "string" && row.assigneeUserId) userIds.add(row.assigneeUserId);
    }
    const projectId = bundle.task.relatedType === "project" ? bundle.task.relatedId : null;
    for (const userId of userIds) {
      db.insert(notifications)
        .values({
          id: id("note"),
          orgId,
          userId,
          kind: "todo",
          commentId: null,
          entityType: "task",
          entityId: bundle.task.id,
          projectId,
          actorId: null,
          actorName: "Reminder",
          snippet: bundle.task.title,
          readAt: null,
          createdAt: nowIso(),
        })
        .run();
      sent += 1;
    }
    db.update(tasks).set({ remindedFor: due }).where(and(eq(tasks.id, bundle.task.id), eq(tasks.orgId, orgId))).run();
  }
  return sent;
}

export function applyTemplateTodos(
  db: AppDatabase,
  actor: Actor,
  projectId: string,
  templateId: string,
  scheduleIds: Map<string, string>,
  anchor: string,
): number {
  const todos = db
    .select()
    .from(templateTodos)
    .where(and(eq(templateTodos.orgId, actor.orgId), eq(templateTodos.templateId, templateId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (todos.length === 0) return 0;
  const checks = db.select().from(templateTodoChecks).where(and(eq(templateTodoChecks.orgId, actor.orgId), eq(templateTodoChecks.templateId, templateId))).all();
  const items = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, projectId))).all();
  const mask = workdaysForOrg(actor.orgId);
  const now = nowIso();
  let created = 0;
  for (const todo of todos) {
    const scheduleId = todo.scheduleKey ? scheduleIds.get(todo.scheduleKey) ?? null : null;
    const item = scheduleId ? items.find((row) => row.id === scheduleId) : null;
    const edge = cleanEdge(todo.deadlineEdge);
    let due: string | null = null;
    const linked = Boolean(item && edge && todo.deadlineOffset != null);
    if (item && edge && todo.deadlineOffset != null) due = linkedDeadline(edge === "start" ? item.startDate : item.endDate, todo.deadlineOffset, mask);
    else if (edge && todo.deadlineOffset != null) due = linkedDeadline(anchor, todo.deadlineOffset, mask);
    const taskId = id("task");
    db.insert(tasks)
      .values({
        id: taskId,
        orgId: actor.orgId,
        title: todo.title,
        assigneeUserId: null,
        dueAt: due,
        relatedType: "project",
        relatedId: projectId,
        status: "open",
        notes: todo.notes,
        priority: todo.priority,
        tags: todo.tags,
        scheduleItemId: linked ? scheduleId : null,
        deadlineEdge: linked ? edge : null,
        deadlineOffset: linked ? todo.deadlineOffset : null,
        deadlineUnlinked: linked ? 0 : due ? 1 : 0,
        remindDays: todo.remindDays,
        remindedFor: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    checks
      .filter((row) => row.todoId === todo.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .forEach((row, index) => {
        db.insert(taskChecks)
          .values({
            id: id("tchk"),
            orgId: actor.orgId,
            taskId,
            title: row.title,
            sortOrder: index,
            status: "open",
            assigneeUserId: null,
            assigneeContactId: null,
            dueAt: null,
            completedAt: null,
            completedBy: null,
          })
          .run();
      });
    created += 1;
  }
  return created;
}

export type VendorTodo = { id: string; taskId: string; title: string; job: string; dueAt: string | null; status: string };

function vendorContact(token: string): { db: AppDatabase; orgId: string; contactId: string } | null {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const db = getDb();
  const portal = db.select().from(vendorPortals).where(eq(vendorPortals.tokenHash, hashVendorToken(trimmed))).get();
  if (!portal || !vendorTokenMatches(trimmed, portal.tokenHash)) return null;
  return { db, orgId: portal.orgId, contactId: portal.contactId };
}

export function vendorTodos(token: string): VendorTodo[] {
  const ctx = vendorContact(token);
  if (!ctx) return [];
  const checks = ctx.db
    .select()
    .from(taskChecks)
    .where(and(eq(taskChecks.orgId, ctx.orgId), eq(taskChecks.assigneeContactId, ctx.contactId)))
    .all();
  const jobs = new Map(ctx.db.select().from(projects).where(eq(projects.orgId, ctx.orgId)).all().map((row) => [row.id, row.name]));
  const parents = new Map(ctx.db.select().from(tasks).where(eq(tasks.orgId, ctx.orgId)).all().map((row) => [row.id, row]));
  return checks.map((row) => {
    const parent = parents.get(row.taskId);
    const projectId = parent?.relatedType === "project" ? parent.relatedId : null;
    return {
      id: row.id,
      taskId: row.taskId,
      title: row.title,
      job: projectId ? jobs.get(projectId) || "" : "",
      dueAt: row.dueAt || dayOf(parent?.dueAt) || null,
      status: row.status,
    };
  });
}

export function vendorTick(token: string, checkId: string, done: boolean, upload?: { filename: string; bytes: Buffer } | null) {
  const ctx = vendorContact(token);
  if (!ctx) throw new ServiceError("That link is not active.");
  const row = ctx.db.select().from(taskChecks).where(and(eq(taskChecks.orgId, ctx.orgId), eq(taskChecks.id, checkId), eq(taskChecks.assigneeContactId, ctx.contactId))).get();
  if (!row) throw new ServiceError("That item is not assigned to you.");
  const now = nowIso();
  ctx.db.transaction((tx) => {
    tx.update(taskChecks)
      .set({ status: done ? "done" : "open", completedAt: done ? now : null, completedBy: ctx.contactId })
      .where(and(eq(taskChecks.id, checkId), eq(taskChecks.orgId, ctx.orgId)))
      .run();
    const parent = tx.select().from(tasks).where(and(eq(tasks.orgId, ctx.orgId), eq(tasks.id, row.taskId))).get();
    if (!done && parent?.status === "done") {
      tx.update(tasks).set({ status: "open", updatedAt: now }).where(and(eq(tasks.id, row.taskId), eq(tasks.orgId, ctx.orgId))).run();
    }
    audit(tx as unknown as AppDatabase, ctx.orgId, ctx.contactId, done ? "todo.check" : "todo.uncheck", checkId, { taskId: row.taskId, who: ctx.contactId, when: now });
  });
  if (upload && upload.bytes.length > 0) {
    const error = photoUploadError(upload.filename, upload.bytes);
    if (error) throw new ServiceError(error);
    const type = rasterImageType(upload.bytes);
    if (!type) throw new ServiceError("Use a JPEG, PNG, or WebP photo.");
    const documentId = id("doc");
    const ext = photoExtension(type);
    const relative = path.join("uploads", ctx.orgId, `${documentId}.${ext}`);
    fs.mkdirSync(path.dirname(path.join(dataDir(), relative)), { recursive: true });
    fs.writeFileSync(path.join(dataDir(), relative), upload.bytes);
    const parent = ctx.db.select().from(tasks).where(and(eq(tasks.orgId, ctx.orgId), eq(tasks.id, row.taskId))).get();
    ctx.db.insert(documents)
      .values({
        id: documentId,
        orgId: ctx.orgId,
        projectId: parent?.relatedType === "project" ? parent.relatedId : null,
        leadId: null,
        contactId: ctx.contactId,
        type: "photo",
        filename: `photo.${ext}`,
        storagePath: relative,
        metadataJson: null,
        deletedAt: null,
        createdAt: nowIso(),
        createdBy: ctx.contactId,
      })
      .run();
    ctx.db.insert(taskFiles).values({ id: id("tfile"), orgId: ctx.orgId, taskId: row.taskId, checkId, documentId }).run();
  }
}

export function todoPeople(actor: Actor): { users: { id: string; name: string }[]; vendors: { id: string; name: string }[]; jobs: { id: string; name: string }[]; items: { id: string; projectId: string; title: string }[] } {
  const db = dbFor(actor);
  const members = db
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const vendors = db
    .select()
    .from(contacts)
    .where(eq(contacts.orgId, actor.orgId))
    .all()
    .filter((row) => !row.deletedAt && (row.type === "vendor" || row.type === "sub"))
    .map((row) => ({ id: row.id, name: row.company || row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const jobs = db
    .select()
    .from(projects)
    .where(eq(projects.orgId, actor.orgId))
    .all()
    .filter((row) => row.status === "active")
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const items = db
    .select()
    .from(scheduleItems)
    .where(eq(scheduleItems.orgId, actor.orgId))
    .all()
    .map((row) => ({ id: row.id, projectId: row.projectId, title: row.title }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return { users: members, vendors, jobs, items };
}
