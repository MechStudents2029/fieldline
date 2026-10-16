import { and, eq } from "drizzle-orm";
import { addDays } from "@/lib/agreements/cadence";
import { getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import { agreementVisits, auditLogs, bookings, contacts, memberships, priceBookItems, projects, scheduleAssignees, scheduleItems, serviceAgreements, users } from "@/lib/db/schema";
import { formatClock, lookbackStart, overlappingIds, parseClock, planAssign, windowOf, type DispatchCard } from "@/lib/dispatch/assign";
import { openTray } from "@/lib/dispatch/board";
import { id, nowIso } from "@/lib/ids";
import { canEditSchedule, type Role } from "@/lib/permissions";
import { todayKey } from "@/lib/receiving/facts";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { approvedOffDays, timeOffWarning } from "@/lib/services/time-off";
import { capacityWarning } from "@/lib/services/workload";

type Writer = Pick<AppDatabase, "insert" | "select" | "update" | "delete" | "transaction">;

const OPEN_ITEM = new Set(["planned", "confirmed"]);
const OPEN_VISIT = new Set(["scheduled"]);

export type DispatchPerson = { id: string; name: string; role: string };

export type BoardCard = {
  id: string;
  kind: "visit" | "item" | "book";
  title: string;
  site: string;
  status: string;
  held: boolean;
  assigneeId: string | null;
  start: string | null;
  end: string | null;
  startMin: number | null;
  endMin: number | null;
  dueOn: string;
  overdue: boolean;
  closed: boolean;
  conflict: boolean;
  href: string;
};

export type DispatchBoard = {
  day: string;
  prev: string;
  next: string;
  label: string;
  canEdit: boolean;
  open: number;
  people: { id: string; name: string }[];
  columns: { id: string; name: string; out: boolean }[];
  cards: BoardCard[];
};

function dbFor(orgId: string): Writer {
  return officeDb(orgId) ?? getDb();
}

export function dayLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(date).replace(",", "");
}

function cleanDay(value: string | undefined, fallback: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return fallback;
}

type Raw = Omit<BoardCard, "conflict"> & { source: string };

