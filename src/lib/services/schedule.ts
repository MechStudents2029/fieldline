import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import { calendarFeeds, memberships, projects, scheduleAssignees, scheduleBaselineItems, scheduleBaselines, scheduleItems, scheduleLinks, users } from "@/lib/db/schema";
import { overdueScheduleIds } from "@/lib/services/rfis";
import { id, nowIso } from "@/lib/ids";
import { canEditSchedule, type Role } from "@/lib/permissions";
import { scheduleConflicts } from "@/lib/schedule/conflicts";
import { buildScheduleIcs } from "@/lib/schedule/ics";
import { formatWorkdayVariance } from "@/lib/schedule/delays";
import { inclusiveDays, scheduleWindow, type ScheduleSpan } from "@/lib/schedule/range";
import { isWorkday, workdayOffset } from "@/lib/schedule/workdays";
import { feedTokenMatches, hashFeedToken, newFeedSecret } from "@/lib/schedule/token";
import { notifyAssignment } from "@/lib/services/comments";
import { ServiceError } from "@/lib/services/errors";
import { unlinkScheduleTodos } from "@/lib/services/todos";
import { cleanDelay, delayRequirement, writeDelay, type DelayInput } from "@/lib/services/schedule-plan";
import { buildSchedulePlan, replaceScheduleLinks, writeScheduleShifts, type ScheduleLinkInput } from "@/lib/services/schedule-shift";
import type { Actor } from "@/lib/services/read";
import { calendarForOrg } from "@/lib/services/time";
import { workCalendarFor } from "@/lib/services/work-calendar";
import { addCalendarDays, localDay, zonedTimeToUtc } from "@/lib/time/calendar";
import { dayHeading, rangeLabel } from "@/lib/time/grid";

const STATUSES = ["planned", "confirmed", "done"] as const;
export type ScheduleStatus = (typeof STATUSES)[number];

export type ScheduleInput = {
  projectId: string;
  title: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  status: ScheduleStatus;
  note: string | null;
  assigneeIds: string[];
  links?: ScheduleLinkInput[];
};

export type ScheduleChip = {
  id: string;
  projectId: string;
  jobName: string;
  title: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  status: ScheduleStatus;
  note: string | null;
  assigneeIds: string[];
  conflict: boolean;
  rfiDue: boolean;
  variance: string | null;
};

export type ScheduleBoard = {
  timeZone: string;
  span: ScheduleSpan;
  label: string;
  today: string;
  days: { date: string; label: string; isToday: boolean; off: boolean }[];
  rows: {
    userId: string | null;
    name: string;
    initials: string;
    cells: { date: string; items: ScheduleChip[] }[];
  }[];
  counts: { items: number; people: number; conflicts: number };
  jobs: { id: string; name: string }[];
  crew: { id: string; name: string }[];
  canEdit: boolean;
  hrefs: { prev: string; next: string; today: string; week: string; two: string; current: string };
  phone: { id: string; jobName: string; title: string; who: string; when: string; conflict: boolean; rfiDue: boolean }[];
  catalog: { id: string; projectId: string; title: string }[];
  links: { itemId: string; predecessorId: string; lag: number }[];
};

export type DayAssignment = {
  id: string;
  projectId: string;
  jobName: string;
  title: string;
  status: ScheduleStatus;
  startTime: string | null;
};

function officeOrThrow(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function assertEditor(actor: Actor) {
  if (!canEditSchedule(actor.role as Role)) throw new ServiceError("Your role can view the schedule, not change it.");
}

function cleanDate(value: string, label: string): string {
  const day = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || addCalendarDays(day, 0) !== day) throw new ServiceError(`Enter a ${label} date.`);
  return day;
}

function cleanTime(value: string | null): string | null {
  if (!value || !value.trim()) return null;
  const time = value.trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ServiceError("Start time uses 24-hour HH:MM.");
  return time;
}

function cleanTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, " ");
  if (!title || title.length > 80) throw new ServiceError("Add a short title.");
  return title;
}

