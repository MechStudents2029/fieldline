import { and, eq } from "drizzle-orm";
import { poOverageMessage } from "@/lib/bills/from-po";
import { retainedCents } from "@/lib/bills/retainage";
import { getDb, type AppDatabase } from "@/lib/db/client";
import {
  auditLogs,
  billEvents,
  billLines,
  bills,
  changeOrderLines,
  changeOrders,
  contacts,
  costItems,
  lienWaivers,
  memberships,
  notifications,
  organizations,
  payApplicationLines,
  payApplicationVersions,
  payApplications,
  projects,
  purchaseOrderLines,
  purchaseOrders,
  vendorPortals,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { applicationTotals, figureLine, type LineFigure } from "@/lib/pay-apps/math";
import { hasFlatBill } from "@/lib/pay-apps/lock";
import { overageByCode } from "@/lib/margin/commitment";
import { parseMoneyToCents } from "@/lib/money";
import { canManageMoney, canSeeMoney, type Role } from "@/lib/permissions";
import { emitAutomation } from "@/lib/services/automations";
import { ServiceError } from "@/lib/services/errors";
import { voidBill } from "@/lib/services/bills";
import type { Actor } from "@/lib/services/read";
import { appOrigin } from "@/lib/security";
import { addCalendarDays, localDay } from "@/lib/time/calendar";
import { PAY_GATE_MESSAGE, parseWaiverMode } from "@/lib/waivers/format";

const OPEN = new Set(["draft", "submitted", "under_review", "revise"]);
const FINAL = new Set(["conditional_final", "unconditional_final"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  revise: "Revise & resubmit",
  approved: "Approved",
  void: "Void",
};

type Database = AppDatabase;
type AppRow = typeof payApplications.$inferSelect;
type LineRow = typeof payApplicationLines.$inferSelect;
type PoLine = typeof purchaseOrderLines.$inferSelect;

export type PayLineInput = {
  purchaseOrderLineId: string;
  thisPeriodCents: number;
  storedCents: number;
  releasedCents: number;
  retainageBps?: number | null;
  rejectNote?: string | null;
};

function dbFor(_actor: Actor) {
  return getDb();
}

function assertSee(actor: Actor) {
  if (actor.role === "field" || !canSeeMoney(actor.role as Role)) throw new ServiceError("Your role cannot see this.");
}

function assertOffice(actor: Actor) {
  assertSee(actor);
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Your role cannot change this.");
}

function audit(db: Database, actor: Actor, action: string, entityId: string, payload: unknown) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action,
      entityType: "pay_application",
      entityId,
      payloadJson: JSON.stringify(payload ?? {}),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function dayOrThrow(value: string, label: string) {
  const text = value.trim();
  if (!DAY.test(text)) throw new ServiceError(`Enter the ${label}.`);
  return text;
}

function companyToday(db: Database, orgId: string) {
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  return localDay(Date.now(), org?.timeZone || "America/New_York");
}

function loadApp(db: Database, orgId: string, applicationId: string) {
  return db.select().from(payApplications).where(and(eq(payApplications.id, applicationId), eq(payApplications.orgId, orgId))).get();
}

function loadLines(db: Database, orgId: string, applicationId: string) {
  return db
    .select()
    .from(payApplicationLines)
    .where(and(eq(payApplicationLines.orgId, orgId), eq(payApplicationLines.applicationId, applicationId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function poOf(db: Database, orgId: string, purchaseOrderId: string) {
  return db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.orgId, orgId))).get();
}

function approvedChangeIds(db: Database, orgId: string, projectId: string) {
  return new Set(
    db
      .select()
      .from(changeOrders)
      .where(and(eq(changeOrders.orgId, orgId), eq(changeOrders.projectId, projectId), eq(changeOrders.status, "approved")))
      .all()
      .map((row) => row.id),
  );
}

/** PO lines, plus lines copied from an approved change order. */
export function scheduleLines(db: Database, orgId: string, purchaseOrderId: string) {
  const order = poOf(db, orgId, purchaseOrderId);
  if (!order) return [];
  const approved = approvedChangeIds(db, orgId, order.projectId);
  const used = new Set(
    db
      .select()
      .from(payApplicationLines)
      .where(eq(payApplicationLines.orgId, orgId))
      .all()
      .map((row) => row.purchaseOrderLineId),
  );
  return db
    .select()
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.orgId, orgId), eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId)))
    .all()
    .filter((line) => line.sourceKind !== "change_order" || approved.has(line.sourceId) || used.has(line.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function priorWork(db: Database, orgId: string, purchaseOrderId: string, beforeNumber: number) {
  const apps = db
    .select()
    .from(payApplications)
    .where(and(eq(payApplications.orgId, orgId), eq(payApplications.purchaseOrderId, purchaseOrderId), eq(payApplications.status, "approved")))
    .all()
    .filter((row) => row.number < beforeNumber);
  const ids = new Set(apps.map((row) => row.id));
  const lines = db
    .select()
    .from(payApplicationLines)
    .where(eq(payApplicationLines.orgId, orgId))
    .all()
    .filter((row) => ids.has(row.applicationId));
  const work = new Map<string, number>();
  const held = new Map<string, number>();
  for (const line of lines) {
    work.set(line.purchaseOrderLineId, (work.get(line.purchaseOrderLineId) ?? 0) + line.thisPeriodCents + line.storedCents);
    const retainage = retainedCents(line.thisPeriodCents + line.storedCents, line.retainageBps);
    held.set(line.purchaseOrderLineId, (held.get(line.purchaseOrderLineId) ?? 0) + retainage - line.releasedCents);
  }
  return { work, held };
}

export function figuresFor(db: Database, orgId: string, app: AppRow, lines: LineRow[], sov: PoLine[]) {
  const prior = priorWork(db, orgId, app.purchaseOrderId, app.number);
  const byId = new Map(sov.map((line) => [line.id, line]));
  const figures = lines.map((line) => {
    const scheduled = byId.get(line.purchaseOrderLineId);
    return {
      line,
      figure: figureLine({
        scheduledCents: scheduled?.amountCents ?? 0,
        previousWorkCents: prior.work.get(line.purchaseOrderLineId) ?? 0,
        previousHeldCents: Math.max(0, prior.held.get(line.purchaseOrderLineId) ?? 0),
        thisPeriodCents: line.thisPeriodCents,
        storedCents: line.storedCents,
        releasedCents: line.releasedCents,
        retainageBps: line.retainageBps,
      }),
    };
  });
  return { figures, totals: applicationTotals(figures.map((row) => row.figure)) };
}

function snapshotLines(lines: LineRow[]) {
  return lines.map((line) => ({
    purchaseOrderLineId: line.purchaseOrderLineId,
    thisPeriodCents: line.thisPeriodCents,
    storedCents: line.storedCents,
    releasedCents: line.releasedCents,
    retainageBps: line.retainageBps,
    rejectNote: line.rejectNote,
  }));
}

function notifySubmitted(db: Database, actor: Actor | null, app: AppRow, label: string) {
  const owners = db
    .select({ id: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.orgId, app.orgId))
    .all()
    .filter((row) => row.role === "owner" || row.role === "admin");
  const stamp = nowIso();
  for (const owner of owners) {
    db.insert(notifications)
      .values({
        id: id("note"),
        orgId: app.orgId,
        userId: owner.id,
        kind: "pay_application",
        commentId: null,
        entityType: "pay_application",
        entityId: app.id,
        projectId: app.projectId,
        actorId: actor?.userId ?? null,
        actorName: "Fieldline",
        snippet: label,
        readAt: null,
        createdAt: stamp,
      })
      .run();
  }
}

function emit(kind: "pay_application_submitted" | "pay_application_approved", app: AppRow, label: string, amountCents: number) {
  emitAutomation({
    orgId: app.orgId,
    kind,
    recordType: "pay_application",
    recordId: app.id,
    recordLabel: label,
    projectId: app.projectId,
    amountCents,
    name: label,
  });
}

function names(db: Database, orgId: string) {
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row.name]));
  const vendors = new Map(
    db
      .select()
      .from(contacts)
      .where(eq(contacts.orgId, orgId))
      .all()
      .map((row) => [row.id, row.company?.trim() || row.name]),
  );
  const orders = new Map(db.select().from(purchaseOrders).where(eq(purchaseOrders.orgId, orgId)).all().map((row) => [row.id, row]));
  return { jobs, vendors, orders };
}

