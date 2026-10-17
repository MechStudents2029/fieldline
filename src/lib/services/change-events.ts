import fs from "node:fs";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb } from "@/lib/db/client";
import {
  auditLogs,
  bills,
  budgetChanges,
  changeEventCodes,
  changeEventCommitments,
  changeEventFiles,
  changeEventQuotes,
  changeEvents as changeEventRows,
  changeOrderLines,
  changeOrders,
  contacts,
  dailyLogs,
  documents,
  inspections,
  meetingActions,
  meetings,
  organizations,
  projects,
  punchItems,
  purchaseOrderEvents,
  purchaseOrderLines,
  delayClaims,
  purchaseOrders,
  rfis,
  scheduleItems,
  vendorPortals,
} from "@/lib/db/schema";
import { id, nowIso, token } from "@/lib/ids";
import { lineAmounts } from "@/lib/money";
import { canAddFieldNotes, canEditCrm, canSeeMoney } from "@/lib/permissions";
import { appOrigin, resolveInside } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { addCalendarDays, localDay } from "@/lib/time/calendar";
import { hashVendorToken, vendorTokenMatches } from "@/lib/vendor/token";

export type ChangeEventQuery = { filter?: string; projectId?: string };

export const CHANGE_REASONS: { value: string; label: string }[] = [
  { value: "owner", label: "Owner request" },
  { value: "design", label: "Design gap" },
  { value: "unforeseen", label: "Unforeseen condition" },
  { value: "field", label: "Field / allowance" },
];

const REASONS = new Set(CHANGE_REASONS.map((row) => row.value));
const REASON_LABEL: Record<string, string> = Object.fromEntries(CHANGE_REASONS.map((row) => [row.value, row.label]));
const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  pricing: "Pricing",
  ready: "Ready",
  converted: "Converted",
  voided: "Void",
};
const SOURCE_KINDS = new Set(["rfi", "meeting_action", "daily_log", "punch", "inspection", "delay"]);
const PENDING = new Set(["open", "pricing", "ready"]);
const LOCKED = new Set(["converted", "voided"]);

type EventRow = typeof changeEventRows.$inferSelect;
type CodeRow = typeof changeEventCodes.$inferSelect;
type QuoteRow = typeof changeEventQuotes.$inferSelect;

export type ChangeEventListRow = {
  id: string;
  projectId: string;
  job: string;
  number: number;
  title: string;
  reason: string;
  reasonLabel: string;
  status: string;
  statusLabel: string;
  romCostCents: number;
  romPriceCents: number;
  pricedCents: number;
  scheduleDays: number;
};

export type ChangeEventCodeView = {
  id: string;
  costCode: string;
  romCostCents: number;
  romPriceCents: number;
};

export type ChangeEventQuoteView = {
  id: string;
  contactId: string;
  vendor: string;
  status: string;
  amountCents: number | null;
  days: number | null;
  note: string;
  dueOn: string;
  chosen: boolean;
  shareUrl: string;
  requestedAt: string | null;
  copiedAt: string | null;
};

export type ChangeEventDetail = ChangeEventListRow & {
  sourceKind: string;
  sourceId: string;
  sourceLabel: string;
  scheduleDays: number;
  voidReason: string;
  changeOrderId: string | null;
  changeOrderNumber: number | null;
  changeOrderHref: string | null;
  budgetChangeId: string | null;
  budgetChangeNumber: number | null;
  budgetChangeHref: string | null;
  commitments: { id: string; number: string; href: string }[];
  codes: ChangeEventCodeView[];
  quotes: ChangeEventQuoteView[];
  files: { id: string; filename: string }[];
  vendors: { id: string; name: string }[];
  documents: { id: string; name: string }[];
  canEdit: boolean;
  canReady: boolean;
  canConvert: boolean;
  canFund: boolean;
  canVoid: boolean;
  showMoney: boolean;
};

export type ChangeEventTotals = { count: number; romPriceCents: number; pricedCents: number };

export type PortalChangeQuote = {
  id: string;
  title: string;
  job: string;
  number: number;
  scope: string;
  dueOn: string;
  status: string;
  amountCents: number | null;
  days: number | null;
  note: string;
  files: { id: string; filename: string; href: string }[];
};

export type ChangeEventInput = {
  title: string;
  reason: string;
  costCode: string;
  romCostCents?: number;
  romPriceCents?: number;
  scheduleDays?: number;
  sourceKind?: string;
  sourceId?: string;
};

function office(actor: Actor) {
  if (!canEditCrm(actor.role)) throw new ServiceError("Your role cannot change this.");
}

function creator(actor: Actor) {
  if (!canAddFieldNotes(actor.role)) throw new ServiceError("Your role cannot change this.");
}

function bound(value: string, max: number, label: string): string {
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().replace(/\s+/g, " ");
  if (text.length > max) throw new ServiceError(`${label} is too long.`);
  return text;
}

function money(cents: number, label: string): number {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100_000_000_00) throw new ServiceError(`Enter ${label}.`);
  return cents;
}

function dayCount(value: number | undefined): number {
  const days = value ?? 0;
  if (!Number.isSafeInteger(days) || days < 0 || days > 999) throw new ServiceError("Enter days.");
  return days;
}

function dueDay(value: string): string {
  const day = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ServiceError("Enter a date.");
  return day;
}

function codeText(value: string): string {
  const text = bound(value, 40, "Cost code");
  if (!text) throw new ServiceError("Add a cost code.");
  return text;
}

function reasonOf(value: string): string {
  const reason = value.trim();
  if (!REASONS.has(reason)) throw new ServiceError("Pick a reason.");
  return reason;
}

