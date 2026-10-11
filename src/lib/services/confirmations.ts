import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import { auditLogs, contacts, memberships, notifications, organizations, projects, scheduleConfirmations, scheduleItems, users, vendorPortals } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canEditSchedule, canManageSettings, type Role } from "@/lib/permissions";
import { confirmPill, nextConfirmStatus, resetsOnMove } from "@/lib/schedule/confirm";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

const VENDOR_TYPES = new Set(["sub", "vendor"]);

export type ConfirmShift = { id: string; start: string; end: string };

export type ConfirmFilters = { status?: string; vendorId?: string; projectId?: string };

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function assertEditor(actor: Actor) {
  if (!canEditSchedule(actor.role as Role)) throw new ServiceError("Your role can view the schedule, not change it.");
}

function cleanDay(value: string | null | undefined): string | null {
  const day = (value ?? "").trim();
  if (!day) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || addCalendarDays(day, 0) !== day) throw new ServiceError("Enter a date.");
  return day;
}

function cleanReason(value: string): string {
  const reason = value.trim().replace(/\s+/g, " ");
  if (!reason) throw new ServiceError("Add a reason.");
  if (reason.length > 240) throw new ServiceError("Keep the reason under 240 characters.");
  return reason;
}

function actorName(db: AppDatabase, userId: string | null): string {
  if (!userId) return "Office";
  return db.select().from(users).where(eq(users.id, userId)).get()?.name || "Office";
}

function orgRow(db: AppDatabase, orgId: string) {
  return db.select().from(organizations).where(eq(organizations.id, orgId)).get();
}

function todayFor(db: AppDatabase, orgId: string) {
  return localDay(Date.now(), orgRow(db, orgId)?.timeZone || "America/New_York");
}

function itemIn(db: AppDatabase, orgId: string, itemId: string) {
  return db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.id, itemId))).get();
}

function vendorIn(db: AppDatabase, orgId: string, contactId: string) {
  const contact = db.select().from(contacts).where(and(eq(contacts.orgId, orgId), eq(contacts.id, contactId))).get();
  if (!contact || contact.deletedAt || !VENDOR_TYPES.has(contact.type)) return null;
  return contact;
}

function portalUrl(db: AppDatabase, orgId: string, contactId: string) {
  const portal = db
    .select()
    .from(vendorPortals)
    .where(and(eq(vendorPortals.orgId, orgId), eq(vendorPortals.contactId, contactId)))
    .get();
  return portal?.issuedToken ? `/v/${portal.issuedToken}` : "";
}

export function confirmationMessage(vendor: string, title: string, job: string, start: string, url: string) {
  return `${vendor}: confirm ${title} · ${job} · ${start}. ${url || "your Fieldline portal"}`;
}

function writeAudit(db: AppDatabase, orgId: string, userId: string | null, action: string, itemId: string, payload: unknown) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId: userId,
      action,
      entityType: "schedule_item",
      entityId: itemId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function writeHistory(
  db: AppDatabase,
  row: { orgId: string; itemId: string; projectId: string; vendorContactId: string | null; event: string; reason: string; proposedDate: string | null; actorName: string; actorId: string | null },
) {
  db.insert(scheduleConfirmations)
    .values({
      id: id("scfm"),
      orgId: row.orgId,
      itemId: row.itemId,
      projectId: row.projectId,
      vendorContactId: row.vendorContactId,
      event: row.event,
      reason: row.reason,
      proposedDate: row.proposedDate,
      actorName: row.actorName,
      actorId: row.actorId,
      createdAt: nowIso(),
    })
    .run();
}

