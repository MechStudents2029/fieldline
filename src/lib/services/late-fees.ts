import { and, eq } from "drizzle-orm";
import {
  AR_BUCKETS,
  LATE_FEE_LINE,
  allocatePayment,
  arBucket,
  feeAmount,
  feeEligible,
  feePeriod,
  lateFeePolicyLine,
  unpaidCents,
  type ArBucket,
  type LatePolicy,
} from "@/lib/fees/late";
import { getDb, type AppDatabase } from "@/lib/db/client";
import {
  agreementInvoices,
  auditLogs,
  clientStatements,
  contacts,
  draws,
  invoiceLines,
  invoices,
  lateFees,
  memberships,
  notifications,
  organizations,
  payments,
  projects,
  users,
} from "@/lib/db/schema";
import { id, nowIso, token } from "@/lib/ids";
import { dollarsToCents, formatMoney } from "@/lib/money";
import { canManageMoney, canManageSettings, canSeeMoney, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { localDay } from "@/lib/time/calendar";

type Writer = Pick<AppDatabase, "insert" | "select" | "update" | "delete">;

function roleOf(actor: Actor): Role {
  return actor.role as Role;
}

function see(actor: Actor) {
  if (!canSeeMoney(roleOf(actor))) throw new ServiceError("Your role cannot see this.");
}

function office(actor: Actor) {
  see(actor);
  if (!canManageMoney(roleOf(actor))) throw new ServiceError("Your role cannot change this.");
}

function settings(actor: Actor) {
  see(actor);
  if (!canManageSettings(roleOf(actor))) throw new ServiceError("Your role cannot change this.");
}

function audit(db: Writer, orgId: string, actorId: string | null, action: string, entityId: string, payload: unknown) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "late_fee",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

export function policyFromOrg(org: {
  lateEnabled: number;
  lateFlatCents: number;
  lateMonthlyBps: number;
  lateGraceDays: number;
  lateMinimumCents: number;
  lateCapCents: number;
  lateExcludeRetainage: number;
  lateExcludeDraws: number;
  lateExcludeAgreements: number;
  lateMode: string;
} | null | undefined): LatePolicy {
  return {
    enabled: org?.lateEnabled === 1,
    flatCents: org?.lateFlatCents ?? 0,
    monthlyBps: org?.lateMonthlyBps ?? 0,
    graceDays: org?.lateGraceDays ?? 7,
    minimumCents: org?.lateMinimumCents ?? 0,
    capCents: org?.lateCapCents ?? 0,
    excludeRetainage: org?.lateExcludeRetainage === 1,
    excludeDraws: org?.lateExcludeDraws === 1,
    excludeAgreements: org?.lateExcludeAgreements === 1,
    mode: org?.lateMode === "apply" ? "apply" : "review",
  };
}

export function policyForOrg(orgId: string): LatePolicy {
  const org = getDb().select().from(organizations).where(eq(organizations.id, orgId)).get();
  return policyFromOrg(org);
}

export function policyLineForOrg(orgId: string): string | null {
  return lateFeePolicyLine(policyForOrg(orgId));
}

export function billingPolicy(actor: Actor) {
  see(actor);
  const org = getDb().select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  if (!org) throw new ServiceError("Company not found.");
  const policy = policyFromOrg(org);
  return { policy, line: lateFeePolicyLine(policy), canEdit: canManageSettings(roleOf(actor)) };
}

function dollars(value: string, label: string): number {
  const text = value.trim();
  if (!text) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new ServiceError(`Enter ${label} in dollars.`);
  const cents = dollarsToCents(Number(text));
  if (cents < 0 || cents > 100_000_000) throw new ServiceError(`Enter ${label} in dollars.`);
  return cents;
}

export function saveLatePolicy(
  actor: Actor,
  input: {
    enabled: boolean;
    flat: string;
    percent: string;
    grace: string;
    minimum: string;
    cap: string;
    excludeRetainage: boolean;
    excludeDraws: boolean;
    excludeAgreements: boolean;
    mode: string;
  },
) {
  settings(actor);
  const flatCents = dollars(input.flat, "the flat fee");
  const minimumCents = dollars(input.minimum, "the minimum");
  const capCents = dollars(input.cap, "the cap");
  const percentText = input.percent.trim() || "0";
  if (!/^\d+(\.\d{1,2})?$/.test(percentText)) throw new ServiceError("Enter the monthly percent.");
  const monthlyBps = Math.round(Number(percentText) * 100);
  if (monthlyBps < 0 || monthlyBps > 10_000) throw new ServiceError("Enter the monthly percent.");
  const graceDays = Number(input.grace);
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 90) throw new ServiceError("Enter grace days.");
  const mode = input.mode === "apply" ? "apply" : "review";
  const now = nowIso();
  getDb()
    .update(organizations)
    .set({
      lateEnabled: input.enabled ? 1 : 0,
      lateFlatCents: flatCents,
      lateMonthlyBps: monthlyBps,
      lateGraceDays: graceDays,
      lateMinimumCents: minimumCents,
      lateCapCents: capCents,
      lateExcludeRetainage: input.excludeRetainage ? 1 : 0,
      lateExcludeDraws: input.excludeDraws ? 1 : 0,
      lateExcludeAgreements: input.excludeAgreements ? 1 : 0,
      lateMode: mode,
      updatedAt: now,
    })
    .where(eq(organizations.id, actor.orgId))
    .run();
  audit(getDb(), actor.orgId, actor.userId, "late_fee.policy", actor.orgId, { enabled: input.enabled, mode });
  return { ok: true };
}

