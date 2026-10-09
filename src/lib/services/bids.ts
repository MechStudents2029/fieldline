import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dueWithinThreeDays, extendCents, lowVendorIds, requestStatusLabel, varianceCents, vendorCanRevise } from "@/lib/bids/math";
import { dataDir, getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  activities,
  auditLogs,
  bidAwards,
  bidFiles,
  bidInvites,
  bidLines,
  bidPrices,
  bidRequests,
  budgetLines,
  contacts,
  documents,
  organizations,
  projects,
  purchaseOrderEvents,
  purchaseOrderLines,
  purchaseOrders,
  vendorCertificates,
  vendorPortalAttempts,
  vendorPortals,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { IP_WINDOW_MS, ORG_WINDOW_MS, rateLimitError } from "@/lib/lead-form/rules";
import { MAX_QTY, positiveMoneyError } from "@/lib/money";
import { canManageMoney, canSeeMoney, type Role } from "@/lib/permissions";
import { photoExtension, photoUploadError, rasterImageType } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import { targetPlans } from "@/lib/services/files";
import type { Actor } from "@/lib/services/read";
import { localDay } from "@/lib/time/calendar";
import { parseComplianceMode, parseRequiredTypes, poIssueDecision, poIssueProblems, vendorRollup, type CertStatus } from "@/lib/vendor/compliance";
import { hashVendorToken, vendorTokenMatches } from "@/lib/vendor/token";

const VENDOR_TYPES = new Set(["sub", "vendor"]);

export type BidLineInput = {
  costCode: string;
  description: string;
  qtyMilli: number;
  unit: string;
  budgetLineId?: string | null;
};

export type BidUpload = { filename: string; bytes: Buffer };

export type BidPriceInput = { bidLineId: string; unitPriceCents: number | null; noBid: boolean };

type Writer = AppDatabase;

export type BidSummary = {
  id: string;
  title: string;
  dueOn: string;
  status: string;
  statusLabel: string;
};

export type BidComposer = {
  projectId: string;
  projectName: string;
  canEdit: boolean;
  showMoney: boolean;
  lines: { budgetLineId: string; name: string; costCode: string; qtyMilli: number; unit: string }[];
  vendors: { id: string; name: string }[];
  bids: BidSummary[];
};

export type BidVendorColumn = {
  inviteId: string;
  contactId: string;
  name: string;
  status: string;
  statusLabel: string;
  compliance: CertStatus;
  blocked: boolean;
  totalCents: number | null;
  prices: {
    lineId: string;
    unitPriceCents: number | null;
    amountCents: number | null;
    noBid: boolean;
    low: boolean;
    varianceCents: number | null;
  }[];
};

export type BidComparison = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  scope: string;
  dueOn: string;
  status: string;
  statusLabel: string;
  showMoney: boolean;
  canEdit: boolean;
  lines: {
    id: string;
    costCode: string;
    description: string;
    qtyMilli: number;
    unit: string;
    budgetLineId: string | null;
    budgetCents: number | null;
  }[];
  vendors: BidVendorColumn[];
  purchaseOrders: { id: string; number: string }[];
  files: { id: string; filename: string }[];
};

export type VendorBidCard = {
  id: string;
  title: string;
  scope: string;
  job: string;
  address: string;
  dueOn: string;
  statusLabel: string;
  editable: boolean;
  response: string;
  responseLabel: string;
  note: string;
  name: string;
  lines: {
    id: string;
    costCode: string;
    description: string;
    qtyMilli: number;
    unit: string;
    unitPriceCents: number | null;
    noBid: boolean;
  }[];
  files: { id: string; filename: string }[];
  plans: { id: string; filename: string }[];
};

function roleOf(actor: Actor): Role {
  return actor.role as Role;
}

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function assertOffice(actor: Actor) {
  if (!canManageMoney(roleOf(actor))) throw new ServiceError("Bids are for the office.");
}

function writeAudit(
  tx: Writer,
  orgId: string,
  actorId: string | null,
  action: string,
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
      entityType: "bid",
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

function cleanTitle(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 2 || text.length > 120) throw new ServiceError("Add a title.");
  return text;
}

function cleanScope(value: string | undefined) {
  const text = value?.trim() || "";
  if (text.length > 2000) throw new ServiceError("Keep the scope under 2,000 characters.");
  return text;
}

function cleanUnit(value: string) {
  const unit = value.trim().slice(0, 16);
  return unit || "ea";
}

