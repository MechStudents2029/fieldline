import { and, eq } from "drizzle-orm";
import {
  addDays,
  daysBetween,
  displayStatus,
  HORIZON_DAYS,
  isBilling,
  isCadence,
  isIsoDate,
  isTermKind,
  lineAmountCents,
  monthlyNormalizedCents,
  periodDates,
  renewalRateBps,
  sellUnitCents,
  statusLabel,
  termEnd,
  visitDates,
  type Billing,
  type Cadence,
  type DisplayStatus,
  type TermKind,
} from "@/lib/agreements/cadence";
import { officeDb } from "@/lib/db/office";
import { getDb, type AppDatabase } from "@/lib/db/client";
import {
  agreementChecks,
  agreementInvoices,
  agreementLines,
  agreementVisits,
  contacts,
  invoices,
  invoiceLines,
  memberships,
  notifications,
  priceBookItems,
  projects,
  scheduleAssignees,
  scheduleItems,
  serviceAgreements,
  users,
} from "@/lib/db/schema";
import { id, nowIso, token } from "@/lib/ids";
import { canAddFieldNotes, canEditSchedule, canManageMoney, type Role } from "@/lib/permissions";
import { emitAutomation, type AutomationEvent } from "@/lib/services/automations";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { todayKey } from "@/lib/receiving/facts";

type Writer = Pick<AppDatabase, "insert" | "select" | "update" | "delete" | "transaction">;
type Agreement = typeof serviceAgreements.$inferSelect;
type Visit = typeof agreementVisits.$inferSelect;

export type AgreementLineInput = { code: string; qtyMilli: number };

export type AgreementDraft = {
  contactId: string;
  projectId?: string | null;
  name: string;
  startOn: string;
  termKind: TermKind;
  termMonths?: number | null;
  endOn?: string | null;
  visitLimit?: number | null;
  cadence: Cadence;
  intervalWeeks?: number | null;
  customDates?: string[];
  billing: Billing;
  fixedCents?: number | null;
  checklist?: string[];
  assigneeUserId?: string | null;
  notes?: string | null;
  lines: AgreementLineInput[];
};

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("Office is unavailable.");
  return db;
}

function todayFor(orgId: string) {
  const db = officeDb(orgId) ?? getDb();
  return todayKey(db, orgId);
}

function horizonFor(today: string) {
  return addDays(today, HORIZON_DAYS);
}

function checklistOf(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  } catch {
    return [];
  }
}

function customOf(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && isIsoDate(item));
  } catch {
    return [];
  }
}

function requireAgreement(db: Writer, orgId: string, agreementId: string) {
  const row = db.select().from(serviceAgreements).where(and(eq(serviceAgreements.orgId, orgId), eq(serviceAgreements.id, agreementId))).get();
  if (!row) throw new ServiceError("Agreement not found.");
  return row;
}

function pricedLines(db: Writer, orgId: string, lines: AgreementLineInput[]) {
  const clean = lines
    .map((line) => ({ code: line.code.trim(), qtyMilli: Math.round(line.qtyMilli) }))
    .filter((line) => line.code && line.qtyMilli > 0);
  if (clean.length === 0) throw new ServiceError("Add a price-book line.");
  return clean.map((line, index) => {
    const item = db
      .select()
      .from(priceBookItems)
      .where(and(eq(priceBookItems.orgId, orgId), eq(priceBookItems.code, line.code)))
      .get();
    if (!item) throw new ServiceError(`Price book has no ${line.code}.`);
    return {
      id: id("agl"),
      priceBookItemId: item.id,
      code: item.code,
      name: item.name,
      unit: item.unit,
      qtyMilli: line.qtyMilli,
      unitPriceCents: sellUnitCents(item.unitCostCents, item.defaultMarkupBps),
      sortOrder: index,
    };
  });
}

function visitCents(db: Writer, orgId: string, agreementId: string) {
  return db
    .select()
    .from(agreementLines)
    .where(and(eq(agreementLines.orgId, orgId), eq(agreementLines.agreementId, agreementId)))
    .all()
    .reduce((sum, line) => sum + lineAmountCents(line.unitPriceCents, line.qtyMilli), 0);
}

