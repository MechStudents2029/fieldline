import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  bills,
  contacts,
  documents,
  lienWaiverAttempts,
  lienWaiverTemplates,
  lienWaivers,
  organizations,
  projects,
  vendorPortals,
} from "@/lib/db/schema";
import { formatCalendarDay } from "@/lib/format";
import { id, nowIso } from "@/lib/ids";
import { IP_WINDOW_MS, ORG_WINDOW_MS, rateLimitError } from "@/lib/lead-form/rules";
import { formatMoney, parseMoneyToCents } from "@/lib/money";
import { canManageMoney, canManageSettings, canSeeMoney, type Role } from "@/lib/permissions";
import { attachmentExtension, attachmentUploadError } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { localDay } from "@/lib/time/calendar";
import {
  DEFAULT_WAIVER_BODIES,
  WAIVER_TYPES,
  assessPayGate,
  displayWaiverLabel,
  displayWaiverState,
  isWaiverType,
  jobClosedForWaiver,
  parseWaiverMode,
  renderWaiver,
  requiredWaiverType,
  waiverIsFinal,
  waiverMissingForToday,
  waiverStatusLabel,
  waiverTypeLabel,
  type WaiverMode,
  type WaiverType,
} from "@/lib/waivers/format";
import { hashVendorToken, vendorTokenMatches } from "@/lib/vendor/token";

export type WaiverUpload = { filename: string; bytes: Buffer };

export type WaiverBadge = {
  billId: string;
  state: "missing" | "requested" | "signed";
  label: string;
  signedAt: string | null;
};

export type WaiverLine = {
  id: string;
  type: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  pending: boolean;
  amountCents: number;
  throughDate: string;
  signedAt: string | null;
  signedName: string | null;
  href: string;
};

export type BillWaiverPanel = {
  lines: WaiverLine[];
  offer: { type: WaiverType; label: string } | null;
};

export type PortalWaiver = {
  id: string;
  typeLabel: string;
  billNumber: string;
  job: string;
  amountCents: number;
  throughDate: string;
  text: string;
};

export type OutstandingWaiver = {
  id: string;
  billId: string;
  billNumber: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  pending: boolean;
  amountCents: number;
  throughDate: string;
};

export type LienSettings = {
  mode: WaiverMode;
  note: string;
  templates: { type: WaiverType; label: string; body: string }[];
};

type WaiverRow = typeof lienWaivers.$inferSelect;
type BillRow = typeof bills.$inferSelect;

function dbFor(actor: Actor): AppDatabase | null {
  if (!canSeeMoney(actor.role as Role)) return null;
  return officeDb(actor.orgId);
}

function assertOffice(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("You cannot change lien waivers.");
}

function writeAudit(tx: AppDatabase, orgId: string, actorId: string | null, action: string, entityId: string, payload: Record<string, unknown> | null, ip?: string) {
  tx.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "waiver",
      entityId,
      payloadJson: payload ? JSON.stringify(payload) : null,
      ip: ip ?? null,
      createdAt: nowIso(),
    })
    .run();
}

function orgRow(db: AppDatabase, orgId: string) {
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) throw new ServiceError("Company not found.");
  return org;
}

function todayFor(db: AppDatabase, orgId: string) {
  return localDay(Date.now(), orgRow(db, orgId).timeZone);
}

function ensureTemplates(db: AppDatabase, orgId: string) {
  const existing = db.select().from(lienWaiverTemplates).where(eq(lienWaiverTemplates.orgId, orgId)).all();
  const have = new Set(existing.map((row) => row.type));
  const now = nowIso();
  for (const type of WAIVER_TYPES) {
    if (have.has(type)) continue;
    db.insert(lienWaiverTemplates)
      .values({ id: id("lwt"), orgId, type, body: DEFAULT_WAIVER_BODIES[type], updatedAt: now })
      .run();
  }
}

function templateBody(db: AppDatabase, orgId: string, type: WaiverType) {
  ensureTemplates(db, orgId);
  const row = db
    .select()
    .from(lienWaiverTemplates)
    .where(and(eq(lienWaiverTemplates.orgId, orgId), eq(lienWaiverTemplates.type, type)))
    .get();
  return row?.body || DEFAULT_WAIVER_BODIES[type];
}

