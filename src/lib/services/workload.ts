import { and, eq } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  agreementVisits,
  auditLogs,
  bookings,
  contacts,
  memberships,
  organizations,
  projects,
  scheduleAssignees,
  scheduleItems,
  serviceAgreements,
  timeEntries,
  timeOffDays,
  timeOffRequests,
  users,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { parseClock } from "@/lib/dispatch/assign";
import { canManageSettings, roleLabel, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { calendarForOrg } from "@/lib/services/time";
import { workCalendarFor } from "@/lib/services/work-calendar";
import { addCalendarDays, localDay } from "@/lib/time/calendar";
import {
  DEFAULT_WEEK_MINUTES,
  WORKLOAD_WEEKS,
  buildWorkload,
  capacityWarningText,
  hoursNumber,
  weekColumns,
  weeksCovering,
  type HoursSource,
  type LoadBlock,
  type PtoBlock,
  type WeekSpan,
} from "@/lib/workload/hours";
import { isWorkday, type WorkdayCalendar } from "@/lib/schedule/workdays";

const OFFICE = new Set(["owner", "admin", "estimator"]);

export type WorkloadQuery = {
  on?: string;
  role?: string;
  crew?: string;
  vendors?: boolean;
  who?: string;
  week?: string;
};

export type WorkloadCell = {
  week: string;
  label: string;
  booked: number;
  capacity: number;
  pto: number;
  percent: number | null;
  over: boolean;
  items: { key: string; title: string; job: string; minutes: number; href: string; source: HoursSource }[];
};

export type WorkloadRow = {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  kind: "member" | "vendor";
  cells: WorkloadCell[];
};

export type WorkloadBoard = {
  anchor: string;
  prev: string;
  next: string;
  label: string;
  weeks: { start: string; end: string; label: string }[];
  rows: WorkloadRow[];
  crews: { id: string; name: string }[];
  role: string;
  crew: string;
  vendors: boolean;
  focus: { personId: string; week: string; name: string; label: string; pto: number; items: WorkloadCell["items"] } | null;
};

function dbFor(orgId: string): AppDatabase {
  return (officeDb(orgId) as AppDatabase | null) ?? getDb();
}

function cleanDay(value: string | undefined): string | null {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && addCalendarDays(value, 0) === value) return value;
  return null;
}

