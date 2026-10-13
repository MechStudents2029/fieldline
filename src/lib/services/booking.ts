import { and, eq, isNull } from "drizzle-orm";
import { addDays } from "@/lib/agreements/cadence";
import { addClock, assertBuffer, assertDuration, assertHours, assertInterval, BOOK_HORIZON, daySlots, durationLabel, pickAssignee, zonedNow, type BusySpan, type TechHours } from "@/lib/booking/slots";
import { getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  agreementVisits,
  auditLogs,
  bookingHours,
  bookingOffs,
  bookings,
  contacts,
  memberships,
  notifications,
  organizations,
  priceBookItems,
  scheduleAssignees,
  scheduleItems,
  users,
} from "@/lib/db/schema";
import { formatClock, parseClock, windowOf } from "@/lib/dispatch/assign";
import { id, nowIso, token } from "@/lib/ids";
import { canManageSettings, type Role } from "@/lib/permissions";
import { isWorkday, weekdayOf, type WorkdayCalendar } from "@/lib/schedule/workdays";
import { ServiceError } from "@/lib/services/errors";
import { emitAutomation } from "@/lib/services/automations";
import type { Actor } from "@/lib/services/read";
import { workCalendarFor } from "@/lib/services/work-calendar";
import { formatWhole, parseMoneyToCents } from "@/lib/money";

type Writer = Pick<AppDatabase, "insert" | "select" | "update" | "delete" | "transaction">;

function dbFor(orgId: string): Writer {
  return officeDb(orgId) ?? getDb();
}

function assertOffice(actor: Actor) {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("Only an owner or admin can change booking.");
}

function dayLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(date).replace(",", "");
}

function questionsOf(raw: string | null): { id: string; label: string }[] {
  try {
    const value = JSON.parse(raw || "[]") as { id?: string; label?: string }[];
    if (!Array.isArray(value)) return [];
    return value.filter((row) => row && row.id && row.label).map((row) => ({ id: String(row.id), label: String(row.label) })).slice(0, 4);
  } catch {
    return [];
  }
}