function audit(orgId: string, actorId: string | null, action: string, entityId: string, payload: unknown) {
  getDb()
    .insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "change_event",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function zoneFor(orgId: string): string {
  return getDb().select().from(organizations).where(eq(organizations.id, orgId)).get()?.timeZone || "America/New_York";
}

function projectOf(orgId: string, projectId: string) {
  const project = getDb().select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
  if (!project) throw new ServiceError("That job is not here.");
  return project;
}

function liveBudgetFund(orgId: string, eventId: string, budgetChangeId: string | null): boolean {
  if (budgetChangeId) return true;
  return getDb()
    .select()
    .from(budgetChanges)
    .where(and(eq(budgetChanges.orgId, orgId), eq(budgetChanges.changeEventId, eventId)))
    .all()
    .some((row) => row.status !== "voided");
}

function loadEvent(orgId: string, eventId: string): EventRow {
  const row = getDb().select().from(changeEventRows).where(and(eq(changeEventRows.id, eventId), eq(changeEventRows.orgId, orgId))).get();
  if (!row) throw new ServiceError("That event is not here.");
  return row;
}

function codesFor(orgId: string, eventId: string): CodeRow[] {
  return getDb()
    .select()
    .from(changeEventCodes)
    .where(and(eq(changeEventCodes.orgId, orgId), eq(changeEventCodes.eventId, eventId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.costCode.localeCompare(b.costCode));
}

function quotesFor(orgId: string, eventId: string): QuoteRow[] {
  return getDb()
    .select()
    .from(changeEventQuotes)
    .where(and(eq(changeEventQuotes.orgId, orgId), eq(changeEventQuotes.eventId, eventId)))
    .all();
}

function vendorIds(orgId: string, projectId: string) {
  const db = getDb();
  const ids = new Set<string>();
  for (const row of db.select().from(bills).where(and(eq(bills.orgId, orgId), eq(bills.projectId, projectId))).all()) {
    if (row.vendorContactId) ids.add(row.vendorContactId);
  }
  for (const row of db.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.projectId, projectId))).all()) {
    ids.add(row.vendorContactId);
  }
  for (const row of db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.projectId, projectId))).all()) {
    if (row.vendorContactId) ids.add(row.vendorContactId);
  }
  return ids;
}

function sourceOf(orgId: string, projectId: string, kindRaw: string | undefined, idRaw: string | undefined) {
  const kind = (kindRaw ?? "").trim();
  const sourceId = (idRaw ?? "").trim();
  if (!kind && !sourceId) return { kind: "", id: null as string | null };
  if (!SOURCE_KINDS.has(kind) || !sourceId) throw new ServiceError("Pick a source.");
  const db = getDb();
  if (kind === "rfi") {
    const row = db.select().from(rfis).where(and(eq(rfis.id, sourceId), eq(rfis.orgId, orgId), eq(rfis.projectId, projectId))).get();
    if (!row) throw new ServiceError("That source is not on this job.");
  } else if (kind === "daily_log") {
    const row = db.select().from(dailyLogs).where(and(eq(dailyLogs.id, sourceId), eq(dailyLogs.orgId, orgId), eq(dailyLogs.projectId, projectId))).get();
    if (!row) throw new ServiceError("That source is not on this job.");
  } else if (kind === "punch") {
    const row = db.select().from(punchItems).where(and(eq(punchItems.id, sourceId), eq(punchItems.orgId, orgId), eq(punchItems.projectId, projectId))).get();
    if (!row) throw new ServiceError("That source is not on this job.");
  } else if (kind === "inspection") {
    const row = db.select().from(inspections).where(and(eq(inspections.id, sourceId), eq(inspections.orgId, orgId), eq(inspections.projectId, projectId))).get();
    if (!row) throw new ServiceError("That source is not on this job.");
  } else if (kind === "delay") {
    const row = db.select().from(delayClaims).where(and(eq(delayClaims.id, sourceId), eq(delayClaims.orgId, orgId), eq(delayClaims.projectId, projectId))).get();
    if (!row) throw new ServiceError("That source is not on this job.");
  } else {
    const action = db.select().from(meetingActions).where(and(eq(meetingActions.id, sourceId), eq(meetingActions.orgId, orgId))).get();
    const meeting = action
      ? db.select().from(meetings).where(and(eq(meetings.id, action.meetingId), eq(meetings.orgId, orgId), eq(meetings.projectId, projectId))).get()
      : undefined;
    if (!meeting) throw new ServiceError("That source is not on this job.");
  }
  return { kind, id: sourceId };
}

function sourceLabel(orgId: string, kind: string, sourceId: string | null): string {
  if (!kind || !sourceId) return "";
  const db = getDb();
  if (kind === "rfi") {
    const row = db.select().from(rfis).where(and(eq(rfis.id, sourceId), eq(rfis.orgId, orgId))).get();
    return row ? `RFI ${row.number}` : "RFI";
  }
  if (kind === "daily_log") return "Daily log";
  if (kind === "punch") return "Punch";
  if (kind === "inspection") return "Inspection";
  if (kind === "delay") {
    const row = db.select().from(delayClaims).where(and(eq(delayClaims.id, sourceId), eq(delayClaims.orgId, orgId))).get();
    return row ? `Delay ${row.number}` : "Delay";
  }
  return "Meeting";
}

