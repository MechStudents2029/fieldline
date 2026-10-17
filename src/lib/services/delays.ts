import fs from "node:fs";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb } from "@/lib/db/client";
import {
  auditLogs,
  changeEvents as changeEventRows,
  delayClaims,
  delayFiles,
  delayItems,
  delayLabor,
  documents,
  organizations,
  projects,
  scheduleItems,
} from "@/lib/db/schema";
import { id, nowIso, token } from "@/lib/ids";
import { canAddFieldNotes, canEditCrm, canManageSettings } from "@/lib/permissions";
import { DELAY_REASONS, delayReasonLabel, isDelayReason } from "@/lib/schedule/delays";
import { appOrigin, resolveInside } from "@/lib/security";
import { addChangeEventCode, createChangeEvent } from "@/lib/services/change-events";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { addCalendarDays, localDay, localWeek } from "@/lib/time/calendar";

export type DelayQuery = { filter?: string; projectId?: string; cause?: string; impact?: string };

export const DELAY_IMPACTS = [
  { value: "full", label: "Full day" },
  { value: "partial", label: "Partial" },
  { value: "none", label: "No work impact" },
] as const;

export const DELAY_STATUSES = [
  { value: "open", label: "Open" },
  { value: "documented", label: "Documented" },
  { value: "converted", label: "Converted" },
  { value: "waived", label: "Waived" },
  { value: "voided", label: "Void" },
] as const;

const IMPACTS = new Set(DELAY_IMPACTS.map((row) => row.value));
const IMPACT_LABEL: Record<string, string> = Object.fromEntries(DELAY_IMPACTS.map((row) => [row.value, row.label]));
const STATUS_LABEL: Record<string, string> = Object.fromEntries(DELAY_STATUSES.map((row) => [row.value, row.label]));
const SHAREABLE = new Set(["documented", "converted", "waived"]);

type ClaimRow = typeof delayClaims.$inferSelect;
type LaborRow = typeof delayLabor.$inferSelect;

export type DelayLaborInput = { costCode?: string; trade?: string; hoursMilli?: number };

export type DelayInput = {
  title: string;
  cause: string;
  impact: string;
  startedAt: string;
  endedAt: string;
  weatherNote?: string;
  idleHoursMilli?: number;
  scheduleDays?: number;
  labor?: DelayLaborInput[];
};

export type DelayListRow = {
  id: string;
  projectId: string;
  job: string;
  number: number;
  title: string;
  cause: string;
  causeLabel: string;
  impact: string;
  impactLabel: string;
  status: string;
  statusLabel: string;
  startedAt: string;
  endedAt: string;
  lostHoursMilli: number;
  idleHoursMilli: number;
  scheduleDays: number;
};

export type DelayDetail = DelayListRow & {
  weatherNote: string;
  lostHours: string;
  idleHours: string;
  changeEventId: string | null;
  changeEventNumber: number | null;
  voidReason: string;
  shareUrl: string;
  sharedAt: string | null;
  labor: { id: string; costCode: string; trade: string; hoursMilli: number; hours: string }[];
  items: { id: string; scheduleItemId: string; title: string; daysClaimed: number }[];
  files: { id: string; filename: string }[];
  scheduleChoices: { id: string; title: string }[];
  documents: { id: string; name: string }[];
  canEdit: boolean;
  canDocument: boolean;
  canConvert: boolean;
  canWaive: boolean;
  canVoid: boolean;
  canShare: boolean;
};

export type DelayPackage = {
  orgName: string;
  job: string;
  number: number;
  title: string;
  causeLabel: string;
  impactLabel: string;
  startedAt: string;
  endedAt: string;
  weatherNote: string;
  lostHours: string;
  idleHours: string;
  scheduleDays: number;
  labor: { label: string; hours: string }[];
  photos: { id: string; filename: string; href: string }[];
};