function rowOf(db: Database, orgId: string, app: AppRow) {
  const { jobs, vendors, orders } = names(db, orgId);
  const lines = loadLines(db, orgId, app.id);
  const sov = scheduleLines(db, orgId, app.purchaseOrderId);
  let netCents = 0;
  let thisCents = 0;
  try {
    const figured = figuresFor(db, orgId, app, lines, sov);
    netCents = figured.totals.netCents;
    thisCents = figured.totals.grossCents;
  } catch {
    netCents = 0;
  }
  const order = orders.get(app.purchaseOrderId);
  return {
    id: app.id,
    number: app.number,
    projectId: app.projectId,
    job: jobs.get(app.projectId) ?? "Job",
    vendorContactId: app.vendorContactId,
    vendor: vendors.get(app.vendorContactId) ?? "Vendor",
    purchaseOrderId: app.purchaseOrderId,
    poNumber: order?.number ?? "",
    periodStart: app.periodStart,
    periodEnd: app.periodEnd,
    status: app.status,
    statusLabel: STATUS_LABEL[app.status] ?? app.status,
    netCents,
    thisCents,
    billId: app.billId,
    submittedAt: app.submittedAt,
  };
}

export function listPayApplications(actor: Actor, filter: { projectId?: string; vendorContactId?: string; status?: string; period?: string } = {}) {
  assertSee(actor);
  const db = dbFor(actor);
  return db
    .select()
    .from(payApplications)
    .where(eq(payApplications.orgId, actor.orgId))
    .all()
    .map((app) => rowOf(db, actor.orgId, app))
    .filter((row) => {
      if (filter.projectId && row.projectId !== filter.projectId) return false;
      if (filter.vendorContactId && row.vendorContactId !== filter.vendorContactId) return false;
      if (filter.status && filter.status !== "all" && filter.status !== "age" && row.status !== filter.status) return false;
      if (filter.period && row.periodEnd !== filter.period) return false;
      return true;
    })
    .filter((row) => {
      if (filter.status !== "age") return true;
      const today = companyToday(db, actor.orgId);
      const submitted = (row.submittedAt ?? "").slice(0, 10);
      return (row.status === "submitted" || row.status === "under_review") && submitted !== "" && submitted < addCalendarDays(today, -5);
    })
    .sort((a, b) => a.job.localeCompare(b.job) || a.poNumber.localeCompare(b.poNumber) || a.number - b.number);
}

export function payApplicationAttention(actor: Actor) {
  if (actor.role === "field" || !canSeeMoney(actor.role as Role)) return { count: 0, href: null as string | null };
  const rows = listPayApplications(actor, { status: "age" });
  return { count: rows.length, href: rows.length ? "/pay-applications?filter=age" : null };
}