function todayFor(orgId: string): string {
  const org = getDb().select().from(organizations).where(eq(organizations.id, orgId)).get();
  return localDay(Date.now(), org?.timeZone || "America/New_York");
}

function flags(orgId: string) {
  const drawIds = new Set(
    getDb()
      .select()
      .from(draws)
      .where(eq(draws.orgId, orgId))
      .all()
      .map((row) => row.invoiceId)
      .filter((value): value is string => Boolean(value)),
  );
  const agreementIds = new Set(
    getDb()
      .select()
      .from(agreementInvoices)
      .where(eq(agreementInvoices.orgId, orgId))
      .all()
      .map((row) => row.invoiceId),
  );
  return { drawIds, agreementIds };
}

function chargedCents(orgId: string, invoiceId: string): number {
  return getDb()
    .select()
    .from(lateFees)
    .where(and(eq(lateFees.orgId, orgId), eq(lateFees.invoiceId, invoiceId)))
    .all()
    .filter((row) => row.status === "pending" || row.status === "applied")
    .reduce((sum, row) => sum + row.amountCents, 0);
}

function notifyPending(db: Writer, orgId: string, feeId: string, snippet: string, stamp: string) {
  const owners = db
    .select({ id: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.orgId, orgId))
    .all()
    .filter((row) => row.role === "owner" || row.role === "admin");
  for (const owner of owners) {
    db.insert(notifications)
      .values({
        id: id("note"),
        orgId,
        userId: owner.id,
        kind: "late_fee",
        commentId: null,
        entityType: "late_fee",
        entityId: feeId,
        projectId: null,
        actorId: null,
        actorName: "Fieldline",
        snippet,
        readAt: null,
        createdAt: stamp,
      })
      .run();
  }
}