export function formatClaimHours(milli: number): string {
  const abs = Math.abs(milli);
  const text = (abs / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return milli < 0 ? `-${text}` : text;
}

function office(actor: Actor) {
  if (!canEditCrm(actor.role)) throw new ServiceError("Your role cannot change this.");
}

function creator(actor: Actor) {
  if (!canAddFieldNotes(actor.role)) throw new ServiceError("Your role cannot change this.");
}

function owner(actor: Actor) {
  if (!canManageSettings(actor.role)) throw new ServiceError("Your role cannot change this.");
}

function bound(value: string, max: number, label: string): string {
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().replace(/\s+/g, " ");
  if (text.length > max) throw new ServiceError(`${label} is too long.`);
  return text;
}

function hoursOf(value: number | undefined): number {
  const hours = value ?? 0;
  if (!Number.isSafeInteger(hours) || hours < 0 || hours > 100_000_000) throw new ServiceError("Enter hours.");
  return hours;
}

function dayCount(value: number | undefined): number {
  const days = value ?? 0;
  if (!Number.isSafeInteger(days) || days < 0 || days > 999) throw new ServiceError("Enter days.");
  return days;
}

function stamp(value: string, label: string): string {
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) throw new ServiceError(`Enter ${label}.`);
  const time = text.slice(11);
  const [hh, mm] = time.split(":").map(Number);
  if (hh > 23 || mm > 59) throw new ServiceError(`Enter ${label}.`);
  return text;
}

function dayOf(value: string): string {
  return value.slice(0, 10);
}

function inclusiveDays(start: string, end: string): number {
  const ms = Date.parse(`${dayOf(end)}T00:00:00Z`) - Date.parse(`${dayOf(start)}T00:00:00Z`);
  const days = Math.round(ms / 86_400_000) + 1;
  if (!Number.isSafeInteger(days) || days < 1 || days > 999) throw new ServiceError("Enter days.");
  return days;
}

function causeOf(value: string): string {
  const cause = value.trim();
  if (!isDelayReason(cause)) throw new ServiceError("Pick a cause.");
  return cause;
}

function impactOf(value: string): string {
  const impact = value.trim();
  if (!IMPACTS.has(impact as (typeof DELAY_IMPACTS)[number]["value"])) throw new ServiceError("Pick an impact.");
  return impact;
}