export function jobPaySummary(orgId: string, projectId: string, role: Role) {
  if (!canSeeMoney(role)) return null;
  const db = getDb();
  const apps = db
    .select()
    .from(payApplications)
    .where(and(eq(payApplications.orgId, orgId), eq(payApplications.projectId, projectId)))
    .all()
    .filter((row) => row.status !== "void");
  let netCents = 0;
  for (const app of apps.filter((row) => row.status === "approved")) {
    const lines = loadLines(db, orgId, app.id);
    const sov = scheduleLines(db, orgId, app.purchaseOrderId);
    try {
      netCents += figuresFor(db, orgId, app, lines, sov).totals.netCents;
    } catch {
      netCents += 0;
    }
  }
  return { count: apps.length, netCents };
}

export function payApplicationDetail(actor: Actor, applicationId: string) {
  assertSee(actor);
  const db = dbFor(actor);
  const app = loadApp(db, actor.orgId, applicationId);
  if (!app) return null;
  const order = poOf(db, actor.orgId, app.purchaseOrderId);
  if (!order) return null;
  const lines = loadLines(db, actor.orgId, app.id);
  const sov = scheduleLines(db, actor.orgId, app.purchaseOrderId);
  const figured = figuresFor(db, actor.orgId, app, lines, sov);
  const byLine = new Map(sov.map((line) => [line.id, line]));
  const versions = db
    .select()
    .from(payApplicationVersions)
    .where(and(eq(payApplicationVersions.orgId, actor.orgId), eq(payApplicationVersions.applicationId, app.id)))
    .all()
    .sort((a, b) => a.version - b.version);
  const bill = app.billId ? db.select().from(bills).where(and(eq(bills.id, app.billId), eq(bills.orgId, actor.orgId))).get() : undefined;
  const portal = db
    .select()
    .from(vendorPortals)
    .where(and(eq(vendorPortals.orgId, actor.orgId), eq(vendorPortals.contactId, app.vendorContactId)))
    .get();
  const { jobs, vendors } = names(db, actor.orgId);
  const audits = db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.orgId, actor.orgId), eq(auditLogs.entityType, "pay_application"), eq(auditLogs.entityId, app.id)))
    .all()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    id: app.id,
    number: app.number,
    status: app.status,
    statusLabel: STATUS_LABEL[app.status] ?? app.status,
    job: jobs.get(app.projectId) ?? "Job",
    projectId: app.projectId,
    vendor: vendors.get(app.vendorContactId) ?? "Vendor",
    vendorContactId: app.vendorContactId,
    poNumber: order.number,
    purchaseOrderId: order.id,
    periodStart: app.periodStart,
    periodEnd: app.periodEnd,
    version: app.version,
    note: app.note,
    voidReason: app.voidReason,
    billId: bill?.id ?? null,
    billNumber: bill?.billNumber ?? null,
    requestedAt: app.requestedAt,
    copiedAt: app.copiedAt,
    portalUrl: portal?.issuedToken ? `${appOrigin(process.env)}/v/${portal.issuedToken}` : null,
    canEdit: canManageMoney(actor.role as Role) && (app.status === "draft" || app.status === "revise" || app.status === "submitted" || app.status === "under_review"),
    canAmounts: canManageMoney(actor.role as Role) && (app.status === "draft" || app.status === "revise"),
    totals: figured.totals,
    lines: figured.figures.map(({ line, figure }) => ({
      id: line.id,
      purchaseOrderLineId: line.purchaseOrderLineId,
      costCode: byLine.get(line.purchaseOrderLineId)?.costCode ?? "",
      description: byLine.get(line.purchaseOrderLineId)?.description ?? "",
      retainageBps: line.retainageBps,
      rejectNote: line.rejectNote,
      ...figure,
    })),
    versions: versions.map((row) => ({ version: row.version, createdAt: row.createdAt })),
    audits: audits.map((row) => ({ id: row.id, action: row.action, createdAt: row.createdAt })),
  };
}

export function progressPurchaseOrders(actor: Actor) {
  assertOffice(actor);
  const db = dbFor(actor);
  return db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.orgId, actor.orgId), eq(purchaseOrders.status, "issued")))
    .all()
    .filter((order) => !hasFlatBill(db, actor.orgId, order.id))
    .map((order) => ({ id: order.id, number: order.number, projectId: order.projectId, vendorContactId: order.vendorContactId }));
}

function assertIssuedProgress(db: Database, actor: Actor, purchaseOrderId: string) {
  const order = poOf(db, actor.orgId, purchaseOrderId);
  if (!order) throw new ServiceError("Purchase order not found.");
  if (order.status !== "issued") throw new ServiceError("Issue the purchase order first.");
  if (hasFlatBill(db, actor.orgId, order.id)) throw new ServiceError("This purchase order already has a bill.");
  return order;
}

export function setProgressBilling(actor: Actor, purchaseOrderId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const order = assertIssuedProgress(db, actor, purchaseOrderId);
  if (order.billingMethod === "progress") return { id: order.id };
  const now = nowIso();
  db.update(purchaseOrders)
    .set({ billingMethod: "progress", updatedAt: now })
    .where(and(eq(purchaseOrders.id, order.id), eq(purchaseOrders.orgId, actor.orgId)))
    .run();
  audit(db, actor, "pay_application.progress", order.id, { number: order.number });
  return { id: order.id };
}

function openApp(db: Database, orgId: string, purchaseOrderId: string) {
  return db
    .select()
    .from(payApplications)
    .where(and(eq(payApplications.orgId, orgId), eq(payApplications.purchaseOrderId, purchaseOrderId)))
    .all()
    .find((row) => OPEN.has(row.status));
}