function billIn(db: AppDatabase, orgId: string, billId: string) {
  return db.select().from(bills).where(and(eq(bills.id, billId), eq(bills.orgId, orgId))).get();
}

function projectIn(db: AppDatabase, orgId: string, projectId: string) {
  return db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
}

function contactIn(db: AppDatabase, orgId: string, contactId: string) {
  return db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId))).get();
}

function waiversFor(db: AppDatabase, orgId: string, billId?: string) {
  return db
    .select()
    .from(lienWaivers)
    .where(billId ? and(eq(lienWaivers.orgId, orgId), eq(lienWaivers.billId, billId)) : eq(lienWaivers.orgId, orgId))
    .all();
}

function otherApproved(db: AppDatabase, bill: BillRow) {
  if (!bill.vendorContactId) return 0;
  return db
    .select()
    .from(bills)
    .where(and(eq(bills.orgId, bill.orgId), eq(bills.projectId, bill.projectId), eq(bills.vendorContactId, bill.vendorContactId)))
    .all()
    .filter((row) => row.id !== bill.id && row.status === "approved").length;
}

function finalFor(db: AppDatabase, bill: BillRow) {
  const project = projectIn(db, bill.orgId, bill.projectId);
  return waiverIsFinal(jobClosedForWaiver(project?.status ?? "", project?.closedAt), otherApproved(db, bill));
}

export function requiredSigned(db: AppDatabase, bill: BillRow, stage: "before" | "after") {
  const type = requiredWaiverType(stage, finalFor(db, bill));
  return waiversFor(db, bill.orgId, bill.id).some((row) => row.type === type && row.status === "signed");
}

export function payGateForBill(db: AppDatabase, orgId: string, bill: BillRow) {
  const mode = parseWaiverMode(orgRow(db, orgId).lienWaiverMode);
  return assessPayGate(mode, requiredSigned(db, bill, "before"));
}

function fillFor(db: AppDatabase, bill: BillRow, amountCents: number, throughDate: string) {
  const org = orgRow(db, bill.orgId);
  const project = projectIn(db, bill.orgId, bill.projectId);
  const vendor = bill.vendorContactId ? contactIn(db, bill.orgId, bill.vendorContactId) : null;
  return {
    vendor: vendor?.company?.trim() || vendor?.name || "Vendor",
    job: project?.name || "Job",
    amount: formatMoney(amountCents),
    through: formatCalendarDay(throughDate),
    bill: bill.billNumber || "Bill",
    company: org.name,
  };
}

function cleanThrough(value: string) {
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ServiceError("Use a through date.");
  return text;
}

function amountOrBill(raw: string | null | undefined, bill: BillRow) {
  if (raw == null || raw.trim() === "") return bill.amountCents;
  const cents = parseMoneyToCents(raw);
  if (cents == null || cents <= 0) throw new ServiceError("Enter the waiver amount.");
  return cents;
}

function liveOfType(rows: WaiverRow[], type: string) {
  return rows.find((row) => row.type === type && row.status !== "void");
}