export function createAgreement(actor: Actor, input: AgreementDraft) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Only the office can sell an agreement.");
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!name) throw new ServiceError("Name the agreement.");
  if (!isIsoDate(input.startOn)) throw new ServiceError("Pick a start date.");
  if (!isTermKind(input.termKind) || !isCadence(input.cadence) || !isBilling(input.billing)) throw new ServiceError("Pick a term, cadence, and billing rule.");
  const db = dbFor(actor);
  const contact = db.select().from(contacts).where(and(eq(contacts.orgId, actor.orgId), eq(contacts.id, input.contactId))).get();
  if (!contact || contact.type !== "client") throw new ServiceError("Pick a client.");
  if (input.projectId) {
    const project = db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, input.projectId))).get();
    if (!project || project.contactId !== contact.id) throw new ServiceError("That job is not this client's.");
  }
  const endOn = termEnd(input);
  if (input.termKind === "months" && !endOn) throw new ServiceError("Enter the number of months.");
  if (input.termKind === "date" && !endOn) throw new ServiceError("Pick an end date.");
  if (input.termKind === "visits" && (input.visitLimit ?? 0) < 1) throw new ServiceError("Enter how many visits.");
  const lines = pricedLines(db, actor.orgId, input.lines);
  const agreementId = id("agr");
  const now = nowIso();
  const checklist = (input.checklist ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 20);
  db.transaction((tx) => {
    tx.insert(serviceAgreements)
      .values({
        id: agreementId,
        orgId: actor.orgId,
        contactId: contact.id,
        projectId: input.projectId || null,
        name,
        status: "draft",
        startOn: input.startOn,
        termKind: input.termKind,
        termMonths: input.termKind === "months" ? input.termMonths ?? null : null,
        endOn,
        visitLimit: input.termKind === "visits" ? input.visitLimit ?? null : null,
        cadence: input.cadence,
        intervalWeeks: Math.max(1, input.intervalWeeks ?? 1),
        customDates: JSON.stringify(input.customDates ?? []),
        billing: input.billing,
        fixedCents: Math.max(0, Math.round(input.fixedCents ?? 0)),
        checklistJson: JSON.stringify(checklist),
        assigneeUserId: input.assigneeUserId || null,
        notes: (input.notes ?? "").trim().slice(0, 500),
        parentId: null,
        acceptToken: token(),
        acceptedAt: null,
        acceptedName: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    for (const line of lines) {
      tx.insert(agreementLines)
        .values({ ...line, orgId: actor.orgId, agreementId })
        .run();
    }
  });
  return { id: agreementId };
}

function specOf(row: Agreement) {
  return {
    startOn: row.startOn,
    termKind: row.termKind as TermKind,
    termMonths: row.termMonths,
    endOn: row.endOn,
    visitLimit: row.visitLimit,
    cadence: row.cadence as Cadence,
    intervalWeeks: row.intervalWeeks,
    customDates: customOf(row.customDates),
  };
}

function placeVisit(tx: Writer, row: Agreement, dueOn: string, stamp: string) {
  const visitId = id("agv");
  const projectId = row.projectId;
  const scheduleItemId = projectId ? id("sch") : null;
  tx.insert(agreementVisits)
    .values({
      id: visitId,
      orgId: row.orgId,
      agreementId: row.id,
      dueOn,
      status: "scheduled",
      assigneeUserId: row.assigneeUserId,
      scheduleItemId,
      projectId,
      invoiceId: null,
      skipReason: null,
      completedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    })
    .run();
  checklistOf(row.checklistJson).forEach((label, index) => {
    tx.insert(agreementChecks)
      .values({ id: id("agc"), orgId: row.orgId, visitId, label, done: 0, sortOrder: index })
      .run();
  });
  if (scheduleItemId && projectId) {
    tx.insert(scheduleItems)
      .values({
        id: scheduleItemId,
        orgId: row.orgId,
        projectId,
        title: row.name,
        startDate: dueOn,
        endDate: dueOn,
        startTime: null,
        status: "planned",
        note: null,
        vendorContactId: null,
        confirmStatus: null,
        confirmReason: "",
        confirmProposed: null,
        confirmRequestedBy: null,
        phase: "Service",
        progressBps: 0,
        createdAt: stamp,
        updatedAt: stamp,
        createdBy: row.createdBy,
      })
      .run();
    if (row.assigneeUserId) {
      tx.insert(scheduleAssignees)
        .values({ id: id("scha"), orgId: row.orgId, itemId: scheduleItemId, userId: row.assigneeUserId })
        .run();
    }
  }
  return visitId;
}

export function generateVisits(db: Writer, row: Agreement, today: string) {
  if (row.status !== "active" && row.status !== "pending_renewal") return [];
  const dates = visitDates(specOf(row), horizonFor(today));
  const have = new Set(
    db
      .select({ dueOn: agreementVisits.dueOn })
      .from(agreementVisits)
      .where(and(eq(agreementVisits.orgId, row.orgId), eq(agreementVisits.agreementId, row.id)))
      .all()
      .map((visit) => visit.dueOn),
  );
  const created: string[] = [];
  const stamp = nowIso();
  for (const dueOn of dates) {
    if (have.has(dueOn)) continue;
    created.push(placeVisit(db, row, dueOn, stamp));
  }
  return created;
}

export function acceptAgreement(actor: Actor, agreementId: string, acceptedName?: string | null) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Only the office can accept an agreement.");
  const db = dbFor(actor);
  const row = requireAgreement(db, actor.orgId, agreementId);
  return acceptRow(db, row, acceptedName?.trim() || actor.name, todayFor(actor.orgId));
}

export function acceptByToken(acceptToken: string, acceptedName: string) {
  const name = acceptedName.trim();
  if (name.length < 2) throw new ServiceError("Type your name.");
  const db = getDb();
  const row = db.select().from(serviceAgreements).where(eq(serviceAgreements.acceptToken, acceptToken)).get();
  if (!row) throw new ServiceError("Agreement not found.");
  return acceptRow(db, row, name, todayFor(row.orgId));
}

