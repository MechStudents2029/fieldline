import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  billEvents,
  billLines,
  bidFiles,
  bidInvites,
  bills,
  contacts,
  documents,
  organizations,
  projects,
  punchItems,
  purchaseOrderEvents,
  purchaseOrderLines,
  purchaseOrders,
  scheduleItems,
  submittalFiles,
  submittals,
  vendorCertificates,
  vendorPortalAttempts,
  vendorPortals,
} from "@/lib/db/schema";
import { netPayableCents, retainedCents } from "@/lib/bills/retainage";
import { id, nowIso } from "@/lib/ids";
import { IP_WINDOW_MS, ORG_WINDOW_MS, rateLimitError } from "@/lib/lead-form/rules";
import { openCommitmentByCode, overageByCode } from "@/lib/margin/commitment";
import { formatMoney, positiveMoneyError } from "@/lib/money";
import { canEditCrm, canManageSettings, canSeeMoney, type Role } from "@/lib/permissions";
import { photoExtension, photoUploadError, rasterImageType } from "@/lib/security";
import { duplicateBill, normalizeBillNumber } from "@/lib/services/bills";
import { targetPlans, vendorMayReadJobFile } from "@/lib/services/files";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { localDay } from "@/lib/time/calendar";
import {
  CERT_TYPES,
  certificateNeedsAttention,
  certificateStatus,
  isCertType,
  parseComplianceMode,
  parseRequiredTypes,
  poIssueDecision,
  poIssueProblems,
  soonestCertificateDays,
  vendorRollup,
  type CertStatus,
  type CertType,
} from "@/lib/vendor/compliance";
import { hashVendorToken, newVendorSecret, vendorTokenMatches } from "@/lib/vendor/token";

const VENDOR_TYPES = new Set(["sub", "vendor"]);
const RELIEVING = new Set(["approved", "paid"]);

export type VendorUpload = { filename: string; bytes: Buffer };

export type VendorOrder = {
  id: string;
  number: string;
  job: string;
  response: "issued" | "accepted" | "declined";
  amountCents: number;
  lines: { costCode: string; description: string; amountCents: number }[];
  plans: { documentId: string; name: string }[];
};

export type VendorPortalHome = {
  company: string;
  vendorName: string;
  today: string;
  openPos: number;
  commitmentCents: number;
  billedCents: number;
  paidCents: number;
  orders: VendorOrder[];
  schedule: { id: string; title: string; startDate: string; endDate: string; startTime: string | null; job: string; address: string }[];
  punch: { id: string; title: string; location: string; dueDate: string | null; status: string; statusLabel: string }[];
  bills: {
    id: string;
    number: string;
    billDate: string | null;
    amountCents: number;
    paidCents: number;
    retainedCents: number;
    releasedCents: number;
    status: string;
    statusLabel: string;
    paidOn: string | null;
  }[];
  certificates: { type: string; label: string; statusLabel: string; state: string; expiresOn: string; documentId: string | null }[];
};

export type VendorOffice = {
  contactId: string;
  showMoney: false;
  canEdit: boolean;
  hasPortal: boolean;
  today: string;
  rollup: CertStatus;
  certificates: VendorPortalHome["certificates"];
};

function roleOf(actor: Actor): Role {
  return actor.role as Role;
}

function writeAudit(
  tx: AppDatabase,
  orgId: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown> | null,
  ip?: string,
) {
  tx.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType,
      entityId,
      payloadJson: payload ? JSON.stringify(payload) : null,
      ip: ip ?? null,
      createdAt: nowIso(),
    })
    .run();
}

function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function cleanName(value: string) {
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().replace(/\s+/g, " ");
  if (text.length < 2 || text.length > 80) throw new ServiceError("Type your name.");
  return text;
}

function cleanReason(value: string) {
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  if (text.length < 2 || text.length > 400) throw new ServiceError("Add a reason.");
  return text;
}

function statusLabel(status: string) {
  if (status === "draft") return "Draft";
  if (status === "approved") return "Approved";
  if (status === "paid") return "Paid";
  if (status === "done") return "Done";
  if (status === "verified") return "Verified";
  if (status === "open") return "Open";
  if (status === "accepted") return "Accepted";
  if (status === "declined") return "Declined";
  if (status === "issued") return "Issued";
  return status;
}

