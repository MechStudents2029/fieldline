import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  auditLogs,
  changeOrders,
  contacts,
  meetingActions,
  meetingAttendees,
  meetingItems,
  meetings,
  memberships,
  organizations,
  projects,
  rfis,
  scheduleItems,
  selections,
  submittals,
  users,
  vendorPortals,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { markTodoDone } from "@/lib/meetings/sync";
import {
  KIND_LABEL,
  STATUS_LABEL,
  canEditMeeting,
  carryForward,
  isLinkType,
  isMeetingKind,
  type AssigneeKind,
} from "@/lib/meetings/series";
import { canEditCrm, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { createTodo } from "@/lib/services/todos";
import { appOrigin } from "@/lib/security";
import { localDay } from "@/lib/time/calendar";
import { addCalendarDays } from "@/lib/time/calendar";
import { hashVendorToken, vendorTokenMatches } from "@/lib/vendor/token";

export type MeetingQuery = { projectId?: string; filter?: string };

export type PortalMeeting = {
  id: string;
  job: string;
  title: string;
  meetOn: string;
  startTime: string;
  location: string;
  kindLabel: string;
  items: { id: string; title: string; notes: string; decision: string; sourceLabel: string }[];
  actions: { id: string; title: string; dueOn: string; status: string }[];
};

function office(actor: Actor) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot change this.");
}

function bound(value: string, max: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function dayOf(value: string | null | undefined): string {
  const day = (value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
}

function clockOf(value: string): string {
  const time = value.trim();
  if (!time) return "";
  if (!/^\d{2}:\d{2}$/.test(time)) throw new ServiceError("Enter a time.");
  return time;
}

function todayFor(orgId: string): string {
  const org = getDb().select().from(organizations).where(eq(organizations.id, orgId)).get();
  return localDay(Date.now(), org?.timeZone || "America/New_York");
}

function shareToken(): string {
  return randomBytes(18).toString("base64url");
}

function shareUrl(token: string): string {
  const origin = appOrigin(process.env) ?? "";
  return `${origin}/m/${token}`;
}

function audit(orgId: string, actorId: string, action: string, entityId: string, payload: unknown) {
  getDb()
    .insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "meeting",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function meetingOf(orgId: string, meetingId: string) {
  return getDb()
    .select()
    .from(meetings)
    .where(and(eq(meetings.orgId, orgId), eq(meetings.id, meetingId)))
    .get();
}

function requireMeeting(actor: Actor, meetingId: string) {
  const row = meetingOf(actor.orgId, meetingId);
  if (!row) throw new ServiceError("That meeting is not in your company.");
  return row;
}

function requireEditable(actor: Actor, meetingId: string) {
  office(actor);
  const row = requireMeeting(actor, meetingId);
  if (!canEditMeeting(row.status)) throw new ServiceError("Approved minutes are locked.");
  return row;
}

function projectOf(orgId: string, projectId: string) {
  return getDb()
    .select()
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId)))
    .get();
}

function names(orgId: string) {
  const db = getDb();
  const people = new Map(
    db
      .select({ id: users.id, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgId))
      .all()
      .map((row) => [row.id, row.name]),
  );
  const cards = new Map(
    db
      .select()
      .from(contacts)
      .where(eq(contacts.orgId, orgId))
      .all()
      .filter((row) => !row.deletedAt)
      .map((row) => [row.id, row.company?.trim() || row.name]),
  );
  return { people, cards };
}