function notifyOffice(db: AppDatabase, orgId: string, item: { id: string; projectId: string; title: string; confirmRequestedBy: string | null }, vendorName: string, snippet: string) {
  const members = db.select().from(memberships).where(eq(memberships.orgId, orgId)).all();
  const targets = new Set<string>();
  if (item.confirmRequestedBy && members.some((row) => row.userId === item.confirmRequestedBy)) targets.add(item.confirmRequestedBy);
  if (targets.size === 0) {
    for (const row of members) {
      if (row.role === "owner" || row.role === "admin") targets.add(row.userId);
    }
  }
  const now = nowIso();
  for (const userId of targets) {
    db.insert(notifications)
      .values({
        id: id("note"),
        orgId,
        userId,
        kind: "confirmation",
        commentId: null,
        entityType: "schedule_item",
        entityId: item.id,
        projectId: item.projectId,
        actorId: null,
        actorName: vendorName,
        snippet,
        readAt: null,
        createdAt: now,
      })
      .run();
  }
}

function jobName(db: AppDatabase, orgId: string, projectId: string) {
  return db.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).get()?.name ?? "Job";
}

export function shiftsThatReset(db: AppDatabase, orgId: string, shifts: ConfirmShift[]) {
  const resets: { id: string; title: string }[] = [];
  for (const shift of shifts) {
    const row = itemIn(db, orgId, shift.id);
    if (!row) continue;
    if (row.startDate === shift.start && row.endDate === shift.end) continue;
    if (!resetsOnMove(row.confirmStatus)) continue;
    resets.push({ id: row.id, title: row.title });
  }
  return resets;
}

export function applyConfirmationResets(db: AppDatabase, actor: { orgId: string; userId: string | null }, shifts: ConfirmShift[]) {
  const resets = shiftsThatReset(db, actor.orgId, shifts);
  if (resets.length === 0) return resets;
  const name = actorName(db, actor.userId);
  const now = nowIso();
  for (const reset of resets) {
    const row = itemIn(db, actor.orgId, reset.id);
    if (!row) continue;
    db.update(scheduleItems)
      .set({ confirmStatus: "requested", confirmReason: "", confirmProposed: null, updatedAt: now })
      .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, row.id)))
      .run();
    writeHistory(db, {
      orgId: actor.orgId,
      itemId: row.id,
      projectId: row.projectId,
      vendorContactId: row.vendorContactId,
      event: "reset",
      reason: "",
      proposedDate: null,
      actorName: name,
      actorId: actor.userId,
    });
    writeAudit(db, actor.orgId, actor.userId, "confirmation.reset", row.id, { title: row.title });
  }
  return resets;
}

export function resetConfirmedOnHold(orgId: string, itemIds: string[]) {
  if (itemIds.length === 0) return [];
  const db = getDb();
  const now = nowIso();
  const resets: string[] = [];
  for (const itemId of itemIds) {
    const row = itemIn(db, orgId, itemId);
    if (!row || row.held === 1 || !resetsOnMove(row.confirmStatus)) continue;
    db.update(scheduleItems)
      .set({ confirmStatus: "requested", confirmReason: "", confirmProposed: null, updatedAt: now })
      .where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.id, row.id)))
      .run();
    writeHistory(db, {
      orgId,
      itemId: row.id,
      projectId: row.projectId,
      vendorContactId: row.vendorContactId,
      event: "reset",
      reason: "",
      proposedDate: null,
      actorName: "Office",
      actorId: null,
    });
    writeAudit(db, orgId, null, "confirmation.reset", row.id, { title: row.title, held: true });
    resets.push(row.id);
  }
  return resets;
}

function writeRequest(db: AppDatabase, orgId: string, itemId: string, userId: string | null) {
  const row = itemIn(db, orgId, itemId);
  if (!row) throw new ServiceError("That schedule item is not in your company.");
  if (!row.vendorContactId) throw new ServiceError("Assign a vendor first.");
  const vendor = vendorIn(db, orgId, row.vendorContactId);
  if (!vendor) throw new ServiceError("Assign a vendor first.");
  const now = nowIso();
  const name = actorName(db, userId);
  db.update(scheduleItems)
    .set({
      confirmStatus: nextConfirmStatus(row.confirmStatus, "request"),
      confirmReason: "",
      confirmProposed: null,
      confirmRequestedBy: userId,
      updatedAt: now,
    })
    .where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.id, row.id)))
    .run();
  writeHistory(db, {
    orgId,
    itemId: row.id,
    projectId: row.projectId,
    vendorContactId: row.vendorContactId,
    event: "requested",
    reason: "",
    proposedDate: null,
    actorName: name,
    actorId: userId,
  });
  writeAudit(db, orgId, userId, "confirmation.request", row.id, { title: row.title, vendorId: row.vendorContactId });
  const url = portalUrl(db, orgId, row.vendorContactId);
  const vendorName = vendor.company?.trim() || vendor.name;
  return {
    id: row.id,
    url,
    message: confirmationMessage(vendorName, row.title, jobName(db, orgId, row.projectId), row.startDate, url),
  };
}