function audit(orgId: string, actorId: string | null, action: string, entityId: string, payload: unknown) {
  getDb()
    .insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "delay_claim",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function calendarFor(orgId: string) {
  const org = getDb().select().from(organizations).where(eq(organizations.id, orgId)).get();
  return { timeZone: org?.timeZone || "America/New_York", weekStartsOn: org?.weekStartsOn ?? 1 };
}

function projectOf(orgId: string, projectId: string) {
  const project = getDb().select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
  if (!project) throw new ServiceError("That job is not here.");
  return project;
}

function loadClaim(orgId: string, claimId: string): ClaimRow {
  const row = getDb().select().from(delayClaims).where(and(eq(delayClaims.id, claimId), eq(delayClaims.orgId, orgId))).get();
  if (!row) throw new ServiceError("That delay is not here.");
  return row;
}

function laborFor(orgId: string, claimId: string): LaborRow[] {
  return getDb()
    .select()
    .from(delayLabor)
    .where(and(eq(delayLabor.orgId, orgId), eq(delayLabor.claimId, claimId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.costCode.localeCompare(b.costCode));
}

function itemsFor(orgId: string, claimId: string) {
  return getDb().select().from(delayItems).where(and(eq(delayItems.orgId, orgId), eq(delayItems.claimId, claimId))).all();
}

function filesFor(orgId: string, claimId: string) {
  return getDb().select().from(delayFiles).where(and(eq(delayFiles.orgId, orgId), eq(delayFiles.claimId, claimId))).all();
}

function editable(status: string) {
  return status === "open" || status === "documented";
}

function nextNumber(orgId: string, projectId: string) {
  const rows = getDb().select().from(delayClaims).where(and(eq(delayClaims.orgId, orgId), eq(delayClaims.projectId, projectId))).all();
  return rows.reduce((max, row) => Math.max(max, row.number), 0) + 1;
}

function lostMilli(rows: LaborRow[]) {
  return rows.reduce((sum, row) => sum + row.hoursMilli, 0);
}

function defaultDays(impact: string, start: string, end: string, given: number | undefined) {
  if (given != null) return dayCount(given);
  if (impact === "full") return inclusiveDays(start, end);
  return 0;
}

function laborLine(input: DelayLaborInput) {
  const costCode = bound(input.costCode ?? "", 40, "Cost code");
  const trade = bound(input.trade ?? "", 40, "Trade");
  const hoursMilli = hoursOf(input.hoursMilli);
  if (!costCode && !trade) {
    if (hoursMilli === 0) return null;
    throw new ServiceError("Add a cost code or a trade.");
  }
  return { costCode, trade, hoursMilli };
}

function eventReason(cause: string): string {
  if (cause === "client" || cause === "change_order") return "owner";
  if (cause === "other") return "field";
  return "unforeseen";
}

function claimCodes(rows: LaborRow[]): string[] {
  const codes: string[] = [];
  for (const row of rows) {
    const code = row.costCode.trim() || row.trade.trim();
    if (!code || codes.includes(code)) continue;
    codes.push(code);
  }
  return codes;
}

function shareUrl(shareToken: string) {
  const origin = appOrigin(process.env) ?? "";
  return `${origin}/d/${shareToken}`;
}

function inWeek(day: string, startDay: string) {
  return day >= startDay && day < addCalendarDays(startDay, 7);
}

function matches(row: ClaimRow, query: DelayQuery, today: string, weekStart: string) {
  const filter = (query.filter ?? "").trim();
  const projectId = (query.projectId ?? "").trim();
  const cause = (query.cause ?? "").trim();
  const impact = (query.impact ?? "").trim();
  if (projectId && row.projectId !== projectId) return false;
  if (cause && row.cause !== cause) return false;
  if (impact && row.impact !== impact) return false;
  if (!filter) return true;
  if (filter === "age") return row.status === "open" && dayOf(row.startedAt) < addCalendarDays(today, -3);
  if (filter === "weather") return row.status === "documented" && row.cause === "weather" && inWeek(dayOf(row.startedAt), weekStart);
  return row.status === filter;
}

function rowOf(row: ClaimRow, job: string, labor: LaborRow[]): DelayListRow {
  return {
    id: row.id,
    projectId: row.projectId,
    job,
    number: row.number,
    title: row.title,
    cause: row.cause,
    causeLabel: delayReasonLabel(row.cause),
    impact: row.impact,
    impactLabel: IMPACT_LABEL[row.impact] || row.impact,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status] || row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    lostHoursMilli: lostMilli(labor),
    idleHoursMilli: row.idleHoursMilli,
    scheduleDays: row.scheduleDays,
  };
}

export function listDelays(actor: Actor, query: DelayQuery = {}): DelayListRow[] {
  const db = getDb();
  const calendar = calendarFor(actor.orgId);
  const today = localDay(Date.now(), calendar.timeZone);
  const weekStart = localWeek(Date.now(), calendar).startDay;
  const projectId = (query.projectId ?? "").trim();
  if (projectId) projectOf(actor.orgId, projectId);
  const claims = db.select().from(delayClaims).where(eq(delayClaims.orgId, actor.orgId)).all();
  const labor = db.select().from(delayLabor).where(eq(delayLabor.orgId, actor.orgId)).all();
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  return claims
    .filter((row) => matches(row, query, today, weekStart))
    .map((row) => rowOf(row, jobs.get(row.projectId) || "", labor.filter((item) => item.claimId === row.id)))
    .sort((a, b) => a.job.localeCompare(b.job) || a.number - b.number);
}

export function delayDetail(actor: Actor, claimId: string): DelayDetail | null {
  const row = getDb().select().from(delayClaims).where(and(eq(delayClaims.id, claimId), eq(delayClaims.orgId, actor.orgId))).get();
  if (!row) return null;
  const project = getDb().select().from(projects).where(and(eq(projects.id, row.projectId), eq(projects.orgId, actor.orgId))).get();
  const labor = laborFor(actor.orgId, row.id);
  const links = itemsFor(actor.orgId, row.id);
  const files = filesFor(actor.orgId, row.id);
  const db = getDb();
  const items = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, row.projectId))).all();
  const docs = db.select().from(documents).where(and(eq(documents.orgId, actor.orgId), eq(documents.projectId, row.projectId))).all();
  const names = new Map(items.map((item) => [item.id, item.title]));
  const docName = new Map(docs.map((doc) => [doc.id, doc.filename]));
  const linked = new Set(links.map((link) => link.scheduleItemId));
  const attached = new Set(files.map((file) => file.documentId));
  const event = row.changeEventId
    ? db.select().from(changeEventRows).where(and(eq(changeEventRows.id, row.changeEventId), eq(changeEventRows.orgId, actor.orgId))).get()
    : undefined;
  const list = rowOf(row, project?.name || "", labor);
  const officeRole = canEditCrm(actor.role);
  const openEdit = officeRole && editable(row.status);
  return {
    ...list,
    weatherNote: row.weatherNote,
    lostHours: formatClaimHours(list.lostHoursMilli),
    idleHours: formatClaimHours(row.idleHoursMilli),
    changeEventId: row.changeEventId,
    changeEventNumber: event?.number ?? null,
    voidReason: row.voidReason || "",
    shareUrl: shareUrl(row.shareToken),
    sharedAt: row.sharedAt,
    labor: labor.map((item) => ({
      id: item.id,
      costCode: item.costCode,
      trade: item.trade,
      hoursMilli: item.hoursMilli,
      hours: formatClaimHours(item.hoursMilli),
    })),
    items: links
      .map((link) => ({ id: link.id, scheduleItemId: link.scheduleItemId, title: names.get(link.scheduleItemId) || "Item", daysClaimed: link.daysClaimed }))
      .sort((a, b) => a.title.localeCompare(b.title)),
    files: files.map((file) => ({ id: file.id, filename: docName.get(file.documentId) || "File" })),
    scheduleChoices: items
      .filter((item) => !linked.has(item.id))
      .map((item) => ({ id: item.id, title: item.title }))
      .sort((a, b) => a.title.localeCompare(b.title)),
    documents: docs
      .filter((doc) => !doc.deletedAt && !attached.has(doc.id))
      .map((doc) => ({ id: doc.id, name: doc.filename }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    canEdit: openEdit,
    canDocument: officeRole && row.status === "open",
    canConvert: officeRole && row.status === "documented" && !row.changeEventId,
    canWaive: officeRole && editable(row.status),
    canVoid: canManageSettings(actor.role) && editable(row.status),
    canShare: officeRole && SHAREABLE.has(row.status),
  };
}

export function createDelay(actor: Actor, projectId: string, input: DelayInput): string {
  creator(actor);
  const project = projectOf(actor.orgId, projectId);
  const title = bound(input.title, 160, "Title");
  if (!title) throw new ServiceError("Add a title.");
  const cause = causeOf(input.cause);
  const impact = impactOf(input.impact);
  const startedAt = stamp(input.startedAt, "a start");
  const endedAt = stamp(input.endedAt, "an end");
  if (endedAt < startedAt) throw new ServiceError("End is before the start.");
  const weatherNote = bound(input.weatherNote ?? "", 200, "Weather");
  const idleHoursMilli = hoursOf(input.idleHoursMilli);
  const scheduleDays = defaultDays(impact, startedAt, endedAt, input.scheduleDays);
  const lines = (input.labor ?? []).map(laborLine).filter((line): line is { costCode: string; trade: string; hoursMilli: number } => line != null);
  const claimId = id("dc");
  const now = nowIso();
  getDb()
    .insert(delayClaims)
    .values({
      id: claimId,
      orgId: actor.orgId,
      projectId: project.id,
      number: nextNumber(actor.orgId, project.id),
      title,
      cause,
      impact,
      startedAt,
      endedAt,
      weatherNote,
      idleHoursMilli,
      scheduleDays,
      status: "open",
      changeEventId: null,
      shareToken: token(),
      sharedAt: null,
      sharedBy: null,
      copiedAt: null,
      copiedBy: null,
      voidReason: null,
      voidedAt: null,
      voidedBy: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  lines.forEach((line, index) => {
    getDb()
      .insert(delayLabor)
      .values({ id: id("dcl"), orgId: actor.orgId, claimId, costCode: line.costCode, trade: line.trade, hoursMilli: line.hoursMilli, sortOrder: index })
      .run();
  });
  audit(actor.orgId, actor.userId, "delay.create", claimId, { title, cause });
  return claimId;
}

export function saveDelay(actor: Actor, claimId: string, input: DelayInput) {
  office(actor);
  const row = loadClaim(actor.orgId, claimId);
  if (!editable(row.status)) throw new ServiceError("This delay is locked.");
  const title = bound(input.title, 160, "Title");
  if (!title) throw new ServiceError("Add a title.");
  const cause = causeOf(input.cause);
  const impact = impactOf(input.impact);
  const startedAt = stamp(input.startedAt, "a start");
  const endedAt = stamp(input.endedAt, "an end");
  if (endedAt < startedAt) throw new ServiceError("End is before the start.");
  const weatherNote = bound(input.weatherNote ?? "", 200, "Weather");
  const idleHoursMilli = hoursOf(input.idleHoursMilli);
  const scheduleDays = input.scheduleDays != null ? dayCount(input.scheduleDays) : defaultDays(impact, startedAt, endedAt, undefined);
  getDb()
    .update(delayClaims)
    .set({ title, cause, impact, startedAt, endedAt, weatherNote, idleHoursMilli, scheduleDays, updatedAt: nowIso() })
    .where(and(eq(delayClaims.id, row.id), eq(delayClaims.orgId, actor.orgId)))
    .run();
  audit(actor.orgId, actor.userId, "delay.save", row.id, { title });
}

export function addDelayLabor(actor: Actor, claimId: string, input: DelayLaborInput) {
  office(actor);
  const row = loadClaim(actor.orgId, claimId);
  if (!editable(row.status)) throw new ServiceError("This delay is locked.");
  const line = laborLine(input);
  if (!line) throw new ServiceError("Add a cost code or a trade.");
  const sort = laborFor(actor.orgId, row.id).length;
  getDb()
    .insert(delayLabor)
    .values({ id: id("dcl"), orgId: actor.orgId, claimId: row.id, costCode: line.costCode, trade: line.trade, hoursMilli: line.hoursMilli, sortOrder: sort })
    .run();
  getDb().update(delayClaims).set({ updatedAt: nowIso() }).where(eq(delayClaims.id, row.id)).run();
}

export function removeDelayLabor(actor: Actor, laborId: string) {
  office(actor);
  const line = getDb().select().from(delayLabor).where(and(eq(delayLabor.id, laborId), eq(delayLabor.orgId, actor.orgId))).get();
  if (!line) throw new ServiceError("That row is not here.");
  const row = loadClaim(actor.orgId, line.claimId);
  if (!editable(row.status)) throw new ServiceError("This delay is locked.");
  getDb().delete(delayLabor).where(and(eq(delayLabor.id, line.id), eq(delayLabor.orgId, actor.orgId))).run();
}

export function linkDelayItem(actor: Actor, claimId: string, scheduleItemId: string) {
  office(actor);
  const row = loadClaim(actor.orgId, claimId);
  if (!editable(row.status)) throw new ServiceError("This delay is locked.");
  const item = getDb()
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.id, scheduleItemId), eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, row.projectId)))
    .get();
  if (!item) throw new ServiceError("That schedule item is not on this job.");
  const taken = itemsFor(actor.orgId, row.id).some((link) => link.scheduleItemId === item.id);
  if (taken) throw new ServiceError("That item is already linked.");
  getDb()
    .insert(delayItems)
    .values({ id: id("dci"), orgId: actor.orgId, claimId: row.id, scheduleItemId: item.id, daysClaimed: row.scheduleDays })
    .run();
}