function loadRaw(db: Writer, orgId: string, day: string): { cards: Raw[]; people: DispatchPerson[] } {
  const people = db
    .select({ id: users.id, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all()
    .filter((person) => person.role !== "viewer")
    .sort((a, b) => a.name.localeCompare(b.name));
  const names = new Map(db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row.name]));
  const agreements = new Map(db.select().from(serviceAgreements).where(eq(serviceAgreements.orgId, orgId)).all().map((row) => [row.id, row]));
  const visits = db.select().from(agreementVisits).where(eq(agreementVisits.orgId, orgId)).all();
  const linked = new Set(visits.map((visit) => visit.scheduleItemId).filter((itemId): itemId is string => Boolean(itemId)));
  const items = db.select().from(scheduleItems).where(eq(scheduleItems.orgId, orgId)).all();
  const itemById = new Map(items.map((item) => [item.id, item]));
  const assignees = db.select().from(scheduleAssignees).where(eq(scheduleAssignees.orgId, orgId)).all();
  const crewOf = new Map<string, string[]>();
  for (const row of assignees) {
    const list = crewOf.get(row.itemId) ?? [];
    list.push(row.userId);
    crewOf.set(row.itemId, list);
  }
  const startBack = lookbackStart(day);
  const cards: Raw[] = [];
  for (const visit of visits) {
    if (visit.status === "skipped") continue;
    const onDay = visit.dueOn === day;
    const overdue = visit.status === "scheduled" && !visit.assigneeUserId && visit.dueOn < day && visit.dueOn >= startBack;
    if (!onDay && !overdue) continue;
    const item = visit.scheduleItemId ? itemById.get(visit.scheduleItemId) : undefined;
    const startMin = parseClock(item?.startTime);
    const endMin = parseClock(item?.endTime);
    const agreement = agreements.get(visit.agreementId);
    cards.push({
      id: `visit:${visit.id}`,
      kind: "visit",
      source: `visit:${visit.id}`,
      title: agreement?.name || "Visit",
      site: names.get(visit.projectId || "") || names.get(item?.projectId || "") || "No job",
      status: visit.status === "scheduled" ? "Scheduled" : visit.status === "completed" ? "Done" : visit.status,
      held: false,
      assigneeId: visit.assigneeUserId,
      start: startMin == null ? null : formatClock(startMin),
      end: endMin == null ? null : formatClock(endMin),
      startMin,
      endMin,
      dueOn: visit.dueOn,
      overdue,
      closed: !OPEN_VISIT.has(visit.status),
      href: `/agreements/${visit.agreementId}`,
    });
  }
  for (const item of items) {
    if (item.status === "cancelled" || linked.has(item.id)) continue;
    const onDay = item.startDate <= day && day <= item.endDate;
    const crew = crewOf.get(item.id) ?? [];
    const overdue = OPEN_ITEM.has(item.status) && crew.length === 0 && item.endDate < day && item.endDate >= startBack;
    if (!onDay && !overdue) continue;
    const startMin = parseClock(item.startTime);
    const endMin = parseClock(item.endTime);
    cards.push({
      id: `item:${item.id}`,
      kind: "item",
      source: `item:${item.id}`,
      title: item.title,
      site: names.get(item.projectId) || "No job",
      status: item.status === "done" ? "Done" : item.status === "confirmed" ? "Confirmed" : "Planned",
      held: item.held === 1,
      assigneeId: crew[0] ?? null,
      start: startMin == null ? null : formatClock(startMin),
      end: endMin == null ? null : formatClock(endMin),
      startMin,
      endMin,
      dueOn: onDay ? day : item.endDate,
      overdue,
      closed: !OPEN_ITEM.has(item.status),
      href: `/schedule/items/${item.id}`,
    });
  }
  const serviceNames = new Map(db.select({ id: priceBookItems.id, name: priceBookItems.name }).from(priceBookItems).where(eq(priceBookItems.orgId, orgId)).all().map((row) => [row.id, row.name]));
  const contactNames = new Map(db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(eq(contacts.orgId, orgId)).all().map((row) => [row.id, row.name]));
  for (const booking of db.select().from(bookings).where(eq(bookings.orgId, orgId)).all()) {
    if (booking.status !== "scheduled") continue;
    const onDay = booking.dueOn === day;
    const overdue = !booking.assigneeUserId && booking.dueOn < day && booking.dueOn >= startBack;
    if (!onDay && !overdue) continue;
    const startMin = parseClock(booking.startTime);
    const endMin = parseClock(booking.endTime);
    cards.push({
      id: `book:${booking.id}`,
      kind: "book",
      source: `book:${booking.id}`,
      title: serviceNames.get(booking.itemId) || "Booking",
      site: contactNames.get(booking.contactId) || "Booking",
      status: "Scheduled",
      held: false,
      assigneeId: booking.assigneeUserId,
      start: startMin == null ? null : formatClock(startMin),
      end: endMin == null ? null : formatClock(endMin),
      startMin,
      endMin,
      dueOn: booking.dueOn,
      overdue,
      closed: false,
      href: `/dispatch?on=${booking.dueOn}`,
    });
  }
  return { cards, people };
}

function withConflicts(cards: Raw[]): BoardCard[] {
  const todayCards: DispatchCard[] = cards
    .filter((card) => !card.overdue)
    .map((card) => ({ id: card.id, source: card.source, assigneeId: card.assigneeId, startMin: card.startMin, endMin: card.endMin }));
  const hits = new Set(overlappingIds(todayCards));
  return cards.map((card) => ({
    id: card.id,
    kind: card.kind,
    title: card.title,
    site: card.site,
    status: card.status,
    held: card.held,
    assigneeId: card.assigneeId,
    start: card.start,
    end: card.end,
    startMin: card.startMin,
    endMin: card.endMin,
    dueOn: card.dueOn,
    overdue: card.overdue,
    closed: card.closed,
    href: card.href,
    conflict: hits.has(card.id),
  }));
}

function unassignedCount(cards: BoardCard[]): number {
  return cards.filter((card) => !card.closed && !card.assigneeId).length;
}