function acceptRow(db: Writer, row: Agreement, acceptedName: string, today: string) {
  if (row.status !== "draft") throw new ServiceError("That agreement is already accepted.");
  const now = nowIso();
  const events: AutomationEvent[] = [];
  db.transaction((tx) => {
    tx.update(serviceAgreements)
      .set({ status: "active", acceptedAt: now, acceptedName, updatedAt: now })
      .where(and(eq(serviceAgreements.orgId, row.orgId), eq(serviceAgreements.id, row.id)))
      .run();
    if (row.parentId) {
      tx.update(serviceAgreements)
        .set({ status: "renewed", updatedAt: now })
        .where(and(eq(serviceAgreements.orgId, row.orgId), eq(serviceAgreements.id, row.parentId), eq(serviceAgreements.status, "pending_renewal")))
        .run();
    }
    const fresh = { ...row, status: "active", acceptedAt: now, acceptedName };
    const ids = generateVisits(tx, fresh, today);
    for (const visitId of ids) {
      const visit = tx.select().from(agreementVisits).where(eq(agreementVisits.id, visitId)).get();
      if (visit?.dueOn === today) events.push(visitEvent(fresh, visit));
    }
  });
  for (const event of events) emitAutomation(event);
  return { id: row.id };
}

function visitEvent(row: Agreement, visit: Visit): AutomationEvent {
  return {
    orgId: row.orgId,
    kind: "visit_due",
    recordType: "agreement_visit",
    recordId: visit.id,
    recordLabel: row.name,
    projectId: visit.projectId,
    name: row.name,
  };
}

export function renewAgreement(actor: Actor, agreementId: string) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Only the office can renew an agreement.");
  const db = dbFor(actor);
  const row = requireAgreement(db, actor.orgId, agreementId);
  if (row.status !== "active" && row.status !== "pending_renewal") throw new ServiceError("Renew an active agreement.");
  const existing = db
    .select()
    .from(serviceAgreements)
    .where(and(eq(serviceAgreements.orgId, actor.orgId), eq(serviceAgreements.parentId, row.id), eq(serviceAgreements.status, "draft")))
    .get();
  if (existing) return { id: existing.id };
  const lines = db.select().from(agreementLines).where(and(eq(agreementLines.orgId, actor.orgId), eq(agreementLines.agreementId, row.id))).all();
  const childId = id("agr");
  const startOn = row.endOn ? addDays(row.endOn, 1) : todayFor(actor.orgId);
  const endOn = termEnd({ ...specOf(row), startOn });
  const now = nowIso();
  db.transaction((tx) => {
    tx.insert(serviceAgreements)
      .values({
        ...row,
        id: childId,
        status: "draft",
        startOn,
        endOn,
        parentId: row.id,
        acceptToken: token(),
        acceptedAt: null,
        acceptedName: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    for (const line of lines) {
      tx.insert(agreementLines)
        .values({ ...line, id: id("agl"), agreementId: childId })
        .run();
    }
    tx.update(serviceAgreements)
      .set({ status: "pending_renewal", updatedAt: now })
      .where(and(eq(serviceAgreements.orgId, actor.orgId), eq(serviceAgreements.id, row.id)))
      .run();
  });
  return { id: childId };
}

export function addVisits(actor: Actor, agreementId: string, input: { startOn: string; count: number; gapDays?: number | null }) {
  if (!canEditSchedule(actor.role as Role) && !canManageMoney(actor.role as Role)) throw new ServiceError("Only the office can add visits.");
  if (!isIsoDate(input.startOn)) throw new ServiceError("Pick a date.");
  const count = Math.round(input.count);
  if (count < 1 || count > 60) throw new ServiceError("Add between 1 and 60 visits.");
  const gap = Math.max(1, Math.round(input.gapDays ?? 1));
  const db = dbFor(actor);
  const row = requireAgreement(db, actor.orgId, agreementId);
  if (row.status !== "active" && row.status !== "pending_renewal") throw new ServiceError("Add visits on an active agreement.");
  const stamp = nowIso();
  const ids: string[] = [];
  db.transaction((tx) => {
    for (let index = 0; index < count; index += 1) ids.push(placeVisit(tx, row, addDays(input.startOn, index * gap), stamp));
  });
  return { ids };
}

function requireVisit(db: Writer, orgId: string, visitId: string) {
  const visit = db.select().from(agreementVisits).where(and(eq(agreementVisits.orgId, orgId), eq(agreementVisits.id, visitId))).get();
  if (!visit) throw new ServiceError("Visit not found.");
  return visit;
}

export function assignVisit(actor: Actor, visitId: string, userId: string | null) {
  if (!canEditSchedule(actor.role as Role)) throw new ServiceError("Only the office can assign a visit.");
  const db = dbFor(actor);
  const visit = requireVisit(db, actor.orgId, visitId);
  if (visit.status !== "scheduled") throw new ServiceError("That visit is closed.");
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(agreementVisits)
      .set({ assigneeUserId: userId, updatedAt: now })
      .where(and(eq(agreementVisits.orgId, actor.orgId), eq(agreementVisits.id, visit.id)))
      .run();
    if (visit.scheduleItemId) {
      tx.delete(scheduleAssignees).where(and(eq(scheduleAssignees.orgId, actor.orgId), eq(scheduleAssignees.itemId, visit.scheduleItemId))).run();
      if (userId) {
        tx.insert(scheduleAssignees).values({ id: id("scha"), orgId: actor.orgId, itemId: visit.scheduleItemId, userId }).run();
      }
    }
  });
}