function applyOn(db: Writer, orgId: string, feeId: string, actorId: string | null) {
  const fee = db.select().from(lateFees).where(and(eq(lateFees.id, feeId), eq(lateFees.orgId, orgId))).get();
  if (!fee) throw new ServiceError("Fee not found.");
  if (fee.status === "applied") throw new ServiceError("Already applied.");
  if (fee.status === "waived") throw new ServiceError("This fee was waived.");
  const invoice = db.select().from(invoices).where(and(eq(invoices.id, fee.invoiceId), eq(invoices.orgId, orgId))).get();
  if (!invoice || invoice.status !== "open") throw new ServiceError("That invoice is not open.");
  const now = nowIso();
  const lineId = id("invl");
  const sort = db.select().from(invoiceLines).where(and(eq(invoiceLines.orgId, orgId), eq(invoiceLines.invoiceId, invoice.id))).all().length;
  db.insert(invoiceLines)
    .values({ id: lineId, orgId, invoiceId: invoice.id, description: LATE_FEE_LINE, amountCents: fee.amountCents, sortOrder: sort })
    .run();
  db.update(invoices)
    .set({
      subtotalCents: invoice.subtotalCents + fee.amountCents,
      totalCents: invoice.totalCents + fee.amountCents,
      updatedAt: now,
    })
    .where(and(eq(invoices.id, invoice.id), eq(invoices.orgId, orgId)))
    .run();
  db.update(lateFees)
    .set({ status: "applied", lineId, appliedAt: now, appliedBy: actorId, updatedAt: now })
    .where(and(eq(lateFees.id, fee.id), eq(lateFees.orgId, orgId)))
    .run();
  audit(db, orgId, actorId, "late_fee.apply", fee.id, { invoiceId: invoice.id, amountCents: fee.amountCents });
}