function staffOf(raw: string | null): string[] {
  try {
    const value = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function holidayClosed(day: string, calendar: WorkdayCalendar): boolean {
  return !isWorkday(day, { mask: 127, exceptions: calendar.exceptions });
}

type OrgRow = typeof organizations.$inferSelect;

function companyWindow(org: OrgRow, day: string, closed: boolean): { startMin: number; endMin: number } | null {
  if (closed) return null;
  if ((org.bookingDaysMask & (1 << weekdayOf(day))) === 0) return null;
  return { startMin: org.bookingStartMin, endMin: org.bookingEndMin };
}

function busyOn(db: Writer, orgId: string, day: string): BusySpan[] {
  const spans: BusySpan[] = [];
  const items = db.select().from(scheduleItems).where(eq(scheduleItems.orgId, orgId)).all();
  const assignees = db.select().from(scheduleAssignees).where(eq(scheduleAssignees.orgId, orgId)).all();
  const crew = new Map<string, string[]>();
  for (const row of assignees) {
    const list = crew.get(row.itemId) ?? [];
    list.push(row.userId);
    crew.set(row.itemId, list);
  }
  const visits = db.select().from(agreementVisits).where(eq(agreementVisits.orgId, orgId)).all();
  const linked = new Set(visits.map((visit) => visit.scheduleItemId).filter((itemId): itemId is string => Boolean(itemId)));
  const itemById = new Map(items.map((item) => [item.id, item]));
  for (const visit of visits) {
    if (visit.status !== "scheduled" || visit.dueOn !== day || !visit.assigneeUserId) continue;
    const item = visit.scheduleItemId ? itemById.get(visit.scheduleItemId) : undefined;
    const window = windowOf(parseClock(item?.startTime), parseClock(item?.endTime));
    if (window) spans.push({ userId: visit.assigneeUserId, ...window });
  }
  for (const item of items) {
    if (item.status === "cancelled" || linked.has(item.id)) continue;
    if (item.startDate > day || day > item.endDate) continue;
    const userId = crew.get(item.id)?.[0];
    const window = userId ? windowOf(parseClock(item.startTime), parseClock(item.endTime)) : null;
    if (userId && window) spans.push({ userId, ...window });
  }
  for (const row of db.select().from(bookings).where(and(eq(bookings.orgId, orgId), eq(bookings.dueOn, day))).all()) {
    if (row.status !== "scheduled" || !row.assigneeUserId) continue;
    const window = windowOf(parseClock(row.startTime), parseClock(row.endTime));
    if (window) spans.push({ userId: row.assigneeUserId, ...window });
  }
  return spans;
}

type TechRow = { id: string; name: string; bookable: number };

function techsOf(db: Writer, orgId: string): TechRow[] {
  return db
    .select({ id: users.id, name: users.name, bookable: memberships.bookable, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all()
    .filter((row) => row.role === "field")
    .map((row) => ({ id: row.id, name: row.name, bookable: row.bookable }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function slotsFor(db: Writer, org: OrgRow, day: string, durationMin: number, staff: string[]) {
  const calendar = workCalendarFor(org.id);
  const hours = db.select().from(bookingHours).where(eq(bookingHours.orgId, org.id)).all();
  const weekday = weekdayOf(day);
  const offs = db
    .select()
    .from(bookingOffs)
    .where(eq(bookingOffs.orgId, org.id))
    .all()
    .filter((row) => row.startDate <= day && day <= row.endDate)
    .map((row) => row.userId);
  const eligible = new Set(staff);
  const techs = techsOf(db, org.id)
    .filter((tech) => tech.bookable === 1 && (eligible.size === 0 || eligible.has(tech.id)))
    .map((tech) => {
      const row = hours.find((hour) => hour.userId === tech.id && hour.weekday === weekday);
      const window: TechHours = !row ? "inherit" : row.open === 1 && row.startMin != null && row.endMin != null ? { startMin: row.startMin, endMin: row.endMin } : null;
      return { id: tech.id, hours: window };
    });
  const now = zonedNow(org.timeZone);
  const cut = addClock(now.day, now.minute, org.bookingEarliestHours * 60);
  const notBeforeMin = day < cut.day ? 24 * 60 : day > cut.day ? 0 : cut.minute;
  return daySlots({
    durationMin,
    intervalMin: org.bookingIntervalMin,
    bufferMin: org.bookingBufferMin,
    company: companyWindow(org, day, holidayClosed(day, calendar)),
    techs,
    busy: busyOn(db, org.id, day),
    off: offs,
    notBeforeMin,
  });
}

export function bookingAttention(orgId: string) {
  const db = dbFor(orgId);
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) return { count: 0, href: null as string | null };
  const today = zonedNow(org.timeZone).day;
  const count = db
    .select()
    .from(bookings)
    .where(eq(bookings.orgId, orgId))
    .all()
    .filter((row) => row.status === "scheduled" && row.dueOn >= today).length;
  return { count, href: count > 0 ? "/dispatch" : null };
}

export function bookingNotice(db: Writer, orgId: string, bookingId: string) {
  const row = db.select().from(bookings).where(and(eq(bookings.orgId, orgId), eq(bookings.id, bookingId))).get();
  if (!row) return null;
  const contact = db.select().from(contacts).where(and(eq(contacts.orgId, orgId), eq(contacts.id, row.contactId))).get();
  return { record: contact?.name || "Booking", href: `/dispatch?on=${row.dueOn}` };
}

export function bookingBoard(actor: Actor) {
  if (!canManageSettings(actor.role as Role)) return null;
  const db = dbFor(actor.orgId);
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  if (!org) return null;
  const items = db.select().from(priceBookItems).where(eq(priceBookItems.orgId, actor.orgId)).all().sort((a, b) => a.name.localeCompare(b.name));
  const techs = techsOf(db, actor.orgId);
  const hours = db.select().from(bookingHours).where(eq(bookingHours.orgId, actor.orgId)).all();
  const offs = db.select().from(bookingOffs).where(eq(bookingOffs.orgId, actor.orgId)).all();
  const names = new Map(techs.map((tech) => [tech.id, tech.name]));
  return {
    enabled: org.bookingEnabled === 1,
    token: org.bookingToken || "",
    earliestHours: org.bookingEarliestHours,
    intervalMin: org.bookingIntervalMin,
    bufferMin: org.bookingBufferMin,
    start: formatClock(org.bookingStartMin),
    end: formatClock(org.bookingEndMin),
    daysMask: org.bookingDaysMask,
    questions: questionsOf(org.bookingQuestionsJson).map((row) => row.label).join("\n"),
    services: items
      .filter((item) => item.bookable === 1)
      .map((item) => ({
        id: item.id,
        name: item.name,
        durationMin: item.bookDurationMin ?? 60,
        price: item.bookPriceCents == null ? "" : (item.bookPriceCents / 100).toFixed(2),
        staff: staffOf(item.bookStaffJson),
      })),
    catalog: items.filter((item) => item.bookable !== 1).map((item) => ({ id: item.id, name: item.name })),
    techs: techs.map((tech) => {
      const row = hours.find((hour) => hour.userId === tech.id && hour.open === 1 && hour.startMin != null && hour.endMin != null);
      return { id: tech.id, name: tech.name, bookable: tech.bookable === 1, start: row ? formatClock(row.startMin!) : "", end: row ? formatClock(row.endMin!) : "" };
    }),
    offs: offs.map((row) => ({ id: row.id, name: names.get(row.userId) || "Tech", start: row.startDate, end: row.endDate })),
  };
}

function orgOf(actor: Actor) {
  const org = dbFor(actor.orgId).select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  if (!org) throw new ServiceError("Company not found.");
  return org;
}

export function saveBookingPrefs(
  actor: Actor,
  input: { enabled: boolean; earliestHours: number; intervalMin: number; bufferMin: number; start: string; end: string; days: number[]; questions: string },
) {
  assertOffice(actor);
  const startMin = parseClock(input.start);
  const endMin = parseClock(input.end);
  if (startMin == null || endMin == null) throw new ServiceError("Hours use 24-hour HH:MM.");
  assertHours(startMin, endMin);
  assertInterval(input.intervalMin);
  assertBuffer(input.bufferMin);
  if (!Number.isInteger(input.earliestHours) || input.earliestHours < 0 || input.earliestHours > 24 * 14) throw new ServiceError("Earliest is 0 to 336 hours.");
  const mask = input.days.reduce((bits, day) => (day >= 0 && day <= 6 ? bits | (1 << day) : bits), 0);
  if (mask === 0) throw new ServiceError("Pick at least one day.");
  const lines = input.questions.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 4);
  const questions = lines.map((label, index) => ({ id: `q${index + 1}`, label: label.slice(0, 80) }));
  const db = dbFor(actor.orgId);
  const org = orgOf(actor);
  db.update(organizations)
    .set({
      bookingEnabled: input.enabled ? 1 : 0,
      bookingToken: org.bookingToken || token(9),
      bookingEarliestHours: input.earliestHours,
      bookingIntervalMin: input.intervalMin,
      bookingBufferMin: input.bufferMin,
      bookingStartMin: startMin,
      bookingEndMin: endMin,
      bookingDaysMask: mask,
      bookingQuestionsJson: JSON.stringify(questions),
      updatedAt: nowIso(),
    })
    .where(eq(organizations.id, actor.orgId))
    .run();
}

export function saveBookableService(actor: Actor, input: { itemId: string; bookable: boolean; durationMin: number; price: string; staff: string[] }) {
  assertOffice(actor);
  const db = dbFor(actor.orgId);
  const item = db.select().from(priceBookItems).where(and(eq(priceBookItems.orgId, actor.orgId), eq(priceBookItems.id, input.itemId))).get();
  if (!item) throw new ServiceError("That service is not in the price book.");
  if (!input.bookable) {
    db.update(priceBookItems).set({ bookable: 0, updatedAt: nowIso() }).where(eq(priceBookItems.id, item.id)).run();
    return;
  }
  const duration = assertDuration(input.durationMin);
  const price = input.price.trim() === "" ? null : parseMoneyToCents(input.price);
  if (input.price.trim() !== "" && price == null) throw new ServiceError("Price is a dollar amount.");
  const known = new Set(techsOf(db, actor.orgId).map((tech) => tech.id));
  const staff = input.staff.filter((userId) => known.has(userId));
  db.update(priceBookItems)
    .set({
      bookable: 1,
      bookDurationMin: duration,
      bookPriceCents: price,
      bookStaffJson: staff.length ? JSON.stringify(staff) : null,
      updatedAt: nowIso(),
    })
    .where(eq(priceBookItems.id, item.id))
    .run();
}

export function saveBookableTech(actor: Actor, input: { userId: string; bookable: boolean; start: string; end: string }) {
  assertOffice(actor);
  const db = dbFor(actor.orgId);
  const tech = techsOf(db, actor.orgId).find((row) => row.id === input.userId);
  if (!tech) throw new ServiceError("That person is not a field tech.");
  const org = orgOf(actor);
  db.update(memberships).set({ bookable: input.bookable ? 1 : 0 }).where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, tech.id))).run();
  db.delete(bookingHours).where(and(eq(bookingHours.orgId, actor.orgId), eq(bookingHours.userId, tech.id))).run();
  if (!input.start.trim() && !input.end.trim()) return;
  const startMin = parseClock(input.start);
  const endMin = parseClock(input.end);
  if (startMin == null || endMin == null) throw new ServiceError("Hours use 24-hour HH:MM.");
  assertHours(startMin, endMin);
  const rows = [];
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    if ((org.bookingDaysMask & (1 << weekday)) === 0) continue;
    rows.push({ id: id("bkh"), orgId: actor.orgId, userId: tech.id, weekday, open: 1, startMin, endMin });
  }
  if (rows.length) db.insert(bookingHours).values(rows).run();
}

export function addBookingOff(actor: Actor, input: { userId: string; start: string; end: string }) {
  assertOffice(actor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start) || !/^\d{4}-\d{2}-\d{2}$/.test(input.end) || input.end < input.start) {
    throw new ServiceError("Enter the dates.");
  }
  const db = dbFor(actor.orgId);
  if (!techsOf(db, actor.orgId).some((tech) => tech.id === input.userId)) throw new ServiceError("That person is not a field tech.");
  db.insert(bookingOffs).values({ id: id("bko"), orgId: actor.orgId, userId: input.userId, startDate: input.start, endDate: input.end, createdAt: nowIso() }).run();
}