export function applyDelayDays(actor: Actor, claimId: string) {
  office(actor);
  const row = loadClaim(actor.orgId, claimId);
  if (!editable(row.status)) throw new ServiceError("This delay is locked.");
  const links = itemsFor(actor.orgId, row.id);
  if (links.length === 0) throw new ServiceError("Link a schedule item.");
  for (const link of links) {
    getDb()
      .update(delayItems)
      .set({ daysClaimed: row.scheduleDays })
      .where(and(eq(delayItems.id, link.id), eq(delayItems.orgId, actor.orgId)))
      .run();
  }
  audit(actor.orgId, actor.userId, "delay.apply_days", row.id, { days: row.scheduleDays, items: links.length });
}

export function attachDelayFile(actor: Actor, claimId: string, documentId: string) {
  office(actor);
  const row = loadClaim(actor.orgId, claimId);
  if (!editable(row.status)) throw new ServiceError("This delay is locked.");
  const doc = getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.orgId, actor.orgId), eq(documents.projectId, row.projectId)))
    .get();
  if (!doc || doc.deletedAt) throw new ServiceError("That file is not on this job.");
  const existing = filesFor(actor.orgId, row.id).some((file) => file.documentId === doc.id);
  if (existing) return;
  getDb().insert(delayFiles).values({ id: id("dcf"), orgId: actor.orgId, claimId: row.id, documentId: doc.id }).run();
}