function nextNumber(db: Database, orgId: string, purchaseOrderId: string) {
  const rows = db
    .select()
    .from(payApplications)
    .where(and(eq(payApplications.orgId, orgId), eq(payApplications.purchaseOrderId, purchaseOrderId)))
    .all();
  return rows.reduce((max, row) => Math.max(max, row.number), 0) + 1;
}

function writeLines(db: Database, orgId: string, applicationId: string, sov: PoLine[], inputs: PayLineInput[] | null, defaultBps: number, keepBps: Map<string, number>) {
  const incoming = new Map((inputs ?? []).map((line) => [line.purchaseOrderLineId, line]));
  db.delete(payApplicationLines).where(and(eq(payApplicationLines.orgId, orgId), eq(payApplicationLines.applicationId, applicationId))).run();
  sov.forEach((source, index) => {
    const input = incoming.get(source.id);
    const bps = input?.retainageBps == null ? (keepBps.get(source.id) ?? defaultBps) : input.retainageBps;
    db.insert(payApplicationLines)
      .values({
        id: id("pal"),
        orgId,
        applicationId,
        purchaseOrderLineId: source.id,
        thisPeriodCents: input?.thisPeriodCents ?? 0,
        storedCents: input?.storedCents ?? 0,
        releasedCents: input?.releasedCents ?? 0,
        retainageBps: Math.min(10_000, Math.max(0, Math.round(bps))),
        rejectNote: input?.rejectNote?.trim().slice(0, 200) ?? "",
        sortOrder: index,
      })
      .run();
  });
}

function checkFigures(db: Database, orgId: string, app: AppRow) {
  const lines = loadLines(db, orgId, app.id);
  const sov = scheduleLines(db, orgId, app.purchaseOrderId);
  try {
    return figuresFor(db, orgId, app, lines, sov);
  } catch (error) {
    throw new ServiceError(error instanceof Error ? error.message : "Check the lines.");
  }
}