function responseOf(order: { acceptedAt: string | null; declinedAt: string | null }): VendorOrder["response"] {
  if (order.declinedAt) return "declined";
  if (order.acceptedAt) return "accepted";
  return "issued";
}

function attemptCount(db: AppDatabase, orgId: string, since: string, ip?: string) {
  return db
    .select()
    .from(vendorPortalAttempts)
    .where(eq(vendorPortalAttempts.orgId, orgId))
    .all()
    .filter((row) => row.createdAt >= since && (!ip || row.ip === ip)).length;
}

function guardWrite(db: AppDatabase, orgId: string, ip: string, nowMs: number) {
  const at = new Date(nowMs).toISOString();
  const limited = rateLimitError({
    ipCount: attemptCount(db, orgId, new Date(nowMs - IP_WINDOW_MS).toISOString(), ip),
    orgCount: attemptCount(db, orgId, new Date(nowMs - ORG_WINDOW_MS).toISOString()),
  });
  if (limited) throw new ServiceError(limited);
  db.insert(vendorPortalAttempts).values({ id: id("vpa"), orgId, ip: ip.slice(0, 80) || "local", createdAt: at }).run();
}

function storeUpload(db: AppDatabase, orgId: string, projectId: string | null, contactId: string, upload: VendorUpload, kind: string) {
  const error = photoUploadError(upload.filename, upload.bytes);
  if (error) throw new ServiceError(error);
  const type = rasterImageType(upload.bytes);
  if (!type) throw new ServiceError("Use a JPEG, PNG, or WebP photo.");
  const documentId = id("doc");
  const ext = photoExtension(type);
  const relative = path.join("uploads", orgId, `${documentId}.${ext}`);
  const absolute = path.join(dataDir(), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, upload.bytes);
  const stem = path.basename(upload.filename).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80);
  db.insert(documents)
    .values({
      id: documentId,
      orgId,
      projectId,
      leadId: null,
      contactId,
      type: kind,
      filename: `${stem || "file"}.${ext}`,
      storagePath: relative,
      metadataJson: null,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy: null,
    })
    .run();
  return documentId;
}

type PortalCtx = {
  db: AppDatabase;
  orgId: string;
  contactId: string;
  orgName: string;
  vendorName: string;
  timeZone: string;
  required: string[];
};

function portalContext(token: string): PortalCtx | null {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const db = getDb();
  const portal = db.select().from(vendorPortals).where(eq(vendorPortals.tokenHash, hashVendorToken(trimmed))).get();
  if (!portal || !vendorTokenMatches(trimmed, portal.tokenHash)) return null;
  const contact = db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, portal.contactId), eq(contacts.orgId, portal.orgId)))
    .get();
  if (!contact || contact.deletedAt || !VENDOR_TYPES.has(contact.type)) return null;
  const org = db.select().from(organizations).where(eq(organizations.id, portal.orgId)).get();
  if (!org) return null;
  return {
    db,
    orgId: portal.orgId,
    contactId: contact.id,
    orgName: org.name,
    vendorName: contact.company?.trim() || contact.name,
    timeZone: org.timeZone,
    required: parseRequiredTypes(org.vendorRequiredTypes),
  };
}

function requirePortal(token: string, ip: string, nowMs = Date.now()): PortalCtx {
  const ctx = portalContext(token);
  if (!ctx) throw new ServiceError("Portal not found.");
  guardWrite(ctx.db, ctx.orgId, ip, nowMs);
  return ctx;
}

function vendorContact(db: AppDatabase, orgId: string, contactId: string) {
  const contact = db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId))).get();
  if (!contact || contact.deletedAt || !VENDOR_TYPES.has(contact.type)) return null;
  return contact;
}

function certRows(db: AppDatabase, orgId: string, contactId: string) {
  return db
    .select()
    .from(vendorCertificates)
    .where(and(eq(vendorCertificates.orgId, orgId), eq(vendorCertificates.contactId, contactId)))
    .all();
}

function orgToday(db: AppDatabase, orgId: string, now = Date.now()) {
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  return localDay(now, org?.timeZone || "America/New_York");
}