export function autoRequestAssigned(db: AppDatabase, orgId: string, itemId: string, userId: string | null) {
  const org = orgRow(db, orgId);
  if (!org || org.confirmAutoRequest !== 1) return null;
  const row = itemIn(db, orgId, itemId);
  if (!row?.vendorContactId || row.confirmStatus) return null;
  return writeRequest(db, orgId, itemId, userId);
}

export function requestConfirmation(actor: Actor, itemId: string) {
  assertEditor(actor);
  return writeRequest(dbFor(actor), actor.orgId, itemId, actor.userId);
}

export function requestConfirmations(actor: Actor, itemIds: string[]) {
  assertEditor(actor);
  const db = dbFor(actor);
  const unique = [...new Set(itemIds.map((itemId) => itemId.trim()).filter(Boolean))];
  if (unique.length === 0) throw new ServiceError("Pick a schedule item.");
  if (unique.length > 40) throw new ServiceError("Request up to 40 items.");
  return unique.map((itemId) => writeRequest(db, actor.orgId, itemId, actor.userId));
}

export function requestUpcoming(actor: Actor, vendorId: string, next: number) {
  assertEditor(actor);
  if (!Number.isInteger(next) || next < 1 || next > 40) throw new ServiceError("Pick 1 to 40 items.");
  const db = dbFor(actor);
  if (!vendorIn(db, actor.orgId, vendorId)) throw new ServiceError("That vendor is not in your company.");
  const today = todayFor(db, actor.orgId);
  const ids = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.vendorContactId, vendorId)))
    .all()
    .filter((row) => row.startDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title))
    .slice(0, next)
    .map((row) => row.id);
  if (ids.length === 0) throw new ServiceError("No upcoming items.");
  return requestConfirmations(actor, ids);
}

export function requestRange(actor: Actor, input: { projectId: string; from: string; to: string; vendorId?: string | null }) {
  assertEditor(actor);
  const from = cleanDay(input.from);
  const to = cleanDay(input.to);
  if (!from || !to || to < from) throw new ServiceError("Enter a date range.");
  const db = dbFor(actor);
  const project = db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, input.projectId))).get();
  if (!project) throw new ServiceError("That job is not in your company.");
  const vendorId = input.vendorId?.trim() || "";
  if (vendorId && !vendorIn(db, actor.orgId, vendorId)) throw new ServiceError("That vendor is not in your company.");
  const ids = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, project.id)))
    .all()
    .filter((row) => row.vendorContactId && row.startDate <= to && row.endDate >= from && (!vendorId || row.vendorContactId === vendorId))
    .map((row) => row.id);
  if (ids.length === 0) throw new ServiceError("No items in that range.");
  return requestConfirmations(actor, ids);
}

export function assignScheduleVendor(actor: Actor, itemId: string, vendorId: string | null) {
  assertEditor(actor);
  const db = dbFor(actor);
  const row = itemIn(db, actor.orgId, itemId);
  if (!row) throw new ServiceError("That schedule item is not in your company.");
  const next = vendorId?.trim() || null;
  if (next && !vendorIn(db, actor.orgId, next)) throw new ServiceError("That vendor is not in your company.");
  const now = nowIso();
  db.update(scheduleItems)
    .set({
      vendorContactId: next,
      confirmStatus: next ? row.confirmStatus : null,
      confirmReason: next ? row.confirmReason : "",
      confirmProposed: next ? row.confirmProposed : null,
      updatedAt: now,
    })
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, row.id)))
    .run();
  if (next && next !== row.vendorContactId) autoRequestAssigned(db, actor.orgId, row.id, actor.userId);
}