export function moveVisit(actor: Actor, visitId: string, dueOn: string) {
  if (!canEditSchedule(actor.role as Role)) throw new ServiceError("Only the office can move a visit.");
  if (!isIsoDate(dueOn)) throw new ServiceError("Pick a date.");
  const db = dbFor(actor);
  const visit = requireVisit(db, actor.orgId, visitId);
  if (visit.status !== "scheduled") throw new ServiceError("That visit is closed.");
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(agreementVisits).set({ dueOn, updatedAt: now }).where(and(eq(agreementVisits.orgId, actor.orgId), eq(agreementVisits.id, visit.id))).run();
    if (visit.scheduleItemId) {
      tx.update(scheduleItems)
        .set({ startDate: dueOn, endDate: dueOn, updatedAt: now })
        .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, visit.scheduleItemId)))
        .run();
    }
  });
}

export function skipVisit(actor: Actor, visitId: string, reason: string) {
  if (!canAddFieldNotes(actor.role as Role)) throw new ServiceError("You cannot skip a visit.");
  const why = reason.trim();
  if (why.length < 3) throw new ServiceError("Enter a reason.");
  const db = dbFor(actor);
  const visit = requireVisit(db, actor.orgId, visitId);
  if (visit.status !== "scheduled") throw new ServiceError("That visit is closed.");
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(agreementVisits)
      .set({ status: "skipped", skipReason: why.slice(0, 200), updatedAt: now })
      .where(and(eq(agreementVisits.orgId, actor.orgId), eq(agreementVisits.id, visit.id)))
      .run();
    if (visit.scheduleItemId) {
      tx.update(scheduleItems)
        .set({ status: "cancelled", note: why.slice(0, 200), updatedAt: now })
        .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, visit.scheduleItemId)))
        .run();
    }
  });
}

export function linkVisit(actor: Actor, visitId: string, projectId: string) {
  if (!canManageMoney(actor.role as Role) && !canEditSchedule(actor.role as Role)) throw new ServiceError("Only the office can link a job.");
  const db = dbFor(actor);
  const visit = requireVisit(db, actor.orgId, visitId);
  const project = db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, projectId))).get();
  if (!project) throw new ServiceError("Job not found.");
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(agreementVisits)
      .set({ projectId: project.id, updatedAt: now })
      .where(and(eq(agreementVisits.orgId, actor.orgId), eq(agreementVisits.id, visit.id)))
      .run();
    if (visit.scheduleItemId) {
      tx.update(scheduleItems)
        .set({ projectId: project.id, updatedAt: now })
        .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, visit.scheduleItemId)))
        .run();
    }
  });
}

export function setVisitChecks(actor: Actor, visitId: string, doneIds: string[]) {
  if (!canAddFieldNotes(actor.role as Role)) throw new ServiceError("You cannot update a visit.");
  const db = dbFor(actor);
  const visit = requireVisit(db, actor.orgId, visitId);
  const wanted = new Set(doneIds);
  const checks = db.select().from(agreementChecks).where(and(eq(agreementChecks.orgId, actor.orgId), eq(agreementChecks.visitId, visit.id))).all();
  db.transaction((tx) => {
    for (const check of checks) {
      tx.update(agreementChecks)
        .set({ done: wanted.has(check.id) ? 1 : 0 })
        .where(and(eq(agreementChecks.orgId, actor.orgId), eq(agreementChecks.id, check.id)))
        .run();
    }
  });
}

export function completeVisit(actor: Actor, visitId: string, doneIds: string[]) {
  if (!canAddFieldNotes(actor.role as Role)) throw new ServiceError("You cannot complete a visit.");
  const db = dbFor(actor);
  const visit = requireVisit(db, actor.orgId, visitId);
  if (visit.status === "completed") return { invoiceId: visit.invoiceId };
  if (visit.status !== "scheduled") throw new ServiceError("That visit is closed.");
  const row = requireAgreement(db, actor.orgId, visit.agreementId);
  setVisitChecks(actor, visitId, doneIds);
  const checks = db.select().from(agreementChecks).where(and(eq(agreementChecks.orgId, actor.orgId), eq(agreementChecks.visitId, visit.id))).all();
  if (checks.some((check) => check.done !== 1)) throw new ServiceError("Finish the checklist.");
  const now = nowIso();
  const projectId = visit.projectId || row.projectId;
  let invoiceId: string | null = visit.invoiceId;
  db.transaction((tx) => {
    if (row.billing === "per_visit" && projectId && !invoiceId) {
      invoiceId = draftInvoice(tx, {
        orgId: actor.orgId,
        projectId,
        agreementId: row.id,
        visitId: visit.id,
        periodOn: null,
        sourceKey: `visit:${visit.id}`,
        description: row.name,
        amountCents: visitCents(tx, actor.orgId, row.id),
        issueOn: now.slice(0, 10),
        createdBy: actor.userId,
      });
    }
    tx.update(agreementVisits)
      .set({ status: "completed", completedAt: now, invoiceId, projectId, updatedAt: now })
      .where(and(eq(agreementVisits.orgId, actor.orgId), eq(agreementVisits.id, visit.id)))
      .run();
    if (visit.scheduleItemId) {
      tx.update(scheduleItems)
        .set({ status: "done", progressBps: 10000, updatedAt: now })
        .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, visit.scheduleItemId)))
        .run();
    }
  });
  return { invoiceId };
}