export function weekLabel(start: string): string {
  const date = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return start;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function entryMinutes(clockIn: string, clockOut: string | null, breakMinutes: number): number | null {
  if (!clockOut) return null;
  const start = Date.parse(clockIn);
  const end = Date.parse(clockOut);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.max(0, Math.round((end - start) / 60_000) - Math.max(0, breakMinutes));
}

type Gathered = {
  timeZone: string;
  weekStartsOn: number;
  companyMinutes: number;
  calendar: WorkdayCalendar;
  people: { id: string; name: string; role: string; capacityMinutes: number | null; kind: "member" | "vendor" }[];
  blocks: LoadBlock[];
  pto: PtoBlock[];
  crews: { id: string; name: string }[];
};

function gather(orgId: string, rangeStart: string, rangeEnd: string): Gathered {
  const db = dbFor(orgId);
  const org = db
    .select({ capacityMinutes: organizations.capacityMinutes })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .get();
  const calendar = calendarForOrg(orgId);
  const companyCalendar = workCalendarFor(orgId);
  const projectCalendar = new Map<string, WorkdayCalendar>();
  const calendarFor = (projectId: string | null | undefined) => {
    if (!projectId) return companyCalendar;
    const cached = projectCalendar.get(projectId);
    if (cached) return cached;
    const next = workCalendarFor(orgId, projectId);
    projectCalendar.set(projectId, next);
    return next;
  };
  const names = new Map(
    db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.orgId, orgId))
      .all()
      .map((row) => [row.id, row.name]),
  );
  const members = db
    .select({ id: users.id, name: users.name, role: memberships.role, capacityMinutes: memberships.capacityMinutes })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const items = db
    .select()
    .from(scheduleItems)
    .where(eq(scheduleItems.orgId, orgId))
    .all()
    .filter((item) => item.status !== "cancelled" && item.startDate <= rangeEnd && item.endDate >= rangeStart);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const assignees = db.select().from(scheduleAssignees).where(eq(scheduleAssignees.orgId, orgId)).all();
  const crewOf = new Map<string, string[]>();
  for (const row of assignees) {
    const list = crewOf.get(row.itemId) ?? [];
    if (!list.includes(row.userId)) list.push(row.userId);
    crewOf.set(row.itemId, list);
  }
  const blocks: LoadBlock[] = [];
  for (const item of items) {
    const base = {
      key: `item:${item.id}`,
      startDate: item.startDate,
      endDate: item.endDate,
      plannedMinutes: item.plannedMinutes,
      startMin: parseClock(item.startTime),
      endMin: parseClock(item.endTime),
      title: item.title,
      job: names.get(item.projectId) || "",
      href: `/schedule/items/${item.id}`,
      crewId: item.vendorContactId,
      calendar: calendarFor(item.projectId),
    };
    for (const userId of crewOf.get(item.id) ?? []) {
      blocks.push({ ...base, personId: userId, source: "schedule" });
    }
    if (item.vendorContactId) {
      blocks.push({ ...base, personId: `v:${item.vendorContactId}`, source: "schedule" });
    }
  }
  const agreements = new Map(
    db
      .select({ id: serviceAgreements.id, name: serviceAgreements.name })
      .from(serviceAgreements)
      .where(eq(serviceAgreements.orgId, orgId))
      .all()
      .map((row) => [row.id, row.name]),
  );
  for (const visit of db.select().from(agreementVisits).where(eq(agreementVisits.orgId, orgId)).all()) {
    if (visit.status === "skipped" || !visit.assigneeUserId) continue;
    if (visit.dueOn < rangeStart || visit.dueOn > rangeEnd) continue;
    const item = visit.scheduleItemId ? itemById.get(visit.scheduleItemId) : undefined;
    blocks.push({
      key: visit.scheduleItemId ? `item:${visit.scheduleItemId}` : `visit:${visit.id}`,
      personId: visit.assigneeUserId,
      startDate: item?.startDate ?? visit.dueOn,
      endDate: item?.endDate ?? visit.dueOn,
      plannedMinutes: item?.plannedMinutes ?? null,
      startMin: parseClock(item?.startTime),
      endMin: parseClock(item?.endTime),
      title: agreements.get(visit.agreementId) || item?.title || "Visit",
      job: names.get(visit.projectId || item?.projectId || "") || "",
      source: "visit",
      href: `/agreements/${visit.agreementId}`,
      crewId: item?.vendorContactId ?? null,
      calendar: calendarFor(item?.projectId || visit.projectId),
    });
  }
  for (const booking of db.select().from(bookings).where(eq(bookings.orgId, orgId)).all()) {
    if (booking.status !== "scheduled" || !booking.assigneeUserId) continue;
    if (booking.dueOn < rangeStart || booking.dueOn > rangeEnd) continue;
    blocks.push({
      key: `book:${booking.id}`,
      personId: booking.assigneeUserId,
      startDate: booking.dueOn,
      endDate: booking.dueOn,
      plannedMinutes: booking.durationMin,
      startMin: null,
      endMin: null,
      title: "Booking",
      job: "",
      source: "booking",
      href: `/dispatch?on=${booking.dueOn}`,
      crewId: null,
      calendar: companyCalendar,
    });
  }
  const pto: PtoBlock[] = [];
  for (const entry of db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.shiftType, "pto"), eq(timeEntries.status, "approved")))
    .all()) {
    const minutes = entryMinutes(entry.clockInAt, entry.clockOutAt, entry.breakMinutes);
    if (minutes == null || minutes <= 0) continue;
    const day = localDay(Date.parse(entry.clockInAt), calendar.timeZone);
    if (day < rangeStart || day > rangeEnd) continue;
    pto.push({ personId: entry.userId, day, minutes });
  }
  for (const day of db
    .select({ userId: timeOffRequests.userId, day: timeOffDays.day, minutes: timeOffDays.minutes, entryId: timeOffDays.entryId })
    .from(timeOffDays)
    .innerJoin(timeOffRequests, eq(timeOffRequests.id, timeOffDays.requestId))
    .where(and(eq(timeOffDays.orgId, orgId), eq(timeOffRequests.orgId, orgId), eq(timeOffRequests.status, "approved")))
    .all()) {
    if (day.entryId || day.minutes <= 0) continue;
    if (day.day < rangeStart || day.day > rangeEnd) continue;
    if (!isWorkday(day.day, companyCalendar)) continue;
    pto.push({ personId: day.userId, day: day.day, minutes: day.minutes });
  }
  const vendorIds = [...new Set(items.map((item) => item.vendorContactId).filter((id): id is string => Boolean(id)))];
  const vendorRows = vendorIds.length
    ? db
        .select({ id: contacts.id, name: contacts.name, company: contacts.company, type: contacts.type })
        .from(contacts)
        .where(eq(contacts.orgId, orgId))
        .all()
        .filter((row) => vendorIds.includes(row.id) && (row.type === "sub" || row.type === "vendor"))
    : [];
  const crews = vendorRows
    .map((row) => ({ id: row.id, name: row.company?.trim() || row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const people = [
    ...members.map((person) => ({
      id: person.id,
      name: person.name,
      role: person.role,
      capacityMinutes: person.capacityMinutes,
      kind: "member" as const,
    })),
    ...crews.map((crew) => ({
      id: `v:${crew.id}`,
      name: crew.name,
      role: "crew",
      capacityMinutes: null,
      kind: "vendor" as const,
    })),
  ];
  return {
    timeZone: calendar.timeZone,
    weekStartsOn: calendar.weekStartsOn,
    companyMinutes: org && org.capacityMinutes > 0 ? org.capacityMinutes : DEFAULT_WEEK_MINUTES,
    calendar: companyCalendar,
    people,
    blocks,
    pto,
    crews,
  };
}

function visiblePeople(gathered: Gathered, query: { role: string; crew: string; vendors: boolean }) {
  const assigned = new Set(gathered.blocks.map((block) => block.personId));
  return gathered.people.filter((person) => {
    const mine = gathered.blocks.filter((block) => block.personId === person.id);
    if (person.kind === "vendor") {
      if (query.crew && person.id !== `v:${query.crew}`) return false;
      if (!query.crew && !query.vendors) return false;
      return mine.length > 0;
    }
    if (query.role === "office" && !OFFICE.has(person.role)) return false;
    if (query.role === "field" && person.role !== "field") return false;
    if (person.role === "viewer" && !assigned.has(person.id)) return false;
    if (query.crew) return mine.some((block) => block.crewId === query.crew);
    return true;
  });
}

function paint(orgId: string, weeks: WeekSpan[], query: { role: string; crew: string; vendors: boolean }): { gathered: Gathered; rows: WorkloadRow[] } {
  const rangeStart = weeks[0]?.start ?? "";
  const rangeEnd = weeks[weeks.length - 1]?.end ?? rangeStart;
  const gathered = gather(orgId, rangeStart, rangeEnd);
  const people = visiblePeople(gathered, query);
  const built = buildWorkload({
    people,
    blocks: gathered.blocks,
    pto: gathered.pto,
    weeks,
    companyMinutes: gathered.companyMinutes,
    calendar: gathered.calendar,
  });
  const rows: WorkloadRow[] = built.map((row) => ({
    id: row.person.id,
    name: row.person.name,
    role: row.person.role,
    roleLabel: row.person.kind === "vendor" ? "Crew" : roleLabel(row.person.role),
    kind: row.person.kind,
    cells: row.cells.map((cell, index) => ({
      week: weeks[index]!.start,
      label: weekLabel(weeks[index]!.start),
      booked: cell.booked,
      capacity: cell.capacity,
      pto: cell.pto,
      percent: cell.percent,
      over: cell.over,
      items: cell.items,
    })),
  }));
  return { gathered, rows };
}

export function workloadBoard(actor: Actor, query: WorkloadQuery = {}): WorkloadBoard {
  const calendar = calendarForOrg(actor.orgId);
  const anchor = cleanDay(query.on) ?? localDay(Date.now(), calendar.timeZone);
  const weeks = weekColumns(anchor, calendar.weekStartsOn, WORKLOAD_WEEKS);
  const role = query.role === "office" || query.role === "field" ? query.role : "";
  const crew = query.crew?.trim() || "";
  const vendors = Boolean(query.vendors);
  const { gathered, rows } = paint(actor.orgId, weeks, { role, crew, vendors });
  const focusRow = query.who ? rows.find((row) => row.id === query.who) : undefined;
  const focusCell = focusRow && query.week ? focusRow.cells.find((cell) => cell.week === query.week) : undefined;
  const first = weeks[0]!;
  const last = weeks[weeks.length - 1]!;
  return {
    anchor: first.start,
    prev: addCalendarDays(first.start, -7),
    next: addCalendarDays(first.start, 7),
    label: `${weekLabel(first.start)} – ${weekLabel(last.start)}`,
    weeks: weeks.map((week) => ({ start: week.start, end: week.end, label: weekLabel(week.start) })),
    rows,
    crews: gathered.crews,
    role,
    crew,
    vendors,
    focus: focusRow && focusCell
      ? { personId: focusRow.id, week: focusCell.week, name: focusRow.name, label: focusCell.label, pto: focusCell.pto, items: focusCell.items }
      : null,
  };
}

function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function workloadCsv(actor: Actor, query: WorkloadQuery = {}): string {
  const board = workloadBoard(actor, query);
  const lines = ["person,role,week_start,booked_hours,capacity_hours,utilization_percent,over"];
  for (const row of board.rows) {
    for (const cell of row.cells) {
      lines.push(
        [
          csvCell(row.name),
          csvCell(row.roleLabel),
          cell.week,
          hoursNumber(cell.booked),
          hoursNumber(cell.capacity),
          cell.percent == null ? "" : String(cell.percent),
          cell.over ? "yes" : "no",
        ].join(","),
      );
    }
  }
  return lines.join("\n");
}

export function capacityWarning(actor: Actor, userIds: string[], start: string, end: string): string | null {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return null;
  const dayStart = cleanDay(start);
  const dayEnd = cleanDay(end);
  if (!dayStart || !dayEnd) return null;
  const calendar = calendarForOrg(actor.orgId);
  const weeks = weeksCovering(dayStart, dayEnd < dayStart ? dayStart : dayEnd, calendar.weekStartsOn);
  const { rows } = paint(actor.orgId, weeks, { role: "", crew: "", vendors: false });
  const lines = unique.flatMap((userId) => {
    const row = rows.find((item) => item.id === userId);
    if (!row) return [];
    const worst = row.cells.filter((cell) => cell.over).sort((a, b) => b.booked - a.booked)[0];
    if (!worst) return [];
    return [{ name: row.name, booked: worst.booked, capacity: worst.capacity }];
  });
  return capacityWarningText(lines);
}

export function overbookedThisWeek(orgId: string): { count: number; names: string; href: string | null } {
  const calendar = calendarForOrg(orgId);
  const anchor = localDay(Date.now(), calendar.timeZone);
  const weeks = weekColumns(anchor, calendar.weekStartsOn, 1);
  const { rows } = paint(orgId, weeks, { role: "", crew: "", vendors: false });
  const over = rows.filter((row) => row.kind === "member" && row.cells[0]?.over);
  if (over.length === 0) return { count: 0, names: "", href: null };
  return { count: over.length, names: over.map((row) => row.name).join(", "), href: "/schedule/workload" };
}

export function capacityForm(actor: Actor) {
  const db = dbFor(actor.orgId);
  const org = db
    .select({ capacityMinutes: organizations.capacityMinutes, workdaysMask: organizations.workdaysMask })
    .from(organizations)
    .where(eq(organizations.id, actor.orgId))
    .get();
  if (!org) return null;
  const people = db
    .select({ id: users.id, name: users.name, role: memberships.role, capacityMinutes: memberships.capacityMinutes })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, actor.orgId))
    .all()
    .filter((person) => person.role !== "viewer")
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    hours: hoursNumber(org.capacityMinutes > 0 ? org.capacityMinutes : DEFAULT_WEEK_MINUTES),
    workdaysMask: org.workdaysMask,
    people: people.map((person) => ({
      id: person.id,
      name: person.name,
      role: roleLabel(person.role),
      hours: person.capacityMinutes == null ? "" : hoursNumber(person.capacityMinutes),
    })),
  };
}