function assertAssignee(orgId: string, kind: AssigneeKind, userId: string | null, contactId: string | null) {
  const db = getDb();
  if (kind === "user") {
    if (!userId) throw new ServiceError("Pick an assignee.");
    const member = db
      .select({ id: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
      .get();
    if (!member) throw new ServiceError("That person is not in your company.");
    return { userId, contactId: null };
  }
  if (!contactId) throw new ServiceError("Pick an assignee.");
  const contact = db.select().from(contacts).where(and(eq(contacts.orgId, orgId), eq(contacts.id, contactId))).get();
  if (!contact || contact.deletedAt) throw new ServiceError("That person is not in your company.");
  if (kind === "vendor" && contact.type !== "vendor" && contact.type !== "sub") throw new ServiceError("That vendor is not in your company.");
  if (kind === "client" && contact.type !== "client") throw new ServiceError("That client is not in your company.");
  return { userId: null, contactId };
}

function assertLink(orgId: string, projectId: string, linkType: string, linkId: string | null) {
  if (!linkType) return { linkType: "", linkId: null as string | null };
  if (!isLinkType(linkType) || !linkId) throw new ServiceError("That link is not on this job.");
  const db = getDb();
  const where = and(eq(rfis.orgId, orgId), eq(rfis.projectId, projectId), eq(rfis.id, linkId));
  const found =
    linkType === "rfi"
      ? db.select({ id: rfis.id }).from(rfis).where(where).get()
      : linkType === "change_order"
        ? db
            .select({ id: changeOrders.id })
            .from(changeOrders)
            .where(and(eq(changeOrders.orgId, orgId), eq(changeOrders.projectId, projectId), eq(changeOrders.id, linkId)))
            .get()
        : linkType === "submittal"
          ? db
              .select({ id: submittals.id })
              .from(submittals)
              .where(and(eq(submittals.orgId, orgId), eq(submittals.projectId, projectId), eq(submittals.id, linkId)))
              .get()
          : linkType === "selection"
            ? db
                .select({ id: selections.id })
                .from(selections)
                .where(and(eq(selections.orgId, orgId), eq(selections.projectId, projectId), eq(selections.id, linkId)))
                .get()
            : db
                .select({ id: scheduleItems.id })
                .from(scheduleItems)
                .where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.projectId, projectId), eq(scheduleItems.id, linkId)))
                .get();
  if (!found) throw new ServiceError("That link is not on this job.");
  return { linkType, linkId };
}

function currentRows(orgId: string) {
  const rows = getDb().select().from(meetings).where(eq(meetings.orgId, orgId)).all();
  const replaced = new Set(rows.map((row) => row.replacesId).filter((value): value is string => Boolean(value)));
  return rows.filter((row) => !replaced.has(row.id));
}

export function listMeetings(actor: Actor, query: MeetingQuery = {}) {
  const db = getDb();
  const today = todayFor(actor.orgId);
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  const actions = db.select().from(meetingActions).where(eq(meetingActions.orgId, actor.orgId)).all();
  const filter = query.filter ?? "";
  return currentRows(actor.orgId)
    .filter((row) => !query.projectId || row.projectId === query.projectId)
    .map((row) => {
      const mine = actions.filter((action) => action.meetingId === row.id);
      const openActions = mine.filter((action) => action.status === "open").length;
      const overdueActions = mine.filter((action) => action.status === "open" && action.dueOn && action.dueOn < today).length;
      return {
        id: row.id,
        projectId: row.projectId,
        job: jobs.get(row.projectId) || "Job",
        title: row.title,
        kind: row.kind,
        kindLabel: isMeetingKind(row.kind) ? KIND_LABEL[row.kind] : row.kind,
        number: row.number,
        meetOn: row.meetOn,
        startTime: row.startTime,
        location: row.location,
        status: row.status,
        statusLabel: STATUS_LABEL[row.status as keyof typeof STATUS_LABEL] || row.status,
        openActions,
        overdueActions,
        version: row.version,
      };
    })
    .filter((row) => {
      if (filter === "upcoming") return row.meetOn >= today;
      if (filter === "minutes") return (row.status === "agenda" || row.status === "minutes") && row.meetOn <= today;
      if (filter === "actions") return row.openActions > 0;
      if (filter === "overdue") return row.overdueActions > 0;
      return true;
    })
    .sort((a, b) => a.meetOn.localeCompare(b.meetOn) || a.number - b.number);
}

export function meetingAttention(actor: Actor): { count: number; href: string | null } {
  const today = todayFor(actor.orgId);
  const current = new Set(currentRows(actor.orgId).map((row) => row.id));
  const count = getDb()
    .select()
    .from(meetingActions)
    .where(eq(meetingActions.orgId, actor.orgId))
    .all()
    .filter((action) => current.has(action.meetingId) && action.status === "open" && action.dueOn && action.dueOn < today).length;
  return { count, href: count > 0 ? "/meetings?filter=overdue" : null };
}