export function assertVendorPoIssue(orgId: string, vendorContactId: string, now = Date.now()): string | null {
  const db = getDb();
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) throw new ServiceError("Company not found.");
  const today = localDay(now, org.timeZone);
  const certs = certRows(db, orgId, vendorContactId).map((row) => ({ type: row.type, expiresOn: row.expiresOn }));
  const decision = poIssueDecision(parseComplianceMode(org.vendorComplianceMode), poIssueProblems(parseRequiredTypes(org.vendorRequiredTypes), certs, today));
  if (decision.error) throw new ServiceError(decision.error);
  return decision.warning;
}

export function setVendorCompliance(actor: Actor, mode: string, required: string[]) {
  if (!canManageSettings(roleOf(actor))) throw new ServiceError("Only an owner or admin can change this.");
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  const types = required.filter(isCertType);
  const stored = CERT_TYPES.map((row) => row.id).filter((id) => types.includes(id)).join(",");
  const next = parseComplianceMode(mode);
  db.update(organizations)
    .set({ vendorComplianceMode: next, vendorRequiredTypes: stored, updatedAt: nowIso() })
    .where(eq(organizations.id, actor.orgId))
    .run();
  writeAudit(db, actor.orgId, actor.userId, "vendor.compliance", "organization", actor.orgId, { mode: next, required: stored });
}

export function rotateVendorPortal(actor: Actor, contactId: string): string {
  if (!canEditCrm(roleOf(actor))) throw new ServiceError("Your role cannot create a vendor link.");
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  const contact = vendorContact(db, actor.orgId, contactId);
  if (!contact) throw new ServiceError("Vendor not found.");
  const secret = newVendorSecret();
  const now = nowIso();
  const existing = db
    .select()
    .from(vendorPortals)
    .where(and(eq(vendorPortals.orgId, actor.orgId), eq(vendorPortals.contactId, contact.id)))
    .get();
  if (existing) {
    db.update(vendorPortals)
      .set({ tokenHash: secret.tokenHash, rotatedAt: now })
      .where(and(eq(vendorPortals.id, existing.id), eq(vendorPortals.orgId, actor.orgId)))
      .run();
  } else {
    db.insert(vendorPortals)
      .values({ id: id("vport"), orgId: actor.orgId, contactId: contact.id, tokenHash: secret.tokenHash, createdAt: now, rotatedAt: null })
      .run();
  }
  writeAudit(db, actor.orgId, actor.userId, "vendor.portal", "contact", contact.id, { rotated: Boolean(existing) });
  return secret.token;
}

export function vendorHasPortal(orgId: string, contactId: string) {
  const db = officeDb(orgId);
  if (!db) return false;
  return Boolean(
    db.select({ id: vendorPortals.id }).from(vendorPortals).where(and(eq(vendorPortals.orgId, orgId), eq(vendorPortals.contactId, contactId))).get(),
  );
}

function presentCerts(
  rows: { type: string; expiresOn: string; documentId: string | null }[],
  today: string,
  required: string[],
): VendorPortalHome["certificates"] {
  const shown = CERT_TYPES.filter((type) => required.includes(type.id) || rows.some((row) => row.type === type.id));
  return shown.map((type) => {
    const row = rows.find((item) => item.type === type.id);
    const status = certificateStatus(row?.expiresOn, today);
    return {
      type: type.id,
      label: type.label,
      statusLabel: row ? status.label : "Missing",
      state: row ? status.state : "missing",
      expiresOn: row?.expiresOn ?? "",
      documentId: row?.documentId ?? null,
    };
  });
}

export function vendorOffice(actor: Actor, contactId: string): VendorOffice | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const contact = vendorContact(db, actor.orgId, contactId);
  if (!contact) return null;
  const today = orgToday(db, actor.orgId);
  const rows = certRows(db, actor.orgId, contact.id);
  const required = parseRequiredTypes(db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get()?.vendorRequiredTypes);
  const rollup = vendorRollup(required, rows, today);
  return {
    contactId: contact.id,
    showMoney: false,
    canEdit: canEditCrm(roleOf(actor)),
    hasPortal: vendorHasPortal(actor.orgId, contact.id),
    today,
    rollup,
    certificates: presentCerts(rows, today, required),
  };
}