function portalUrl(orgId: string, contactId: string): string {
  const portal = getDb()
    .select()
    .from(vendorPortals)
    .where(and(eq(vendorPortals.orgId, orgId), eq(vendorPortals.contactId, contactId)))
    .get();
  if (!portal?.issuedToken) return "";
  const origin = appOrigin(process.env) ?? "";
  if (!origin) return "";
  return `${origin}/v/${portal.issuedToken}`;
}

function vendorPortal(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const db = getDb();
  const portal = db.select().from(vendorPortals).where(eq(vendorPortals.tokenHash, hashVendorToken(trimmed))).get();
  if (!portal || !vendorTokenMatches(trimmed, portal.tokenHash)) return null;
  return portal;
}

function pastDue(quote: QuoteRow, today: string) {
  return quote.status === "requested" && Boolean(quote.dueOn) && (quote.dueOn as string) < today;
}

function older(createdAt: string, cutoff: string, zone: string) {
  const stamp = Date.parse(createdAt);
  if (Number.isNaN(stamp)) return false;
  return localDay(stamp, zone) < cutoff;
}

function nextEventNumber(orgId: string, projectId: string) {
  const rows = getDb().select().from(changeEventRows).where(and(eq(changeEventRows.orgId, orgId), eq(changeEventRows.projectId, projectId))).all();
  return rows.reduce((max, row) => Math.max(max, row.number), 0) + 1;
}

function nextOrderNumber(orgId: string, projectId: string) {
  const rows = getDb().select().from(changeOrders).where(and(eq(changeOrders.orgId, orgId), eq(changeOrders.projectId, projectId))).all();
  return rows.reduce((max, row) => Math.max(max, row.number), 0) + 1;
}