/** One row per invoice per month. A second run the same day does not add another. */
export function scanLateFees(orgId: string): { created: number } {
  const db = getDb();
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) return { created: 0 };
  const policy = policyFromOrg(org);
  if (!policy.enabled) return { created: 0 };
  const today = localDay(Date.now(), org.timeZone || "America/New_York");
  const period = feePeriod(today);
  const { drawIds, agreementIds } = flags(orgId);
  let created = 0;
  for (const invoice of db.select().from(invoices).where(eq(invoices.orgId, orgId)).all()) {
    const existing = db
      .select()
      .from(lateFees)
      .where(and(eq(lateFees.orgId, orgId), eq(lateFees.invoiceId, invoice.id), eq(lateFees.period, period)))
      .get();
    if (existing) continue;
    const eligible = feeEligible(
      policy,
      {
        status: invoice.status,
        dueDate: invoice.dueDate,
        totalCents: invoice.totalCents,
        amountPaidCents: invoice.amountPaidCents,
        retainageCents: invoice.retainageCents,
        type: invoice.type,
        draw: drawIds.has(invoice.id),
        agreement: agreementIds.has(invoice.id),
      },
      today,
    );
    if (!eligible) continue;
    const base = unpaidCents(invoice.totalCents, invoice.amountPaidCents);
    const amount = feeAmount(policy, base, chargedCents(orgId, invoice.id));
    if (amount < 1) continue;
    const stamp = nowIso();
    const feeId = id("lf");
    db.insert(lateFees)
      .values({
        id: feeId,
        orgId,
        invoiceId: invoice.id,
        period,
        status: "pending",
        baseCents: base,
        amountCents: amount,
        lineId: null,
        reason: null,
        appliedAt: null,
        appliedBy: null,
        waivedAt: null,
        waivedBy: null,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .run();
    audit(db, orgId, null, "late_fee.scan", feeId, { invoiceId: invoice.id, period, amountCents: amount });
    if (policy.mode === "apply") {
      applyOn(db, orgId, feeId, null);
    } else {
      notifyPending(db, orgId, feeId, invoice.number, stamp);
    }
    created += 1;
  }
  return { created };
}

export function applyLateFee(actor: Actor, feeId: string) {
  office(actor);
  applyOn(getDb(), actor.orgId, feeId, actor.userId);
  return { id: feeId };
}

export function waiveLateFee(actor: Actor, feeId: string, reason: string) {
  office(actor);
  const note = reason.trim();
  if (note.length < 2) throw new ServiceError("Enter a reason.");
  const db = getDb();
  const fee = db.select().from(lateFees).where(and(eq(lateFees.id, feeId), eq(lateFees.orgId, actor.orgId))).get();
  if (!fee) throw new ServiceError("Fee not found.");
  if (fee.status === "waived") throw new ServiceError("Already waived.");
  const now = nowIso();
  if (fee.status === "applied") {
    const invoice = db.select().from(invoices).where(and(eq(invoices.id, fee.invoiceId), eq(invoices.orgId, actor.orgId))).get();
    if (!invoice) throw new ServiceError("Invoice not found.");
    if (fee.lineId) {
      db.delete(invoiceLines).where(and(eq(invoiceLines.id, fee.lineId), eq(invoiceLines.orgId, actor.orgId))).run();
    }
    const total = Math.max(0, invoice.totalCents - fee.amountCents);
    const subtotal = Math.max(0, invoice.subtotalCents - fee.amountCents);
    const status = invoice.status === "void" ? "void" : invoice.amountPaidCents >= total ? "paid" : invoice.status;
    db.update(invoices)
      .set({ totalCents: total, subtotalCents: subtotal, status, updatedAt: now })
      .where(and(eq(invoices.id, invoice.id), eq(invoices.orgId, actor.orgId)))
      .run();
  }
  db.update(lateFees)
    .set({ status: "waived", reason: note, waivedAt: now, waivedBy: actor.userId, updatedAt: now })
    .where(and(eq(lateFees.id, fee.id), eq(lateFees.orgId, actor.orgId)))
    .run();
  audit(db, actor.orgId, actor.userId, "late_fee.waive", fee.id, { invoiceId: fee.invoiceId, reason: note, amountCents: fee.amountCents });
  return { id: fee.id };
}

export type FeeRow = {
  id: string;
  invoiceId: string;
  number: string;
  client: string;
  projectId: string;
  status: string;
  amountCents: number;
  baseCents: number;
  period: string;
  reason: string | null;
  dueDate: string;
};

export function listLateFees(actor: Actor, status = ""): FeeRow[] {
  see(actor);
  const db = getDb();
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, actor.orgId)).all().map((row) => [row.id, row]));
  const people = new Map(db.select().from(contacts).where(eq(contacts.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  const bills = new Map(db.select().from(invoices).where(eq(invoices.orgId, actor.orgId)).all().map((row) => [row.id, row]));
  return db
    .select()
    .from(lateFees)
    .where(eq(lateFees.orgId, actor.orgId))
    .all()
    .filter((row) => !status || row.status === status)
    .map((row) => {
      const invoice = bills.get(row.invoiceId);
      const project = invoice ? jobs.get(invoice.projectId) : undefined;
      return {
        id: row.id,
        invoiceId: row.invoiceId,
        number: invoice?.number ?? "Invoice",
        client: project ? people.get(project.contactId) ?? "Client" : "Client",
        projectId: invoice?.projectId ?? "",
        status: row.status,
        amountCents: row.amountCents,
        baseCents: row.baseCents,
        period: row.period,
        reason: row.reason,
        dueDate: invoice?.dueDate ?? "",
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));
}

export function lateFeeDetail(actor: Actor, feeId: string) {
  see(actor);
  const row = listLateFees(actor).find((item) => item.id === feeId);
  if (!row) throw new ServiceError("Fee not found.");
  return { ...row, canEdit: canManageMoney(roleOf(actor)) && row.status !== "waived" };
}

export function lateFeeAttention(actor: Actor): { count: number; cents: number; href: string | null } {
  if (!canSeeMoney(roleOf(actor))) return { count: 0, cents: 0, href: null };
  const rows = listLateFees(actor, "pending");
  const cents = rows.reduce((sum, row) => sum + row.amountCents, 0);
  return { count: rows.length, cents, href: rows.length ? "/fees?status=pending" : null };
}

export function lateFeeNotice(orgId: string, feeId: string): { record: string; href: string } | null {
  const fee = getDb().select().from(lateFees).where(and(eq(lateFees.id, feeId), eq(lateFees.orgId, orgId))).get();
  if (!fee) return null;
  const invoice = getDb().select().from(invoices).where(and(eq(invoices.id, fee.invoiceId), eq(invoices.orgId, orgId))).get();
  return { record: invoice?.number ?? "Fee", href: `/fees/${fee.id}` };
}

export function portalFeeLines(orgId: string, invoiceIds: string[]): Map<string, number> {
  if (invoiceIds.length === 0) return new Map();
  const rows = getDb().select().from(invoiceLines).where(eq(invoiceLines.orgId, orgId)).all();
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!invoiceIds.includes(row.invoiceId) || row.description !== LATE_FEE_LINE || row.amountCents <= 0) continue;
    map.set(row.invoiceId, (map.get(row.invoiceId) ?? 0) + row.amountCents);
  }
  return map;
}

export type AgingRow = { contactId: string; name: string; buckets: Record<ArBucket, number>; totalCents: number };

export function arAging(actor: Actor): { rows: AgingRow[]; totals: Record<ArBucket, number> & { totalCents: number } } {
  see(actor);
  const db = getDb();
  const today = todayFor(actor.orgId);
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, actor.orgId)).all().map((row) => [row.id, row]));
  const people = new Map(db.select().from(contacts).where(eq(contacts.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  const grouped = new Map<string, AgingRow>();
  for (const invoice of db.select().from(invoices).where(eq(invoices.orgId, actor.orgId)).all()) {
    if (invoice.status !== "open") continue;
    const balance = unpaidCents(invoice.totalCents, invoice.amountPaidCents);
    if (balance < 1) continue;
    const project = jobs.get(invoice.projectId);
    if (!project) continue;
    const bucket = arBucket(invoice.dueDate, today);
    const current = grouped.get(project.contactId) ?? {
      contactId: project.contactId,
      name: people.get(project.contactId) ?? "Client",
      buckets: { Current: 0, "1–30": 0, "31–60": 0, "61–90": 0, "90+": 0 },
      totalCents: 0,
    };
    current.buckets[bucket] += balance;
    current.totalCents += balance;
    grouped.set(project.contactId, current);
  }
  const rows = [...grouped.values()].sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name));
  const totals = { Current: 0, "1–30": 0, "31–60": 0, "61–90": 0, "90+": 0, totalCents: 0 };
  for (const row of rows) {
    for (const bucket of AR_BUCKETS) totals[bucket] += row.buckets[bucket];
    totals.totalCents += row.totalCents;
  }
  return { rows, totals };
}

function csvMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function arAgingCsv(actor: Actor): string {
  const report = arAging(actor);
  const header = ["Client", ...AR_BUCKETS, "Total"];
  const lines = report.rows.map((row) => [row.name, ...AR_BUCKETS.map((bucket) => csvMoney(row.buckets[bucket])), csvMoney(row.totalCents)]);
  lines.push(["Total", ...AR_BUCKETS.map((bucket) => csvMoney(report.totals[bucket])), csvMoney(report.totals.totalCents)]);
  return [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export type StatementEvent = { date: string; label: string; chargeCents: number; creditCents: number; balanceCents: number };
export type StatementView = {
  id: string;
  token: string;
  path: string;
  contactId: string;
  client: string;
  sentAt: string | null;
  sentByName: string | null;
  buckets: Record<ArBucket, number>;
  totalCents: number;
  events: StatementEvent[];
  policy: string | null;
};

function statementEvents(orgId: string, contactId: string, today: string): { events: StatementEvent[]; buckets: Record<ArBucket, number>; totalCents: number } {
  const db = getDb();
  const jobs = db.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.contactId, contactId))).all();
  const jobIds = new Set(jobs.map((row) => row.id));
  const bills = db.select().from(invoices).where(eq(invoices.orgId, orgId)).all().filter((row) => jobIds.has(row.projectId) && row.status !== "void");
  const billIds = new Set(bills.map((row) => row.id));
  const feeRows = db.select().from(lateFees).where(eq(lateFees.orgId, orgId)).all().filter((row) => billIds.has(row.invoiceId));
  const payRows = db
    .select()
    .from(payments)
    .where(eq(payments.orgId, orgId))
    .all()
    .filter((row) => billIds.has(row.invoiceId) && (row.status === "succeeded" || row.method === "credit_memo"));
  const applied = new Map<string, number>();
  for (const fee of feeRows) {
    if (fee.status !== "applied") continue;
    applied.set(fee.invoiceId, (applied.get(fee.invoiceId) ?? 0) + fee.amountCents);
  }
  type Raw = { date: string; label: string; chargeCents: number; creditCents: number; sort: string };
  const raw: Raw[] = [];
  const buckets: Record<ArBucket, number> = { Current: 0, "1–30": 0, "31–60": 0, "61–90": 0, "90+": 0 };
  let totalCents = 0;
  for (const invoice of bills) {
    const feeSum = applied.get(invoice.id) ?? 0;
    const principal = Math.max(0, invoice.totalCents - feeSum);
    raw.push({ date: invoice.issueDate.slice(0, 10), label: invoice.number, chargeCents: principal, creditCents: 0, sort: `0-${invoice.number}` });
    if (invoice.status === "open") {
      const balance = unpaidCents(invoice.totalCents, invoice.amountPaidCents);
      if (balance > 0) {
        buckets[arBucket(invoice.dueDate, today)] += balance;
        totalCents += balance;
      }
    }
  }
  for (const fee of feeRows) {
    const invoice = bills.find((row) => row.id === fee.invoiceId);
    if (!invoice) continue;
    if (fee.status === "applied") {
      raw.push({
        date: (fee.appliedAt ?? fee.createdAt).slice(0, 10),
        label: `${LATE_FEE_LINE} · ${invoice.number}`,
        chargeCents: fee.amountCents,
        creditCents: 0,
        sort: `1-${fee.id}`,
      });
    } else if (fee.status === "waived") {
      raw.push({
        date: (fee.waivedAt ?? fee.createdAt).slice(0, 10),
        label: `Waived · ${invoice.number}${fee.reason ? ` · ${fee.reason}` : ""}`,
        chargeCents: 0,
        creditCents: 0,
        sort: `2-${fee.id}`,
      });
    }
  }
  for (const payment of payRows) {
    if (payment.status === "void") continue;
    const invoice = bills.find((row) => row.id === payment.invoiceId);
    const label = payment.method === "credit_memo" ? `Credit · ${invoice?.number ?? ""}` : `Payment · ${invoice?.number ?? ""}`;
    raw.push({
      date: payment.createdAt.slice(0, 10),
      label,
      chargeCents: 0,
      creditCents: payment.amountCents,
      sort: `3-${payment.id}`,
    });
  }
  raw.sort((a, b) => a.date.localeCompare(b.date) || a.sort.localeCompare(b.sort));
  let balance = 0;
  const events = raw.map((row) => {
    balance += row.chargeCents - row.creditCents;
    return { date: row.date, label: row.label, chargeCents: row.chargeCents, creditCents: row.creditCents, balanceCents: balance };
  });
  return { events, buckets, totalCents };
}