function cleanNote(value: string | null): string | null {
  if (!value || !value.trim()) return null;
  const note = value.trim();
  if (note.length > 400) throw new ServiceError("Keep the note under 400 characters.");
  return note;
}

function cleanStatus(value: string): ScheduleStatus {
  if ((STATUSES as readonly string[]).includes(value)) return value as ScheduleStatus;
  throw new ServiceError("Status is planned, confirmed, or done.");
}

function asStatus(value: string): ScheduleStatus {
  return (STATUSES as readonly string[]).includes(value) ? (value as ScheduleStatus) : "planned";
}

function anchorInstant(day: string, timeZone: string, fallback: number): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fallback;
  const [year, month, date] = day.split("-").map(Number);
  try {
    return zonedTimeToUtc(year!, month!, date!, 12, 0, 0, timeZone);
  } catch {
    return fallback;
  }
}

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
}

function boardHref(on: string | null, span: ScheduleSpan, today: string): string {
  const params = new URLSearchParams();
  if (on && on !== today) params.set("on", on);
  if (span === 14) params.set("span", "14");
  const query = params.toString();
  return query ? `/schedule?${query}` : "/schedule";
}

function loadCrew(db: ReturnType<typeof officeOrThrow>, orgId: string) {
  return db
    .select({ id: users.id, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all()
    .filter((row) => row.role !== "viewer")
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function scheduleBoard(actor: Actor, query: { on?: string; span?: string }, now = Date.now()): ScheduleBoard {
  const db = officeOrThrow(actor);
  const calendar = calendarForOrg(actor.orgId);
  const today = localDay(now, calendar.timeZone);
  const span: ScheduleSpan = query.span === "14" ? 14 : 7;
  const anchor = query.on && /^\d{4}-\d{2}-\d{2}$/.test(query.on) ? query.on : today;
  const window = scheduleWindow(anchorInstant(anchor, calendar.timeZone, now), calendar, span);
  const itemRows = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), lte(scheduleItems.startDate, window.endDay), gte(scheduleItems.endDate, window.startDay)))
    .all();
  const itemIds = itemRows.map((row) => row.id);
  const assigneeRows = itemIds.length
    ? db
        .select()
        .from(scheduleAssignees)
        .where(and(eq(scheduleAssignees.orgId, actor.orgId), inArray(scheduleAssignees.itemId, itemIds)))
        .all()
    : [];
  const projectIds = [...new Set(itemRows.map((row) => row.projectId))];
  const projectRows = projectIds.length
    ? db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(and(eq(projects.orgId, actor.orgId), inArray(projects.id, projectIds)))
        .all()
    : [];
  const names = new Map(projectRows.map((row) => [row.id, row.name]));
  const byItem = new Map<string, string[]>();
  for (const row of assigneeRows) {
    const list = byItem.get(row.itemId) ?? [];
    list.push(row.userId);
    byItem.set(row.itemId, list);
  }
  const conflictItems = itemRows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    startDate: row.startDate,
    endDate: row.endDate,
    assigneeIds: byItem.get(row.id) ?? [],
  }));
  const hits = scheduleConflicts(conflictItems).filter((hit) => window.days.includes(hit.day));
  const conflictKey = new Set(hits.flatMap((hit) => hit.itemIds.map((itemId) => `${hit.userId}|${hit.day}|${itemId}`)));
  const lateRfi = overdueScheduleIds(actor.orgId, today);
  const companyCalendar = workCalendarFor(actor.orgId);
  const jobCalendars = new Map<string, ReturnType<typeof workCalendarFor>>();
  const baselines = db.select().from(scheduleBaselines).where(and(eq(scheduleBaselines.orgId, actor.orgId), eq(scheduleBaselines.current, 1))).all();
  const baselineIds = baselines.map((row) => row.id);
  const frozen = baselineIds.length
    ? db
        .select()
        .from(scheduleBaselineItems)
        .where(and(eq(scheduleBaselineItems.orgId, actor.orgId), inArray(scheduleBaselineItems.baselineId, baselineIds)))
        .all()
    : [];
  const varianceOf = new Map<string, string | null>();
  for (const row of itemRows) {
    const base = frozen.find((item) => item.itemId === row.id);
    if (!base) {
      varianceOf.set(row.id, null);
      continue;
    }
    let calendar = jobCalendars.get(row.projectId);
    if (!calendar) {
      calendar = workCalendarFor(actor.orgId, row.projectId);
      jobCalendars.set(row.projectId, calendar);
    }
    const days = workdayOffset(base.endDate, row.endDate, calendar);
    varianceOf.set(row.id, days === 0 ? null : formatWorkdayVariance(days));
  }
  const crew = loadCrew(db, actor.orgId);
  const people = new Map(crew.map((person) => [person.id, person.name]));
  const chipFor = (row: (typeof itemRows)[number], userId: string | null, day: string): ScheduleChip => ({
    id: row.id,
    projectId: row.projectId,
    jobName: names.get(row.projectId) ?? "Job",
    title: row.title,
    startDate: row.startDate,
    endDate: row.endDate,
    startTime: row.startTime,
    status: asStatus(row.status),
    note: row.note,
    assigneeIds: byItem.get(row.id) ?? [],
    conflict: userId != null && conflictKey.has(`${userId}|${day}|${row.id}`),
    rfiDue: lateRfi.has(row.id),
    variance: varianceOf.get(row.id) ?? null,
  });
  const rows = [
    ...crew.map((person) => ({
      userId: person.id,
      name: person.name,
      initials: initials(person.name),
      cells: window.days.map((date) => ({
        date,
        items: itemRows
          .filter((row) => (byItem.get(row.id) ?? []).includes(person.id) && row.startDate <= date && date <= row.endDate)
          .map((row) => chipFor(row, person.id, date)),
      })),
    })),
    {
      userId: null,
      name: "Unassigned",
      initials: "—",
      cells: window.days.map((date) => ({
        date,
        items: itemRows
          .filter((row) => (byItem.get(row.id) ?? []).length === 0 && row.startDate <= date && date <= row.endDate)
          .map((row) => chipFor(row, null, date)),
      })),
    },
  ];
  const booked = new Set(assigneeRows.map((row) => row.userId));
  const jobs = db
    .select({ id: projects.id, name: projects.name, status: projects.status })
    .from(projects)
    .where(eq(projects.orgId, actor.orgId))
    .all()
    .filter((row) => row.status !== "cancelled")
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const anchorOn = query.on && query.on !== today ? window.startDay : null;
  return {
    timeZone: calendar.timeZone,
    span,
    label: rangeLabel(window.days),
    today,
    days: window.days.map((date) => ({ date, label: dayHeading(date), isToday: date === today, off: !isWorkday(date, companyCalendar) })),
    rows,
    counts: { items: itemRows.length, people: booked.size, conflicts: hits.length },
    jobs,
    crew: crew.map((person) => ({ id: person.id, name: person.name })),
    canEdit: canEditSchedule(actor.role as Role),
    hrefs: {
      prev: boardHref(addCalendarDays(window.startDay, -7), span, today),
      next: boardHref(addCalendarDays(window.startDay, 7), span, today),
      today: boardHref(null, span, today),
      week: boardHref(anchorOn, 7, today),
      two: boardHref(anchorOn, 14, today),
      current: boardHref(anchorOn, span, today),
    },
    phone: itemRows
      .slice()
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title))
      .map((row) => {
        const whoIds = byItem.get(row.id) ?? [];
        return {
          id: row.id,
          jobName: names.get(row.projectId) ?? "Job",
          title: row.title,
          who: whoIds.length ? whoIds.map((userId) => people.get(userId) ?? "Crew").join(", ") : "Unassigned",
          when: row.startDate === row.endDate ? dayHeading(row.startDate) : `${dayHeading(row.startDate)} – ${dayHeading(row.endDate)}`,
          conflict: hits.some((hit) => hit.itemIds.includes(row.id)),
          rfiDue: lateRfi.has(row.id),
        };
      }),
    catalog: db
      .select({ id: scheduleItems.id, projectId: scheduleItems.projectId, title: scheduleItems.title })
      .from(scheduleItems)
      .where(eq(scheduleItems.orgId, actor.orgId))
      .all()
      .sort((a, b) => a.title.localeCompare(b.title)),
    links: db
      .select()
      .from(scheduleLinks)
      .where(eq(scheduleLinks.orgId, actor.orgId))
      .all()
      .map((row) => ({ itemId: row.itemId, predecessorId: row.predecessorId, lag: row.lagWorkdays })),
  };
}