function cleanHours(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 1 || value > 168) throw new ServiceError(`${label} is 1 to 168 hours.`);
  return Math.round(value * 60);
}

export function saveCapacity(actor: Actor, input: { hours: number; workdays: number[]; people: { userId: string; hours: string }[] }) {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("Your role cannot change capacity.");
  const minutes = cleanHours(input.hours, "Weekly capacity");
  if (input.workdays.length === 0 || input.workdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new ServiceError("Pick at least one workday.");
  }
  const mask = input.workdays.reduce((bits, day) => bits | (1 << day), 0);
  const db = dbFor(actor.orgId);
  const known = new Set(
    db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.orgId, actor.orgId))
      .all()
      .map((row) => row.userId),
  );
  const overrides = input.people
    .filter((person) => known.has(person.userId))
    .map((person) => {
      const text = person.hours.trim();
      if (!text) return { userId: person.userId, minutes: null as number | null };
      return { userId: person.userId, minutes: cleanHours(Number(text), "Capacity") };
    });
  const stamp = nowIso();
  db.transaction((tx) => {
    tx.update(organizations)
      .set({ capacityMinutes: minutes, workdaysMask: mask, updatedAt: stamp })
      .where(eq(organizations.id, actor.orgId))
      .run();
    for (const person of overrides) {
      tx.update(memberships)
        .set({ capacityMinutes: person.minutes })
        .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, person.userId)))
        .run();
    }
    tx.insert(auditLogs)
      .values({
        id: id("audit"),
        orgId: actor.orgId,
        actorId: actor.userId,
        action: "capacity.update",
        entityType: "organization",
        entityId: actor.orgId,
        payloadJson: JSON.stringify({ minutes, workdaysMask: mask }),
        ip: null,
        createdAt: stamp,
      })
      .run();
  });
}