function cleanLines(lines: BidLineInput[]) {
  const cleaned = lines
    .map((line) => ({
      costCode: line.costCode.trim().toUpperCase(),
      description: line.description.trim().slice(0, 200),
      qtyMilli: line.qtyMilli,
      unit: cleanUnit(line.unit),
      budgetLineId: line.budgetLineId || null,
    }))
    .filter((line) => line.costCode || line.description);
  if (cleaned.length === 0) throw new ServiceError("Add a line.");
  for (const line of cleaned) {
    if (!line.costCode) throw new ServiceError("Each line needs a cost code.");
    if (!line.description) line.description = line.costCode;
    if (!Number.isSafeInteger(line.qtyMilli) || line.qtyMilli <= 0 || line.qtyMilli > MAX_QTY * 1000) {
      throw new ServiceError("Enter a quantity.");
    }
  }
  return cleaned;
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

function inviteLabel(status: string) {
  if (status === "invited") return "Invited";
  if (status === "submitted") return "Submitted";
  if (status === "needs_revision") return "Needs revision";
  if (status === "declined") return "Declined";
  if (status === "awarded") return "Awarded";
  if (status === "lost") return "Lost";
  return status;
}

function vendorName(contact: { name: string; company: string | null }) {
  return contact.company?.trim() || contact.name;
}

function requireProject(db: Writer, orgId: string, projectId: string) {
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  return project;
}

function requireVendor(db: Writer, orgId: string, contactId: string) {
  const contact = db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId))).get();
  if (!contact || contact.deletedAt || !VENDOR_TYPES.has(contact.type)) {
    throw new ServiceError("Pick a subcontractor or vendor in this company.");
  }
  return contact;
}

function loadBid(db: Writer, orgId: string, bidId: string) {
  return db.select().from(bidRequests).where(and(eq(bidRequests.id, bidId), eq(bidRequests.orgId, orgId))).get();
}

function orgRow(db: Writer, orgId: string) {
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) throw new ServiceError("Company not found.");
  return org;
}