export function scheduleItemBrief(actor: Actor, itemId: string) {
  const db = officeOrThrow(actor);
  const item = db
    .select({ item: scheduleItems, jobName: projects.name })
    .from(scheduleItems)
    .innerJoin(projects, and(eq(projects.id, scheduleItems.projectId), eq(projects.orgId, scheduleItems.orgId)))
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, itemId)))
    .get();
  if (!item) return null;
  return {
    id: item.item.id,
    projectId: item.item.projectId,
    jobName: item.jobName,
    title: item.item.title,
    startDate: item.item.startDate,
    endDate: item.item.endDate,
    canEdit: canEditSchedule(actor.role as Role),
  };
}

export function jobSchedule(actor: Actor, projectId: string) {
  const db = officeOrThrow(actor);
  const project = db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.orgId, actor.orgId), eq(projects.id, projectId)))
    .get();
  if (!project) return [];
  const itemRows = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, projectId)))
    .all()
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
  const itemIds = itemRows.map((row) => row.id);
  const assigneeRows = itemIds.length
    ? db
        .select()
        .from(scheduleAssignees)
        .where(and(eq(scheduleAssignees.orgId, actor.orgId), inArray(scheduleAssignees.itemId, itemIds)))
        .all()
    : [];
  const crew = loadCrew(db, actor.orgId);
  const names = new Map(crew.map((person) => [person.id, person.name]));
  return itemRows.map((row) => {
    const who = assigneeRows.filter((assignee) => assignee.itemId === row.id).map((assignee) => names.get(assignee.userId) ?? "Crew");
    return {
      id: row.id,
      title: row.title,
      startDate: row.startDate,
      endDate: row.endDate,
      status: row.status,
      who: who.length ? who.join(", ") : "Unassigned",
    };
  });
}