export type PublicBook = {
  state: "open" | "closed";
  orgName: string;
  services: { id: string; name: string; duration: string; price: string | null }[];
  serviceId: string;
  days: { day: string; label: string; slots: { startMin: number; label: string }[] }[];
  day: string;
  questions: { id: string; label: string }[];
};

export function publicBooking(formToken: string, query: { service?: string; day?: string }): PublicBook | null {
  const db = getDb();
  const org = db.select().from(organizations).where(eq(organizations.bookingToken, formToken)).get();
  if (!org) return null;
  const services = db
    .select()
    .from(priceBookItems)
    .where(and(eq(priceBookItems.orgId, org.id), eq(priceBookItems.bookable, 1)))
    .all()
    .filter((item) => item.bookDurationMin != null)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => ({
      id: item.id,
      name: item.name,
      duration: durationLabel(item.bookDurationMin!),
      price: item.bookPriceCents == null ? null : formatWhole(item.bookPriceCents),
    }));
  const closed = org.bookingEnabled !== 1;
  const service = services.find((item) => item.id === query.service) ?? null;
  const book = service ? db.select().from(priceBookItems).where(eq(priceBookItems.id, service.id)).get() : null;
  const today = zonedNow(org.timeZone).day;
  const days = !closed && book?.bookDurationMin
    ? Array.from({ length: BOOK_HORIZON }, (_, index) => addDays(today, index))
        .map((day) => ({
          day,
          label: dayLabel(day),
          slots: slotsFor(db, org, day, book.bookDurationMin!, staffOf(book.bookStaffJson)).map((slot) => ({ startMin: slot.startMin, label: formatClock(slot.startMin) })),
        }))
        .filter((day) => day.slots.length > 0)
    : [];
  return {
    state: closed ? "closed" : "open",
    orgName: org.name,
    services: closed ? [] : services,
    serviceId: service?.id ?? "",
    days,
    day: days.some((day) => day.day === query.day) ? query.day! : "",
    questions: questionsOf(org.bookingQuestionsJson),
  };
}