export function complianceByContact(orgId: string): Record<string, CertStatus> {
  const db = officeDb(orgId);
  if (!db) return {};
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) return {};
  const today = localDay(Date.now(), org.timeZone);
  const required = parseRequiredTypes(org.vendorRequiredTypes);
  const people = db.select().from(contacts).where(eq(contacts.orgId, orgId)).all().filter((row) => !row.deletedAt && VENDOR_TYPES.has(row.type));
  const certs = db.select().from(vendorCertificates).where(eq(vendorCertificates.orgId, orgId)).all();
  const out: Record<string, CertStatus> = {};
  for (const person of people) {
    out[person.id] = vendorRollup(
      required,
      certs.filter((row) => row.contactId === person.id),
      today,
    );
  }
  return out;
}

export function vendorBillQueue(orgId: string): { count: number; href: string | null } {
  const db = officeDb(orgId);
  if (!db) return { count: 0, href: null };
  const rows = db
    .select()
    .from(bills)
    .where(eq(bills.orgId, orgId))
    .all()
    .filter((row) => row.portalSubmitted === 1 && row.status === "draft")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (rows.length === 0) return { count: 0, href: null };
  return { count: rows.length, href: `/bills/${rows[0].id}` };
}

export function vendorCertificateQueue(orgId: string): { count: number; href: string | null } {
  const db = officeDb(orgId);
  if (!db) return { count: 0, href: null };
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) return { count: 0, href: null };
  const today = localDay(Date.now(), org.timeZone);
  const people = db.select().from(contacts).where(eq(contacts.orgId, orgId)).all().filter((row) => !row.deletedAt && VENDOR_TYPES.has(row.type));
  const certs = db.select().from(vendorCertificates).where(eq(vendorCertificates.orgId, orgId)).all();
  const hits = people
    .map((person) => {
      const rows = certs.filter((row) => row.contactId === person.id);
      return { id: person.id, days: soonestCertificateDays(rows, today), attention: certificateNeedsAttention(rows, today) };
    })
    .filter((row) => row.attention)
    .sort((a, b) => (a.days ?? 99) - (b.days ?? 99));
  if (hits.length === 0) return { count: 0, href: null };
  return { count: hits.length, href: `/contacts/${hits[0].id}` };
}