export function memberAssignments(actor: Actor, now = Date.now()): { today: DayAssignment[]; tomorrow: DayAssignment[] } {
  const db = officeOrThrow(actor);
  const calendar = calendarForOrg(actor.orgId);
  const today = localDay(now, calendar.timeZone);
  const tomorrow = addCalendarDays(today, 1);
  const rows = db
    .select({ item: scheduleItems, projectName: projects.name })
    .from(scheduleAssignees)
    .innerJoin(scheduleItems, and(eq(scheduleItems.id, scheduleAssignees.itemId), eq(scheduleItems.orgId, scheduleAssignees.orgId)))
    .innerJoin(projects, and(eq(projects.id, scheduleItems.projectId), eq(projects.orgId, scheduleItems.orgId)))
    .where(and(eq(scheduleAssignees.orgId, actor.orgId), eq(scheduleAssignees.userId, actor.userId), lte(scheduleItems.startDate, tomorrow), gte(scheduleItems.endDate, today)))
    .all();
  const onDay = (day: string) =>
    rows
      .filter((row) => row.item.startDate <= day && day <= row.item.endDate)
      .map((row) => ({
        id: row.item.id,
        projectId: row.item.projectId,
        jobName: row.projectName,
        title: row.item.title,
        status: asStatus(row.item.status),
        startTime: row.item.startTime,
      }))
      .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || "") || a.jobName.localeCompare(b.jobName));
  return { today: onDay(today), tomorrow: onDay(tomorrow) };
}