export function vendorDecision(
  db: AppDatabase,
  ctx: { orgId: string; contactId: string; vendorName: string },
  itemId: string,
  input: { decision: "confirm" | "decline"; reason?: string; proposedDate?: string | null },
) {
  const row = itemIn(db, ctx.orgId, itemId);
  if (!row || row.vendorContactId !== ctx.contactId) throw new ServiceError("Not found.");
  let status: "confirmed" | "declined";
  try {
    const next = nextConfirmStatus(row.confirmStatus, input.decision);
    if (next !== "confirmed" && next !== "declined") throw new Error(input.decision);
    status = next;
  } catch {
    throw new ServiceError("That item is not waiting on a confirmation.");
  }
  const reason = input.decision === "decline" ? cleanReason(input.reason ?? "") : "";
  const proposed = input.decision === "decline" ? cleanDay(input.proposedDate) : null;
  const now = nowIso();
  db.update(scheduleItems)
    .set({ confirmStatus: status, confirmReason: reason, confirmProposed: proposed, updatedAt: now })
    .where(and(eq(scheduleItems.orgId, ctx.orgId), eq(scheduleItems.id, row.id)))
    .run();
  writeHistory(db, {
    orgId: ctx.orgId,
    itemId: row.id,
    projectId: row.projectId,
    vendorContactId: row.vendorContactId,
    event: status,
    reason,
    proposedDate: proposed,
    actorName: ctx.vendorName,
    actorId: null,
  });
  writeAudit(db, ctx.orgId, null, status === "confirmed" ? "confirmation.confirm" : "confirmation.decline", row.id, { title: row.title, reason, proposed });
  notifyOffice(db, ctx.orgId, row, ctx.vendorName, `${status === "confirmed" ? "Confirmed" : "Declined"} ${row.title}`);
  return { id: row.id, projectId: row.projectId, title: row.title, status };
}

export function itemConfirmations(actor: Actor, itemId: string) {
  const db = dbFor(actor);
  const row = itemIn(db, actor.orgId, itemId);
  if (!row) return null;
  const vendor = row.vendorContactId ? vendorIn(db, actor.orgId, row.vendorContactId) : null;
  const history = db
    .select()
    .from(scheduleConfirmations)
    .where(and(eq(scheduleConfirmations.orgId, actor.orgId), eq(scheduleConfirmations.itemId, row.id)))
    .all()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const url = row.vendorContactId ? portalUrl(db, actor.orgId, row.vendorContactId) : "";
  const vendorName = vendor ? vendor.company?.trim() || vendor.name : "";
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    startDate: row.startDate,
    endDate: row.endDate,
    vendorId: row.vendorContactId,
    vendorName,
    status: row.confirmStatus,
    pill: confirmPill(row.confirmStatus),
    reason: row.confirmReason,
    proposed: row.confirmProposed,
    canEdit: canEditSchedule(actor.role as Role),
    url,
    message: vendorName ? confirmationMessage(vendorName, row.title, jobName(db, actor.orgId, row.projectId), row.startDate, url) : "",
    history: history.map((event) => ({
      id: event.id,
      event: event.event,
      label: event.event === "requested" ? "Requested" : event.event === "confirmed" ? "Confirmed" : event.event === "declined" ? "Declined" : "Reset",
      reason: event.reason,
      proposedDate: event.proposedDate,
      actorName: event.actorName,
      createdAt: event.createdAt,
    })),
  };
}