export function documentDelay(actor: Actor, claimId: string) {
  office(actor);
  const row = loadClaim(actor.orgId, claimId);
  if (row.status !== "open") throw new ServiceError("This delay is not open.");
  const now = nowIso();
  getDb().update(delayClaims).set({ status: "documented", updatedAt: now }).where(and(eq(delayClaims.id, row.id), eq(delayClaims.orgId, actor.orgId))).run();
  audit(actor.orgId, actor.userId, "delay.document", row.id, {});
}

export function waiveDelay(actor: Actor, claimId: string) {
  office(actor);
  const row = loadClaim(actor.orgId, claimId);
  if (!editable(row.status)) throw new ServiceError("This delay is locked.");
  const now = nowIso();
  getDb().update(delayClaims).set({ status: "waived", updatedAt: now }).where(and(eq(delayClaims.id, row.id), eq(delayClaims.orgId, actor.orgId))).run();
  audit(actor.orgId, actor.userId, "delay.waive", row.id, {});
}

export function voidDelay(actor: Actor, claimId: string, reason: string) {
  owner(actor);
  const row = loadClaim(actor.orgId, claimId);
  if (!editable(row.status)) throw new ServiceError("This delay is locked.");
  const text = bound(reason, 400, "Reason");
  if (!text) throw new ServiceError("Add a reason.");
  const now = nowIso();
  getDb()
    .update(delayClaims)
    .set({ status: "voided", voidReason: text, voidedAt: now, voidedBy: actor.userId, updatedAt: now })
    .where(and(eq(delayClaims.id, row.id), eq(delayClaims.orgId, actor.orgId)))
    .run();
  audit(actor.orgId, actor.userId, "delay.void", row.id, { reason: text });
}