export function dispatchBoard(actor: Actor, on?: string): DispatchBoard {
  const db = dbFor(actor.orgId);
  const day = cleanDay(on, todayKey(db as AppDatabase, actor.orgId));
  const loaded = loadRaw(db, actor.orgId, day);
  let cards = withConflicts(loaded.cards);
  const field = actor.role === "field";
  if (field) cards = cards.filter((card) => card.assigneeId === actor.userId);
  const busy = new Set(cards.filter((card) => card.assigneeId && card.dueOn === day && windowOf(card.startMin, card.endMin)).map((card) => card.assigneeId as string));
  const shown = field ? loaded.people.filter((person) => person.id === actor.userId) : loaded.people.filter((person) => person.role === "field" || busy.has(person.id));
  const outIds = new Set(approvedOffDays(actor.orgId, day, day).map((row) => row.userId));
  const columns = shown.map((person) => ({ id: person.id, name: person.name, out: outIds.has(person.id) }));
  return {
    day,
    prev: addDays(day, -1),
    next: addDays(day, 1),
    label: dayLabel(day),
    canEdit: canEditSchedule(actor.role as Role),
    open: openTray(cards, columns, day).length,
    people: loaded.people.map((person) => ({ id: person.id, name: person.name })),
    columns,
    cards,
  };
}

export function dispatchAttention(orgId: string) {
  const db = dbFor(orgId);
  const day = todayKey(db as AppDatabase, orgId);
  const count = unassignedCount(withConflicts(loadRaw(db, orgId, day).cards));
  return { count, href: count > 0 ? "/dispatch" : null };
}

export function dispatchNotice(db: Writer, orgId: string, entityId: string) {
  const item = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.id, entityId))).get();
  if (item) return { record: item.title, href: `/dispatch?on=${item.startDate}` };
  const visit = db.select().from(agreementVisits).where(and(eq(agreementVisits.orgId, orgId), eq(agreementVisits.id, entityId))).get();
  if (!visit) return null;
  return { record: "Visit", href: `/dispatch?on=${visit.dueOn}` };
}

function parseCard(cardId: string): { kind: "visit" | "item" | "book"; rawId: string } | null {
  if (cardId.startsWith("visit:")) return { kind: "visit", rawId: cardId.slice(6) };
  if (cardId.startsWith("item:")) return { kind: "item", rawId: cardId.slice(5) };
  if (cardId.startsWith("book:")) return { kind: "book", rawId: cardId.slice(5) };
  return null;
}