export function statementView(orgId: string, statement: typeof clientStatements.$inferSelect): StatementView {
  const db = getDb();
  const today = todayFor(orgId);
  const contact = db.select().from(contacts).where(and(eq(contacts.id, statement.contactId), eq(contacts.orgId, orgId))).get();
  const sender = statement.sentBy ? db.select().from(users).where(eq(users.id, statement.sentBy)).get() : null;
  const body = statementEvents(orgId, statement.contactId, today);
  return {
    id: statement.id,
    token: statement.token,
    path: `/s/${statement.token}`,
    contactId: statement.contactId,
    client: contact?.name ?? "Client",
    sentAt: statement.sentAt,
    sentByName: sender?.name ?? null,
    buckets: body.buckets,
    totalCents: body.totalCents,
    events: body.events,
    policy: policyLineForOrg(orgId),
  };
}

export function listStatements(actor: Actor) {
  see(actor);
  const db = getDb();
  const people = new Map(db.select().from(contacts).where(eq(contacts.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  return db
    .select()
    .from(clientStatements)
    .where(eq(clientStatements.orgId, actor.orgId))
    .all()
    .map((row) => ({ id: row.id, contactId: row.contactId, client: people.get(row.contactId) ?? "Client", sentAt: row.sentAt, path: `/s/${row.token}` }))
    .sort((a, b) => a.client.localeCompare(b.client));
}

export function openStatement(actor: Actor, statementId: string): StatementView {
  see(actor);
  const row = getDb().select().from(clientStatements).where(and(eq(clientStatements.id, statementId), eq(clientStatements.orgId, actor.orgId))).get();
  if (!row) throw new ServiceError("Statement not found.");
  return statementView(actor.orgId, row);
}

export function statementByToken(publicToken: string): StatementView | null {
  const row = getDb().select().from(clientStatements).where(eq(clientStatements.token, publicToken)).get();
  if (!row) return null;
  return statementView(row.orgId, row);
}

export function ensureStatement(actor: Actor, contactId: string) {
  office(actor);
  const db = getDb();
  const contact = db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.orgId, actor.orgId), eq(contacts.type, "client"))).get();
  if (!contact) throw new ServiceError("Client not found.");
  const existing = db.select().from(clientStatements).where(and(eq(clientStatements.orgId, actor.orgId), eq(clientStatements.contactId, contactId))).get();
  if (existing) return { id: existing.id };
  const now = nowIso();
  const statementId = id("stmt");
  db.insert(clientStatements)
    .values({
      id: statementId,
      orgId: actor.orgId,
      contactId,
      token: token(),
      sentAt: null,
      sentBy: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  audit(db, actor.orgId, actor.userId, "statement.create", statementId, { contactId });
  return { id: statementId };
}

export function markStatementSent(actor: Actor, statementId: string) {
  office(actor);
  const db = getDb();
  const row = db.select().from(clientStatements).where(and(eq(clientStatements.id, statementId), eq(clientStatements.orgId, actor.orgId))).get();
  if (!row) throw new ServiceError("Statement not found.");
  if (row.sentAt) throw new ServiceError("Already sent.");
  const now = nowIso();
  db.update(clientStatements)
    .set({ sentAt: now, sentBy: actor.userId, updatedAt: now })
    .where(and(eq(clientStatements.id, row.id), eq(clientStatements.orgId, actor.orgId)))
    .run();
  audit(db, actor.orgId, actor.userId, "statement.sent", row.id, { contactId: row.contactId });
  return { id: row.id, sentAt: now };
}

export function clientChoices(actor: Actor) {
  see(actor);
  return getDb()
    .select()
    .from(contacts)
    .where(and(eq(contacts.orgId, actor.orgId), eq(contacts.type, "client")))
    .all()
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function feeAllocation(orgId: string, invoiceId: string, paidCents: number) {
  const invoice = getDb().select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId))).get();
  if (!invoice) return null;
  const fees = getDb()
    .select()
    .from(lateFees)
    .where(and(eq(lateFees.orgId, orgId), eq(lateFees.invoiceId, invoiceId)))
    .all()
    .filter((row) => row.status === "applied")
    .map((row) => ({ id: row.id, amountCents: row.amountCents, appliedAt: row.appliedAt ?? row.createdAt }));
  const feeSum = fees.reduce((sum, row) => sum + row.amountCents, 0);
  return allocatePayment(Math.max(0, invoice.totalCents - feeSum), fees, paidCents);
}

export { formatMoney, lateFeePolicyLine };