function linesFor(db: Writer, orgId: string, bidId: string) {
  return db
    .select()
    .from(bidLines)
    .where(and(eq(bidLines.orgId, orgId), eq(bidLines.bidId, bidId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.costCode.localeCompare(b.costCode));
}

function invitesFor(db: Writer, orgId: string, bidId: string) {
  return db.select().from(bidInvites).where(and(eq(bidInvites.orgId, orgId), eq(bidInvites.bidId, bidId))).all();
}

function pricesFor(db: Writer, orgId: string, inviteIds: string[]) {
  if (inviteIds.length === 0) return [];
  const wanted = new Set(inviteIds);
  return db
    .select()
    .from(bidPrices)
    .where(eq(bidPrices.orgId, orgId))
    .all()
    .filter((row) => wanted.has(row.inviteId));
}

function statusOf(bid: { status: string }, invites: { status: string }[]) {
  const submitted = invites.filter((row) => row.status === "submitted" || row.status === "awarded").length;
  return requestStatusLabel(bid.status, submitted, invites.length);
}

function storeUpload(db: Writer, orgId: string, projectId: string | null, contactId: string | null, upload: BidUpload, kind: string) {
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

function attemptCount(db: Writer, orgId: string, since: string, ip?: string) {
  return db
    .select()
    .from(vendorPortalAttempts)
    .where(eq(vendorPortalAttempts.orgId, orgId))
    .all()
    .filter((row) => row.createdAt >= since && (!ip || row.ip === ip)).length;
}

function guardWrite(db: Writer, orgId: string, ip: string, nowMs: number) {
  const at = new Date(nowMs).toISOString();
  const limited = rateLimitError({
    ipCount: attemptCount(db, orgId, new Date(nowMs - IP_WINDOW_MS).toISOString(), ip),
    orgCount: attemptCount(db, orgId, new Date(nowMs - ORG_WINDOW_MS).toISOString()),
  });
  if (limited) throw new ServiceError(limited);
  db.insert(vendorPortalAttempts).values({ id: id("vpa"), orgId, ip: ip.slice(0, 80) || "local", createdAt: at }).run();
}

function portal(token: string) {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const db = getDb();
  const row = db.select().from(vendorPortals).where(eq(vendorPortals.tokenHash, hashVendorToken(trimmed))).get();
  if (!row || !vendorTokenMatches(trimmed, row.tokenHash)) return null;
  const contact = db.select().from(contacts).where(and(eq(contacts.id, row.contactId), eq(contacts.orgId, row.orgId))).get();
  if (!contact || contact.deletedAt || !VENDOR_TYPES.has(contact.type)) return null;
  const org = db.select().from(organizations).where(eq(organizations.id, row.orgId)).get();
  if (!org) return null;
  return { db, org, contact };
}

function compliance(db: Writer, org: typeof organizations.$inferSelect, contactId: string, today: string) {
  const certs = db
    .select()
    .from(vendorCertificates)
    .where(and(eq(vendorCertificates.orgId, org.id), eq(vendorCertificates.contactId, contactId)))
    .all()
    .map((row) => ({ type: row.type, expiresOn: row.expiresOn }));
  const required = parseRequiredTypes(org.vendorRequiredTypes);
  const rollup = vendorRollup(required, certs, today);
  const decision = poIssueDecision(parseComplianceMode(org.vendorComplianceMode), poIssueProblems(required, certs, today));
  return { rollup, decision, blocked: Boolean(decision.error) };
}

function insertLines(tx: Writer, orgId: string, bidId: string, lines: ReturnType<typeof cleanLines>) {
  lines.forEach((line, index) => {
    tx.insert(bidLines)
      .values({
        id: id("bln"),
        orgId,
        bidId,
        costCode: line.costCode,
        description: line.description,
        qtyMilli: line.qtyMilli,
        unit: line.unit,
        budgetLineId: line.budgetLineId,
        sortOrder: index,
      })
      .run();
  });
}

function nextPoBase(db: Writer, orgId: string) {
  const rows = db.select({ number: purchaseOrders.number }).from(purchaseOrders).where(eq(purchaseOrders.orgId, orgId)).all();
  let max = 1000;
  for (const row of rows) {
    const match = /^PO-(\d+)$/.exec(row.number);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

export function bidComposer(actor: Actor, projectId: string): BidComposer | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) return null;
  const showMoney = canSeeMoney(roleOf(actor));
  const bids = db
    .select()
    .from(bidRequests)
    .where(and(eq(bidRequests.orgId, actor.orgId), eq(bidRequests.projectId, projectId)))
    .all()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const inviteRows = db.select().from(bidInvites).where(eq(bidInvites.orgId, actor.orgId)).all();
  const summaries = bids.map((bid) => ({
    id: bid.id,
    title: bid.title,
    dueOn: bid.dueOn,
    status: bid.status,
    statusLabel: statusOf(bid, inviteRows.filter((row) => row.bidId === bid.id)),
  }));
  if (!showMoney) {
    return { projectId, projectName: project.name, canEdit: false, showMoney: false, lines: [], vendors: [], bids: summaries };
  }
  const budget = db
    .select()
    .from(budgetLines)
    .where(and(eq(budgetLines.orgId, actor.orgId), eq(budgetLines.projectId, projectId)))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const vendors = db
    .select()
    .from(contacts)
    .where(eq(contacts.orgId, actor.orgId))
    .all()
    .filter((row) => !row.deletedAt && VENDOR_TYPES.has(row.type))
    .map((row) => ({ id: row.id, name: vendorName(row) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    projectId,
    projectName: project.name,
    canEdit: canManageMoney(roleOf(actor)),
    showMoney: true,
    lines: budget.map((line) => ({
      budgetLineId: line.id,
      name: line.name,
      costCode: line.costCode || "",
      qtyMilli: 1000,
      unit: "ea",
    })),
    vendors,
    bids: summaries,
  };
}

export function createBid(
  actor: Actor,
  input: { projectId: string; title: string; scope?: string; dueOn: string; lines: BidLineInput[]; vendorContactIds: string[]; file?: BidUpload | null },
) {
  assertOffice(actor);
  const db = dbFor(actor);
  const project = requireProject(db, actor.orgId, input.projectId);
  if (!validDay(input.dueOn)) throw new ServiceError("Enter a due date.");
  const title = cleanTitle(input.title);
  const scope = cleanScope(input.scope);
  const budget = db.select().from(budgetLines).where(and(eq(budgetLines.orgId, actor.orgId), eq(budgetLines.projectId, project.id))).all();
  const hydrated = input.lines.map((line) => {
    if (!line.budgetLineId) return line;
    const row = budget.find((item) => item.id === line.budgetLineId);
    if (!row) throw new ServiceError("That line is on a different job.");
    return {
      ...line,
      costCode: line.costCode || row.costCode || "",
      description: line.description || row.name,
      budgetLineId: row.id,
    };
  });
  const lines = cleanLines(hydrated);
  const budgetIds = new Set(budget.map((row) => row.id));
  for (const line of lines) {
    if (line.budgetLineId && !budgetIds.has(line.budgetLineId)) throw new ServiceError("That line is on a different job.");
  }
  const vendors = [...new Set(input.vendorContactIds)].map((contactId) => requireVendor(db, actor.orgId, contactId));
  const bidId = id("bid");
  const now = nowIso();
  const status = vendors.length > 0 ? "out" : "draft";
  db.transaction((tx) => {
    tx.insert(bidRequests)
      .values({
        id: bidId,
        orgId: actor.orgId,
        projectId: project.id,
        title,
        scope: scope || null,
        dueOn: input.dueOn,
        status,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
        awardedAt: null,
        closedAt: null,
      })
      .run();
    insertLines(tx, actor.orgId, bidId, lines);
    if (input.file && input.file.bytes.length > 0) {
      const documentId = storeUpload(tx, actor.orgId, project.id, null, input.file, "bid");
      tx.insert(bidFiles).values({ id: id("bfile"), orgId: actor.orgId, bidId, documentId }).run();
    }
    for (const vendor of vendors) {
      tx.insert(bidInvites)
        .values({
          id: id("binv"),
          orgId: actor.orgId,
          bidId,
          contactId: vendor.id,
          status: "invited",
          note: null,
          submittedName: null,
          submittedAt: null,
          declinedAt: null,
          declineReason: null,
          documentId: null,
        })
        .run();
    }
    writeAudit(tx, actor.orgId, actor.userId, "bid.create", bidId, { title, vendors: vendors.map((row) => row.id) });
    if (vendors.length > 0) writeAudit(tx, actor.orgId, actor.userId, "bid.invite", bidId, { vendors: vendors.map((row) => row.id) });
  });
  return { id: bidId };
}

export function saveBidLines(actor: Actor, bidId: string, lines: BidLineInput[]) {
  assertOffice(actor);
  const db = dbFor(actor);
  const bid = loadBid(db, actor.orgId, bidId);
  if (!bid) throw new ServiceError("Bid not found.");
  if (bid.status === "awarded" || bid.status === "closed") throw new ServiceError("This bid can no longer be edited.");
  const cleaned = cleanLines(lines);
  const budgetIds = new Set(
    db.select().from(budgetLines).where(and(eq(budgetLines.orgId, actor.orgId), eq(budgetLines.projectId, bid.projectId))).all().map((row) => row.id),
  );
  for (const line of cleaned) {
    if (line.budgetLineId && !budgetIds.has(line.budgetLineId)) throw new ServiceError("That line is on a different job.");
  }
  const invites = invitesFor(db, actor.orgId, bid.id);
  const reset = invites.some((row) => row.status === "submitted" || row.status === "needs_revision");
  const now = nowIso();
  db.transaction((tx) => {
    const inviteIds = invites.map((row) => row.id);
    for (const inviteId of inviteIds) {
      tx.delete(bidPrices).where(and(eq(bidPrices.orgId, actor.orgId), eq(bidPrices.inviteId, inviteId))).run();
    }
    tx.delete(bidLines).where(and(eq(bidLines.orgId, actor.orgId), eq(bidLines.bidId, bid.id))).run();
    insertLines(tx, actor.orgId, bid.id, cleaned);
    if (reset) {
      for (const invite of invites) {
        if (invite.status !== "submitted" && invite.status !== "needs_revision") continue;
        tx.update(bidInvites)
          .set({ status: "needs_revision", submittedAt: null })
          .where(and(eq(bidInvites.id, invite.id), eq(bidInvites.orgId, actor.orgId)))
          .run();
      }
    }
    tx.update(bidRequests).set({ updatedAt: now }).where(and(eq(bidRequests.id, bid.id), eq(bidRequests.orgId, actor.orgId))).run();
    writeAudit(tx, actor.orgId, actor.userId, "bid.edit", bid.id, { reset, lines: cleaned.map((line) => line.costCode) });
  });
  return { warning: reset ? "Vendors need to bid again." : null };
}

export function closeBid(actor: Actor, bidId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const bid = loadBid(db, actor.orgId, bidId);
  if (!bid) throw new ServiceError("Bid not found.");
  if (bid.status === "closed") return { id: bid.id };
  if (bid.status === "awarded") throw new ServiceError("This bid is already awarded.");
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(bidRequests)
      .set({ status: "closed", closedAt: now, updatedAt: now })
      .where(and(eq(bidRequests.id, bid.id), eq(bidRequests.orgId, actor.orgId)))
      .run();
    writeAudit(tx, actor.orgId, actor.userId, "bid.close", bid.id, null);
  });
  return { id: bid.id };
}

export function bidComparison(actor: Actor, bidId: string): BidComparison | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const bid = loadBid(db, actor.orgId, bidId);
  if (!bid) return null;
  const project = db.select().from(projects).where(and(eq(projects.id, bid.projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) return null;
  const showMoney = canSeeMoney(roleOf(actor));
  const org = orgRow(db, actor.orgId);
  const today = localDay(Date.now(), org.timeZone);
  const lines = linesFor(db, actor.orgId, bid.id);
  const invites = invitesFor(db, actor.orgId, bid.id);
  const people = new Map(
    db
      .select()
      .from(contacts)
      .where(eq(contacts.orgId, actor.orgId))
      .all()
      .map((row) => [row.id, row]),
  );
  const prices = showMoney ? pricesFor(db, actor.orgId, invites.map((row) => row.id)) : [];
  const budget = showMoney
    ? new Map(
        db
          .select()
          .from(budgetLines)
          .where(and(eq(budgetLines.orgId, actor.orgId), eq(budgetLines.projectId, bid.projectId)))
          .all()
          .map((row) => [row.id, row.budgetCostCents]),
      )
    : new Map<string, number>();
  const awards = db.select().from(bidAwards).where(and(eq(bidAwards.orgId, actor.orgId), eq(bidAwards.bidId, bid.id))).all();
  const poIds = [...new Set(awards.map((row) => row.purchaseOrderId).filter((value): value is string => Boolean(value)))];
  const purchaseOrderRows = showMoney
    ? db
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.orgId, actor.orgId))
        .all()
        .filter((row) => poIds.includes(row.id))
        .sort((a, b) => a.number.localeCompare(b.number))
    : [];
  const files = db
    .select()
    .from(bidFiles)
    .where(and(eq(bidFiles.orgId, actor.orgId), eq(bidFiles.bidId, bid.id)))
    .all();
  const docs = db.select().from(documents).where(eq(documents.orgId, actor.orgId)).all();
  const vendors = invites
    .map((invite) => {
      const contact = people.get(invite.contactId);
      const name = contact ? vendorName(contact) : "Vendor";
      const cert = compliance(db, org, invite.contactId, today);
      const quoteRows = lines.map((line) => {
        const price = prices.find((row) => row.inviteId === invite.id && row.bidLineId === line.id);
        const noBid = Boolean(price?.noBid);
        const unitPriceCents = noBid ? null : (price?.unitPriceCents ?? null);
        const live = invite.status === "submitted" || invite.status === "awarded";
        return { line, noBid, unitPriceCents, live };
      });
      return { invite, name, cert, quoteRows };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    id: bid.id,
    projectId: bid.projectId,
    projectName: project.name,
    title: bid.title,
    scope: bid.scope ?? "",
    dueOn: bid.dueOn,
    status: bid.status,
    statusLabel: statusOf(bid, invites),
    showMoney,
    canEdit: showMoney && canManageMoney(roleOf(actor)) && bid.status !== "awarded" && bid.status !== "closed",
    lines: lines.map((line) => ({
      id: line.id,
      costCode: line.costCode,
      description: line.description,
      qtyMilli: line.qtyMilli,
      unit: line.unit,
      budgetLineId: line.budgetLineId,
      budgetCents: showMoney && line.budgetLineId ? (budget.get(line.budgetLineId) ?? null) : null,
    })),
    vendors: vendors.map((column) => {
      const pricesOut = showMoney
        ? column.quoteRows.map((quote) => {
            const amount = quote.unitPriceCents == null ? null : extendCents(quote.line.qtyMilli, quote.unitPriceCents);
            const lows = lowVendorIds(
              vendors.map((other) => {
                const match = other.quoteRows.find((row) => row.line.id === quote.line.id);
                return {
                  vendorId: other.invite.contactId,
                  unitPriceCents: match?.unitPriceCents ?? null,
                  noBid: Boolean(match?.noBid),
                  live: Boolean(match?.live),
                };
              }),
            );
            return {
              lineId: quote.line.id,
              unitPriceCents: quote.unitPriceCents,
              amountCents: amount,
              noBid: quote.noBid,
              low: lows.includes(column.invite.contactId),
              varianceCents: amount == null ? null : varianceCents(amount, quote.line.budgetLineId ? (budget.get(quote.line.budgetLineId) ?? null) : null),
            };
          })
        : [];
      const total = pricesOut.reduce((sum, row) => sum + (row.noBid || row.amountCents == null ? 0 : row.amountCents), 0);
      const priced = pricesOut.some((row) => row.amountCents != null);
      return {
        inviteId: column.invite.id,
        contactId: column.invite.contactId,
        name: column.name,
        status: column.invite.status,
        statusLabel: inviteLabel(column.invite.status),
        compliance: column.cert.rollup,
        blocked: column.cert.blocked,
        totalCents: showMoney && priced ? total : null,
        prices: pricesOut,
      };
    }),
    purchaseOrders: purchaseOrderRows.map((row) => ({ id: row.id, number: row.number })),
    files: files.map((row) => ({ id: row.documentId, filename: docs.find((doc) => doc.id === row.documentId)?.filename || "File" })),
  };
}

export function awardBid(
  actor: Actor,
  input: { bidId: string; assignments: { bidLineId: string; contactId: string }[]; createPurchaseOrders: boolean; updateBudget: boolean },
) {
  assertOffice(actor);
  const db = dbFor(actor);
  const bid = loadBid(db, actor.orgId, input.bidId);
  if (!bid) throw new ServiceError("Bid not found.");
  if (bid.status !== "out") throw new ServiceError("This bid is not out for prices.");
  const lines = linesFor(db, actor.orgId, bid.id);
  const invites = invitesFor(db, actor.orgId, bid.id);
  const prices = pricesFor(db, actor.orgId, invites.map((row) => row.id));
  if (input.assignments.length !== lines.length) throw new ServiceError("Choose a vendor for each line.");
  const chosen = input.assignments.map((assignment) => {
    const line = lines.find((row) => row.id === assignment.bidLineId);
    if (!line) throw new ServiceError("Bid not found.");
    const invite = invites.find((row) => row.contactId === assignment.contactId);
    if (!invite || invite.status !== "submitted") throw new ServiceError("That vendor has not submitted.");
    const price = prices.find((row) => row.inviteId === invite.id && row.bidLineId === line.id);
    if (!price || price.noBid || price.unitPriceCents == null) throw new ServiceError(`${line.costCode} has no price from that vendor.`);
    const amount = extendCents(line.qtyMilli, price.unitPriceCents);
    if (positiveMoneyError(amount)) throw new ServiceError("Enter an amount greater than zero and under $10,000,000.");
    return { line, invite, amount };
  });
  const org = orgRow(db, actor.orgId);
  const today = localDay(Date.now(), org.timeZone);
  const warnings: string[] = [];
  const awardedContacts = [...new Set(chosen.map((row) => row.invite.contactId))];
  for (const contactId of awardedContacts) {
    requireVendor(db, actor.orgId, contactId);
    const cert = compliance(db, org, contactId, today);
    if (cert.decision.error) throw new ServiceError(cert.decision.error);
    if (cert.decision.warning) warnings.push(cert.decision.warning);
  }
  const now = nowIso();
  const created: { id: string; number: string; contactId: string }[] = [];
  const budgetChanges: { id: string; before: number; after: number }[] = [];
  db.transaction((tx) => {
    let poMax = nextPoBase(tx, actor.orgId);
    const byVendor = new Map<string, typeof chosen>();
    for (const row of chosen) {
      const list = byVendor.get(row.invite.contactId) ?? [];
      list.push(row);
      byVendor.set(row.invite.contactId, list);
    }
    const poByContact = new Map<string, string>();
    if (input.createPurchaseOrders) {
      for (const [contactId, rows] of byVendor) {
        poMax += 1;
        const poId = id("po");
        const number = `PO-${poMax}`;
        tx.insert(purchaseOrders)
          .values({
            id: poId,
            orgId: actor.orgId,
            projectId: bid.projectId,
            vendorContactId: contactId,
            changeOrderId: null,
            number,
            scope: bid.title,
            status: "draft",
            voidReason: null,
            issuedAt: null,
            closedAt: null,
            acceptedAt: null,
            acceptedName: null,
            declinedAt: null,
            declineReason: null,
            createdAt: now,
            updatedAt: now,
            createdBy: actor.userId,
          })
          .run();
        rows.forEach((row, index) => {
          tx.insert(purchaseOrderLines)
            .values({
              id: id("pol"),
              orgId: actor.orgId,
              purchaseOrderId: poId,
              costCode: row.line.costCode,
              description: row.line.description,
              amountCents: row.amount,
              sortOrder: index,
            })
            .run();
        });
        tx.insert(purchaseOrderEvents)
          .values({
            id: id("poe"),
            orgId: actor.orgId,
            purchaseOrderId: poId,
            actorId: actor.userId,
            type: "created",
            reason: "bid",
            beforeJson: null,
            afterJson: JSON.stringify({ number, bidId: bid.id }),
            createdAt: now,
          })
          .run();
        poByContact.set(contactId, poId);
        created.push({ id: poId, number, contactId });
      }
    }
    if (input.updateBudget) {
      const sums = new Map<string, number>();
      for (const row of chosen) {
        if (!row.line.budgetLineId) continue;
        sums.set(row.line.budgetLineId, (sums.get(row.line.budgetLineId) ?? 0) + row.amount);
      }
      for (const [lineId, amount] of sums) {
        const current = tx.select().from(budgetLines).where(and(eq(budgetLines.id, lineId), eq(budgetLines.orgId, actor.orgId))).get();
        if (!current || current.projectId !== bid.projectId) continue;
        budgetChanges.push({ id: lineId, before: current.budgetCostCents, after: amount });
        tx.update(budgetLines).set({ budgetCostCents: amount }).where(and(eq(budgetLines.id, lineId), eq(budgetLines.orgId, actor.orgId))).run();
      }
    }
    for (const row of chosen) {
      tx.insert(bidAwards)
        .values({
          id: id("baw"),
          orgId: actor.orgId,
          bidId: bid.id,
          bidLineId: row.line.id,
          inviteId: row.invite.id,
          purchaseOrderId: poByContact.get(row.invite.contactId) ?? null,
          amountCents: row.amount,
        })
        .run();
    }
    const winners = new Set(chosen.map((row) => row.invite.id));
    for (const invite of invites) {
      const next = winners.has(invite.id) ? "awarded" : invite.status === "declined" ? "declined" : "lost";
      tx.update(bidInvites).set({ status: next }).where(and(eq(bidInvites.id, invite.id), eq(bidInvites.orgId, actor.orgId))).run();
    }
    tx.update(bidRequests)
      .set({ status: "awarded", awardedAt: now, updatedAt: now })
      .where(and(eq(bidRequests.id, bid.id), eq(bidRequests.orgId, actor.orgId)))
      .run();
    tx.insert(activities)
      .values({
        id: id("act"),
        orgId: actor.orgId,
        entityType: "project",
        entityId: bid.projectId,
        type: "bid",
        actorType: "user",
        actorId: actor.userId,
        summary: `Awarded ${bid.title}.`,
        payloadJson: null,
        createdAt: now,
      })
      .run();
    writeAudit(tx, actor.orgId, actor.userId, "bid.award", bid.id, {
      purchaseOrders: created.map((row) => row.number),
      budget: budgetChanges,
    });
  });
  return { id: bid.id, purchaseOrders: created.map((row) => row.number), warning: warnings[0] ?? null };
}

export function bidQueues(orgId: string): { due: { count: number; href: string | null }; award: { count: number; href: string | null } } {
  const empty = { count: 0, href: null };
  const db = officeDb(orgId);
  if (!db) return { due: empty, award: empty };
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) return { due: empty, award: empty };
  const today = localDay(Date.now(), org.timeZone);
  const bids = db.select().from(bidRequests).where(eq(bidRequests.orgId, orgId)).all().filter((row) => row.status === "out");
  const invites = db.select().from(bidInvites).where(eq(bidInvites.orgId, orgId)).all();
  const due = bids.filter((row) => dueWithinThreeDays(row.dueOn, today)).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title));
  const award = bids
    .filter((row) => invites.some((invite) => invite.bidId === row.id && invite.status === "submitted"))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    due: { count: due.length, href: due[0] ? `/bids/${due[0].id}` : null },
    award: { count: award.length, href: award[0] ? `/bids/${award[0].id}` : null },
  };
}