function draftInvoice(
  tx: Writer,
  input: {
    orgId: string;
    projectId: string;
    agreementId: string;
    visitId: string | null;
    periodOn: string | null;
    sourceKey: string;
    description: string;
    amountCents: number;
    issueOn: string;
    createdBy: string | null;
  },
) {
  const existing = tx
    .select()
    .from(agreementInvoices)
    .where(and(eq(agreementInvoices.orgId, input.orgId), eq(agreementInvoices.sourceKey, input.sourceKey)))
    .get();
  if (existing) return existing.invoiceId;
  const invoiceId = id("inv");
  const count = tx.select().from(invoices).where(eq(invoices.orgId, input.orgId)).all().length + 1;
  const now = nowIso();
  tx.insert(invoices)
    .values({
      id: invoiceId,
      orgId: input.orgId,
      projectId: input.projectId,
      changeOrderId: null,
      number: `SA-${1000 + count}`,
      type: "service",
      status: "draft",
      scheduleIndex: null,
      issueDate: input.issueOn,
      dueDate: input.issueOn,
      subtotalCents: input.amountCents,
      taxCents: 0,
      totalCents: input.amountCents,
      amountPaidCents: 0,
      payToken: token(),
      applicationNumber: null,
      retainageCents: 0,
      presentAs: "grouped",
      markupDisplay: "baked",
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
    })
    .run();
  tx.insert(invoiceLines)
    .values({
      id: id("invl"),
      orgId: input.orgId,
      invoiceId,
      description: input.description,
      amountCents: input.amountCents,
      sortOrder: 0,
    })
    .run();
  tx.insert(agreementInvoices)
    .values({
      id: id("agin"),
      orgId: input.orgId,
      agreementId: input.agreementId,
      visitId: input.visitId,
      periodOn: input.periodOn,
      invoiceId,
      sourceKey: input.sourceKey,
      createdAt: now,
    })
    .run();
  return invoiceId;
}

export function billPeriods(orgId: string, today: string) {
  const db = officeDb(orgId);
  if (!db) return 0;
  const rows = db
    .select()
    .from(serviceAgreements)
    .where(eq(serviceAgreements.orgId, orgId))
    .all()
    .filter((row) => (row.status === "active" || row.status === "pending_renewal") && row.billing !== "per_visit" && row.projectId);
  let created = 0;
  for (const row of rows) {
    const periods = periodDates(row.startOn, row.billing as Billing, today, row.endOn);
    for (const periodOn of periods) {
      const sourceKey = `period:${row.id}:${periodOn}`;
      const before = db.select().from(agreementInvoices).where(and(eq(agreementInvoices.orgId, orgId), eq(agreementInvoices.sourceKey, sourceKey))).get();
      if (before) continue;
      draftInvoice(db, {
        orgId,
        projectId: row.projectId as string,
        agreementId: row.id,
        visitId: null,
        periodOn,
        sourceKey,
        description: `${row.name} · ${periodOn}`,
        amountCents: row.fixedCents,
        issueOn: periodOn,
        createdBy: null,
      });
      created += 1;
    }
  }
  return created;
}