export function createPayApplication(actor: Actor, purchaseOrderId: string, input: { periodStart: string; periodEnd: string; lines?: PayLineInput[] }) {
  assertOffice(actor);
  const db = dbFor(actor);
  const order = assertIssuedProgress(db, actor, purchaseOrderId);
  if (openApp(db, actor.orgId, order.id)) throw new ServiceError("This purchase order already has an open application.");
  const periodStart = dayOrThrow(input.periodStart, "period start");
  const periodEnd = dayOrThrow(input.periodEnd, "period end");
  if (periodEnd < periodStart) throw new ServiceError("The period end is before the start.");
  const sov = scheduleLines(db, actor.orgId, order.id);
  if (sov.length === 0) throw new ServiceError("This purchase order has no lines.");
  setProgressBilling(actor, order.id);
  const applicationId = id("pa");
  const now = nowIso();
  const number = nextNumber(db, actor.orgId, order.id);
  db.insert(payApplications)
    .values({
      id: applicationId,
      orgId: actor.orgId,
      purchaseOrderId: order.id,
      projectId: order.projectId,
      vendorContactId: order.vendorContactId,
      number,
      periodStart,
      periodEnd,
      status: "draft",
      billId: null,
      note: "",
      voidReason: null,
      voidedAt: null,
      submittedAt: null,
      reviewedAt: null,
      approvedAt: null,
      approvedBy: null,
      version: 1,
      requestedAt: null,
      requestedBy: null,
      copiedAt: null,
      copiedBy: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  writeLines(db, actor.orgId, applicationId, sov, input.lines ?? null, order.retainageBps, new Map());
  const app = loadApp(db, actor.orgId, applicationId)!;
  checkFigures(db, actor.orgId, app);
  audit(db, actor, "pay_application.create", applicationId, { number, purchaseOrderId: order.id });
  return { id: applicationId };
}

export function savePayApplication(actor: Actor, applicationId: string, input: { lines: PayLineInput[]; officeBps?: boolean }) {
  assertOffice(actor);
  const db = dbFor(actor);
  const app = loadApp(db, actor.orgId, applicationId);
  if (!app) throw new ServiceError("Pay application not found.");
  if (app.status !== "draft" && app.status !== "revise") throw new ServiceError("This application cannot be edited.");
  const order = poOf(db, actor.orgId, app.purchaseOrderId);
  if (!order) throw new ServiceError("Purchase order not found.");
  const existing = loadLines(db, actor.orgId, app.id);
  const keep = new Map(existing.map((line) => [line.purchaseOrderLineId, line.retainageBps]));
  const lines = input.lines.map((line) => ({
    ...line,
    retainageBps: input.officeBps ? line.retainageBps : keep.get(line.purchaseOrderLineId),
    rejectNote: existing.find((row) => row.purchaseOrderLineId === line.purchaseOrderLineId)?.rejectNote ?? "",
  }));
  const sov = scheduleLines(db, actor.orgId, order.id);
  writeLines(db, actor.orgId, app.id, sov, lines, order.retainageBps, keep);
  checkFigures(db, actor.orgId, app);
  db.update(payApplications).set({ updatedAt: nowIso() }).where(and(eq(payApplications.id, app.id), eq(payApplications.orgId, actor.orgId))).run();
  audit(db, actor, "pay_application.save", app.id, { number: app.number });
  return { id: app.id };
}

function storeVersion(db: Database, actorId: string | null, app: AppRow) {
  const lines = loadLines(db, app.orgId, app.id);
  const existing = db
    .select()
    .from(payApplicationVersions)
    .where(and(eq(payApplicationVersions.orgId, app.orgId), eq(payApplicationVersions.applicationId, app.id), eq(payApplicationVersions.version, app.version)))
    .get();
  if (existing) return;
  db.insert(payApplicationVersions)
    .values({
      id: id("pav"),
      orgId: app.orgId,
      applicationId: app.id,
      version: app.version,
      linesJson: JSON.stringify(snapshotLines(lines)),
      createdAt: nowIso(),
      createdBy: actorId,
    })
    .run();
}

export function submitPayApplication(actor: Actor, applicationId: string) {
  assertOffice(actor);
  return submitStored(actor, applicationId);
}

function submitStored(actor: Actor | null, applicationId: string, orgId?: string) {
  const org = actor?.orgId ?? orgId;
  if (!org) throw new ServiceError("Pay application not found.");
  const db = getDb();
  const app = loadApp(db, org, applicationId);
  if (!app) throw new ServiceError("Pay application not found.");
  if (app.status !== "draft" && app.status !== "revise") throw new ServiceError("This application cannot be submitted.");
  const figured = checkFigures(db, org, app);
  if (figured.totals.grossCents <= 0 && figured.totals.releasedCents <= 0) throw new ServiceError("Add an amount.");
  storeVersion(db, actor?.userId ?? null, app);
  const now = nowIso();
  const nextVersion = app.status === "revise" ? app.version + 1 : app.version;
  db.update(payApplications)
    .set({
      status: "submitted",
      submittedAt: now,
      version: nextVersion,
      updatedAt: now,
    })
    .where(and(eq(payApplications.id, app.id), eq(payApplications.orgId, org)))
    .run();
  db.update(payApplicationLines)
    .set({ rejectNote: "" })
    .where(and(eq(payApplicationLines.orgId, org), eq(payApplicationLines.applicationId, app.id)))
    .run();
  const order = poOf(db, org, app.purchaseOrderId);
  const label = `${order?.number ?? "PO"} ${app.number}`;
  if (actor) audit(db, actor, "pay_application.submit", app.id, { number: app.number, status: "submitted" });
  else {
    db.insert(auditLogs)
      .values({
        id: id("audit"),
        orgId: org,
        actorId: null,
        action: "pay_application.submit",
        entityType: "pay_application",
        entityId: app.id,
        payloadJson: JSON.stringify({ number: app.number, status: "submitted" }),
        ip: null,
        createdAt: now,
      })
      .run();
  }
  const fresh = loadApp(db, org, app.id)!;
  notifySubmitted(db, actor, fresh, label);
  emit("pay_application_submitted", fresh, label, figured.totals.netCents);
  return { id: app.id };
}

export function markUnderReview(actor: Actor, applicationId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const app = loadApp(db, actor.orgId, applicationId);
  if (!app) throw new ServiceError("Pay application not found.");
  if (app.status !== "submitted") throw new ServiceError("Submit the application first.");
  const now = nowIso();
  db.update(payApplications)
    .set({ status: "under_review", reviewedAt: now, updatedAt: now })
    .where(and(eq(payApplications.id, app.id), eq(payApplications.orgId, actor.orgId)))
    .run();
  audit(db, actor, "pay_application.review", app.id, { number: app.number, status: "under_review" });
  return { id: app.id };
}

export function revisePayApplication(actor: Actor, applicationId: string, notes: { purchaseOrderLineId: string; rejectNote: string }[]) {
  assertOffice(actor);
  const db = dbFor(actor);
  const app = loadApp(db, actor.orgId, applicationId);
  if (!app) throw new ServiceError("Pay application not found.");
  if (app.status !== "under_review") throw new ServiceError("Review the application first.");
  const cleaned = notes.map((row) => ({ purchaseOrderLineId: row.purchaseOrderLineId, rejectNote: row.rejectNote.trim().slice(0, 200) })).filter((row) => row.rejectNote);
  if (cleaned.length === 0) throw new ServiceError("Add a note on a line.");
  storeVersion(db, actor.userId, app);
  const now = nowIso();
  for (const note of cleaned) {
    db.update(payApplicationLines)
      .set({ rejectNote: note.rejectNote })
      .where(
        and(
          eq(payApplicationLines.orgId, actor.orgId),
          eq(payApplicationLines.applicationId, app.id),
          eq(payApplicationLines.purchaseOrderLineId, note.purchaseOrderLineId),
        ),
      )
      .run();
  }
  db.update(payApplications)
    .set({ status: "revise", updatedAt: now })
    .where(and(eq(payApplications.id, app.id), eq(payApplications.orgId, actor.orgId)))
    .run();
  audit(db, actor, "pay_application.revise", app.id, { number: app.number, lines: cleaned.length });
  return { id: app.id };
}

function signedFinal(db: Database, orgId: string, projectId: string, vendorContactId: string) {
  return db
    .select()
    .from(lienWaivers)
    .where(eq(lienWaivers.orgId, orgId))
    .all()
    .some((row) => row.projectId === projectId && row.vendorContactId === vendorContactId && row.status === "signed" && FINAL.has(row.type));
}

function postBill(actor: Actor, app: AppRow, figured: { figures: { line: LineRow; figure: LineFigure }[]; totals: ReturnType<typeof applicationTotals> }) {
  const db = dbFor(actor);
  if (app.billId) return app.billId;
  const order = poOf(db, actor.orgId, app.purchaseOrderId);
  if (!order) throw new ServiceError("Purchase order not found.");
  const billNumber = `${order.number}-PA${app.number}`;
  const duplicate = db
    .select()
    .from(bills)
    .where(and(eq(bills.orgId, actor.orgId), eq(bills.vendorContactId, order.vendorContactId), eq(bills.billNumber, billNumber)))
    .all()
    .find((row) => row.status !== "void");
  if (duplicate) throw new ServiceError(`${billNumber} is already on file.`);
  const sov = new Map(scheduleLines(db, actor.orgId, order.id).map((line) => [line.id, line]));
  const work = figured.figures
    .map(({ line, figure }) => ({
      costCode: sov.get(line.purchaseOrderLineId)?.costCode ?? "",
      description: sov.get(line.purchaseOrderLineId)?.description ?? null,
      amountCents: figure.thisPeriodCents + figure.storedCents,
    }))
    .filter((line) => line.amountCents > 0);
  const priorBills = db
    .select()
    .from(bills)
    .where(and(eq(bills.orgId, actor.orgId), eq(bills.purchaseOrderId, order.id)))
    .all()
    .filter((bill) => (bill.status === "approved" || bill.status === "paid") && bill.kind !== "release");
  const priorIds = new Set(priorBills.map((bill) => bill.id));
  const priorLines = db
    .select()
    .from(billLines)
    .where(eq(billLines.orgId, actor.orgId))
    .all()
    .filter((line) => priorIds.has(line.billId));
  const overs = overageByCode(
    scheduleLines(db, actor.orgId, order.id),
    priorLines,
    work,
  );
  const over = poOverageMessage(order.number, overs);
  if (over) throw new ServiceError(over.replace(/ It was still saved\.$/, ""));
  const vendor = db.select().from(contacts).where(and(eq(contacts.id, order.vendorContactId), eq(contacts.orgId, actor.orgId))).get();
  const vendorName = vendor?.company?.trim() || vendor?.name || "Vendor";
  const today = companyToday(db, actor.orgId);
  const billDate = app.periodEnd <= today ? app.periodEnd : today;
  const dueDate = app.periodEnd >= today ? app.periodEnd : today;
  const billId = id("bill");
  const now = nowIso();
  const { grossCents, retainageCents, releasedCents, netCents } = figured.totals;
  const amountCents = grossCents + releasedCents;
  db.transaction((tx) => {
    tx.insert(bills)
      .values({
        id: billId,
        orgId: actor.orgId,
        projectId: order.projectId,
        vendorContactId: order.vendorContactId,
        billNumber,
        billDate,
        amountCents,
        dueDate,
        status: "approved",
        memo: `Pay application ${app.number} on ${order.number}`,
        voidReason: null,
        paidAt: null,
        payMethod: null,
        payReference: null,
        documentId: null,
        purchaseOrderId: order.id,
        approvedAt: now,
        lowConfidence: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
        portalSubmitted: 0,
        retainageCents,
        kind: "standard",
      })
      .run();
    work.forEach((line, index) => {
      const costId = id("cost");
      tx.insert(costItems)
        .values({
          id: costId,
          orgId: actor.orgId,
          projectId: order.projectId,
          budgetLineId: null,
          costCode: line.costCode,
          amountCents: line.amountCents,
          vendorName,
          memo: `Bill ${billNumber}${line.description ? ` · ${line.description}` : ""}`,
          source: "bill",
          aiExtracted: 0,
          documentId: null,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.userId,
        })
        .run();
      tx.insert(billLines)
        .values({
          id: id("bln"),
          orgId: actor.orgId,
          billId,
          costCode: line.costCode,
          description: line.description,
          amountCents: line.amountCents,
          costItemId: costId,
          sortOrder: index,
        })
        .run();
    });
    tx.insert(billEvents)
      .values({
        id: id("bev"),
        orgId: actor.orgId,
        billId,
        actorId: actor.userId,
        type: "approved",
        reason: "pay application",
        beforeJson: null,
        afterJson: JSON.stringify({ amountCents, retainageCents, releasedCents, netCents }),
        createdAt: now,
      })
      .run();
  });
  return billId;
}

export function approvePayApplication(actor: Actor, applicationId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const app = loadApp(db, actor.orgId, applicationId);
  if (!app) throw new ServiceError("Pay application not found.");
  if (app.status === "approved") {
    if (!app.billId) throw new ServiceError("This application has no bill.");
    return { id: app.id, billId: app.billId };
  }
  if (app.status !== "under_review") throw new ServiceError("Review the application first.");
  const figured = checkFigures(db, actor.orgId, app);
  if (figured.totals.grossCents <= 0 && figured.totals.releasedCents <= 0) throw new ServiceError("Add an amount.");
  if (figured.totals.netCents < 0) throw new ServiceError("The net cannot be negative.");
  if (figured.totals.finalRelease) {
    const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
    const mode = parseWaiverMode(org?.lienWaiverMode);
    if (mode === "block" && !signedFinal(db, actor.orgId, app.projectId, app.vendorContactId)) throw new ServiceError(PAY_GATE_MESSAGE);
  }
  const billId = postBill(actor, app, figured);
  const now = nowIso();
  db.update(payApplications)
    .set({ status: "approved", billId, approvedAt: now, approvedBy: actor.userId, updatedAt: now })
    .where(and(eq(payApplications.id, app.id), eq(payApplications.orgId, actor.orgId)))
    .run();
  audit(db, actor, "pay_application.approve", app.id, { number: app.number, billId });
  const order = poOf(db, actor.orgId, app.purchaseOrderId);
  const label = `${order?.number ?? "PO"} ${app.number}`;
  emit("pay_application_approved", { ...app, status: "approved", billId }, label, figured.totals.netCents);
  return { id: app.id, billId };
}

export function voidPayApplication(actor: Actor, applicationId: string, reason: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const app = loadApp(db, actor.orgId, applicationId);
  if (!app) throw new ServiceError("Pay application not found.");
  if (app.status === "void") throw new ServiceError("This application is void.");
  const why = reason.trim();
  if (why.length < 2) throw new ServiceError("Enter a reason.");
  const latest = db
    .select()
    .from(payApplications)
    .where(and(eq(payApplications.orgId, actor.orgId), eq(payApplications.purchaseOrderId, app.purchaseOrderId)))
    .all()
    .filter((row) => row.status !== "void")
    .sort((a, b) => b.number - a.number)[0];
  if (!latest || latest.id !== app.id) throw new ServiceError("Void the latest application.");
  if (app.status === "approved" && app.billId) voidBill(actor, app.billId, why);
  const now = nowIso();
  db.update(payApplications)
    .set({ status: "void", voidReason: why, voidedAt: now, updatedAt: now })
    .where(and(eq(payApplications.id, app.id), eq(payApplications.orgId, actor.orgId)))
    .run();
  audit(db, actor, "pay_application.void", app.id, { number: app.number, reason: why });
  return { id: app.id };
}

export function markPayRequested(actor: Actor, applicationId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const app = loadApp(db, actor.orgId, applicationId);
  if (!app) throw new ServiceError("Pay application not found.");
  const now = nowIso();
  db.update(payApplications)
    .set({ requestedAt: now, requestedBy: actor.userId, updatedAt: now })
    .where(and(eq(payApplications.id, app.id), eq(payApplications.orgId, actor.orgId)))
    .run();
  audit(db, actor, "pay_application.request", app.id, { number: app.number });
  return { id: app.id };
}

export function copyPayLink(actor: Actor, applicationId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const app = loadApp(db, actor.orgId, applicationId);
  if (!app) throw new ServiceError("Pay application not found.");
  const now = nowIso();
  db.update(payApplications)
    .set({ copiedAt: now, copiedBy: actor.userId, updatedAt: now })
    .where(and(eq(payApplications.id, app.id), eq(payApplications.orgId, actor.orgId)))
    .run();
  audit(db, actor, "pay_application.copy", app.id, { number: app.number });
  return { id: app.id };
}

export function attachApprovedChange(actor: Actor, purchaseOrderId: string, changeOrderId: string) {
  assertOffice(actor);
  const db = dbFor(actor);
  const order = assertIssuedProgress(db, actor, purchaseOrderId);
  const change = db.select().from(changeOrders).where(and(eq(changeOrders.id, changeOrderId), eq(changeOrders.orgId, actor.orgId))).get();
  if (!change || change.projectId !== order.projectId) throw new ServiceError("Change order not found.");
  if (change.status !== "approved") throw new ServiceError("Approve the change order first.");
  const existing = db
    .select()
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.orgId, actor.orgId), eq(purchaseOrderLines.purchaseOrderId, order.id), eq(purchaseOrderLines.sourceId, change.id)))
    .all();
  if (existing.length > 0) return { id: order.id, added: 0 };
  const lines = db
    .select()
    .from(changeOrderLines)
    .where(and(eq(changeOrderLines.orgId, actor.orgId), eq(changeOrderLines.changeOrderId, change.id)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const current = db
    .select()
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.orgId, actor.orgId), eq(purchaseOrderLines.purchaseOrderId, order.id)))
    .all();
  let sort = current.reduce((max, line) => Math.max(max, line.sortOrder), -1);
  for (const line of lines) {
    const amountCents = Math.round((line.qtyMilli * line.unitCostCents) / 1000);
    if (amountCents <= 0 || !line.costCode) continue;
    sort += 1;
    db.insert(purchaseOrderLines)
      .values({
        id: id("pol"),
        orgId: actor.orgId,
        purchaseOrderId: order.id,
        costCode: line.costCode,
        description: line.name,
        amountCents,
        sortOrder: sort,
        qtyMilli: line.qtyMilli,
        unitCostCents: line.unitCostCents,
        sourceKind: "change_order",
        sourceId: change.id,
        note: null,
        expectedOn: null,
        scheduleItemId: null,
      })
      .run();
  }
  if (order.billingMethod !== "progress") setProgressBilling(actor, order.id);
  audit(db, actor, "pay_application.amend", order.id, { changeOrderId: change.id });
  return { id: order.id, added: lines.length };
}