function confirmationRows(actor: Actor, filters: ConfirmFilters) {
  const db = dbFor(actor);
  const people = new Map(db.select().from(contacts).where(eq(contacts.orgId, actor.orgId)).all().map((row) => [row.id, row.company?.trim() || row.name]));
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  return db
    .select()
    .from(scheduleItems)
    .where(eq(scheduleItems.orgId, actor.orgId))
    .all()
    .filter((row) => row.vendorContactId)
    .filter((row) => !filters.status || (filters.status === "none" ? !row.confirmStatus : row.confirmStatus === filters.status))
    .filter((row) => !filters.vendorId || row.vendorContactId === filters.vendorId)
    .filter((row) => !filters.projectId || row.projectId === filters.projectId)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title))
    .map((row) => ({
      id: row.id,
      projectId: row.projectId,
      job: jobs.get(row.projectId) ?? "Job",
      title: row.title,
      vendorId: row.vendorContactId ?? "",
      vendor: people.get(row.vendorContactId ?? "") ?? "Vendor",
      status: row.confirmStatus,
      pill: confirmPill(row.confirmStatus) ?? "",
      start: row.startDate,
      proposed: row.confirmProposed,
      reason: row.confirmReason,
    }));
}

export function listConfirmations(actor: Actor, filters: ConfirmFilters = {}) {
  const db = dbFor(actor);
  const vendors = db
    .select()
    .from(contacts)
    .where(eq(contacts.orgId, actor.orgId))
    .all()
    .filter((row) => !row.deletedAt && VENDOR_TYPES.has(row.type))
    .map((row) => ({ id: row.id, name: row.company?.trim() || row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const jobs = db
    .select()
    .from(projects)
    .where(eq(projects.orgId, actor.orgId))
    .all()
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { rows: confirmationRows(actor, filters), vendors, jobs, canEdit: canEditSchedule(actor.role as Role) };
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

export function confirmationsCsv(actor: Actor, filters: ConfirmFilters = {}) {
  const lines = ["Job,Item,Vendor,Status,Start,Proposed"];
  for (const row of confirmationRows(actor, filters)) {
    lines.push([row.job, row.title, row.vendor, row.pill, row.start, row.proposed ?? ""].map(csvCell).join(","));
  }
  return { filename: "confirmations.csv", body: `${lines.join("\n")}\n` };
}

export function unconfirmedSoon(orgId: string) {
  const db = getDb();
  const org = orgRow(db, orgId);
  if (!org) return { count: 0, days: 3, href: "/confirmations" };
  const days = org.confirmRemindDays;
  const today = localDay(Date.now(), org.timeZone);
  const end = addCalendarDays(today, Math.max(0, days));
  const count = db
    .select()
    .from(scheduleItems)
    .where(eq(scheduleItems.orgId, orgId))
    .all()
    .filter((row) => row.vendorContactId && row.confirmStatus !== "confirmed" && row.startDate >= today && row.startDate <= end).length;
  return { count, days, href: "/confirmations" };
}

export function confirmSettings(actor: Actor) {
  const org = orgRow(dbFor(actor), actor.orgId);
  return { autoRequest: org?.confirmAutoRequest === 1, remindDays: org?.confirmRemindDays ?? 3 };
}

export function saveConfirmSettings(actor: Actor, input: { autoRequest: boolean; remindDays: number }) {
  if (!canManageSettings(actor.role)) throw new ServiceError("Only an owner or admin can change this.");
  if (!Number.isInteger(input.remindDays) || input.remindDays < 0 || input.remindDays > 30) throw new ServiceError("Reminder lead is 0 to 30 days.");
  dbFor(actor)
    .update(organizations)
    .set({ confirmAutoRequest: input.autoRequest ? 1 : 0, confirmRemindDays: input.remindDays, updatedAt: nowIso() })
    .where(eq(organizations.id, actor.orgId))
    .run();
}

export function systemRequestConfirmation(orgId: string, itemId: string) {
  const db = getDb();
  const row = itemIn(db, orgId, itemId);
  if (!row?.vendorContactId) return "No vendor";
  writeRequest(db, orgId, itemId, null);
  return `Requested ${row.title}`;
}