export function vendorPortal(token: string): VendorPortalHome | null {
  const ctx = portalContext(token);
  if (!ctx) return null;
  const { db, orgId, contactId } = ctx;
  const today = localDay(Date.now(), ctx.timeZone);
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row]));
  const orders = db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.vendorContactId, contactId)))
    .all()
    .filter((row) => row.status === "issued");
  const orderIds = new Set(orders.map((row) => row.id));
  const poLines = db
    .select()
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.orgId, orgId))
    .all()
    .filter((row) => orderIds.has(row.purchaseOrderId));
  const vendorBills = db
    .select()
    .from(bills)
    .where(and(eq(bills.orgId, orgId), eq(bills.vendorContactId, contactId)))
    .all()
    .filter((row) => row.status !== "void");
  const billIds = new Set(vendorBills.map((row) => row.id));
  const lines = db
    .select()
    .from(billLines)
    .where(eq(billLines.orgId, orgId))
    .all()
    .filter((row) => billIds.has(row.billId));
  const openOrders = orders.filter((row) => !row.declinedAt);
  let commitmentCents = 0;
  for (const order of openOrders) {
    const relieved = vendorBills
      .filter((bill) => bill.purchaseOrderId === order.id && RELIEVING.has(bill.status) && bill.kind !== "release")
      .flatMap((bill) => lines.filter((line) => line.billId === bill.id));
    commitmentCents += openCommitmentByCode(
      poLines.filter((line) => line.purchaseOrderId === order.id),
      relieved,
    ).reduce((sum, row) => sum + row.amountCents, 0);
  }
  const schedule = db
    .select({ item: scheduleItems, name: projects.name, address: projects.address })
    .from(scheduleItems)
    .innerJoin(projects, and(eq(projects.id, scheduleItems.projectId), eq(projects.orgId, scheduleItems.orgId)))
    .where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.vendorContactId, contactId)))
    .all()
    .sort((a, b) => a.item.startDate.localeCompare(b.item.startDate) || a.item.title.localeCompare(b.item.title));
  const punch = db
    .select()
    .from(punchItems)
    .where(and(eq(punchItems.orgId, orgId), eq(punchItems.assigneeContactId, contactId)))
    .all()
    .sort((a, b) => a.title.localeCompare(b.title));
  const certs = certRows(db, orgId, contactId);
  return {
    company: ctx.orgName,
    vendorName: ctx.vendorName,
    today,
    openPos: openOrders.length,
    commitmentCents,
    billedCents: vendorBills.filter((row) => row.kind !== "release").reduce((sum, row) => sum + row.amountCents, 0),
    paidCents: vendorBills
      .filter((row) => row.status === "paid")
      .reduce((sum, row) => sum + netPayableCents(row.amountCents, row.retainageCents, row.kind === "release" ? "release" : "standard"), 0),
    orders: orders
      .sort((a, b) => a.number.localeCompare(b.number))
      .map((order) => ({
        id: order.id,
        number: order.number,
        job: jobs.get(order.projectId)?.name ?? "Job",
        response: responseOf(order),
        amountCents: poLines.filter((line) => line.purchaseOrderId === order.id).reduce((sum, line) => sum + line.amountCents, 0),
        lines: poLines
          .filter((line) => line.purchaseOrderId === order.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((line) => ({ costCode: line.costCode, description: line.description ?? "", amountCents: line.amountCents })),
        plans: targetPlans(db, orgId, "purchase_order", order.id).map((plan) => ({ documentId: plan.documentId, name: plan.name })),
      })),
    schedule: schedule.map((row) => ({
      id: row.item.id,
      title: row.item.title,
      startDate: row.item.startDate,
      endDate: row.item.endDate,
      startTime: row.item.startTime,
      job: row.name,
      address: row.address ?? "",
    })),
    punch: punch.map((row) => ({
      id: row.id,
      title: row.title,
      location: row.location ?? "",
      dueDate: row.dueDate,
      status: row.status,
      statusLabel: statusLabel(row.status),
    })),
    bills: vendorBills
      .sort((a, b) => (b.billDate ?? "").localeCompare(a.billDate ?? "") || b.createdAt.localeCompare(a.createdAt))
      .map((row) => ({
        id: row.id,
        number: row.billNumber,
        billDate: row.billDate,
        amountCents: row.amountCents,
        paidCents: row.status === "paid" ? netPayableCents(row.amountCents, row.retainageCents, row.kind === "release" ? "release" : "standard") : 0,
        retainedCents: row.kind === "release" ? 0 : row.retainageCents,
        releasedCents: row.kind === "release" ? row.amountCents : 0,
        status: row.status,
        statusLabel: statusLabel(row.status),
        paidOn: row.status === "paid" ? row.paidAt?.slice(0, 10) ?? null : null,
      })),
    certificates: presentCerts(certs, today, ctx.required),
  };
}

function issuedOrder(ctx: PortalCtx, purchaseOrderId: string) {
  const order = ctx.db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.orgId, ctx.orgId), eq(purchaseOrders.vendorContactId, ctx.contactId)))
    .get();
  if (!order || order.status !== "issued") throw new ServiceError("Purchase order not found.");
  return order;
}

export function acceptVendorPo(input: { token: string; purchaseOrderId: string; name: string; ip: string }) {
  const ctx = requirePortal(input.token, input.ip);
  const order = issuedOrder(ctx, input.purchaseOrderId);
  if (order.declinedAt) throw new ServiceError("This purchase order was declined.");
  if (order.acceptedAt) return { id: order.id };
  const name = cleanName(input.name);
  const now = nowIso();
  ctx.db.transaction((tx) => {
    tx.update(purchaseOrders)
      .set({ acceptedAt: now, acceptedName: name, updatedAt: now })
      .where(and(eq(purchaseOrders.id, order.id), eq(purchaseOrders.orgId, ctx.orgId)))
      .run();
    tx.insert(purchaseOrderEvents)
      .values({
        id: id("poe"),
        orgId: ctx.orgId,
        purchaseOrderId: order.id,
        actorId: null,
        type: "accepted",
        reason: name,
        beforeJson: null,
        afterJson: JSON.stringify({ acceptedName: name }),
        createdAt: now,
      })
      .run();
    writeAudit(tx, ctx.orgId, null, "vendor.po.accept", "purchase_order", order.id, { number: order.number }, input.ip);
  });
  return { id: order.id };
}