export function copyDelayLink(actor: Actor, claimId: string): string {
  office(actor);
  const row = loadClaim(actor.orgId, claimId);
  if (!SHAREABLE.has(row.status)) throw new ServiceError("Document this delay first.");
  const now = nowIso();
  getDb()
    .update(delayClaims)
    .set({ copiedAt: now, copiedBy: actor.userId, updatedAt: now })
    .where(and(eq(delayClaims.id, row.id), eq(delayClaims.orgId, actor.orgId)))
    .run();
  return shareUrl(row.shareToken);
}

export function markDelayShared(actor: Actor, claimId: string): string {
  office(actor);
  const row = loadClaim(actor.orgId, claimId);
  if (!SHAREABLE.has(row.status)) throw new ServiceError("Document this delay first.");
  if (!row.sharedAt) {
    const now = nowIso();
    getDb()
      .update(delayClaims)
      .set({ sharedAt: now, sharedBy: actor.userId, updatedAt: now })
      .where(and(eq(delayClaims.id, row.id), eq(delayClaims.orgId, actor.orgId)))
      .run();
    audit(actor.orgId, actor.userId, "delay.share", row.id, {});
  }
  return shareUrl(row.shareToken);
}

export function convertDelay(actor: Actor, claimId: string): string {
  office(actor);
  const row = loadClaim(actor.orgId, claimId);
  if (row.status === "converted" || row.changeEventId) throw new ServiceError("Already converted.");
  if (row.status !== "documented") throw new ServiceError("Document this delay first.");
  const existing = getDb()
    .select()
    .from(changeEventRows)
    .where(and(eq(changeEventRows.orgId, actor.orgId), eq(changeEventRows.sourceKind, "delay"), eq(changeEventRows.sourceId, row.id)))
    .get();
  if (existing) throw new ServiceError("Already converted.");
  const codes = claimCodes(laborFor(actor.orgId, row.id));
  if (codes.length === 0) throw new ServiceError("Add a cost code.");
  const eventId = createChangeEvent(actor, row.projectId, {
    title: row.title,
    reason: eventReason(row.cause),
    costCode: codes[0],
    romCostCents: 0,
    romPriceCents: 0,
    scheduleDays: row.scheduleDays,
    sourceKind: "delay",
    sourceId: row.id,
  });
  for (const code of codes.slice(1)) addChangeEventCode(actor, eventId, code, 0, 0);
  const now = nowIso();
  getDb()
    .update(delayClaims)
    .set({ status: "converted", changeEventId: eventId, updatedAt: now })
    .where(and(eq(delayClaims.id, row.id), eq(delayClaims.orgId, actor.orgId)))
    .run();
  audit(actor.orgId, actor.userId, "delay.convert", row.id, { changeEventId: eventId });
  return eventId;
}