export function payApplicationsCsv(actor: Actor, filter: { projectId?: string; vendorContactId?: string; status?: string; period?: string } = {}) {
  const rows = listPayApplications(actor, filter);
  const header = "Number,Job,Vendor,PO,Period,Status,This period,Net";
  const body = rows.map((row) =>
    [row.number, row.job, row.vendor, row.poNumber, row.periodEnd, row.statusLabel, (row.thisCents / 100).toFixed(2), (row.netCents / 100).toFixed(2)]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header, ...body].join("\n");
}

export function poPayApplications(orgId: string, purchaseOrderId: string, role: Role) {
  if (!canSeeMoney(role)) return [];
  const db = getDb();
  return db
    .select()
    .from(payApplications)
    .where(and(eq(payApplications.orgId, orgId), eq(payApplications.purchaseOrderId, purchaseOrderId)))
    .all()
    .map((app) => rowOf(db, orgId, app))
    .sort((a, b) => a.number - b.number);
}

export function portalPayApplications(orgId: string, contactId: string) {
  const db = getDb();
  const apps = db
    .select()
    .from(payApplications)
    .where(and(eq(payApplications.orgId, orgId), eq(payApplications.vendorContactId, contactId)))
    .all()
    .filter((row) => row.status !== "void");
  return apps
    .map((app) => {
      const order = poOf(db, orgId, app.purchaseOrderId);
      const lines = loadLines(db, orgId, app.id);
      const sov = scheduleLines(db, orgId, app.purchaseOrderId);
      const byLine = new Map(sov.map((line) => [line.id, line]));
      let figures: { line: LineRow; figure: LineFigure }[] = [];
      try {
        figures = figuresFor(db, orgId, app, lines, sov).figures;
      } catch {
        figures = [];
      }
      return {
        id: app.id,
        number: app.number,
        purchaseOrderId: app.purchaseOrderId,
        poNumber: order?.number ?? "",
        status: app.status,
        statusLabel: STATUS_LABEL[app.status] ?? app.status,
        periodEnd: app.periodEnd,
        editable: app.status === "draft" || app.status === "revise",
        lines: figures.map(({ line, figure }) => ({
          id: line.id,
          purchaseOrderLineId: line.purchaseOrderLineId,
          costCode: byLine.get(line.purchaseOrderLineId)?.costCode ?? "",
          description: byLine.get(line.purchaseOrderLineId)?.description ?? "",
          scheduledCents: figure.scheduledCents,
          previousCents: figure.previousCents,
          thisPeriodCents: figure.thisPeriodCents,
          storedCents: figure.storedCents,
          releasedCents: figure.releasedCents,
          rejectNote: line.rejectNote,
        })),
      };
    })
    .sort((a, b) => a.poNumber.localeCompare(b.poNumber) || a.number - b.number);
}