export function declineVendorPo(input: { token: string; purchaseOrderId: string; reason: string; ip: string }) {
  const ctx = requirePortal(input.token, input.ip);
  const order = issuedOrder(ctx, input.purchaseOrderId);
  if (order.acceptedAt) throw new ServiceError("This purchase order was accepted.");
  if (order.declinedAt) return { id: order.id };
  const reason = cleanReason(input.reason);
  const now = nowIso();
  ctx.db.transaction((tx) => {
    tx.update(purchaseOrders)
      .set({ declinedAt: now, declineReason: reason, updatedAt: now })
      .where(and(eq(purchaseOrders.id, order.id), eq(purchaseOrders.orgId, ctx.orgId)))
      .run();
    tx.insert(purchaseOrderEvents)
      .values({
        id: id("poe"),
        orgId: ctx.orgId,
        purchaseOrderId: order.id,
        actorId: null,
        type: "declined",
        reason,
        beforeJson: null,
        afterJson: JSON.stringify({ status: "declined" }),
        createdAt: now,
      })
      .run();
    writeAudit(tx, ctx.orgId, null, "vendor.po.decline", "purchase_order", order.id, { number: order.number }, input.ip);
  });
  return { id: order.id };
}

export function submitVendorBill(input: {
  token: string;
  ip: string;
  purchaseOrderId: string;
  billNumber: string;
  billDate: string;
  dueDate: string;
  lines: { costCode: string; amountCents: number }[];
  file?: VendorUpload | null;
}): { id: string; warning: string | null } {
  const ctx = requirePortal(input.token, input.ip);
  const order = issuedOrder(ctx, input.purchaseOrderId);
  if (order.declinedAt) throw new ServiceError("This purchase order was declined.");
  if (!order.acceptedAt) throw new ServiceError("Accept the purchase order first.");
  const billNumber = normalizeBillNumber(input.billNumber);
  if (billNumber.length < 1 || billNumber.length > 40) throw new ServiceError("Enter the bill number.");
  if (!validDay(input.billDate)) throw new ServiceError("Enter the bill date.");
  const dueDate = input.dueDate.trim() || input.billDate;
  if (!validDay(dueDate)) throw new ServiceError("Enter the due date.");
  const poLines = ctx.db
    .select()
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.purchaseOrderId, order.id), eq(purchaseOrderLines.orgId, ctx.orgId)))
    .all();
  const allowed = new Set(poLines.map((line) => line.costCode));
  const cleaned = input.lines
    .map((line) => ({ costCode: line.costCode.trim().toUpperCase(), amountCents: line.amountCents }))
    .filter((line) => line.costCode || line.amountCents);
  if (cleaned.length === 0) throw new ServiceError("Add an amount.");
  for (const line of cleaned) {
    if (!allowed.has(line.costCode)) throw new ServiceError("Use a cost code on the purchase order.");
    const amountError = positiveMoneyError(line.amountCents);
    if (amountError) throw new ServiceError(amountError);
  }
  if (duplicateBill(ctx.orgId, ctx.contactId, billNumber)) throw new ServiceError(`Bill ${billNumber} is already on file.`);
  const documentId = input.file && input.file.bytes.length > 0 ? storeUpload(ctx.db, ctx.orgId, order.projectId, ctx.contactId, input.file, "bill") : null;
  const prior = ctx.db
    .select()
    .from(bills)
    .where(and(eq(bills.orgId, ctx.orgId), eq(bills.purchaseOrderId, order.id)))
    .all()
    .filter((row) => RELIEVING.has(row.status) && row.kind !== "release");
  const priorIds = new Set(prior.map((row) => row.id));
  const priorLines = ctx.db
    .select()
    .from(billLines)
    .where(eq(billLines.orgId, ctx.orgId))
    .all()
    .filter((row) => priorIds.has(row.billId));
  const overs = overageByCode(poLines, priorLines, cleaned);
  const warning = overs.length
    ? `This bill is past ${order.number}: ${overs.map((row) => `${formatMoney(row.overCents)} over on ${row.code}`).join(", ")}. It was still saved.`
    : null;
  const billId = id("bill");
  const now = nowIso();
  const amountCents = cleaned.reduce((sum, line) => sum + line.amountCents, 0);
  ctx.db.transaction((tx) => {
    tx.insert(bills)
      .values({
        id: billId,
        orgId: ctx.orgId,
        projectId: order.projectId,
        vendorContactId: ctx.contactId,
        billNumber,
        billDate: input.billDate,
        amountCents,
        dueDate,
        status: "draft",
        memo: null,
        voidReason: null,
        paidAt: null,
        payMethod: null,
        payReference: null,
        documentId,
        purchaseOrderId: order.id,
        approvedAt: null,
        lowConfidence: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        portalSubmitted: 1,
        retainageCents: retainedCents(amountCents, order.retainageBps),
        kind: "standard",
      })
      .run();
    cleaned.forEach((line, index) => {
      const source = poLines.find((row) => row.costCode === line.costCode);
      tx.insert(billLines)
        .values({
          id: id("bln"),
          orgId: ctx.orgId,
          billId,
          costCode: line.costCode,
          description: source?.description ?? null,
          amountCents: line.amountCents,
          costItemId: null,
          sortOrder: index,
        })
        .run();
    });
    tx.insert(billEvents)
      .values({ id: id("bev"), orgId: ctx.orgId, billId, actorId: null, type: "created", reason: "portal", beforeJson: null, afterJson: null, createdAt: now })
      .run();
    writeAudit(tx, ctx.orgId, null, "vendor.bill", "bill", billId, { number: billNumber, purchaseOrderId: order.id, status: "draft" }, input.ip);
  });
  return { id: billId, warning };
}