function insertWaiver(db: AppDatabase, actor: Actor, bill: BillRow, type: WaiverType, amountCents: number, throughDate: string) {
  if (!bill.vendorContactId) throw new ServiceError("This bill has no vendor.");
  if (bill.status === "void") throw new ServiceError("A void bill cannot take a waiver.");
  const rows = waiversFor(db, actor.orgId, bill.id);
  if (liveOfType(rows, type)) throw new ServiceError("This bill already has that waiver.");
  const body = renderWaiver(templateBody(db, actor.orgId, type), fillFor(db, bill, amountCents, throughDate));
  const now = nowIso();
  const waiverId = id("lw");
  db.insert(lienWaivers)
    .values({
      id: waiverId,
      orgId: actor.orgId,
      billId: bill.id,
      projectId: bill.projectId,
      vendorContactId: bill.vendorContactId,
      type,
      status: "requested",
      amountCents,
      throughDate,
      body,
      signedName: null,
      signedAt: null,
      signedText: null,
      documentId: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  writeAudit(db, actor.orgId, actor.userId, "waiver.request", waiverId, { billId: bill.id, type, amountCents, throughDate });
  return waiverId;
}

export function requestWaiver(actor: Actor, billId: string, input: { type: string; amount?: string | null; throughDate?: string | null }) {
  assertOffice(actor);
  const db = dbFor(actor);
  if (!db) throw new ServiceError("You cannot change lien waivers.");
  if (!isWaiverType(input.type)) throw new ServiceError("Pick a waiver type.");
  const bill = billIn(db, actor.orgId, billId);
  if (!bill) throw new ServiceError("Bill not found.");
  const through = input.throughDate?.trim() ? cleanThrough(input.throughDate) : bill.billDate || todayFor(db, actor.orgId);
  const amount = amountOrBill(input.amount, bill);
  return { id: insertWaiver(db, actor, bill, input.type, amount, through) };
}

export function requestWaivers(actor: Actor, billIds: string[], type: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  if (!db) throw new ServiceError("You cannot change lien waivers.");
  if (!isWaiverType(type)) throw new ServiceError("Pick a waiver type.");
  const unique = [...new Set(billIds.map((value) => value.trim()).filter(Boolean))];
  if (unique.length === 0) throw new ServiceError("Pick a bill.");
  let count = 0;
  for (const billId of unique) {
    const bill = billIn(db, actor.orgId, billId);
    if (!bill || !bill.vendorContactId || bill.status === "void") continue;
    const rows = waiversFor(db, actor.orgId, bill.id);
    if (liveOfType(rows, type)) continue;
    const through = bill.billDate || todayFor(db, actor.orgId);
    insertWaiver(db, actor, bill, type, bill.amountCents, through);
    count += 1;
  }
  if (count === 0) throw new ServiceError("Those bills already have that waiver.");
  return { count };
}

export function requestUnconditional(actor: Actor, billId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  if (!db) throw new ServiceError("You cannot change lien waivers.");
  const bill = billIn(db, actor.orgId, billId);
  if (!bill) throw new ServiceError("Bill not found.");
  if (bill.status !== "paid") throw new ServiceError("Mark the bill paid before the unconditional waiver.");
  const type = requiredWaiverType("after", finalFor(db, bill));
  const through = bill.paidAt || bill.billDate || todayFor(db, actor.orgId);
  return { id: insertWaiver(db, actor, bill, type, bill.amountCents, through), type };
}

function lineOf(row: WaiverRow): WaiverLine {
  return {
    id: row.id,
    type: row.type,
    typeLabel: waiverTypeLabel(row.type),
    status: row.status,
    statusLabel: waiverStatusLabel(row.status),
    pending: row.status === "requested",
    amountCents: row.amountCents,
    throughDate: row.throughDate,
    signedAt: row.signedAt,
    signedName: row.signedName,
    href: `/waivers/${row.id}/print`,
  };
}

export function billWaiverPanel(actor: Actor, billId: string): BillWaiverPanel | null {
  const db = dbFor(actor);
  if (!db) return null;
  const bill = billIn(db, actor.orgId, billId);
  if (!bill) return null;
  const lines = waiversFor(db, actor.orgId, bill.id)
    .filter((row) => row.status !== "void")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(lineOf);
  let offer: BillWaiverPanel["offer"] = null;
  if (bill.status === "paid") {
    const type = requiredWaiverType("after", finalFor(db, bill));
    const rows = waiversFor(db, actor.orgId, bill.id);
    if (!liveOfType(rows, type)) offer = { type, label: "Request unconditional waiver" };
  }
  return { lines, offer };
}

export function waiverBadges(actor: Actor): WaiverBadge[] {
  const db = dbFor(actor);
  if (!db) return [];
  const rows = waiversFor(db, actor.orgId);
  const byBill = new Map<string, WaiverRow[]>();
  for (const row of rows) {
    const list = byBill.get(row.billId) ?? [];
    list.push(row);
    byBill.set(row.billId, list);
  }
  const all = db.select().from(bills).where(eq(bills.orgId, actor.orgId)).all();
  return all.map((bill) => {
    const mine = byBill.get(bill.id) ?? [];
    const state = displayWaiverState(mine);
    const signed = mine.filter((row) => row.status === "signed").sort((a, b) => (b.signedAt ?? "").localeCompare(a.signedAt ?? ""))[0];
    return { billId: bill.id, state, label: displayWaiverLabel(state), signedAt: signed?.signedAt ?? null };
  });
}

export function waiverQueue(actor: Actor): { count: number; href: string | null } {
  const db = dbFor(actor);
  if (!db) return { count: 0, href: null };
  const today = todayFor(db, actor.orgId);
  const all = db.select().from(bills).where(eq(bills.orgId, actor.orgId)).all();
  const count = all.filter((bill) => {
    const stage = bill.status === "paid" ? "after" : "before";
    const signed = requiredSigned(db, bill, stage);
    return waiverMissingForToday({ status: bill.status, dueDate: bill.dueDate, today, requiredSigned: signed });
  }).length;
  return { count, href: count ? "/bills?waiver=missing" : null };
}

export function outstandingWaivers(actor: Actor, contactId: string): OutstandingWaiver[] {
  const db = dbFor(actor);
  if (!db) return [];
  const contact = contactIn(db, actor.orgId, contactId);
  if (!contact) return [];
  const billMap = new Map(db.select().from(bills).where(eq(bills.orgId, actor.orgId)).all().map((row) => [row.id, row]));
  return waiversFor(db, actor.orgId)
    .filter((row) => row.vendorContactId === contactId && row.status === "requested")
    .map((row) => ({
      id: row.id,
      billId: row.billId,
      billNumber: billMap.get(row.billId)?.billNumber || "Bill",
      typeLabel: waiverTypeLabel(row.type),
      status: row.status,
      statusLabel: waiverStatusLabel(row.status),
      pending: true,
      amountCents: row.amountCents,
      throughDate: row.throughDate,
    }));
}

export function billsCsv(actor: Actor): string | null {
  const db = dbFor(actor);
  if (!db) return null;
  const badges = new Map(waiverBadges(actor).map((row) => [row.billId, row.label]));
  const names = new Map(db.select().from(contacts).where(eq(contacts.orgId, actor.orgId)).all().map((row) => [row.id, row.company?.trim() || row.name]));
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  const header = ["Bill", "Vendor", "Job", "Status", "Amount", "Waiver"];
  const lines = db
    .select()
    .from(bills)
    .where(eq(bills.orgId, actor.orgId))
    .all()
    .filter((row) => row.status !== "void")
    .map((row) =>
      [row.billNumber, names.get(row.vendorContactId ?? "") ?? "", jobs.get(row.projectId) ?? "", row.status, formatMoney(row.amountCents), badges.get(row.id) ?? "Missing"]
        .map(csvCell)
        .join(","),
    );
  return [header.join(","), ...lines].join("\n");
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function lienSettings(actor: Actor): LienSettings | null {
  const db = dbFor(actor);
  if (!db) return null;
  ensureTemplates(db, actor.orgId);
  const org = orgRow(db, actor.orgId);
  const bodies = new Map(db.select().from(lienWaiverTemplates).where(eq(lienWaiverTemplates.orgId, actor.orgId)).all().map((row) => [row.type, row.body]));
  return {
    mode: parseWaiverMode(org.lienWaiverMode),
    note: "Templates, not legal advice.",
    templates: WAIVER_TYPES.map((type) => ({ type, label: waiverTypeLabel(type), body: bodies.get(type) || DEFAULT_WAIVER_BODIES[type] })),
  };
}

export function saveLienSettings(actor: Actor, input: { mode: string; bodies: Record<string, string> }) {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("You cannot change lien waivers.");
  const db = dbFor(actor);
  if (!db) throw new ServiceError("You cannot change lien waivers.");
  const mode = input.mode === "off" || input.mode === "warn" || input.mode === "block" ? input.mode : null;
  if (!mode) throw new ServiceError("Pick Off, Warn, or Block.");
  ensureTemplates(db, actor.orgId);
  const now = nowIso();
  db.update(organizations).set({ lienWaiverMode: mode, updatedAt: now }).where(eq(organizations.id, actor.orgId)).run();
  for (const type of WAIVER_TYPES) {
    const body = (input.bodies[type] ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
    if (body.length < 8 || body.length > 4000) throw new ServiceError("Waiver wording needs a sentence.");
    db.update(lienWaiverTemplates)
      .set({ body, updatedAt: now })
      .where(and(eq(lienWaiverTemplates.orgId, actor.orgId), eq(lienWaiverTemplates.type, type)))
      .run();
  }
  writeAudit(db, actor.orgId, actor.userId, "waiver.settings", actor.orgId, { mode });
  return { mode };
}

function freezeSign(db: AppDatabase, orgId: string, row: WaiverRow, name: string, documentId: string | null, actorId: string | null, action: string, ip?: string) {
  if (row.status === "signed") throw new ServiceError("This waiver is already signed.");
  if (row.status !== "requested") throw new ServiceError("This waiver is not open.");
  const now = nowIso();
  db.update(lienWaivers)
    .set({ status: "signed", signedName: name, signedAt: now, signedText: row.body, documentId, updatedAt: now })
    .where(and(eq(lienWaivers.id, row.id), eq(lienWaivers.orgId, orgId)))
    .run();
  writeAudit(db, orgId, actorId, action, row.id, { name, documentId }, ip);
  const saved = db.select().from(lienWaivers).where(and(eq(lienWaivers.id, row.id), eq(lienWaivers.orgId, orgId))).get();
  if (!saved || saved.body !== row.body || saved.signedText !== row.body) throw new ServiceError("The signed text could not be stored.");
  return saved;
}

export function uploadPaperWaiver(actor: Actor, waiverId: string, upload: WaiverUpload) {
  assertOffice(actor);
  const db = dbFor(actor);
  if (!db) throw new ServiceError("You cannot change lien waivers.");
  const row = db.select().from(lienWaivers).where(and(eq(lienWaivers.id, waiverId), eq(lienWaivers.orgId, actor.orgId))).get();
  if (!row) throw new ServiceError("Waiver not found.");
  const error = attachmentUploadError(upload.filename, upload.bytes);
  if (error) throw new ServiceError(error);
  const documentId = id("doc");
  const ext = attachmentExtension(upload.bytes);
  const relative = path.join("uploads", actor.orgId, `${documentId}.${ext}`);
  fs.mkdirSync(path.dirname(path.join(dataDir(), relative)), { recursive: true });
  fs.writeFileSync(path.join(dataDir(), relative), upload.bytes);
  const stem = path.basename(upload.filename).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80) || "waiver";
  db.insert(documents)
    .values({
      id: documentId,
      orgId: actor.orgId,
      projectId: row.projectId,
      leadId: null,
      contactId: row.vendorContactId,
      type: "lien_waiver",
      filename: `${stem}.${ext}`,
      storagePath: relative,
      metadataJson: null,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy: actor.userId,
    })
    .run();
  freezeSign(db, actor.orgId, row, actor.name, documentId, actor.userId, "waiver.upload");
  return { id: row.id };
}

export function voidWaiver(actor: Actor, waiverId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  if (!db) throw new ServiceError("You cannot change lien waivers.");
  const row = db.select().from(lienWaivers).where(and(eq(lienWaivers.id, waiverId), eq(lienWaivers.orgId, actor.orgId))).get();
  if (!row) throw new ServiceError("Waiver not found.");
  if (row.status === "signed") throw new ServiceError("A signed waiver stays as signed.");
  if (row.status === "void") throw new ServiceError("This waiver is already void.");
  const now = nowIso();
  db.update(lienWaivers).set({ status: "void", updatedAt: now }).where(and(eq(lienWaivers.id, row.id), eq(lienWaivers.orgId, actor.orgId))).run();
  writeAudit(db, actor.orgId, actor.userId, "waiver.void", row.id, null);
  return { id: row.id };
}

function attemptCount(db: AppDatabase, orgId: string, since: string, ip?: string) {
  return db
    .select()
    .from(lienWaiverAttempts)
    .where(eq(lienWaiverAttempts.orgId, orgId))
    .all()
    .filter((row) => row.createdAt >= since && (!ip || row.ip === ip)).length;
}

function guardPortal(db: AppDatabase, orgId: string, ip: string) {
  const nowMs = Date.now();
  const limited = rateLimitError({
    ipCount: attemptCount(db, orgId, new Date(nowMs - IP_WINDOW_MS).toISOString(), ip),
    orgCount: attemptCount(db, orgId, new Date(nowMs - ORG_WINDOW_MS).toISOString()),
  });
  if (limited) throw new ServiceError(limited);
  db.insert(lienWaiverAttempts).values({ id: id("lwa"), orgId, ip: ip.slice(0, 80) || "local", createdAt: new Date(nowMs).toISOString() }).run();
}

function portalOf(token: string) {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const db = getDb();
  const portal = db.select().from(vendorPortals).where(eq(vendorPortals.tokenHash, hashVendorToken(trimmed))).get();
  if (!portal || !vendorTokenMatches(trimmed, portal.tokenHash)) return null;
  const contact = db.select().from(contacts).where(and(eq(contacts.id, portal.contactId), eq(contacts.orgId, portal.orgId))).get();
  if (!contact || contact.deletedAt) return null;
  return { db, orgId: portal.orgId, contactId: contact.id };
}

export function vendorPortalWaivers(token: string): PortalWaiver[] | null {
  const ctx = portalOf(token);
  if (!ctx) return null;
  const billMap = new Map(ctx.db.select().from(bills).where(eq(bills.orgId, ctx.orgId)).all().map((row) => [row.id, row]));
  const jobs = new Map(ctx.db.select().from(projects).where(eq(projects.orgId, ctx.orgId)).all().map((row) => [row.id, row.name]));
  return ctx.db
    .select()
    .from(lienWaivers)
    .where(and(eq(lienWaivers.orgId, ctx.orgId), eq(lienWaivers.vendorContactId, ctx.contactId), eq(lienWaivers.status, "requested")))
    .all()
    .map((row) => ({
      id: row.id,
      typeLabel: waiverTypeLabel(row.type),
      billNumber: billMap.get(row.billId)?.billNumber || "Bill",
      job: jobs.get(row.projectId) || "",
      amountCents: row.amountCents,
      throughDate: row.throughDate,
      text: row.body,
    }));
}

export function signVendorWaiver(input: { token: string; waiverId: string; name: string; ip: string }) {
  const ctx = portalOf(input.token);
  if (!ctx) throw new ServiceError("Portal not found.");
  guardPortal(ctx.db, ctx.orgId, input.ip || "local");
  const row = ctx.db.select().from(lienWaivers).where(and(eq(lienWaivers.id, input.waiverId), eq(lienWaivers.orgId, ctx.orgId))).get();
  if (!row || row.vendorContactId !== ctx.contactId) throw new ServiceError("Waiver not found.");
  const name = input.name.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw new ServiceError("Type your name.");
  const saved = freezeSign(ctx.db, ctx.orgId, row, name, null, null, "waiver.sign", input.ip);
  return { id: saved.id, signedText: saved.signedText };
}

export function waiverPrint(actor: Actor, waiverId: string) {
  const db = dbFor(actor);
  if (!db) return null;
  const row = db.select().from(lienWaivers).where(and(eq(lienWaivers.id, waiverId), eq(lienWaivers.orgId, actor.orgId))).get();
  if (!row) return null;
  const bill = billIn(db, actor.orgId, row.billId);
  const project = projectIn(db, actor.orgId, row.projectId);
  const vendor = contactIn(db, actor.orgId, row.vendorContactId);
  const org = orgRow(db, actor.orgId);
  return {
    orgName: org.name,
    typeLabel: waiverTypeLabel(row.type),
    statusLabel: waiverStatusLabel(row.status),
    billNumber: bill?.billNumber || "",
    job: project?.name || "",
    vendor: vendor?.company?.trim() || vendor?.name || "",
    amountCents: row.amountCents,
    throughDate: row.throughDate,
    text: row.status === "signed" && row.signedText ? row.signedText : row.body,
    signedName: row.signedName,
    signedAt: row.signedAt,
  };
}

export function waiverTextFrozen(before: string, afterBody: string, signedText: string | null) {
  return afterBody === before && signedText === before;
}