function replaceAssignees(db: ReturnType<typeof officeOrThrow>, actor: Actor, itemId: string, assigneeIds: string[]) {
  const crew = new Set(loadCrew(db, actor.orgId).map((person) => person.id));
  const unique = [...new Set(assigneeIds)];
  if (unique.some((userId) => !crew.has(userId))) throw new ServiceError("Assign someone in this company.");
  db.delete(scheduleAssignees).where(and(eq(scheduleAssignees.orgId, actor.orgId), eq(scheduleAssignees.itemId, itemId))).run();
  if (unique.length === 0) return;
  db.insert(scheduleAssignees)
    .values(unique.map((userId) => ({ id: id("scha"), orgId: actor.orgId, itemId, userId })))
    .run();
}

export function saveScheduleItem(actor: Actor, input: ScheduleInput, itemId?: string, delay: DelayInput | null = null) {
  assertEditor(actor);
  const db = officeOrThrow(actor);
  const title = cleanTitle(input.title);
  const startDate = cleanDate(input.startDate, "start");
  const endDate = cleanDate(input.endDate, "end");
  if (endDate < startDate) throw new ServiceError("End is on or after the start.");
  if (inclusiveDays(startDate, endDate).length > 62) throw new ServiceError("Keep an item inside two months.");
  const startTime = cleanTime(input.startTime);
  const status = cleanStatus(input.status);
  const note = cleanNote(input.note);
  const project = db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.orgId, actor.orgId), eq(projects.id, input.projectId)))
    .get();
  if (!project) throw new ServiceError("That job is not in your company.");
  const now = nowIso();
  const existing = itemId
    ? db
        .select()
        .from(scheduleItems)
        .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, itemId)))
        .get()
    : null;
  if (itemId && !existing) throw new ServiceError("That schedule item is not in your company.");
  const savedId = existing?.id ?? id("sch");
  if (existing && input.links) replaceScheduleLinks(actor, savedId, input.links);
  const dateChanged = Boolean(existing && (existing.startDate !== startDate || existing.endDate !== endDate));
  const needs = dateChanged && existing ? delayRequirement(actor, existing.id, endDate) : null;
  const reason = needs ? cleanDelay(delay) : null;
  const plan = dateChanged ? buildSchedulePlan(actor, savedId, startDate, endDate) : [];
  if (existing) {
    db.update(scheduleItems)
      .set({ projectId: project.id, title, startDate, endDate, startTime, status, note, updatedAt: now })
      .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, existing.id)))
      .run();
  } else {
    db.insert(scheduleItems)
      .values({
        id: savedId,
        orgId: actor.orgId,
        projectId: project.id,
        title,
        startDate,
        endDate,
        startTime,
        status,
        note,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
  }
  if (!existing && input.links) replaceScheduleLinks(actor, savedId, input.links);
  if (plan.length) writeScheduleShifts(db, actor, plan);
  if (needs && reason && existing) writeDelay(db, actor, existing.projectId, existing.id, needs.days, reason);
  const previous = existing
    ? db
        .select()
        .from(scheduleAssignees)
        .where(and(eq(scheduleAssignees.orgId, actor.orgId), eq(scheduleAssignees.itemId, savedId)))
        .all()
        .map((row) => row.userId)
    : [];
  replaceAssignees(db, actor, savedId, input.assigneeIds);
  const added = [...new Set(input.assigneeIds)].filter((userId) => !previous.includes(userId));
  if (added.length) notifyAssignment(actor, { entityType: "schedule_item", entityId: savedId, userIds: added });
  return savedId;
}

export function moveScheduleItem(actor: Actor, itemId: string, input: { startDate: string; endDate: string; assigneeId: string | null }, delay: DelayInput | null = null) {
  assertEditor(actor);
  const db = officeOrThrow(actor);
  const existing = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, itemId)))
    .get();
  if (!existing) throw new ServiceError("That schedule item is not in your company.");
  const startDate = cleanDate(input.startDate, "start");
  const endDate = cleanDate(input.endDate, "end");
  if (endDate < startDate) throw new ServiceError("End is on or after the start.");
  const needs = delayRequirement(actor, itemId, endDate);
  const reason = needs ? cleanDelay(delay) : null;
  const plan = buildSchedulePlan(actor, itemId, startDate, endDate);
  if (plan.length) writeScheduleShifts(db, actor, plan);
  if (needs && reason) writeDelay(db, actor, existing.projectId, itemId, needs.days, reason);
  const previous = db
    .select()
    .from(scheduleAssignees)
    .where(and(eq(scheduleAssignees.orgId, actor.orgId), eq(scheduleAssignees.itemId, itemId)))
    .all()
    .map((row) => row.userId);
  replaceAssignees(db, actor, itemId, input.assigneeId ? [input.assigneeId] : []);
  if (input.assigneeId && !previous.includes(input.assigneeId)) {
    notifyAssignment(actor, { entityType: "schedule_item", entityId: itemId, userIds: [input.assigneeId] });
  }
}