export function markVendorPunch(input: { token: string; ip: string; itemId: string; photo?: VendorUpload | null }) {
  const ctx = requirePortal(input.token, input.ip);
  const item = ctx.db
    .select()
    .from(punchItems)
    .where(and(eq(punchItems.id, input.itemId), eq(punchItems.orgId, ctx.orgId), eq(punchItems.assigneeContactId, ctx.contactId)))
    .get();
  if (!item) throw new ServiceError("Punch item not found.");
  if (item.status === "verified") throw new ServiceError("The office already verified this.");
  if (item.status === "done") return { id: item.id };
  const documentId = input.photo && input.photo.bytes.length > 0 ? storeUpload(ctx.db, ctx.orgId, item.projectId, ctx.contactId, input.photo, "photo") : item.afterDocumentId;
  const now = nowIso();
  ctx.db.transaction((tx) => {
    tx.update(punchItems)
      .set({ status: "done", doneAt: now, afterDocumentId: documentId, updatedAt: now })
      .where(and(eq(punchItems.id, item.id), eq(punchItems.orgId, ctx.orgId)))
      .run();
    writeAudit(tx, ctx.orgId, null, "vendor.punch.done", "punch_item", item.id, { from: item.status, status: "done" }, input.ip);
  });
  return { id: item.id };
}

function upsertCertificate(db: AppDatabase, orgId: string, contactId: string, type: CertType, expiresOn: string, documentId: string | null, actorId: string | null, ip: string | undefined) {
  if (!validDay(expiresOn)) throw new ServiceError("Enter the expiration date.");
  const existing = db
    .select()
    .from(vendorCertificates)
    .where(and(eq(vendorCertificates.orgId, orgId), eq(vendorCertificates.contactId, contactId), eq(vendorCertificates.type, type)))
    .get();
  const now = nowIso();
  const certId = existing?.id ?? id("vcert");
  if (existing) {
    db.update(vendorCertificates)
      .set({ expiresOn, documentId: documentId ?? existing.documentId, updatedAt: now })
      .where(and(eq(vendorCertificates.id, existing.id), eq(vendorCertificates.orgId, orgId)))
      .run();
    if (documentId && existing.documentId && existing.documentId !== documentId) {
      db.update(documents).set({ deletedAt: now }).where(and(eq(documents.id, existing.documentId), eq(documents.orgId, orgId))).run();
    }
  } else {
    db.insert(vendorCertificates)
      .values({ id: certId, orgId, contactId, type, expiresOn, documentId, createdAt: now, updatedAt: now })
      .run();
  }
  writeAudit(db, orgId, actorId, "vendor.certificate", "vendor_certificate", certId, { type, expiresOn }, ip);
  return certId;
}