export function meetingForm(actor: Actor, projectId: string) {
  const project = projectOf(actor.orgId, projectId);
  if (!project) return null;
  const db = getDb();
  const team = db
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const cards = db
    .select()
    .from(contacts)
    .where(eq(contacts.orgId, actor.orgId))
    .all()
    .filter((row) => !row.deletedAt);
  const label = (row: { company: string | null; name: string }) => row.company?.trim() || row.name;
  return {
    project,
    team,
    vendors: cards.filter((row) => row.type === "vendor" || row.type === "sub").map((row) => ({ id: row.id, name: label(row) })).sort((a, b) => a.name.localeCompare(b.name)),
    clients: cards.filter((row) => row.type === "client").map((row) => ({ id: row.id, name: label(row) })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function attendeeRow(orgId: string, meetingId: string, kind: "user" | "vendor" | "client", personId: string) {
  if (kind === "user") {
    const member = getDb()
      .select({ id: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, personId)))
      .get();
    if (!member) return null;
    return { id: id("matt"), orgId, meetingId, kind, userId: personId, contactId: null, presence: "present" };
  }
  const contact = getDb().select().from(contacts).where(and(eq(contacts.orgId, orgId), eq(contacts.id, personId))).get();
  if (!contact || contact.deletedAt) return null;
  if (kind === "vendor" && contact.type !== "vendor" && contact.type !== "sub") return null;
  if (kind === "client" && contact.type !== "client") return null;
  return { id: id("matt"), orgId, meetingId, kind, userId: null, contactId: personId, presence: "present" };
}

export function createMeeting(
  actor: Actor,
  input: { projectId: string; kind: string; title: string; meetOn: string; startTime: string; location: string; userId?: string; vendorId?: string; clientId?: string },
): string {
  office(actor);
  const project = projectOf(actor.orgId, input.projectId);
  if (!project) throw new ServiceError("That job is not in your company.");
  if (!isMeetingKind(input.kind)) throw new ServiceError("Pick a meeting type.");
  const meetOn = dayOf(input.meetOn);
  if (!meetOn) throw new ServiceError("Enter a date.");
  const title = bound(input.title, 160) || KIND_LABEL[input.kind];
  const now = nowIso();
  const meetingId = id("mtg");
  const seriesId = id("mser");
  getDb()
    .insert(meetings)
    .values({
      id: meetingId,
      orgId: actor.orgId,
      projectId: project.id,
      seriesId,
      number: 1,
      title,
      kind: input.kind,
      meetOn,
      startTime: clockOf(input.startTime),
      location: bound(input.location, 200),
      status: "agenda",
      version: 1,
      replacesId: null,
      shareToken: shareToken(),
      distributedAt: null,
      distributedBy: null,
      approvedAt: null,
      approvedBy: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  const attendees = [input.userId ? attendeeRow(actor.orgId, meetingId, "user", input.userId) : null, input.vendorId ? attendeeRow(actor.orgId, meetingId, "vendor", input.vendorId) : null, input.clientId ? attendeeRow(actor.orgId, meetingId, "client", input.clientId) : null].filter((row): row is NonNullable<typeof row> => Boolean(row));
  if (attendees.length) getDb().insert(meetingAttendees).values(attendees).run();
  audit(actor.orgId, actor.userId, "meeting.create", meetingId, { title, kind: input.kind });
  return meetingId;
}

function linkChoices(orgId: string, projectId: string) {
  const db = getDb();
  const out: { value: string; label: string }[] = [];
  for (const row of db.select().from(rfis).where(and(eq(rfis.orgId, orgId), eq(rfis.projectId, projectId))).all()) out.push({ value: `rfi:${row.id}`, label: `RFI · ${row.title}` });
  for (const row of db.select().from(changeOrders).where(and(eq(changeOrders.orgId, orgId), eq(changeOrders.projectId, projectId))).all()) out.push({ value: `change_order:${row.id}`, label: `CO · ${row.title}` });
  for (const row of db.select().from(submittals).where(and(eq(submittals.orgId, orgId), eq(submittals.projectId, projectId))).all()) out.push({ value: `submittal:${row.id}`, label: `Submittal · ${row.title}` });
  for (const row of db.select().from(selections).where(and(eq(selections.orgId, orgId), eq(selections.projectId, projectId))).all()) out.push({ value: `selection:${row.id}`, label: `Selection · ${row.title}` });
  for (const row of db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.projectId, projectId))).all()) out.push({ value: `schedule:${row.id}`, label: `Schedule · ${row.title}` });
  return out;
}

function linkLabel(orgId: string, projectId: string, linkType: string, linkId: string | null) {
  if (!linkType || !linkId) return "";
  return linkChoices(orgId, projectId).find((row) => row.value === `${linkType}:${linkId}`)?.label ?? "";
}

export function meetingDetail(actor: Actor, meetingId: string) {
  const row = meetingOf(actor.orgId, meetingId);
  if (!row) return null;
  const db = getDb();
  const project = projectOf(actor.orgId, row.projectId);
  const { people, cards } = names(actor.orgId);
  const attendees = db
    .select()
    .from(meetingAttendees)
    .where(and(eq(meetingAttendees.orgId, actor.orgId), eq(meetingAttendees.meetingId, row.id)))
    .all()
    .map((attendee) => ({
      id: attendee.id,
      kind: attendee.kind,
      userId: attendee.userId,
      contactId: attendee.contactId,
      presence: attendee.presence,
      name: attendee.userId ? people.get(attendee.userId) || "Team" : cards.get(attendee.contactId || "") || "Contact",
    }));
  const actionRows = db
    .select()
    .from(meetingActions)
    .where(and(eq(meetingActions.orgId, actor.orgId), eq(meetingActions.meetingId, row.id)))
    .all();
  const items = db
    .select()
    .from(meetingItems)
    .where(and(eq(meetingItems.orgId, actor.orgId), eq(meetingItems.meetingId, row.id)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => ({
      id: item.id,
      title: item.title,
      notes: item.notes,
      decision: item.decision,
      itemStatus: item.itemStatus,
      linkType: item.linkType,
      linkId: item.linkId,
      linkLabel: linkLabel(actor.orgId, row.projectId, item.linkType, item.linkId),
      sourceLabel: item.sourceLabel,
      sortOrder: item.sortOrder,
      actions: actionRows
        .filter((action) => action.itemId === item.id)
        .map((action) => ({
          id: action.id,
          title: action.title,
          assigneeKind: action.assigneeKind,
          userId: action.userId,
          contactId: action.contactId,
          dueOn: action.dueOn,
          status: action.status,
          todoId: action.todoId,
          sourceLabel: action.sourceLabel,
          assignee: action.userId ? people.get(action.userId) || "Team" : cards.get(action.contactId || "") || "Contact",
        })),
    }));
  const assignees = [
    ...[...people.entries()].map(([personId, name]) => ({ value: `user:${personId}`, label: name })),
    ...db
      .select()
      .from(contacts)
      .where(eq(contacts.orgId, actor.orgId))
      .all()
      .filter((contact) => !contact.deletedAt && (contact.type === "vendor" || contact.type === "sub" || contact.type === "client"))
      .map((contact) => ({
        value: `${contact.type === "client" ? "client" : "vendor"}:${contact.id}`,
        label: contact.company?.trim() || contact.name,
      })),
  ].sort((a, b) => a.label.localeCompare(b.label));
  return {
    ...row,
    job: project?.name || "Job",
    kindLabel: isMeetingKind(row.kind) ? KIND_LABEL[row.kind] : row.kind,
    statusLabel: STATUS_LABEL[row.status as keyof typeof STATUS_LABEL] || row.status,
    shareUrl: shareUrl(row.shareToken),
    editable: canEditMeeting(row.status) && canEditCrm(actor.role as Role),
    distributedByName: row.distributedBy ? people.get(row.distributedBy) || "" : "",
    approvedByName: row.approvedBy ? people.get(row.approvedBy) || "" : "",
    attendees,
    items,
    assignees,
    links: linkChoices(actor.orgId, row.projectId),
  };
}

export function addItem(actor: Actor, meetingId: string, input: { title: string; link?: string }) {
  const meeting = requireEditable(actor, meetingId);
  const title = bound(input.title, 160);
  if (!title) throw new ServiceError("Enter an agenda item.");
  const [linkType, linkId] = (input.link ?? "").split(":");
  const link = assertLink(actor.orgId, meeting.projectId, linkType || "", linkId || null);
  const existing = getDb().select().from(meetingItems).where(and(eq(meetingItems.orgId, actor.orgId), eq(meetingItems.meetingId, meetingId))).all();
  const sortOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
  const itemId = id("mitm");
  getDb()
    .insert(meetingItems)
    .values({
      id: itemId,
      orgId: actor.orgId,
      meetingId,
      sortOrder,
      title,
      notes: "",
      decision: "",
      itemStatus: "open",
      linkType: link.linkType,
      linkId: link.linkId,
      carriedFromItemId: null,
      sourceLabel: "",
    })
    .run();
  audit(actor.orgId, actor.userId, "meeting.item", meetingId, { itemId, title });
  return itemId;
}

export function saveItem(actor: Actor, itemId: string, input: { notes: string; decision: string; itemStatus: string; title?: string }) {
  const db = getDb();
  const item = db.select().from(meetingItems).where(and(eq(meetingItems.orgId, actor.orgId), eq(meetingItems.id, itemId))).get();
  if (!item) throw new ServiceError("That item is not in your company.");
  requireEditable(actor, item.meetingId);
  const itemStatus = input.itemStatus === "closed" ? "closed" : "open";
  const title = input.title != null && bound(input.title, 160) ? bound(input.title, 160) : item.title;
  db.update(meetingItems)
    .set({
      title,
      notes: bound(input.notes, 4000),
      decision: bound(input.decision, 2000),
      itemStatus,
    })
    .where(and(eq(meetingItems.id, itemId), eq(meetingItems.orgId, actor.orgId)))
    .run();
}

export function addAction(actor: Actor, itemId: string, input: { title: string; assignee: string; dueOn: string }) {
  const db = getDb();
  const item = db.select().from(meetingItems).where(and(eq(meetingItems.orgId, actor.orgId), eq(meetingItems.id, itemId))).get();
  if (!item) throw new ServiceError("That item is not in your company.");
  requireEditable(actor, item.meetingId);
  const title = bound(input.title, 160);
  if (!title) throw new ServiceError("Enter an action.");
  const [kind, personId] = input.assignee.split(":");
  if (kind !== "user" && kind !== "vendor" && kind !== "client") throw new ServiceError("Pick an assignee.");
  const assignee = assertAssignee(actor.orgId, kind, kind === "user" ? personId : null, kind === "user" ? null : personId);
  const dueOn = input.dueOn.trim() ? dayOf(input.dueOn) : null;
  if (input.dueOn.trim() && !dueOn) throw new ServiceError("Enter a date.");
  const now = nowIso();
  const actionId = id("mact");
  db.insert(meetingActions)
    .values({
      id: actionId,
      orgId: actor.orgId,
      meetingId: item.meetingId,
      itemId,
      title,
      assigneeKind: kind,
      userId: assignee.userId,
      contactId: assignee.contactId,
      dueOn,
      status: "open",
      todoId: null,
      carriedFromActionId: null,
      sourceLabel: "",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  audit(actor.orgId, actor.userId, "meeting.action", item.meetingId, { actionId, title });
  return actionId;
}

export function setActionStatus(actor: Actor, actionId: string, status: string) {
  const db = getDb();
  const action = db.select().from(meetingActions).where(and(eq(meetingActions.orgId, actor.orgId), eq(meetingActions.id, actionId))).get();
  if (!action) throw new ServiceError("That action is not in your company.");
  requireEditable(actor, action.meetingId);
  const next = status === "done" ? "done" : "open";
  db.update(meetingActions).set({ status: next, updatedAt: nowIso() }).where(and(eq(meetingActions.id, actionId), eq(meetingActions.orgId, actor.orgId))).run();
  if (next === "done" && action.todoId) markTodoDone(db, actor.orgId, action.todoId);
  if (next === "done") audit(actor.orgId, actor.userId, "meeting.action.done", action.meetingId, { actionId });
}

export function createActionTodo(actor: Actor, actionId: string): string {
  office(actor);
  const db = getDb();
  const action = db.select().from(meetingActions).where(and(eq(meetingActions.orgId, actor.orgId), eq(meetingActions.id, actionId))).get();
  if (!action) throw new ServiceError("That action is not in your company.");
  requireEditable(actor, action.meetingId);
  if (action.todoId) return action.todoId;
  const meeting = requireMeeting(actor, action.meetingId);
  const { cards } = names(actor.orgId);
  const notes = action.assigneeKind === "client" ? `Client: ${cards.get(action.contactId || "") || "Client"}` : "";
  const todoId = createTodo(actor, {
    title: action.title,
    projectId: meeting.projectId,
    notes,
    dueAt: action.dueOn,
    userIds: action.userId ? [action.userId] : [],
    contactIds: action.assigneeKind === "vendor" && action.contactId ? [action.contactId] : [],
  });
  db.update(meetingActions).set({ todoId, updatedAt: nowIso() }).where(and(eq(meetingActions.id, actionId), eq(meetingActions.orgId, actor.orgId))).run();
  audit(actor.orgId, actor.userId, "meeting.todo", action.meetingId, { actionId, todoId });
  return todoId;
}

export function startMinutes(actor: Actor, meetingId: string) {
  office(actor);
  const row = requireMeeting(actor, meetingId);
  if (row.status !== "agenda") throw new ServiceError("Minutes already started.");
  getDb().update(meetings).set({ status: "minutes", updatedAt: nowIso() }).where(and(eq(meetings.id, meetingId), eq(meetings.orgId, actor.orgId))).run();
  audit(actor.orgId, actor.userId, "meeting.minutes", meetingId, {});
}

export function approveMinutes(actor: Actor, meetingId: string) {
  office(actor);
  const row = requireMeeting(actor, meetingId);
  if (row.status !== "minutes") throw new ServiceError("Start the minutes first.");
  const now = nowIso();
  getDb().update(meetings).set({ status: "approved", approvedAt: now, approvedBy: actor.userId, updatedAt: now }).where(and(eq(meetings.id, meetingId), eq(meetings.orgId, actor.orgId))).run();
  audit(actor.orgId, actor.userId, "meeting.approve", meetingId, {});
}

function copyMeeting(actor: Actor, sourceId: string, mode: "revise" | "follow") {
  office(actor);
  const db = getDb();
  const source = requireMeeting(actor, sourceId);
  if (mode === "revise" && source.status !== "approved") throw new ServiceError("Approve the minutes first.");
  const attendees = db.select().from(meetingAttendees).where(and(eq(meetingAttendees.orgId, actor.orgId), eq(meetingAttendees.meetingId, sourceId))).all();
  const items = db.select().from(meetingItems).where(and(eq(meetingItems.orgId, actor.orgId), eq(meetingItems.meetingId, sourceId))).all();
  const actions = db.select().from(meetingActions).where(and(eq(meetingActions.orgId, actor.orgId), eq(meetingActions.meetingId, sourceId))).all();
  const now = nowIso();
  const meetingId = id("mtg");
  const siblings = db.select().from(meetings).where(and(eq(meetings.orgId, actor.orgId), eq(meetings.seriesId, source.seriesId))).all();
  const number = mode === "follow" ? Math.max(...siblings.map((row) => row.number)) + 1 : source.number;
  const version = mode === "revise" ? source.version + 1 : 1;
  db.insert(meetings)
    .values({
      id: meetingId,
      orgId: actor.orgId,
      projectId: source.projectId,
      seriesId: source.seriesId,
      number,
      title: source.title,
      kind: source.kind,
      meetOn: mode === "follow" ? addCalendarDays(source.meetOn, 7) : source.meetOn,
      startTime: source.startTime,
      location: source.location,
      status: mode === "revise" ? "minutes" : "agenda",
      version,
      replacesId: mode === "revise" ? source.id : null,
      shareToken: shareToken(),
      distributedAt: null,
      distributedBy: null,
      approvedAt: null,
      approvedBy: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  if (attendees.length) {
    db.insert(meetingAttendees)
      .values(attendees.map((row) => ({ id: id("matt"), orgId: actor.orgId, meetingId, kind: row.kind, userId: row.userId, contactId: row.contactId, presence: row.presence })))
      .run();
  }
  if (mode === "revise") {
    const itemIds = new Map<string, string>();
    for (const item of items.sort((a, b) => a.sortOrder - b.sortOrder)) {
      const itemId = id("mitm");
      itemIds.set(item.id, itemId);
      db.insert(meetingItems)
        .values({
          id: itemId,
          orgId: actor.orgId,
          meetingId,
          sortOrder: item.sortOrder,
          title: item.title,
          notes: item.notes,
          decision: item.decision,
          itemStatus: item.itemStatus,
          linkType: item.linkType,
          linkId: item.linkId,
          carriedFromItemId: item.carriedFromItemId,
          sourceLabel: item.sourceLabel,
        })
        .run();
    }
    if (actions.length) {
      db.insert(meetingActions)
        .values(
          actions.map((action) => ({
            id: id("mact"),
            orgId: actor.orgId,
            meetingId,
            itemId: itemIds.get(action.itemId) || action.itemId,
            title: action.title,
            assigneeKind: action.assigneeKind,
            userId: action.userId,
            contactId: action.contactId,
            dueOn: action.dueOn,
            status: action.status,
            todoId: null,
            carriedFromActionId: action.carriedFromActionId,
            sourceLabel: action.sourceLabel,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .run();
    }
    audit(actor.orgId, actor.userId, "meeting.revise", meetingId, { replacesId: source.id, version });
    return meetingId;
  }
  const carried = carryForward(
    items.map((item) => ({
      id: item.id,
      title: item.title,
      notes: item.notes,
      decision: item.decision,
      itemStatus: item.itemStatus,
      linkType: item.linkType,
      linkId: item.linkId,
      sortOrder: item.sortOrder,
    })),
    actions.map((action) => ({
      id: action.id,
      itemId: action.itemId,
      title: action.title,
      assigneeKind: action.assigneeKind,
      userId: action.userId,
      contactId: action.contactId,
      dueOn: action.dueOn,
      status: action.status,
    })),
    source.number,
  );
  const itemIds = new Map<string, string>();
  for (const item of carried) {
    const itemId = id("mitm");
    itemIds.set(item.carriedFromItemId, itemId);
    db.insert(meetingItems)
      .values({
        id: itemId,
        orgId: actor.orgId,
        meetingId,
        sortOrder: item.sortOrder,
        title: item.title,
        notes: item.notes,
        decision: item.decision,
        itemStatus: item.itemStatus,
        linkType: item.linkType,
        linkId: item.linkId,
        carriedFromItemId: item.carriedFromItemId,
        sourceLabel: item.sourceLabel,
      })
      .run();
    if (item.actions.length) {
      db.insert(meetingActions)
        .values(
          item.actions.map((action) => ({
            id: id("mact"),
            orgId: actor.orgId,
            meetingId,
            itemId,
            title: action.title,
            assigneeKind: action.assigneeKind,
            userId: action.userId,
            contactId: action.contactId,
            dueOn: action.dueOn,
            status: action.status,
            todoId: null,
            carriedFromActionId: action.carriedFromActionId,
            sourceLabel: action.sourceLabel,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .run();
    }
  }
  audit(actor.orgId, actor.userId, "meeting.followup", meetingId, { from: source.id, number });
  return meetingId;
}

export function reviseMeeting(actor: Actor, meetingId: string) {
  return copyMeeting(actor, meetingId, "revise");
}

export function followUpMeeting(actor: Actor, meetingId: string, meetOn: string) {
  const day = meetOn.trim() ? dayOf(meetOn) : "";
  if (meetOn.trim() && !day) throw new ServiceError("Enter a date.");
  const meetingIdNext = copyMeeting(actor, meetingId, "follow");
  if (day) getDb().update(meetings).set({ meetOn: day }).where(and(eq(meetings.id, meetingIdNext), eq(meetings.orgId, actor.orgId))).run();
  return meetingIdNext;
}

export function markDistributed(actor: Actor, meetingId: string) {
  office(actor);
  requireMeeting(actor, meetingId);
  const now = nowIso();
  getDb().update(meetings).set({ distributedAt: now, distributedBy: actor.userId, updatedAt: now }).where(and(eq(meetings.id, meetingId), eq(meetings.orgId, actor.orgId))).run();
  audit(actor.orgId, actor.userId, "meeting.distribute", meetingId, { who: actor.userId, when: now });
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function meetingsCsv(actor: Actor, query: MeetingQuery = {}) {
  const rows = listMeetings(actor, query);
  const db = getDb();
  const { people, cards } = names(actor.orgId);
  const lines = ["job,meeting,type,date,status,item,action,assignee,due,action status"];
  for (const row of rows) {
    const items = db.select().from(meetingItems).where(and(eq(meetingItems.orgId, actor.orgId), eq(meetingItems.meetingId, row.id))).all().sort((a, b) => a.sortOrder - b.sortOrder);
    const actions = db.select().from(meetingActions).where(and(eq(meetingActions.orgId, actor.orgId), eq(meetingActions.meetingId, row.id))).all();
    if (items.length === 0) {
      lines.push([csvCell(row.job), csvCell(row.title), row.kind, row.meetOn, row.status, "", "", "", "", ""].join(","));
      continue;
    }
    for (const item of items) {
      const mine = actions.filter((action) => action.itemId === item.id);
      if (mine.length === 0) {
        lines.push([csvCell(row.job), csvCell(row.title), row.kind, row.meetOn, row.status, csvCell(item.title), "", "", "", ""].join(","));
        continue;
      }
      for (const action of mine) {
        const assignee = action.userId ? people.get(action.userId) || "" : cards.get(action.contactId || "") || "";
        lines.push([csvCell(row.job), csvCell(row.title), row.kind, row.meetOn, row.status, csvCell(item.title), csvCell(action.title), csvCell(assignee), action.dueOn || "", action.status].join(","));
      }
    }
  }
  return lines.join("\n");
}

function portalMeetings(orgId: string, contactId: string, projectId?: string): PortalMeeting[] {
  const db = getDb();
  const attended = new Set(
    db
      .select()
      .from(meetingAttendees)
      .where(and(eq(meetingAttendees.orgId, orgId), eq(meetingAttendees.contactId, contactId)))
      .all()
      .map((row) => row.meetingId),
  );
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row.name]));
  const rows = db
    .select()
    .from(meetings)
    .where(eq(meetings.orgId, orgId))
    .all()
    .filter((row) => row.status === "approved" && attended.has(row.id) && (!projectId || row.projectId === projectId));
  return rows
    .sort((a, b) => b.meetOn.localeCompare(a.meetOn))
    .map((row) => {
      const items = db.select().from(meetingItems).where(and(eq(meetingItems.orgId, orgId), eq(meetingItems.meetingId, row.id))).all().sort((a, b) => a.sortOrder - b.sortOrder);
      const actions = db
        .select()
        .from(meetingActions)
        .where(and(eq(meetingActions.orgId, orgId), eq(meetingActions.meetingId, row.id), eq(meetingActions.contactId, contactId)))
        .all();
      return {
        id: row.id,
        job: jobs.get(row.projectId) || "Job",
        title: row.title,
        meetOn: row.meetOn,
        startTime: row.startTime,
        location: row.location,
        kindLabel: isMeetingKind(row.kind) ? KIND_LABEL[row.kind] : row.kind,
        items: items.map((item) => ({ id: item.id, title: item.title, notes: item.notes, decision: item.decision, sourceLabel: item.sourceLabel })),
        actions: actions.map((action) => ({ id: action.id, title: action.title, dueOn: action.dueOn || "", status: action.status })),
      };
    });
}

export function portalMeetingsForClient(token: string): PortalMeeting[] {
  const project = getDb().select().from(projects).where(eq(projects.portalToken, token)).get();
  if (!project) return [];
  return portalMeetings(project.orgId, project.contactId, project.id);
}

export function portalMeetingsForVendor(token: string): PortalMeeting[] {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 200) return [];
  const db = getDb();
  const portal = db.select().from(vendorPortals).where(eq(vendorPortals.tokenHash, hashVendorToken(trimmed))).get();
  if (!portal || !vendorTokenMatches(trimmed, portal.tokenHash)) return [];
  return portalMeetings(portal.orgId, portal.contactId);
}

export function publicMeeting(token: string) {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const db = getDb();
  const row = db.select().from(meetings).where(eq(meetings.shareToken, trimmed)).get();
  if (!row) return null;
  const project = projectOf(row.orgId, row.projectId);
  const org = db.select().from(organizations).where(eq(organizations.id, row.orgId)).get();
  const { people, cards } = names(row.orgId);
  const approved = row.status === "approved";
  const attendees = db
    .select()
    .from(meetingAttendees)
    .where(and(eq(meetingAttendees.orgId, row.orgId), eq(meetingAttendees.meetingId, row.id)))
    .all()
    .map((attendee) => ({
      id: attendee.id,
      name: attendee.userId ? people.get(attendee.userId) || "Team" : cards.get(attendee.contactId || "") || "Contact",
      presence: attendee.presence,
    }));
  const items = db
    .select()
    .from(meetingItems)
    .where(and(eq(meetingItems.orgId, row.orgId), eq(meetingItems.meetingId, row.id)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => ({
      id: item.id,
      title: item.title,
      notes: approved ? item.notes : "",
      decision: approved ? item.decision : "",
      sourceLabel: item.sourceLabel,
    }));
  const actions = approved
    ? db
        .select()
        .from(meetingActions)
        .where(and(eq(meetingActions.orgId, row.orgId), eq(meetingActions.meetingId, row.id)))
        .all()
        .map((action) => ({
          id: action.id,
          title: action.title,
          dueOn: action.dueOn || "",
          status: action.status,
          assignee: action.userId ? people.get(action.userId) || "Team" : cards.get(action.contactId || "") || "Contact",
        }))
    : [];
  return {
    orgName: org?.name || "",
    job: project?.name || "Job",
    title: row.title,
    kindLabel: isMeetingKind(row.kind) ? KIND_LABEL[row.kind] : row.kind,
    meetOn: row.meetOn,
    startTime: row.startTime,
    location: row.location,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status as keyof typeof STATUS_LABEL] || row.status,
    number: row.number,
    approved,
    attendees,
    items,
    actions,
  };
}