export function portalSavePayApplication(input: { tokenOrgId: string; contactId: string; applicationId: string; lines: PayLineInput[] }) {
  const db = getDb();
  const app = loadApp(db, input.tokenOrgId, input.applicationId);
  if (!app || app.vendorContactId !== input.contactId) throw new ServiceError("Pay application not found.");
  if (app.status !== "draft" && app.status !== "revise") throw new ServiceError("This application cannot be edited.");
  const order = poOf(db, app.orgId, app.purchaseOrderId);
  if (!order) throw new ServiceError("Purchase order not found.");
  const existing = loadLines(db, app.orgId, app.id);
  const keep = new Map(existing.map((line) => [line.purchaseOrderLineId, line.retainageBps]));
  const notes = new Map(existing.map((line) => [line.purchaseOrderLineId, line.rejectNote]));
  const lines = input.lines.map((line) => ({
    ...line,
    retainageBps: keep.get(line.purchaseOrderLineId),
    rejectNote: notes.get(line.purchaseOrderLineId) ?? "",
  }));
  writeLines(db, app.orgId, app.id, scheduleLines(db, app.orgId, order.id), lines, order.retainageBps, keep);
  checkFigures(db, app.orgId, app);
  db.update(payApplications).set({ updatedAt: nowIso() }).where(and(eq(payApplications.id, app.id), eq(payApplications.orgId, app.orgId))).run();
  return { id: app.id };
}