export function saveVendorCertificate(input: { token: string; ip: string; type: string; expiresOn: string; file?: VendorUpload | null }) {
  const ctx = requirePortal(input.token, input.ip);
  if (!isCertType(input.type)) throw new ServiceError("Pick a certificate type.");
  const documentId = input.file && input.file.bytes.length > 0 ? storeUpload(ctx.db, ctx.orgId, null, ctx.contactId, input.file, "certificate") : null;
  if (!documentId) {
    const existing = certRows(ctx.db, ctx.orgId, ctx.contactId).find((row) => row.type === input.type);
    if (!existing) throw new ServiceError("Choose a file.");
  }
  return { id: upsertCertificate(ctx.db, ctx.orgId, ctx.contactId, input.type, input.expiresOn, documentId, null, input.ip) };
}

export function saveOfficeCertificate(actor: Actor, contactId: string, type: string, expiresOn: string, file?: VendorUpload | null) {
  if (!canEditCrm(roleOf(actor))) throw new ServiceError("Your role cannot change certificates.");
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  const contact = vendorContact(db, actor.orgId, contactId);
  if (!contact) throw new ServiceError("Vendor not found.");
  if (!isCertType(type)) throw new ServiceError("Pick a certificate type.");
  const documentId = file && file.bytes.length > 0 ? storeUpload(db, actor.orgId, null, contact.id, file, "certificate") : null;
  if (!documentId && !certRows(db, actor.orgId, contact.id).some((row) => row.type === type)) throw new ServiceError("Choose a file.");
  return { id: upsertCertificate(db, actor.orgId, contact.id, type, expiresOn, documentId, actor.userId, undefined) };
}

export function vendorFileAllowed(token: string, documentId: string): boolean {
  const ctx = portalContext(token);
  if (!ctx) return false;
  const document = ctx.db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.orgId, ctx.orgId))).get();
  if (!document || document.deletedAt) return false;
  if (document.contactId === ctx.contactId) return true;
  const punch = ctx.db
    .select()
    .from(punchItems)
    .where(and(eq(punchItems.orgId, ctx.orgId), eq(punchItems.assigneeContactId, ctx.contactId)))
    .all();
  if (punch.some((row) => row.afterDocumentId === document.id || row.beforeDocumentId === document.id)) return true;
  const bill = ctx.db
    .select()
    .from(bills)
    .where(and(eq(bills.orgId, ctx.orgId), eq(bills.vendorContactId, ctx.contactId), eq(bills.documentId, document.id)))
    .get();
  if (bill) return true;
  const invited = ctx.db
    .select()
    .from(bidInvites)
    .where(and(eq(bidInvites.orgId, ctx.orgId), eq(bidInvites.contactId, ctx.contactId)))
    .all();
  if (invited.some((row) => row.documentId === document.id)) return true;
  const submittalFile = ctx.db
    .select({ id: submittalFiles.id })
    .from(submittalFiles)
    .innerJoin(submittals, and(eq(submittals.id, submittalFiles.submittalId), eq(submittals.orgId, ctx.orgId)))
    .where(
      and(
        eq(submittalFiles.orgId, ctx.orgId),
        eq(submittalFiles.documentId, document.id),
        eq(submittals.assigneeKind, "vendor"),
        eq(submittals.assigneeContactId, ctx.contactId),
      ),
    )
    .get();
  if (submittalFile) return true;
  const bidIds = new Set(invited.map((row) => row.bidId));
  const attachment = ctx.db
    .select()
    .from(bidFiles)
    .where(and(eq(bidFiles.orgId, ctx.orgId), eq(bidFiles.documentId, document.id)))
    .get();
  if (attachment && bidIds.has(attachment.bidId)) return true;
  return vendorMayReadJobFile(ctx.db, ctx.orgId, ctx.contactId, document.id);
}

export function vendorMoneyHiddenFrom(role: Role) {
  return !canSeeMoney(role);
}