export function vendorBidPortal(token: string): VendorBidCard[] | null {
  const ctx = portal(token);
  if (!ctx) return null;
  const today = localDay(Date.now(), ctx.org.timeZone);
  const invites = ctx.db
    .select()
    .from(bidInvites)
    .where(and(eq(bidInvites.orgId, ctx.org.id), eq(bidInvites.contactId, ctx.contact.id)))
    .all();
  const cards: VendorBidCard[] = [];
  for (const invite of invites) {
    const bid = ctx.db.select().from(bidRequests).where(and(eq(bidRequests.id, invite.bidId), eq(bidRequests.orgId, ctx.org.id))).get();
    if (!bid || bid.status === "draft") continue;
    const project = ctx.db.select().from(projects).where(and(eq(projects.id, bid.projectId), eq(projects.orgId, ctx.org.id))).get();
    const lines = linesFor(ctx.db, ctx.org.id, bid.id);
    const prices = pricesFor(ctx.db, ctx.org.id, [invite.id]);
    const files = ctx.db.select().from(bidFiles).where(and(eq(bidFiles.orgId, ctx.org.id), eq(bidFiles.bidId, bid.id))).all();
    const docs = ctx.db.select().from(documents).where(eq(documents.orgId, ctx.org.id)).all();
    cards.push({
      id: bid.id,
      title: bid.title,
      scope: bid.scope ?? "",
      job: project?.name ?? "Job",
      address: project?.address ?? "",
      dueOn: bid.dueOn,
      statusLabel: bid.status === "out" ? "Out" : requestStatusLabel(bid.status, 0, 0),
      editable: vendorCanRevise(bid.status, bid.dueOn, today, invite.status),
      response: invite.status,
      responseLabel: inviteLabel(invite.status),
      note: invite.note ?? "",
      name: invite.submittedName ?? "",
      lines: lines.map((line) => {
        const price = prices.find((row) => row.bidLineId === line.id);
        return {
          id: line.id,
          costCode: line.costCode,
          description: line.description,
          qtyMilli: line.qtyMilli,
          unit: line.unit,
          unitPriceCents: price?.noBid ? null : (price?.unitPriceCents ?? null),
          noBid: Boolean(price?.noBid),
        };
      }),
      files: files.map((row) => ({ id: row.documentId, filename: docs.find((doc) => doc.id === row.documentId)?.filename || "File" })),
      plans: targetPlans(ctx.db, ctx.org.id, "bid", bid.id).map((plan) => ({ id: plan.documentId, filename: plan.name })),
    });
  }
  return cards.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title));
}