export function removeScheduleItem(actor: Actor, itemId: string) {
  assertEditor(actor);
  const db = officeOrThrow(actor);
  const existing = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, itemId)))
    .get();
  if (!existing) throw new ServiceError("That schedule item is not in your company.");
  db.transaction((tx) => {
    const writer = tx as unknown as ReturnType<typeof officeOrThrow>;
    unlinkScheduleTodos(writer, actor.orgId, itemId, actor.userId);
    tx.delete(scheduleLinks).where(and(eq(scheduleLinks.orgId, actor.orgId), eq(scheduleLinks.itemId, itemId))).run();
    tx.delete(scheduleLinks).where(and(eq(scheduleLinks.orgId, actor.orgId), eq(scheduleLinks.predecessorId, itemId))).run();
    tx.delete(scheduleAssignees).where(and(eq(scheduleAssignees.orgId, actor.orgId), eq(scheduleAssignees.itemId, itemId))).run();
    tx.delete(scheduleItems).where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, itemId))).run();
  });
}

export function rotateCalendarFeed(actor: Actor): string {
  const db = officeOrThrow(actor);
  const secret = newFeedSecret();
  const now = nowIso();
  db.delete(calendarFeeds).where(and(eq(calendarFeeds.orgId, actor.orgId), eq(calendarFeeds.userId, actor.userId))).run();
  db.insert(calendarFeeds)
    .values({ id: id("feed"), orgId: actor.orgId, userId: actor.userId, tokenHash: secret.tokenHash, createdAt: now })
    .run();
  return secret.token;
}

export function calendarFeedReady(actor: Actor): boolean {
  const db = officeOrThrow(actor);
  return Boolean(
    db
      .select({ id: calendarFeeds.id })
      .from(calendarFeeds)
      .where(and(eq(calendarFeeds.orgId, actor.orgId), eq(calendarFeeds.userId, actor.userId)))
      .get(),
  );
}

/** Public read. The token is hashed. Only that person's items in that company are included. */
export function scheduleFeedIcs(token: string): string | null {
  const trimmed = token.trim();
  if (trimmed.length < 20 || trimmed.length > 200) return null;
  const hash = hashFeedToken(trimmed);
  const db = getDb();
  const feed = db.select().from(calendarFeeds).where(eq(calendarFeeds.tokenHash, hash)).get();
  if (!feed || !feedTokenMatches(trimmed, feed.tokenHash)) return null;
  const rows = db
    .select({ item: scheduleItems, projectName: projects.name })
    .from(scheduleAssignees)
    .innerJoin(scheduleItems, and(eq(scheduleItems.id, scheduleAssignees.itemId), eq(scheduleItems.orgId, feed.orgId)))
    .innerJoin(projects, and(eq(projects.id, scheduleItems.projectId), eq(projects.orgId, feed.orgId)))
    .where(and(eq(scheduleAssignees.orgId, feed.orgId), eq(scheduleAssignees.userId, feed.userId)))
    .all();
  return buildScheduleIcs(
    rows
      .slice()
      .sort((a, b) => a.item.startDate.localeCompare(b.item.startDate))
      .map((row) => ({
        uid: row.item.id,
        title: `${row.projectName}: ${row.item.title}`,
        startDate: row.item.startDate,
        endDate: row.item.endDate,
        description: row.item.note,
      })),
  );
}