export function assignDispatch(actor: Actor, input: { cardId: string; assigneeId: string | null; start: string | null; end: string | null; day: string }) {
  if (!canEditSchedule(actor.role as Role)) throw new ServiceError("Your role can view the day, not move it.");
  const parsed = parseCard(input.cardId);
  if (!parsed) throw new ServiceError("That card is not on the board.");
  const day = cleanDay(input.day, "");
  if (!day) throw new ServiceError("Pick a day.");
  const db = dbFor(actor.orgId);
  const people = new Set(
    db
      .select({ id: users.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, actor.orgId))
      .all()
      .map((row) => row.id),
  );
  const assigneeId = input.assigneeId || null;
  if (assigneeId && !people.has(assigneeId)) throw new ServiceError("Assign someone in this company.");
  const startMin = input.start ? parseClock(input.start) : null;
  const endMin = input.end ? parseClock(input.end) : null;
  if (input.start && startMin == null) throw new ServiceError("Start time uses 24-hour HH:MM.");
  if (input.end && endMin == null) throw new ServiceError("End time uses 24-hour HH:MM.");
  const loaded = loadRaw(db, actor.orgId, day);
  const current = loaded.cards.find((card) => card.id === input.cardId);
  if (!current) throw new ServiceError("That card is not on this day.");
  if (current.closed) throw new ServiceError("That card is closed.");
  const mathCards: DispatchCard[] = loaded.cards
    .filter((card) => card.dueOn === day)
    .map((card) => ({ id: card.id, source: card.source, assigneeId: card.assigneeId, startMin: card.startMin, endMin: card.endMin }));
  const plan = planAssign(mathCards, input.cardId, assigneeId, startMin, endMin);
  if (!plan.ok && plan.code === "window") throw new ServiceError("End is after the start.");
  if (!plan.ok && plan.code === "overlap") {
    const titles = plan.with.map((cardId) => loaded.cards.find((card) => card.id === cardId)?.title || "another job");
    throw new ServiceError(`Overlaps ${titles.join(", ")}`);
  }
  if (!plan.ok) throw new ServiceError("That card is not on this day.");
  const previous = current.assigneeId;
  const sameClock = current.startMin === startMin && current.endMin === endMin;
  if (previous === assigneeId && sameClock) return { id: input.cardId, warning: null };
  const now = nowIso();
  const action = !assigneeId ? "dispatch.unassign" : previous && previous !== assigneeId ? "dispatch.reassign" : "dispatch.assign";
  if (parsed.kind === "book") {
    db.transaction((tx) => {
      tx.update(bookings)
        .set({
          assigneeUserId: assigneeId,
          startTime: startMin == null ? current.start || "00:00" : formatClock(startMin),
          endTime: endMin == null ? current.end || "00:00" : formatClock(endMin),
        })
        .where(and(eq(bookings.orgId, actor.orgId), eq(bookings.id, parsed.rawId)))
        .run();
      tx.insert(auditLogs)
        .values({
          id: id("audit"),
          orgId: actor.orgId,
          actorId: actor.userId,
          action,
          entityType: "booking",
          entityId: parsed.rawId,
          payloadJson: JSON.stringify({
            from: previous,
            to: assigneeId,
            start: startMin == null ? null : formatClock(startMin),
            end: endMin == null ? null : formatClock(endMin),
            day,
          }),
          ip: null,
          createdAt: now,
        })
        .run();
    });
    return { id: input.cardId, warning: assigneeId ? [capacityWarning(actor, [assigneeId], day, day), timeOffWarning(actor, [assigneeId], day, day)].filter(Boolean).join(" ") || null : null };
  }
  const visit = parsed.kind === "visit" ? db.select().from(agreementVisits).where(and(eq(agreementVisits.orgId, actor.orgId), eq(agreementVisits.id, parsed.rawId))).get() : null;
  const itemId = parsed.kind === "item" ? parsed.rawId : visit?.scheduleItemId ?? null;
  if ((startMin != null || endMin != null) && !itemId) throw new ServiceError("That visit is not on the schedule.");
  db.transaction((tx) => {
    if (visit) {
      tx.update(agreementVisits)
        .set({ assigneeUserId: assigneeId, updatedAt: now })
        .where(and(eq(agreementVisits.orgId, actor.orgId), eq(agreementVisits.id, visit.id)))
        .run();
    }
    if (itemId) {
      tx.update(scheduleItems)
        .set({
          startTime: startMin == null ? null : formatClock(startMin),
          endTime: endMin == null ? null : formatClock(endMin),
          updatedAt: now,
        })
        .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, itemId)))
        .run();
      tx.delete(scheduleAssignees).where(and(eq(scheduleAssignees.orgId, actor.orgId), eq(scheduleAssignees.itemId, itemId))).run();
      if (assigneeId) {
        tx.insert(scheduleAssignees).values({ id: id("scha"), orgId: actor.orgId, itemId, userId: assigneeId }).run();
      }
    }
    tx.insert(auditLogs)
      .values({
        id: id("audit"),
        orgId: actor.orgId,
        actorId: actor.userId,
        action,
        entityType: parsed.kind === "visit" ? "agreement_visit" : "schedule_item",
        entityId: parsed.rawId,
        payloadJson: JSON.stringify({
          from: previous,
          to: assigneeId,
          start: startMin == null ? null : formatClock(startMin),
          end: endMin == null ? null : formatClock(endMin),
          day,
        }),
        ip: null,
        createdAt: now,
      })
      .run();
  });
  let spanStart = day;
  let spanEnd = day;
  if (itemId) {
    const saved = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, itemId))).get();
    if (saved) {
      spanStart = saved.startDate;
      spanEnd = saved.endDate;
    }
  }
  return { id: input.cardId, warning: assigneeId ? [capacityWarning(actor, [assigneeId], spanStart, spanEnd), timeOffWarning(actor, [assigneeId], spanStart, spanEnd)].filter(Boolean).join(" ") || null : null };
}