function nextDocNumber(orgId: string, prefix: "PO" | "WO") {
  const rows = getDb().select({ number: purchaseOrders.number }).from(purchaseOrders).where(eq(purchaseOrders.orgId, orgId)).all();
  let max = 1000;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  for (const row of rows) {
    const match = pattern.exec(row.number);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${max + 1}`;
}

function docPrefix(orgId: string, projectId: string, contactId: string): "PO" | "WO" {
  const issued = getDb()
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.projectId, projectId), eq(purchaseOrders.vendorContactId, contactId)))
    .all()
    .filter((row) => row.status === "issued");
  if (issued.length > 0 && issued.every((row) => row.kind === "work")) return "WO";
  return "PO";
}

function allocate(amount: number, costs: number[]): number[] {
  if (costs.length === 0) return [];
  if (costs.length === 1) return [amount];
  const total = costs.reduce((sum, cost) => sum + Math.max(0, cost), 0);
  if (total <= 0) return costs.map((_, index) => (index === 0 ? amount : 0));
  let left = amount;
  return costs.map((cost, index) => {
    if (index === costs.length - 1) return left;
    const share = Math.round((amount * Math.max(0, cost)) / total);
    left -= share;
    return share;
  });
}

function rowOf(
  row: EventRow,
  job: string,
  codes: CodeRow[],
  quotes: QuoteRow[],
): ChangeEventListRow {
  return {
    id: row.id,
    projectId: row.projectId,
    job,
    number: row.number,
    title: row.title,
    reason: row.reason,
    reasonLabel: REASON_LABEL[row.reason] || row.reason,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status] || row.status,
    romCostCents: codes.reduce((sum, code) => sum + code.romCostCents, 0),
    romPriceCents: codes.reduce((sum, code) => sum + code.romPriceCents, 0),
    pricedCents: quotes.filter((quote) => quote.status === "priced").reduce((sum, quote) => sum + (quote.amountCents ?? 0), 0),
    scheduleDays: row.scheduleDays,
  };
}

export function listChangeEvents(actor: Actor, query: ChangeEventQuery = {}): ChangeEventListRow[] {
  const db = getDb();
  const zone = zoneFor(actor.orgId);
  const today = localDay(Date.now(), zone);
  const cutoff = addCalendarDays(today, -7);
  const filter = (query.filter ?? "").trim();
  const projectId = (query.projectId ?? "").trim();
  const events = db.select().from(changeEventRows).where(eq(changeEventRows.orgId, actor.orgId)).all();
  const codes = db.select().from(changeEventCodes).where(eq(changeEventCodes.orgId, actor.orgId)).all();
  const quotes = db.select().from(changeEventQuotes).where(eq(changeEventQuotes.orgId, actor.orgId)).all();
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  return events
    .filter((row) => !projectId || row.projectId === projectId)
    .filter((row) => {
      if (!filter) return true;
      if (filter === "age") return row.status === "open" && older(row.createdAt, cutoff, zone);
      if (filter === "due") return quotes.some((quote) => quote.eventId === row.id && pastDue(quote, today));
      return row.status === filter;
    })
    .map((row) => rowOf(row, jobs.get(row.projectId) || "", codes.filter((code) => code.eventId === row.id), quotes.filter((quote) => quote.eventId === row.id)))
    .sort((a, b) => a.job.localeCompare(b.job) || a.number - b.number);
}

export function changeEventTotals(rows: ChangeEventListRow[]): ChangeEventTotals {
  return {
    count: rows.length,
    romPriceCents: rows.reduce((sum, row) => sum + row.romPriceCents, 0),
    pricedCents: rows.reduce((sum, row) => sum + row.pricedCents, 0),
  };
}

export function changeEventDetail(actor: Actor, eventId: string): ChangeEventDetail | null {
  const db = getDb();
  const row = db.select().from(changeEventRows).where(and(eq(changeEventRows.id, eventId), eq(changeEventRows.orgId, actor.orgId))).get();
  if (!row) return null;
  const project = db.select().from(projects).where(and(eq(projects.id, row.projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) return null;
  const codes = codesFor(actor.orgId, row.id);
  const quotes = quotesFor(actor.orgId, row.id);
  const people = db.select().from(contacts).where(eq(contacts.orgId, actor.orgId)).all();
  const names = new Map(people.map((person) => [person.id, person.company || person.name]));
  const files = db.select().from(changeEventFiles).where(and(eq(changeEventFiles.orgId, actor.orgId), eq(changeEventFiles.eventId, row.id))).all();
  const docs = db.select().from(documents).where(and(eq(documents.orgId, actor.orgId), eq(documents.projectId, row.projectId))).all();
  const docName = new Map(docs.map((doc) => [doc.id, doc.filename]));
  const commitments = db
    .select()
    .from(changeEventCommitments)
    .where(and(eq(changeEventCommitments.orgId, actor.orgId), eq(changeEventCommitments.eventId, row.id)))
    .all();
  const orders = commitments.length
    ? db.select().from(purchaseOrders).where(eq(purchaseOrders.orgId, actor.orgId)).all()
    : [];
  const order = row.changeOrderId
    ? db.select().from(changeOrders).where(and(eq(changeOrders.id, row.changeOrderId), eq(changeOrders.orgId, actor.orgId))).get()
    : undefined;
  const funded = db
    .select()
    .from(budgetChanges)
    .where(eq(budgetChanges.orgId, actor.orgId))
    .all()
    .filter((change) => change.id === row.budgetChangeId || (change.changeEventId === row.id && change.status !== "voided"));
  const budgetChange = funded.find((change) => change.id === row.budgetChangeId) ?? funded[0];
  const fundedLive = liveBudgetFund(actor.orgId, row.id, row.budgetChangeId);
  const taken = new Set(quotes.map((quote) => quote.contactId));
  const vendors = [...vendorIds(actor.orgId, row.projectId)]
    .filter((contactId) => !taken.has(contactId))
    .map((contactId) => ({ id: contactId, name: names.get(contactId) || "Vendor" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const editable = canEditCrm(actor.role) && !LOCKED.has(row.status);
  return {
    ...rowOf(row, project.name, codes, quotes),
    sourceKind: row.sourceKind,
    sourceId: row.sourceId || "",
    sourceLabel: sourceLabel(actor.orgId, row.sourceKind, row.sourceId),
    voidReason: row.voidReason || "",
    changeOrderId: row.changeOrderId,
    changeOrderNumber: order?.number ?? null,
    changeOrderHref: order ? `/projects/${row.projectId}/orders/${order.id}` : null,
    budgetChangeId: budgetChange && canSeeMoney(actor.role) ? budgetChange.id : null,
    budgetChangeNumber: budgetChange && canSeeMoney(actor.role) ? budgetChange.number : null,
    budgetChangeHref: budgetChange && canSeeMoney(actor.role) ? `/budget-changes/${budgetChange.id}` : null,
    commitments: commitments.map((link) => {
      const po = orders.find((item) => item.id === link.purchaseOrderId);
      return { id: link.purchaseOrderId, number: po?.number || "", href: `/purchase-orders/${link.purchaseOrderId}` };
    }),
    codes: codes.map((code) => ({ id: code.id, costCode: code.costCode, romCostCents: code.romCostCents, romPriceCents: code.romPriceCents })),
    quotes: quotes
      .map((quote) => ({
        id: quote.id,
        contactId: quote.contactId,
        vendor: names.get(quote.contactId) || "Vendor",
        status: quote.status,
        amountCents: quote.amountCents,
        days: quote.days,
        note: quote.note,
        dueOn: quote.dueOn || "",
        chosen: quote.chosen === 1,
        shareUrl: portalUrl(actor.orgId, quote.contactId),
        requestedAt: quote.requestedAt,
        copiedAt: quote.copiedAt,
      }))
      .sort((a, b) => a.vendor.localeCompare(b.vendor)),
    files: files.map((file) => ({ id: file.id, filename: docName.get(file.documentId) || "File" })),
    vendors,
    documents: docs
      .filter((doc) => !doc.deletedAt)
      .map((doc) => ({ id: doc.id, name: doc.filename }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    canEdit: editable,
    canReady: editable && (row.status === "open" || row.status === "pricing"),
    canConvert: canEditCrm(actor.role) && row.status === "ready" && !fundedLive && !row.changeOrderId,
    canFund: canEditCrm(actor.role) && row.status === "ready" && !fundedLive && !row.changeOrderId,
    canVoid: canEditCrm(actor.role) && !LOCKED.has(row.status),
    showMoney: canSeeMoney(actor.role),
  };
}

export function createChangeEvent(actor: Actor, projectId: string, input: ChangeEventInput): string {
  creator(actor);
  const project = projectOf(actor.orgId, projectId);
  const title = bound(input.title, 160, "Title");
  if (!title) throw new ServiceError("Add a title.");
  const reason = reasonOf(input.reason);
  const costCode = codeText(input.costCode);
  const romCost = money(input.romCostCents ?? 0, "a cost");
  const romPrice = money(input.romPriceCents ?? 0, "a price");
  const scheduleDays = dayCount(input.scheduleDays);
  const source = sourceOf(actor.orgId, project.id, input.sourceKind, input.sourceId);
  const eventId = id("ce");
  const now = nowIso();
  const number = nextEventNumber(actor.orgId, project.id);
  getDb()
    .insert(changeEventRows)
    .values({
      id: eventId,
      orgId: actor.orgId,
      projectId: project.id,
      number,
      title,
      reason,
      sourceKind: source.kind,
      sourceId: source.id,
      scheduleDays,
      status: "open",
      changeOrderId: null,
      voidReason: null,
      voidedAt: null,
      voidedBy: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  getDb()
    .insert(changeEventCodes)
    .values({ id: id("cec"), orgId: actor.orgId, eventId, costCode, romCostCents: romCost, romPriceCents: romPrice, sortOrder: 0 })
    .run();
  audit(actor.orgId, actor.userId, "change_event.create", eventId, { number, title });
  return eventId;
}

export function saveChangeEvent(
  actor: Actor,
  eventId: string,
  input: { title: string; reason: string; scheduleDays?: number; codes: { id: string; romCostCents: number; romPriceCents: number }[] },
) {
  office(actor);
  const row = loadEvent(actor.orgId, eventId);
  if (LOCKED.has(row.status)) throw new ServiceError("This event is locked.");
  const title = bound(input.title, 160, "Title");
  if (!title) throw new ServiceError("Add a title.");
  const reason = reasonOf(input.reason);
  const scheduleDays = dayCount(input.scheduleDays);
  const codes = codesFor(actor.orgId, row.id);
  const now = nowIso();
  getDb()
    .update(changeEventRows)
    .set({ title, reason, scheduleDays, updatedAt: now })
    .where(and(eq(changeEventRows.id, row.id), eq(changeEventRows.orgId, actor.orgId)))
    .run();
  for (const code of codes) {
    const next = input.codes.find((item) => item.id === code.id);
    if (!next) continue;
    getDb()
      .update(changeEventCodes)
      .set({ romCostCents: money(next.romCostCents, "a cost"), romPriceCents: money(next.romPriceCents, "a price") })
      .where(and(eq(changeEventCodes.id, code.id), eq(changeEventCodes.orgId, actor.orgId)))
      .run();
  }
}

export function addChangeEventCode(actor: Actor, eventId: string, costCode: string, romCostCents: number, romPriceCents: number) {
  office(actor);
  const row = loadEvent(actor.orgId, eventId);
  if (LOCKED.has(row.status)) throw new ServiceError("This event is locked.");
  const code = codeText(costCode);
  const codes = codesFor(actor.orgId, row.id);
  if (codes.some((item) => item.costCode === code)) throw new ServiceError("That cost code is already on this event.");
  getDb()
    .insert(changeEventCodes)
    .values({
      id: id("cec"),
      orgId: actor.orgId,
      eventId: row.id,
      costCode: code,
      romCostCents: money(romCostCents, "a cost"),
      romPriceCents: money(romPriceCents, "a price"),
      sortOrder: codes.length,
    })
    .run();
  getDb().update(changeEventRows).set({ updatedAt: nowIso() }).where(eq(changeEventRows.id, row.id)).run();
}

export function attachChangeEventFile(actor: Actor, eventId: string, documentId: string) {
  office(actor);
  const row = loadEvent(actor.orgId, eventId);
  if (LOCKED.has(row.status)) throw new ServiceError("This event is locked.");
  const doc = getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.orgId, actor.orgId), eq(documents.projectId, row.projectId)))
    .get();
  if (!doc || doc.deletedAt) throw new ServiceError("That file is not on this job.");
  const existing = getDb()
    .select()
    .from(changeEventFiles)
    .where(and(eq(changeEventFiles.orgId, actor.orgId), eq(changeEventFiles.eventId, row.id), eq(changeEventFiles.documentId, doc.id)))
    .get();
  if (existing) return;
  getDb().insert(changeEventFiles).values({ id: id("cef"), orgId: actor.orgId, eventId: row.id, documentId: doc.id }).run();
}

export function askChangeQuote(actor: Actor, eventId: string, contactId: string, dueOn: string): string {
  office(actor);
  const row = loadEvent(actor.orgId, eventId);
  if (LOCKED.has(row.status)) throw new ServiceError("This event is locked.");
  const vendor = contactId.trim();
  if (!vendorIds(actor.orgId, row.projectId).has(vendor)) throw new ServiceError("That vendor is not on this job.");
  const due = dueDay(dueOn);
  const taken = quotesFor(actor.orgId, row.id).some((quote) => quote.contactId === vendor);
  if (taken) throw new ServiceError("That vendor is already on this event.");
  const quoteId = id("ceq");
  getDb()
    .insert(changeEventQuotes)
    .values({
      id: quoteId,
      orgId: actor.orgId,
      eventId: row.id,
      contactId: vendor,
      status: "draft",
      amountCents: null,
      days: null,
      note: "",
      dueOn: due,
      shareToken: token(),
      requestedAt: null,
      requestedBy: null,
      copiedAt: null,
      copiedBy: null,
      pricedAt: null,
      chosen: 0,
    })
    .run();
  audit(actor.orgId, actor.userId, "change_event.ask", row.id, { quoteId, contactId: vendor });
  return quoteId;
}

export function copyChangeQuote(actor: Actor, quoteId: string): string {
  office(actor);
  const quote = getDb().select().from(changeEventQuotes).where(and(eq(changeEventQuotes.id, quoteId), eq(changeEventQuotes.orgId, actor.orgId))).get();
  if (!quote) throw new ServiceError("That request is not here.");
  const row = loadEvent(actor.orgId, quote.eventId);
  if (row.status === "voided") throw new ServiceError("This event is locked.");
  const url = portalUrl(actor.orgId, quote.contactId);
  if (!url) throw new ServiceError("That vendor has no portal link.");
  const now = nowIso();
  getDb()
    .update(changeEventQuotes)
    .set({ copiedAt: now, copiedBy: actor.userId })
    .where(and(eq(changeEventQuotes.id, quote.id), eq(changeEventQuotes.orgId, actor.orgId)))
    .run();
  audit(actor.orgId, actor.userId, "change_event.copy", row.id, { quoteId: quote.id });
  return url;
}

export function markChangeRequested(actor: Actor, quoteId: string) {
  office(actor);
  const quote = getDb().select().from(changeEventQuotes).where(and(eq(changeEventQuotes.id, quoteId), eq(changeEventQuotes.orgId, actor.orgId))).get();
  if (!quote) throw new ServiceError("That request is not here.");
  const row = loadEvent(actor.orgId, quote.eventId);
  if (LOCKED.has(row.status)) throw new ServiceError("This event is locked.");
  if (quote.status !== "draft") throw new ServiceError("Already requested.");
  const now = nowIso();
  getDb()
    .update(changeEventQuotes)
    .set({ status: "requested", requestedAt: now, requestedBy: actor.userId })
    .where(and(eq(changeEventQuotes.id, quote.id), eq(changeEventQuotes.orgId, actor.orgId)))
    .run();
  if (row.status === "open") {
    getDb().update(changeEventRows).set({ status: "pricing", updatedAt: now }).where(eq(changeEventRows.id, row.id)).run();
  } else {
    getDb().update(changeEventRows).set({ updatedAt: now }).where(eq(changeEventRows.id, row.id)).run();
  }
  audit(actor.orgId, actor.userId, "change_event.request", row.id, { quoteId: quote.id });
}

export function chooseChangeQuote(actor: Actor, quoteId: string) {
  office(actor);
  const quote = getDb().select().from(changeEventQuotes).where(and(eq(changeEventQuotes.id, quoteId), eq(changeEventQuotes.orgId, actor.orgId))).get();
  if (!quote) throw new ServiceError("That request is not here.");
  const row = loadEvent(actor.orgId, quote.eventId);
  if (LOCKED.has(row.status)) throw new ServiceError("This event is locked.");
  if (quote.status !== "priced" || quote.amountCents == null) throw new ServiceError("That price is not in.");
  getDb().update(changeEventQuotes).set({ chosen: 1 }).where(and(eq(changeEventQuotes.id, quote.id), eq(changeEventQuotes.orgId, actor.orgId))).run();
}

export function markChangeReady(actor: Actor, eventId: string) {
  office(actor);
  const row = loadEvent(actor.orgId, eventId);
  if (LOCKED.has(row.status)) throw new ServiceError("This event is locked.");
  if (row.status !== "open" && row.status !== "pricing") throw new ServiceError("This event is locked.");
  if (codesFor(actor.orgId, row.id).length === 0) throw new ServiceError("Add a cost code.");
  const now = nowIso();
  getDb().update(changeEventRows).set({ status: "ready", updatedAt: now }).where(eq(changeEventRows.id, row.id)).run();
  audit(actor.orgId, actor.userId, "change_event.ready", row.id, {});
}

export function voidChangeEvent(actor: Actor, eventId: string, reason: string) {
  office(actor);
  const row = loadEvent(actor.orgId, eventId);
  if (LOCKED.has(row.status)) throw new ServiceError("This event is locked.");
  const text = bound(reason, 400, "Reason");
  if (!text) throw new ServiceError("Add a reason.");
  const now = nowIso();
  getDb()
    .update(changeEventRows)
    .set({ status: "voided", voidReason: text, voidedAt: now, voidedBy: actor.userId, updatedAt: now })
    .where(and(eq(changeEventRows.id, row.id), eq(changeEventRows.orgId, actor.orgId)))
    .run();
  audit(actor.orgId, actor.userId, "change_event.void", row.id, { reason: text });
}

export function convertChangeEvent(actor: Actor, eventId: string): { changeOrderId: string; purchaseOrderIds: string[] } {
  office(actor);
  const row = loadEvent(actor.orgId, eventId);
  if (row.status === "converted" || row.changeOrderId || liveBudgetFund(actor.orgId, row.id, row.budgetChangeId)) throw new ServiceError("Already converted.");
  if (row.status !== "ready") throw new ServiceError("Mark it ready first.");
  const project = projectOf(actor.orgId, row.projectId);
  const codes = codesFor(actor.orgId, row.id);
  if (codes.length === 0) throw new ServiceError("Add a cost code.");
  const chosen = quotesFor(actor.orgId, row.id).filter((quote) => quote.chosen === 1 && quote.status === "priced" && quote.amountCents != null);
  const markup = project.markupBps;
  type Line = { name: string; costCode: string; costCents: number; priceCents: number; markupBps: number };
  const lines: Line[] = [];
  const vendorLines = new Map<string, { quoteId: string; lines: { costCode: string; amountCents: number }[] }>();
  if (chosen.length === 0) {
    for (const code of codes) {
      lines.push({
        name: row.title,
        costCode: code.costCode,
        costCents: code.romCostCents,
        priceCents: code.romPriceCents,
        markupBps: 0,
      });
    }
  } else {
    for (const quote of chosen) {
      const shares = allocate(quote.amountCents as number, codes.map((code) => code.romCostCents));
      const poLines: { costCode: string; amountCents: number }[] = [];
      codes.forEach((code, index) => {
        const cost = shares[index] ?? 0;
        if (cost <= 0) return;
        const priced = lineAmounts(1000, cost, markup);
        lines.push({ name: row.title, costCode: code.costCode, costCents: priced.cost, priceCents: priced.price, markupBps: markup });
        poLines.push({ costCode: code.costCode, amountCents: priced.cost });
      });
      vendorLines.set(quote.contactId, { quoteId: quote.id, lines: poLines });
    }
  }
  if (lines.length === 0) throw new ServiceError("Add a cost code.");
  const priceDelta = lines.reduce((sum, line) => sum + line.priceCents, 0);
  const costDelta = lines.reduce((sum, line) => sum + line.costCents, 0);
  const changeOrderId = id("co");
  const now = nowIso();
  const orderNumber = nextOrderNumber(actor.orgId, row.projectId);
  const purchaseOrderIds: string[] = [];
  const drafts: { id: string; contactId: string; quoteId: string; number: string; kind: "purchase" | "work"; lines: { costCode: string; amountCents: number }[] }[] = [];
  const cursors = { PO: Number(nextDocNumber(actor.orgId, "PO").slice(3)), WO: Number(nextDocNumber(actor.orgId, "WO").slice(3)) };
  for (const [contactId, bundle] of vendorLines) {
    const prefix = docPrefix(actor.orgId, row.projectId, contactId);
    const number = `${prefix}-${cursors[prefix]}`;
    cursors[prefix] += 1;
    const poId = id("po");
    purchaseOrderIds.push(poId);
    drafts.push({ id: poId, contactId, quoteId: bundle.quoteId, number, kind: prefix === "WO" ? "work" : "purchase", lines: bundle.lines });
  }
  getDb().transaction((tx) => {
    const current = tx.select().from(changeEventRows).where(and(eq(changeEventRows.id, row.id), eq(changeEventRows.orgId, actor.orgId))).get();
    if (!current || current.status !== "ready" || current.changeOrderId || liveBudgetFund(actor.orgId, current.id, current.budgetChangeId)) {
      throw new ServiceError("Already converted.");
    }
    const number = orderNumber;
    tx.insert(changeOrders)
      .values({
        id: changeOrderId,
        orgId: actor.orgId,
        projectId: row.projectId,
        number,
        title: row.title,
        status: "draft",
        description: row.title,
        priceDeltaCents: priceDelta,
        costDeltaCents: costDelta,
        publicToken: token(),
        sentAt: null,
        approvedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    lines.forEach((line, index) => {
      tx.insert(changeOrderLines)
        .values({
          id: id("col"),
          orgId: actor.orgId,
          changeOrderId,
          name: line.name,
          qtyMilli: 1000,
          unit: "ea",
          unitCostCents: line.costCents,
          markupBps: line.markupBps,
          priceCents: line.priceCents,
          costCode: line.costCode,
          sortOrder: index,
        })
        .run();
    });
    for (const draft of drafts) {
      tx.insert(purchaseOrders)
        .values({
          id: draft.id,
          orgId: actor.orgId,
          projectId: row.projectId,
          vendorContactId: draft.contactId,
          changeOrderId,
          number: draft.number,
          scope: `CE ${row.number} ${row.title}`.slice(0, 240),
          status: "draft",
          voidReason: null,
          issuedAt: null,
          closedAt: null,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.userId,
          retainageBps: 0,
          kind: draft.kind,
        })
        .run();
      draft.lines.forEach((line, index) => {
        tx.insert(purchaseOrderLines)
          .values({
            id: id("pol"),
            orgId: actor.orgId,
            purchaseOrderId: draft.id,
            costCode: line.costCode,
            description: row.title,
            amountCents: line.amountCents,
            sortOrder: index,
            qtyMilli: 1000,
            unitCostCents: line.amountCents,
            sourceKind: "change_event",
            sourceId: row.id,
            note: null,
            expectedOn: null,
            scheduleItemId: null,
          })
          .run();
      });
      tx.insert(purchaseOrderEvents)
        .values({
          id: id("poe"),
          orgId: actor.orgId,
          purchaseOrderId: draft.id,
          actorId: actor.userId,
          type: "created",
          reason: null,
          beforeJson: null,
          afterJson: JSON.stringify({ number: draft.number, eventId: row.id }),
          createdAt: now,
        })
        .run();
      tx.insert(changeEventCommitments)
        .values({ id: id("ceco"), orgId: actor.orgId, eventId: row.id, quoteId: draft.quoteId, purchaseOrderId: draft.id })
        .run();
    }
    tx.update(changeEventRows)
      .set({ status: "converted", changeOrderId, updatedAt: now })
      .where(and(eq(changeEventRows.id, row.id), eq(changeEventRows.orgId, actor.orgId)))
      .run();
  });
  audit(actor.orgId, actor.userId, "change_event.convert", row.id, { changeOrderId, purchaseOrderIds });
  return { changeOrderId, purchaseOrderIds };
}

export function changeEventsCsv(actor: Actor, query: ChangeEventQuery = {}): string {
  const moneyOn = canSeeMoney(actor.role);
  const rows = listChangeEvents(actor, query);
  const header = "job,number,title,reason,status,rom cost,rom price,priced,days";
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const dollars = (cents: number) => (moneyOn ? (cents / 100).toFixed(2) : "");
  const body = rows.map((row) =>
    [row.job, String(row.number), row.title, row.reasonLabel, row.statusLabel, dollars(row.romCostCents), dollars(row.romPriceCents), dollars(row.pricedCents), String(row.scheduleDays)]
      .map(cell)
      .join(","),
  );
  return [header, ...body].join("\n");
}

export function changeEventAttention(actor: Actor): { age: { count: number; href: string | null }; due: { count: number; href: string | null } } {
  const zone = zoneFor(actor.orgId);
  const today = localDay(Date.now(), zone);
  const ageCount = listChangeEvents(actor, { filter: "age" }).length;
  const dueCount = getDb()
    .select()
    .from(changeEventQuotes)
    .where(eq(changeEventQuotes.orgId, actor.orgId))
    .all()
    .filter((quote) => pastDue(quote, today)).length;
  return {
    age: { count: ageCount, href: ageCount > 0 ? "/change-events?filter=age" : null },
    due: { count: dueCount, href: dueCount > 0 ? "/change-events?filter=due" : null },
  };
}

export function pendingCostByCode(orgId: string, projectId: string): Map<string, number> {
  const db = getDb();
  const events = db
    .select()
    .from(changeEventRows)
    .where(and(eq(changeEventRows.orgId, orgId), eq(changeEventRows.projectId, projectId)))
    .all()
    .filter((row) => PENDING.has(row.status));
  const ids = new Set(events.map((row) => row.id));
  const totals = new Map<string, number>();
  if (ids.size === 0) return totals;
  for (const code of db.select().from(changeEventCodes).where(and(eq(changeEventCodes.orgId, orgId))).all()) {
    if (!ids.has(code.eventId) || code.romCostCents <= 0) continue;
    totals.set(code.costCode, (totals.get(code.costCode) ?? 0) + code.romCostCents);
  }
  return totals;
}

export function portalChangeQuotesForClient(_portalToken: string): PortalChangeQuote[] {
  return [];
}

export function portalChangeQuotesForVendor(portalToken: string): PortalChangeQuote[] {
  const portal = vendorPortal(portalToken);
  if (!portal) return [];
  const db = getDb();
  const quotes = db
    .select()
    .from(changeEventQuotes)
    .where(and(eq(changeEventQuotes.orgId, portal.orgId), eq(changeEventQuotes.contactId, portal.contactId)))
    .all()
    .filter((quote) => quote.status === "requested" || quote.status === "priced");
  const events = db.select().from(changeEventRows).where(eq(changeEventRows.orgId, portal.orgId)).all();
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, portal.orgId)).all().map((row) => [row.id, row.name]));
  const codes = db.select().from(changeEventCodes).where(eq(changeEventCodes.orgId, portal.orgId)).all();
  const files = db.select().from(changeEventFiles).where(eq(changeEventFiles.orgId, portal.orgId)).all();
  const docs = db.select().from(documents).where(eq(documents.orgId, portal.orgId)).all();
  const docName = new Map(docs.map((doc) => [doc.id, doc.filename]));
  return quotes
    .map((quote) => {
      const event = events.find((row) => row.id === quote.eventId);
      if (!event || event.status === "voided") return null;
      const scope = codes
        .filter((code) => code.eventId === event.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((code) => code.costCode)
        .join(", ");
      return {
        id: quote.id,
        title: event.title,
        job: jobs.get(event.projectId) || "",
        number: event.number,
        scope,
        dueOn: quote.dueOn || "",
        status: quote.status,
        amountCents: quote.amountCents,
        days: quote.days,
        note: quote.note,
        files: files
          .filter((file) => file.eventId === event.id)
          .map((file) => ({ id: file.id, filename: docName.get(file.documentId) || "File", href: `/v/${portalToken}/change/${file.id}` })),
      };
    })
    .filter((row): row is PortalChangeQuote => row != null)
    .sort((a, b) => a.job.localeCompare(b.job) || a.number - b.number);
}

export function submitChangeQuote(input: { token: string; quoteId: string; amountCents: number; days: number; note: string }) {
  const portal = vendorPortal(input.token);
  if (!portal) throw new ServiceError("That request is not here.");
  const quote = getDb()
    .select()
    .from(changeEventQuotes)
    .where(and(eq(changeEventQuotes.id, input.quoteId), eq(changeEventQuotes.orgId, portal.orgId), eq(changeEventQuotes.contactId, portal.contactId)))
    .get();
  if (!quote || quote.status !== "requested") throw new ServiceError("That request is not here.");
  const amount = money(input.amountCents, "an amount");
  if (amount <= 0) throw new ServiceError("Enter an amount.");
  const days = dayCount(input.days);
  const note = bound(input.note, 400, "Note");
  const now = nowIso();
  getDb()
    .update(changeEventQuotes)
    .set({ status: "priced", amountCents: amount, days, note, pricedAt: now })
    .where(and(eq(changeEventQuotes.id, quote.id), eq(changeEventQuotes.orgId, portal.orgId)))
    .run();
  audit(portal.orgId, null, "change_event.price", quote.eventId, { quoteId: quote.id, amountCents: amount, days });
}

export function changeEventFileForVendor(portalToken: string, fileId: string): { filename: string; bytes: Buffer } | null {
  const portal = vendorPortal(portalToken);
  if (!portal) return null;
  const db = getDb();
  const file = db.select().from(changeEventFiles).where(and(eq(changeEventFiles.id, fileId), eq(changeEventFiles.orgId, portal.orgId))).get();
  if (!file) return null;
  const quote = db
    .select()
    .from(changeEventQuotes)
    .where(and(eq(changeEventQuotes.orgId, portal.orgId), eq(changeEventQuotes.eventId, file.eventId), eq(changeEventQuotes.contactId, portal.contactId)))
    .all()
    .find((row) => row.status === "requested" || row.status === "priced");
  if (!quote) return null;
  const document = db.select().from(documents).where(and(eq(documents.id, file.documentId), eq(documents.orgId, portal.orgId))).get();
  if (!document || document.deletedAt) return null;
  const path = resolveInside(dataDir(), document.storagePath);
  if (!path || !fs.existsSync(path)) return null;
  return { filename: document.filename, bytes: fs.readFileSync(path) };
}