export function bookPublic(input: { token: string; itemId: string; day: string; startMin: number; name: string; phone: string; email: string; answers: Record<string, string> }) {
  const db = getDb();
  const org = db.select().from(organizations).where(eq(organizations.bookingToken, input.token)).get();
  if (!org || org.bookingEnabled !== 1) throw new ServiceError("Not taking bookings.");
  const item = db.select().from(priceBookItems).where(and(eq(priceBookItems.orgId, org.id), eq(priceBookItems.id, input.itemId), eq(priceBookItems.bookable, 1))).get();
  if (!item?.bookDurationMin) throw new ServiceError("That service is not bookable.");
  const name = input.name.trim().slice(0, 80);
  const email = input.email.trim().toLowerCase().slice(0, 120);
  const phone = input.phone.trim().slice(0, 40);
  if (name.length < 2) throw new ServiceError("Enter a name.");
  if (!email.includes("@") || !email.includes(".")) throw new ServiceError("Enter an email.");
  if (phone.replace(/\D/g, "").length < 7) throw new ServiceError("Enter a phone.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day) || !Number.isInteger(input.startMin)) throw new ServiceError("Pick a time.");
  const asked = questionsOf(org.bookingQuestionsJson);
  const answers: Record<string, string> = {};
  for (const question of asked) answers[question.id] = (input.answers[question.id] || "").trim().slice(0, 200);
  const placed = db.transaction((tx) => {
    const slot = slotsFor(tx, org, input.day, item.bookDurationMin!, staffOf(item.bookStaffJson)).find((row) => row.startMin === input.startMin);
    if (!slot) throw new ServiceError("That time is taken.");
    const assigneeId = pickAssignee(slot.userIds);
    const existing = tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.orgId, org.id), isNull(contacts.deletedAt)))
      .all()
      .find((row) => row.email?.trim().toLowerCase() === email);
    const now = nowIso();
    const contactId = existing?.id ?? id("c");
    if (existing) {
      tx.update(contacts).set({ name, phone, updatedAt: now }).where(and(eq(contacts.orgId, org.id), eq(contacts.id, existing.id))).run();
    } else {
      tx.insert(contacts)
        .values({
          id: contactId,
          orgId: org.id,
          type: "client",
          name,
          company: null,
          email,
          phone,
          address: null,
          city: null,
          state: null,
          zip: null,
          notes: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
          createdBy: null,
        })
        .run();
    }
    const bookingId = id("book");
    const endMin = input.startMin + item.bookDurationMin!;
    tx.insert(bookings)
      .values({
        id: bookingId,
        orgId: org.id,
        itemId: item.id,
        contactId,
        dueOn: input.day,
        startTime: formatClock(input.startMin),
        endTime: formatClock(endMin),
        assigneeUserId: assigneeId,
        status: "scheduled",
        durationMin: item.bookDurationMin!,
        priceCents: item.bookPriceCents,
        answersJson: JSON.stringify(answers),
        createdAt: now,
      })
      .run();
    const owners = tx
      .select({ id: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.orgId, org.id))
      .all()
      .filter((row) => row.role === "owner" || row.role === "admin");
    for (const owner of owners) {
      tx.insert(notifications)
        .values({
          id: id("note"),
          orgId: org.id,
          userId: owner.id,
          kind: "booking",
          commentId: null,
          entityType: "booking",
          entityId: bookingId,
          projectId: null,
          actorId: null,
          actorName: name,
          snippet: `${item.name} · ${formatClock(input.startMin)}`,
          readAt: null,
          createdAt: now,
        })
        .run();
    }
    tx.insert(auditLogs)
      .values({
        id: id("audit"),
        orgId: org.id,
        actorId: null,
        action: "booking.create",
        entityType: "booking",
        entityId: bookingId,
        payloadJson: JSON.stringify({ day: input.day, start: formatClock(input.startMin), to: assigneeId }),
        ip: null,
        createdAt: now,
      })
      .run();
    const assignee = tx.select({ name: users.name }).from(users).where(eq(users.id, assigneeId)).get();
    return { bookingId, assigneeName: assignee?.name || "Tech", day: input.day, start: formatClock(input.startMin), label: item.name };
  });
  emitAutomation({
    orgId: org.id,
    kind: "booking_created",
    recordType: "booking",
    recordId: placed.bookingId,
    recordLabel: placed.label,
    projectId: null,
    name: name,
  });
  return placed;
}