function officeUsers(db: Writer, orgId: string) {
  return db
    .select({ userId: memberships.userId, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all()
    .filter((member) => member.role === "owner" || member.role === "admin");
}

function notifyOnce(db: Writer, input: { orgId: string; userId: string; entityType: string; entityId: string; projectId: string | null; snippet: string }) {
  const existing = db
    .select()
    .from(notifications)
    .where(and(eq(notifications.orgId, input.orgId), eq(notifications.userId, input.userId), eq(notifications.entityType, input.entityType), eq(notifications.entityId, input.entityId)))
    .get();
  if (existing) return;
  db.insert(notifications)
    .values({
      id: id("note"),
      orgId: input.orgId,
      userId: input.userId,
      kind: "agreement",
      commentId: null,
      entityType: input.entityType,
      entityId: input.entityId,
      projectId: input.projectId,
      actorId: null,
      actorName: "Fieldline",
      snippet: input.snippet,
      readAt: null,
      createdAt: nowIso(),
    })
    .run();
}

export function rollAgreements(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return { invoices: 0, visits: 0 };
  const today = todayFor(orgId);
  const rows = db.select().from(serviceAgreements).where(eq(serviceAgreements.orgId, orgId)).all();
  const events: AutomationEvent[] = [];
  let visits = 0;
  const now = nowIso();
  for (const row of rows) {
    if (row.status === "active" && row.endOn && row.endOn < today) {
      db.update(serviceAgreements).set({ status: "expired", updatedAt: now }).where(eq(serviceAgreements.id, row.id)).run();
      continue;
    }
    if (row.status === "active" || row.status === "pending_renewal") {
      const created = generateVisits(db, row, today);
      visits += created.length;
      for (const visitId of created) {
        const visit = db.select().from(agreementVisits).where(eq(agreementVisits.id, visitId)).get();
        if (visit && visit.dueOn <= today) events.push(visitEvent(row, visit));
      }
    }
    if (displayStatus(row.status, row.endOn, today) === "expiring") {
      events.push({
        orgId,
        kind: "agreement_expiring",
        recordType: "service_agreement",
        recordId: row.id,
        recordLabel: row.name,
        projectId: row.projectId,
        name: row.name,
        days: row.endOn ? daysBetween(today, row.endOn) : 0,
      });
    }
  }
  const invoicesMade = billPeriods(orgId, today);
  const people = officeUsers(db, orgId);
  const openVisits = db.select().from(agreementVisits).where(eq(agreementVisits.orgId, orgId)).all().filter((visit) => visit.status === "scheduled");
  const names = new Map(rows.map((row) => [row.id, row.name]));
  for (const visit of openVisits) {
    if (visit.dueOn > today || visit.assigneeUserId) continue;
    for (const person of people) {
      notifyOnce(db, {
        orgId,
        userId: person.userId,
        entityType: "agreement_visit",
        entityId: visit.id,
        projectId: visit.projectId,
        snippet: `Unscheduled · ${names.get(visit.agreementId) || "Visit"}`,
      });
    }
  }
  for (const visit of openVisits.filter((visit) => visit.dueOn < today)) {
    for (const person of people) {
      notifyOnce(db, {
        orgId,
        userId: person.userId,
        entityType: "agreement_visit",
        entityId: visit.id,
        projectId: visit.projectId,
        snippet: `Overdue · ${names.get(visit.agreementId) || "Visit"}`,
      });
    }
  }
  for (const row of rows) {
    if (displayStatus(row.status, row.endOn, today) !== "expiring") continue;
    for (const person of people) {
      notifyOnce(db, {
        orgId,
        userId: person.userId,
        entityType: "agreement",
        entityId: row.id,
        projectId: row.projectId,
        snippet: `Expiring · ${row.name}`,
      });
    }
  }
  for (const event of events) emitAutomation(event);
  return { invoices: invoicesMade, visits };
}

export function agreementAttention(orgId: string) {
  const db = officeDb(orgId);
  const empty = { count: 0, href: null as string | null };
  if (!db) return { unscheduled: empty, expiring: empty, overdue: empty };
  const today = todayFor(orgId);
  const visits = db.select().from(agreementVisits).where(eq(agreementVisits.orgId, orgId)).all();
  const agreements = db.select().from(serviceAgreements).where(eq(serviceAgreements.orgId, orgId)).all();
  const unscheduled = visits.filter((visit) => visit.status === "scheduled" && !visit.assigneeUserId && visit.dueOn <= today);
  const overdue = visits.filter((visit) => visit.status === "scheduled" && visit.dueOn < today);
  const expiring = agreements.filter((row) => displayStatus(row.status, row.endOn, today) === "expiring");
  return {
    unscheduled: { count: unscheduled.length, href: unscheduled.length ? "/agreements?attention=unscheduled" : null },
    expiring: { count: expiring.length, href: expiring.length ? "/agreements?status=expiring" : null },
    overdue: { count: overdue.length, href: overdue.length ? "/agreements?attention=overdue" : null },
  };
}

export function cancelAgreement(actor: Actor, agreementId: string) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Only the office can cancel an agreement.");
  const db = dbFor(actor);
  const row = requireAgreement(db, actor.orgId, agreementId);
  if (row.status === "renewed" || row.status === "cancelled") throw new ServiceError("That agreement is already closed.");
  db.update(serviceAgreements)
    .set({ status: "cancelled", updatedAt: nowIso() })
    .where(and(eq(serviceAgreements.orgId, actor.orgId), eq(serviceAgreements.id, row.id)))
    .run();
  return { id: row.id };
}

export function agreementChoices(actor: Actor) {
  const db = dbFor(actor);
  const clients = db
    .select()
    .from(contacts)
    .where(eq(contacts.orgId, actor.orgId))
    .all()
    .filter((contact) => contact.type === "client")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((contact) => ({ id: contact.id, name: contact.name }));
  const jobs = db
    .select()
    .from(projects)
    .where(eq(projects.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((project) => ({ id: project.id, name: project.name, contactId: project.contactId }));
  const people = db
    .select({ userId: memberships.userId, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const codes = db
    .select()
    .from(priceBookItems)
    .where(eq(priceBookItems.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((item) => ({ code: item.code, name: item.name }));
  return { clients, jobs, people, codes };
}

export function listAgreements(actor: Actor, filter?: { status?: string; attention?: string }) {
  const db = dbFor(actor);
  const today = todayFor(actor.orgId);
  const rows = db.select().from(serviceAgreements).where(eq(serviceAgreements.orgId, actor.orgId)).all();
  const visits = db.select().from(agreementVisits).where(eq(agreementVisits.orgId, actor.orgId)).all();
  const clients = new Map(db.select().from(contacts).where(eq(contacts.orgId, actor.orgId)).all().map((contact) => [contact.id, contact.name]));
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, actor.orgId)).all().map((project) => [project.id, project.name]));
  const mine = actor.role === "field" ? actor.userId : null;
  return rows
    .map((row) => {
      const own = visits.filter((visit) => visit.agreementId === row.id);
      const shown = displayStatus(row.status, row.endOn, today);
      const next = own
        .filter((visit) => visit.status === "scheduled" && visit.dueOn >= today)
        .sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
      return {
        id: row.id,
        name: row.name,
        client: clients.get(row.contactId) || "Client",
        job: row.projectId ? jobs.get(row.projectId) || "Job" : "",
        status: shown,
        statusLabel: statusLabel(shown),
        nextOn: next?.dueOn ?? null,
        monthlyCents: monthlyNormalizedCents({
          billing: row.billing as Billing,
          fixedCents: row.fixedCents,
          visitCents: visitCents(db, actor.orgId, row.id),
          cadence: row.cadence as Cadence,
          intervalWeeks: row.intervalWeeks,
          customPerYear: customOf(row.customDates).filter((date) => date >= today && date <= addDays(today, 365)).length,
        }),
        assigneeUserId: row.assigneeUserId,
        openVisits: own.filter((visit) => visit.status === "scheduled"),
      };
    })
    .filter((row) => {
      if (mine && row.assigneeUserId !== mine && !row.openVisits.some((visit) => visit.assigneeUserId === mine)) return false;
      if (filter?.status && row.status !== filter.status) return false;
      if (filter?.attention === "unscheduled") return row.openVisits.some((visit) => !visit.assigneeUserId && visit.dueOn <= today);
      if (filter?.attention === "overdue") return row.openVisits.some((visit) => visit.dueOn < today);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function agreementDetail(actor: Actor, agreementId: string) {
  const db = dbFor(actor);
  const row = requireAgreement(db, actor.orgId, agreementId);
  const today = todayFor(actor.orgId);
  const lines = db
    .select()
    .from(agreementLines)
    .where(and(eq(agreementLines.orgId, actor.orgId), eq(agreementLines.agreementId, row.id)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const visits = db
    .select()
    .from(agreementVisits)
    .where(and(eq(agreementVisits.orgId, actor.orgId), eq(agreementVisits.agreementId, row.id)))
    .all()
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.createdAt.localeCompare(b.createdAt));
  const checks = db.select().from(agreementChecks).where(eq(agreementChecks.orgId, actor.orgId)).all();
  const client = db.select().from(contacts).where(and(eq(contacts.orgId, actor.orgId), eq(contacts.id, row.contactId))).get();
  const job = row.projectId ? db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, row.projectId))).get() : null;
  const people = db
    .select({ userId: memberships.userId, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const names = new Map(people.map((person) => [person.userId, person.name]));
  const child = db
    .select()
    .from(serviceAgreements)
    .where(and(eq(serviceAgreements.orgId, actor.orgId), eq(serviceAgreements.parentId, row.id)))
    .all()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const shown = displayStatus(row.status, row.endOn, today);
  const jobs = db.select().from(projects).where(eq(projects.orgId, actor.orgId)).all().sort((a, b) => a.name.localeCompare(b.name));
  const invoiceNumbers = new Map(db.select().from(invoices).where(eq(invoices.orgId, actor.orgId)).all().map((invoice) => [invoice.id, invoice.number]));
  const parent = row.parentId
    ? db.select().from(serviceAgreements).where(and(eq(serviceAgreements.orgId, actor.orgId), eq(serviceAgreements.id, row.parentId))).get()
    : null;
  return {
    id: row.id,
    name: row.name,
    status: shown,
    statusLabel: statusLabel(shown),
    storedStatus: row.status,
    client: client?.name || "Client",
    contactId: row.contactId,
    job: job?.name || "",
    projectId: row.projectId,
    startOn: row.startOn,
    endOn: row.endOn,
    cadence: row.cadence,
    intervalWeeks: row.intervalWeeks,
    billing: row.billing,
    fixedCents: row.fixedCents,
    notes: row.notes,
    acceptToken: row.acceptToken,
    acceptedName: row.acceptedName,
    childId: child?.id ?? null,
    parentId: parent?.id ?? null,
    parentName: parent?.name ?? "",
    monthlyCents: monthlyNormalizedCents({
      billing: row.billing as Billing,
      fixedCents: row.fixedCents,
      visitCents: lines.reduce((sum, line) => sum + lineAmountCents(line.unitPriceCents, line.qtyMilli), 0),
      cadence: row.cadence as Cadence,
      intervalWeeks: row.intervalWeeks,
      customPerYear: customOf(row.customDates).length,
    }),
    lines: lines.map((line) => ({
      id: line.id,
      code: line.code,
      name: line.name,
      qtyMilli: line.qtyMilli,
      amountCents: lineAmountCents(line.unitPriceCents, line.qtyMilli),
    })),
    visits: visits.map((visit) => ({
      id: visit.id,
      dueOn: visit.dueOn,
      status: visit.status,
      assignee: visit.assigneeUserId ? names.get(visit.assigneeUserId) || "Crew" : "",
      assigneeUserId: visit.assigneeUserId,
      projectId: visit.projectId,
      invoiceId: visit.invoiceId,
      invoiceNumber: visit.invoiceId ? invoiceNumbers.get(visit.invoiceId) || "" : "",
      skipReason: visit.skipReason,
      checks: checks
        .filter((check) => check.visitId === visit.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((check) => ({ id: check.id, label: check.label, done: check.done === 1 })),
    })),
    people,
    jobs: jobs.map((project) => ({ id: project.id, name: project.name })),
  };
}

export function agreementsCsv(actor: Actor, status = "") {
  const rows = listAgreements(actor, status ? { status } : undefined);
  const see = canManageMoney(actor.role as Role);
  const header = see ? "name,client,job,status,next,monthly" : "name,client,job,status,next";
  const body = rows.map((row) => {
    const cells = [row.name, row.client, row.job, row.statusLabel, row.nextOn ?? ""];
    if (see) cells.push((row.monthlyCents / 100).toFixed(2));
    return cells.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",");
  });
  return [header, ...body].join("\n");
}

export function clientAgreements(orgId: string, contactId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  const today = todayFor(orgId);
  return db
    .select()
    .from(serviceAgreements)
    .where(and(eq(serviceAgreements.orgId, orgId), eq(serviceAgreements.contactId, contactId)))
    .all()
    .map((row) => {
      const shown = displayStatus(row.status, row.endOn, today);
      const next = db
        .select()
        .from(agreementVisits)
        .where(and(eq(agreementVisits.orgId, orgId), eq(agreementVisits.agreementId, row.id), eq(agreementVisits.status, "scheduled")))
        .all()
        .filter((visit) => visit.dueOn >= today)
        .sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
      return { id: row.id, name: row.name, status: shown, statusLabel: statusLabel(shown), nextOn: next?.dueOn ?? null, active: shown === "active" || shown === "expiring" };
    })
    .filter((row) => row.active)
    .sort((a, b) => (a.nextOn ?? "9").localeCompare(b.nextOn ?? "9"));
}

export function portalAgreements(portalToken: string) {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, portalToken)).get();
  if (!project) return [];
  return db
    .select()
    .from(serviceAgreements)
    .where(and(eq(serviceAgreements.orgId, project.orgId), eq(serviceAgreements.contactId, project.contactId), eq(serviceAgreements.status, "draft")))
    .all()
    .map((row) => ({ id: row.id, name: row.name, startOn: row.startOn, token: row.acceptToken }));
}

export function agreementNotice(db: Writer, orgId: string, entityType: string, entityId: string) {
  if (entityType === "agreement") {
    const row = db.select().from(serviceAgreements).where(and(eq(serviceAgreements.orgId, orgId), eq(serviceAgreements.id, entityId))).get();
    if (!row) return null;
    return { record: row.name, href: `/agreements/${row.id}` };
  }
  if (entityType === "agreement_visit") {
    const visit = db.select().from(agreementVisits).where(and(eq(agreementVisits.orgId, orgId), eq(agreementVisits.id, entityId))).get();
    if (!visit) return null;
    const row = db.select().from(serviceAgreements).where(and(eq(serviceAgreements.orgId, orgId), eq(serviceAgreements.id, visit.agreementId))).get();
    return { record: row?.name || "Visit", href: `/agreements/${visit.agreementId}` };
  }
  return null;
}

export function agreementReport(orgId: string, today: string) {
  const db = officeDb(orgId) ?? getDb();
  const rows = db.select().from(serviceAgreements).where(eq(serviceAgreements.orgId, orgId)).all();
  const visits = db.select().from(agreementVisits).where(eq(agreementVisits.orgId, orgId)).all();
  const clients = new Map(db.select().from(contacts).where(eq(contacts.orgId, orgId)).all().map((contact) => [contact.id, contact.name]));
  const rate = renewalRateBps({
    renewed: rows.filter((row) => row.status === "renewed").length,
    expired: rows.filter((row) => row.status === "expired").length,
  });
  return {
    rate,
    rows: rows.map((row) => {
      const own = visits.filter((visit) => visit.agreementId === row.id);
      const shown = displayStatus(row.status, row.endOn, today);
      return {
        id: row.id,
        name: row.name,
        client: clients.get(row.contactId) || "Client",
        status: statusLabel(shown),
        monthlyCents: monthlyNormalizedCents({
          billing: row.billing as Billing,
          fixedCents: row.fixedCents,
          visitCents: visitCents(db, orgId, row.id),
          cadence: row.cadence as Cadence,
          intervalWeeks: row.intervalWeeks,
          customPerYear: customOf(row.customDates).filter((date) => date >= today && date <= addDays(today, 365)).length,
        }),
        scheduled: own.filter((visit) => visit.status !== "skipped").length,
        completed: own.filter((visit) => visit.status === "completed").length,
        rate,
      };
    }),
  };
}