export function portalSubmitPayApplication(orgId: string, contactId: string, applicationId: string) {
  const db = getDb();
  const app = loadApp(db, orgId, applicationId);
  if (!app || app.vendorContactId !== contactId) throw new ServiceError("Pay application not found.");
  return submitStored(null, applicationId, orgId);
}

export function portalCreatePayApplication(orgId: string, contactId: string, purchaseOrderId: string, input: { periodStart: string; periodEnd: string; lines: PayLineInput[] }) {
  const db = getDb();
  const order = poOf(db, orgId, purchaseOrderId);
  if (!order || order.vendorContactId !== contactId) throw new ServiceError("Purchase order not found.");
  if (order.status !== "issued" || order.declinedAt) throw new ServiceError("Purchase order not found.");
  if (order.billingMethod !== "progress") throw new ServiceError("This purchase order is not set to bill by progress.");
  if (hasFlatBill(db, orgId, order.id)) throw new ServiceError("This purchase order already has a bill.");
  if (openApp(db, orgId, order.id)) throw new ServiceError("This purchase order already has an open application.");
  const periodStart = dayOrThrow(input.periodStart, "period start");
  const periodEnd = dayOrThrow(input.periodEnd, "period end");
  if (periodEnd < periodStart) throw new ServiceError("The period end is before the start.");
  const sov = scheduleLines(db, orgId, order.id);
  const applicationId = id("pa");
  const now = nowIso();
  db.insert(payApplications)
    .values({
      id: applicationId,
      orgId,
      purchaseOrderId: order.id,
      projectId: order.projectId,
      vendorContactId: order.vendorContactId,
      number: nextNumber(db, orgId, order.id),
      periodStart,
      periodEnd,
      status: "draft",
      billId: null,
      note: "",
      voidReason: null,
      voidedAt: null,
      submittedAt: null,
      reviewedAt: null,
      approvedAt: null,
      approvedBy: null,
      version: 1,
      requestedAt: null,
      requestedBy: null,
      copiedAt: null,
      copiedBy: null,
      createdAt: now,
      updatedAt: now,
      createdBy: null,
    })
    .run();
  writeLines(db, orgId, applicationId, sov, input.lines, order.retainageBps, new Map());
  checkFigures(db, orgId, loadApp(db, orgId, applicationId)!);
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId: null,
      action: "pay_application.create",
      entityType: "pay_application",
      entityId: applicationId,
      payloadJson: JSON.stringify({ purchaseOrderId: order.id }),
      ip: null,
      createdAt: now,
    })
    .run();
  return { id: applicationId };
}

export function moneyOf(raw: string) {
  const text = raw.trim();
  if (!text) return 0;
  const cents = parseMoneyToCents(text);
  if (cents == null) throw new ServiceError("Enter an amount.");
  return cents;
}

export function bpsOf(raw: string, fallback: number) {
  const text = raw.trim();
  if (!text) return fallback;
  if (!/^\d+(\.\d)?$/.test(text)) throw new ServiceError("Enter the retainage percent.");
  const bps = Math.round(Number(text) * 100);
  if (bps < 0 || bps > 10_000) throw new ServiceError("Enter the retainage percent.");
  return bps;
}