export function delaysCsv(actor: Actor, query: DelayQuery = {}): string {
  const rows = listDelays(actor, query);
  const header = "job,number,title,cause,impact,status,start,end,lost hours,idle hours,days";
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const body = rows.map((row) =>
    [
      row.job,
      String(row.number),
      row.title,
      row.causeLabel,
      row.impactLabel,
      row.statusLabel,
      row.startedAt,
      row.endedAt,
      formatClaimHours(row.lostHoursMilli),
      formatClaimHours(row.idleHoursMilli),
      String(row.scheduleDays),
    ]
      .map(cell)
      .join(","),
  );
  return [header, ...body].join("\n");
}

export function delayAttention(actor: Actor): { age: { count: number; href: string | null }; weather: { count: number; href: string | null } } {
  const ageCount = listDelays(actor, { filter: "age" }).length;
  const weatherCount = listDelays(actor, { filter: "weather" }).length;
  return {
    age: { count: ageCount, href: ageCount > 0 ? "/delays?filter=age" : null },
    weather: { count: weatherCount, href: weatherCount > 0 ? "/delays?filter=weather" : null },
  };
}

export function delayPackageByToken(shareToken: string): DelayPackage | null {
  const trimmed = shareToken.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const row = getDb().select().from(delayClaims).where(eq(delayClaims.shareToken, trimmed)).get();
  if (!row || !row.sharedAt || !SHAREABLE.has(row.status)) return null;
  const project = getDb().select().from(projects).where(and(eq(projects.id, row.projectId), eq(projects.orgId, row.orgId))).get();
  const org = getDb().select().from(organizations).where(eq(organizations.id, row.orgId)).get();
  const labor = laborFor(row.orgId, row.id);
  const files = filesFor(row.orgId, row.id);
  const docs = getDb().select().from(documents).where(eq(documents.orgId, row.orgId)).all();
  const docName = new Map(docs.map((doc) => [doc.id, doc.filename]));
  return {
    orgName: org?.name || "",
    job: project?.name || "",
    number: row.number,
    title: row.title,
    causeLabel: delayReasonLabel(row.cause),
    impactLabel: IMPACT_LABEL[row.impact] || row.impact,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    weatherNote: row.weatherNote,
    lostHours: formatClaimHours(lostMilli(labor)),
    idleHours: formatClaimHours(row.idleHoursMilli),
    scheduleDays: row.scheduleDays,
    labor: labor.map((item) => ({ label: item.costCode || item.trade, hours: formatClaimHours(item.hoursMilli) })),
    photos: files.map((file) => ({ id: file.id, filename: docName.get(file.documentId) || "File", href: `/d/${row.shareToken}/file/${file.id}` })),
  };
}

export function delayFileByToken(shareToken: string, fileId: string): { filename: string; bytes: Buffer } | null {
  const row = getDb().select().from(delayClaims).where(eq(delayClaims.shareToken, shareToken.trim())).get();
  if (!row || !row.sharedAt || !SHAREABLE.has(row.status)) return null;
  const file = filesFor(row.orgId, row.id).find((item) => item.id === fileId);
  if (!file) return null;
  const document = getDb().select().from(documents).where(and(eq(documents.id, file.documentId), eq(documents.orgId, row.orgId))).get();
  if (!document || document.deletedAt) return null;
  const path = resolveInside(dataDir(), document.storagePath);
  if (!path || !fs.existsSync(path)) return null;
  return { filename: document.filename, bytes: fs.readFileSync(path) };
}

export { DELAY_REASONS };