function requireInvite(token: string, bidId: string, ip: string) {
  const ctx = portal(token);
  if (!ctx) throw new ServiceError("Portal not found.");
  guardWrite(ctx.db, ctx.org.id, ip, Date.now());
  const bid = ctx.db.select().from(bidRequests).where(and(eq(bidRequests.id, bidId), eq(bidRequests.orgId, ctx.org.id))).get();
  const invite = bid
    ? ctx.db
        .select()
        .from(bidInvites)
        .where(and(eq(bidInvites.orgId, ctx.org.id), eq(bidInvites.bidId, bid.id), eq(bidInvites.contactId, ctx.contact.id)))
        .get()
    : undefined;
  if (!bid || !invite || bid.status === "draft") throw new ServiceError("Bid not found.");
  const today = localDay(Date.now(), ctx.org.timeZone);
  return { ctx, bid, invite, today };
}

export function submitVendorBid(input: { token: string; ip: string; bidId: string; name: string; note?: string; prices: BidPriceInput[]; file?: BidUpload | null }) {
  const { ctx, bid, invite, today } = requireInvite(input.token, input.bidId, input.ip);
  if (!vendorCanRevise(bid.status, bid.dueOn, today, invite.status)) throw new ServiceError("This bid is closed.");
  const name = cleanName(input.name);
  const note = (input.note ?? "").trim();
  if (note.length > 400) throw new ServiceError("Keep the note shorter.");
  const lines = linesFor(ctx.db, ctx.org.id, bid.id);
  if (input.prices.length !== lines.length) throw new ServiceError("Price each line.");
  const priced = lines.map((line) => {
    const price = input.prices.find((row) => row.bidLineId === line.id);
    if (!price) throw new ServiceError("Price each line.");
    if (price.noBid) return { line, unitPriceCents: null, noBid: 1 };
    if (price.unitPriceCents == null || positiveMoneyError(price.unitPriceCents)) {
      throw new ServiceError("Enter an amount greater than zero and under $10,000,000.");
    }
    const amount = extendCents(line.qtyMilli, price.unitPriceCents);
    if (positiveMoneyError(amount)) throw new ServiceError("Enter an amount greater than zero and under $10,000,000.");
    return { line, unitPriceCents: price.unitPriceCents, noBid: 0 };
  });
  const now = nowIso();
  ctx.db.transaction((tx) => {
    tx.delete(bidPrices).where(and(eq(bidPrices.orgId, ctx.org.id), eq(bidPrices.inviteId, invite.id))).run();
    for (const row of priced) {
      tx.insert(bidPrices)
        .values({
          id: id("bpr"),
          orgId: ctx.org.id,
          inviteId: invite.id,
          bidLineId: row.line.id,
          unitPriceCents: row.unitPriceCents,
          noBid: row.noBid,
        })
        .run();
    }
    const documentId = input.file && input.file.bytes.length > 0 ? storeUpload(tx, ctx.org.id, bid.projectId, ctx.contact.id, input.file, "bid") : invite.documentId;
    tx.update(bidInvites)
      .set({
        status: "submitted",
        note: note || null,
        submittedName: name,
        submittedAt: now,
        declinedAt: null,
        declineReason: null,
        documentId,
      })
      .where(and(eq(bidInvites.id, invite.id), eq(bidInvites.orgId, ctx.org.id)))
      .run();
    tx.update(bidRequests).set({ updatedAt: now }).where(and(eq(bidRequests.id, bid.id), eq(bidRequests.orgId, ctx.org.id))).run();
    writeAudit(tx, ctx.org.id, null, "bid.submit", bid.id, { contactId: ctx.contact.id, name }, input.ip);
  });
  return { id: bid.id };
}

export function declineVendorBid(input: { token: string; ip: string; bidId: string; reason: string }) {
  const { ctx, bid, invite, today } = requireInvite(input.token, input.bidId, input.ip);
  if (!vendorCanRevise(bid.status, bid.dueOn, today, invite.status)) throw new ServiceError("This bid is closed.");
  const reason = cleanReason(input.reason);
  const now = nowIso();
  ctx.db.transaction((tx) => {
    tx.update(bidInvites)
      .set({ status: "declined", declinedAt: now, declineReason: reason })
      .where(and(eq(bidInvites.id, invite.id), eq(bidInvites.orgId, ctx.org.id)))
      .run();
    tx.update(bidRequests).set({ updatedAt: now }).where(and(eq(bidRequests.id, bid.id), eq(bidRequests.orgId, ctx.org.id))).run();
    writeAudit(tx, ctx.org.id, null, "bid.decline", bid.id, { contactId: ctx.contact.id, reason }, input.ip);
  });
  return { id: bid.id };
}
