import { and, eq } from "drizzle-orm";
import {
  CLIENT_CREDIT_METHOD,
  assertApplySlice,
  cashDueCents,
  clientCreditStatusLabel,
  memoRemainingCents,
  memoStatusAfter,
} from "@/lib/credits/client-memo";
import { getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  clientCreditApplications,
  clientCreditMemoLines,
  clientCreditMemos,
  contacts,
  invoices,
  memberships,
  notifications,
  payments,
  projects,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { canManageMoney, canManageSettings, canSeeMoney, type Role } from "@/lib/permissions";
import { emitAutomation } from "@/lib/services/automations";
import { dismissCollections } from "@/lib/services/collections";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { bindReviewEmit, considerReview } from "@/lib/services/reviews";
import { syncJobCommissions } from "@/lib/services/commissions";

type Database = NonNullable<ReturnType<typeof officeDb>>;
type MemoRow = typeof clientCreditMemos.$inferSelect;

const APPLY = new Set(["ready", "partial"]);
const ATTENTION = new Set(["ready", "partial"]);

export type CreditLineInput = { costCode: string; description: string; amountCents: number };

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function office(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Credit memos are for the office.");
}

function propose(actor: Actor) {
  const role = actor.role as Role;
  if (role !== "field" && !canManageMoney(role)) throw new ServiceError("You cannot propose a credit memo.");
}

function fail(error: unknown): never {
  if (error instanceof ServiceError) throw error;
  if (error instanceof Error) throw new ServiceError(error.message);
  throw new ServiceError("Credit memo could not be saved.");
}

function audit(db: Database, orgId: string, actorId: string | null, action: string, entityId: string, payload: unknown) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "client_credit_memo",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

export function dollarsToCents(raw: string): number {
  const trimmed = raw.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) throw new ServiceError("Enter the amount in dollars.");
  const [whole, frac = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

function appliedMap(db: Database, orgId: string) {
  const paymentsById = new Map(
    db
      .select()
      .from(payments)
      .where(eq(payments.orgId, orgId))
      .all()
      .map((row) => [row.id, row]),
  );
  const map = new Map<string, number>();
  for (const row of db.select().from(clientCreditApplications).where(eq(clientCreditApplications.orgId, orgId)).all()) {
    if (paymentsById.get(row.paymentId)?.status !== "succeeded") continue;
    map.set(row.memoId, (map.get(row.memoId) ?? 0) + row.amountCents);
  }
  return map;
}

function names(db: Database, orgId: string) {
  const clients = new Map(db.select().from(contacts).where(eq(contacts.orgId, orgId)).all().map((row) => [row.id, row.name]));
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row.name]));
  return { clients, jobs };
}

function nextNumber(db: Database, orgId: string) {
  let max = 1047;
  for (const row of db.select().from(clientCreditMemos).where(eq(clientCreditMemos.orgId, orgId)).all()) {
    const match = /CM-(\d+)/.exec(row.number);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `CM-${max + 1}`;
}

function notifyReady(db: Database, orgId: string, memoId: string, number: string, stamp: string) {
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
        kind: "client_credit",
        commentId: null,
        entityType: "client_credit_memo",
        entityId: memoId,
        projectId: null,
        actorId: null,
        actorName: "Fieldline",
        snippet: number,
        readAt: null,
        createdAt: stamp,
      })
      .run();
  }
}

function emit(kind: "client_credit_created" | "client_credit_applied" | "client_credit_voided", memo: { id: string; orgId: string; number: string; projectId: string; amountCents: number }, amountCents?: number) {
  emitAutomation({
    orgId: memo.orgId,
    kind,
    recordType: "client_credit_memo",
    recordId: memo.id,
    recordLabel: memo.number,
    projectId: memo.projectId,
    name: memo.number,
    amountCents: amountCents ?? memo.amountCents,
  });
}

function cleanLines(lines: CreditLineInput[], allowZero: boolean): CreditLineInput[] {
  const out: CreditLineInput[] = [];
  for (const line of lines) {
    const costCode = line.costCode.trim();
    const description = line.description.trim();
    if (!costCode && !description && line.amountCents < 1) continue;
    if (costCode.length < 2) throw new ServiceError("Enter a cost code.");
    if (description.length < 2) throw new ServiceError("Enter a line description.");
    if (!allowZero && line.amountCents < 1) throw new ServiceError("Enter the line amount.");
    if (line.amountCents < 0 || !Number.isInteger(line.amountCents)) throw new ServiceError("Enter the line amount.");
    out.push({ costCode, description, amountCents: line.amountCents });
  }
  if (out.length < 1) throw new ServiceError("Add a line.");
  return out;
}

function insertLines(db: Database, orgId: string, memoId: string, lines: CreditLineInput[]) {
  db.delete(clientCreditMemoLines).where(and(eq(clientCreditMemoLines.orgId, orgId), eq(clientCreditMemoLines.memoId, memoId))).run();
  lines.forEach((line, index) => {
    db.insert(clientCreditMemoLines)
      .values({
        id: id("cml"),
        orgId,
        memoId,
        costCode: line.costCode,
        description: line.description,
        amountCents: line.amountCents,
        sortOrder: index,
      })
      .run();
  });
}

export function createClientCredit(
  actor: Actor,
  input: {
    projectId: string;
    title: string;
    description?: string;
    kind: "flat" | "lines";
    amountCents?: number;
    lines?: CreditLineInput[];
    release?: boolean;
  },
) {
  propose(actor);
  const field = actor.role === "field";
  if (field && ((input.amountCents ?? 0) > 0 || input.release || (input.lines ?? []).some((line) => line.amountCents > 0))) {
    throw new ServiceError("Field cannot set an amount.");
  }
  const db = dbFor(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  const title = input.title.trim();
  if (title.length < 2) throw new ServiceError("Enter a title.");
  const description = (input.description ?? "").trim();
  const kind = input.kind === "lines" ? "lines" : "flat";
  let amount = 0;
  let lines: CreditLineInput[] = [];
  if (!field && kind === "lines") {
    lines = cleanLines(input.lines ?? [], false);
    amount = lines.reduce((sum, line) => sum + line.amountCents, 0);
  } else if (!field) {
    amount = input.amountCents ?? 0;
    if (!Number.isInteger(amount) || amount < 0) throw new ServiceError("Enter the amount.");
  }
  const release = Boolean(input.release) && !field;
  if (release && amount < 1) throw new ServiceError("Enter the amount before releasing.");
  const now = nowIso();
  const memoId = id("ccm");
  const number = nextNumber(db, actor.orgId);
  const status = release ? "ready" : "draft";
  db.insert(clientCreditMemos)
    .values({
      id: memoId,
      orgId: actor.orgId,
      number,
      projectId: project.id,
      clientContactId: project.contactId,
      title,
      description,
      kind,
      amountCents: amount,
      status,
      releasedAt: release ? now : null,
      voidReason: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  if (lines.length) insertLines(db, actor.orgId, memoId, lines);
  audit(db, actor.orgId, actor.userId, release ? "client_credit.release" : "client_credit.create", memoId, { number, amountCents: amount });
  if (release) notifyReady(db, actor.orgId, memoId, number, now);
  const saved = { id: memoId, orgId: actor.orgId, number, projectId: project.id, amountCents: amount, status };
  emit("client_credit_created", saved, amount);
  return saved;
}

export function releaseClientCredit(actor: Actor, memoId: string, input: { amountCents?: number; lines?: CreditLineInput[] }) {
  office(actor);
  const db = dbFor(actor);
  const memo = db.select().from(clientCreditMemos).where(and(eq(clientCreditMemos.id, memoId), eq(clientCreditMemos.orgId, actor.orgId))).get();
  if (!memo) throw new ServiceError("Credit memo not found.");
  if (memo.status !== "draft") throw new ServiceError("Only a draft can be released.");
  let amount = memo.amountCents;
  let lines: CreditLineInput[] | null = null;
  if (memo.kind === "lines") {
    lines = cleanLines(input.lines ?? [], false);
    amount = lines.reduce((sum, line) => sum + line.amountCents, 0);
  } else if (input.amountCents != null) {
    amount = input.amountCents;
  }
  if (!Number.isInteger(amount) || amount < 1) throw new ServiceError("Enter the amount before releasing.");
  const now = nowIso();
  if (lines) insertLines(db, actor.orgId, memo.id, lines);
  db.update(clientCreditMemos)
    .set({ amountCents: amount, status: "ready", releasedAt: now, updatedAt: now })
    .where(and(eq(clientCreditMemos.id, memo.id), eq(clientCreditMemos.orgId, actor.orgId)))
    .run();
  audit(db, actor.orgId, actor.userId, "client_credit.release", memo.id, { number: memo.number, amountCents: amount });
  notifyReady(db, actor.orgId, memo.id, memo.number, now);
  return { id: memo.id, number: memo.number, status: "ready", amountCents: amount, projectId: memo.projectId };
}

export function applyClientCredit(actor: Actor, input: { memoId: string; invoiceId: string; amountCents: number; idempotencyKey: string }) {
  office(actor);
  const key = input.idempotencyKey.trim();
  if (key.length < 8 || key.length > 80) throw new ServiceError("Missing idempotency key.");
  const db = dbFor(actor);
  const result = db.transaction((tx) => {
    const existing = tx
      .select()
      .from(clientCreditApplications)
      .where(and(eq(clientCreditApplications.orgId, actor.orgId), eq(clientCreditApplications.idempotencyKey, key)))
      .get();
    if (existing) {
      if (existing.memoId !== input.memoId || existing.invoiceId !== input.invoiceId || existing.amountCents !== input.amountCents) {
        throw new ServiceError("That idempotency key was already used.");
      }
      const memo = tx.select().from(clientCreditMemos).where(eq(clientCreditMemos.id, existing.memoId)).get();
      return {
        id: existing.id,
        duplicate: true,
        amountCents: existing.amountCents,
        memoStatus: memo?.status ?? "partial",
        invoiceId: existing.invoiceId,
        paidOff: false,
        projectId: memo?.projectId ?? "",
        number: memo?.number ?? "",
        orgId: actor.orgId,
      };
    }
    const memo = tx
      .select()
      .from(clientCreditMemos)
      .where(and(eq(clientCreditMemos.id, input.memoId), eq(clientCreditMemos.orgId, actor.orgId)))
      .get();
    if (!memo) throw new ServiceError("Credit memo not found.");
    if (!APPLY.has(memo.status)) throw new ServiceError("Release the memo before applying it.");
    const invoice = tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, input.invoiceId), eq(invoices.orgId, actor.orgId)))
      .get();
    if (!invoice || invoice.projectId !== memo.projectId) throw new ServiceError("Invoice not found on this job.");
    if (invoice.status !== "open") throw new ServiceError("That invoice is not open.");
    const applied = appliedMap(tx as Database, actor.orgId).get(memo.id) ?? 0;
    try {
      assertApplySlice(memoRemainingCents(memo.amountCents, applied, memo.status), cashDueCents(invoice.totalCents, invoice.amountPaidCents), input.amountCents);
    } catch (error) {
      fail(error);
    }
    const now = nowIso();
    const paymentId = id("pay");
    const applicationId = id("cca");
    tx.insert(payments)
      .values({
        id: paymentId,
        orgId: actor.orgId,
        invoiceId: invoice.id,
        method: CLIENT_CREDIT_METHOD,
        amountCents: input.amountCents,
        feeCents: 0,
        netCents: 0,
        status: "succeeded",
        stripePaymentIntent: null,
        idempotencyKey: `ccm:${actor.orgId}:${key}`,
        failureReason: null,
        stub: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(clientCreditApplications)
      .values({
        id: applicationId,
        orgId: actor.orgId,
        memoId: memo.id,
        invoiceId: invoice.id,
        paymentId,
        amountCents: input.amountCents,
        idempotencyKey: key,
        createdAt: now,
        createdBy: actor.userId,
      })
      .run();
    const paid = invoice.amountPaidCents + input.amountCents;
    const invoiceStatus = paid >= invoice.totalCents ? "paid" : "open";
    tx.update(invoices)
      .set({ amountPaidCents: paid, status: invoiceStatus, updatedAt: now })
      .where(and(eq(invoices.id, invoice.id), eq(invoices.orgId, actor.orgId)))
      .run();
    const next = memoStatusAfter(memo.amountCents, applied + input.amountCents);
    tx.update(clientCreditMemos)
      .set({ status: next, updatedAt: now })
      .where(and(eq(clientCreditMemos.id, memo.id), eq(clientCreditMemos.orgId, actor.orgId)))
      .run();
    audit(tx as Database, actor.orgId, actor.userId, "client_credit.apply", memo.id, { invoiceId: invoice.id, amountCents: input.amountCents, netCents: 0 });
    return { id: applicationId, duplicate: false, amountCents: input.amountCents, memoStatus: next, invoiceId: invoice.id, paidOff: invoiceStatus === "paid", projectId: memo.projectId, number: memo.number, orgId: actor.orgId };
  });
  if (!result.duplicate) {
    emit(
      "client_credit_applied",
      { id: input.memoId, orgId: actor.orgId, number: result.number, projectId: result.projectId, amountCents: result.amountCents },
      result.amountCents,
    );
    if (result.paidOff) {
      try {
        bindReviewEmit(emitAutomation);
        considerReview(actor.orgId, result.projectId ?? "", "paid");
      } catch {
        // A review miss does not undo the credit.
      }
      try {
        dismissCollections(actor.orgId, result.invoiceId);
      } catch {
        // A follow-up miss does not undo the credit.
      }
    }
    if (result.projectId) {
      try {
        syncJobCommissions(actor.orgId, result.projectId);
      } catch {
        // A commission miss does not undo the credit.
      }
    }
  }
  return result;
}

export function voidClientCredit(actor: Actor, memoId: string, reason: string) {
  office(actor);
  const note = reason.trim();
  if (note.length < 2) throw new ServiceError("Enter a reason.");
  const db = dbFor(actor);
  const saved = db.transaction((tx) => {
    const memo = tx
      .select()
      .from(clientCreditMemos)
      .where(and(eq(clientCreditMemos.id, memoId), eq(clientCreditMemos.orgId, actor.orgId)))
      .get();
    if (!memo) throw new ServiceError("Credit memo not found.");
    if (memo.status === "void") throw new ServiceError("This memo is already void.");
    const now = nowIso();
    const apps = tx
      .select()
      .from(clientCreditApplications)
      .where(and(eq(clientCreditApplications.orgId, actor.orgId), eq(clientCreditApplications.memoId, memo.id)))
      .all();
    for (const app of apps) {
      const payment = tx.select().from(payments).where(and(eq(payments.id, app.paymentId), eq(payments.orgId, actor.orgId))).get();
      if (!payment || payment.status !== "succeeded") continue;
      tx.update(payments)
        .set({ status: "void", netCents: 0, updatedAt: now })
        .where(and(eq(payments.id, payment.id), eq(payments.orgId, actor.orgId)))
        .run();
      const invoice = tx.select().from(invoices).where(and(eq(invoices.id, app.invoiceId), eq(invoices.orgId, actor.orgId))).get();
      if (!invoice) continue;
      const paid = Math.max(0, invoice.amountPaidCents - app.amountCents);
      const status = invoice.status === "void" ? "void" : paid >= invoice.totalCents ? "paid" : "open";
      tx.update(invoices)
        .set({ amountPaidCents: paid, status, updatedAt: now })
        .where(and(eq(invoices.id, invoice.id), eq(invoices.orgId, actor.orgId)))
        .run();
    }
    tx.update(clientCreditMemos)
      .set({ status: "void", voidReason: note, updatedAt: now })
      .where(and(eq(clientCreditMemos.id, memo.id), eq(clientCreditMemos.orgId, actor.orgId)))
      .run();
    audit(tx as Database, actor.orgId, actor.userId, "client_credit.void", memo.id, { number: memo.number, reason: note });
    return memo;
  });
  emit("client_credit_voided", saved, saved.amountCents);
  try {
    syncJobCommissions(actor.orgId, saved.projectId);
  } catch {
    // A commission miss does not undo the void.
  }
  return { id: saved.id, number: saved.number, projectId: saved.projectId, status: "void" };
}

export type ClientCreditListRow = {
  id: string;
  number: string;
  projectId: string;
  projectName: string;
  clientContactId: string;
  clientName: string;
  title: string;
  kind: string;
  amountCents: number;
  appliedCents: number;
  remainingCents: number;
  status: string;
  statusLabel: string;
};

function toList(row: MemoRow, applied: number, clientName: string, projectName: string, seeMoney: boolean): ClientCreditListRow {
  let remaining = 0;
  try {
    remaining = memoRemainingCents(row.amountCents, applied, row.status);
  } catch {
    remaining = 0;
  }
  return {
    id: row.id,
    number: row.number,
    projectId: row.projectId,
    projectName,
    clientContactId: row.clientContactId,
    clientName,
    title: row.title,
    kind: row.kind,
    amountCents: seeMoney ? row.amountCents : 0,
    appliedCents: seeMoney ? applied : 0,
    remainingCents: seeMoney ? remaining : 0,
    status: row.status,
    statusLabel: clientCreditStatusLabel(row.status),
  };
}

export function listClientCredits(actor: Actor, filter: { projectId?: string; clientContactId?: string; status?: string; attention?: boolean } = {}) {
  const db = officeDb(actor.orgId);
  if (!db) return [];
  const seeMoney = canSeeMoney(actor.role as Role);
  const applied = appliedMap(db, actor.orgId);
  const { clients, jobs } = names(db, actor.orgId);
  return db
    .select()
    .from(clientCreditMemos)
    .where(eq(clientCreditMemos.orgId, actor.orgId))
    .all()
    .map((row) => toList(row, applied.get(row.id) ?? 0, clients.get(row.clientContactId) ?? "Client", jobs.get(row.projectId) ?? "Job", seeMoney))
    .filter((row) => {
      if (!seeMoney && row.status !== "draft") return false;
      if (filter.projectId && row.projectId !== filter.projectId) return false;
      if (filter.clientContactId && row.clientContactId !== filter.clientContactId) return false;
      if (filter.status && row.status !== filter.status) return false;
      if (filter.attention && !ATTENTION.has(row.status)) return false;
      return true;
    })
    .sort((a, b) => b.number.localeCompare(a.number));
}

export function clientCreditDetail(actor: Actor, memoId: string) {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const row = db.select().from(clientCreditMemos).where(and(eq(clientCreditMemos.id, memoId), eq(clientCreditMemos.orgId, actor.orgId))).get();
  if (!row) return null;
  const seeMoney = canSeeMoney(actor.role as Role);
  if (!seeMoney && row.status !== "draft") return null;
  const applied = appliedMap(db, actor.orgId).get(row.id) ?? 0;
  const { clients, jobs } = names(db, actor.orgId);
  const lines = db
    .select()
    .from(clientCreditMemoLines)
    .where(and(eq(clientCreditMemoLines.orgId, actor.orgId), eq(clientCreditMemoLines.memoId, row.id)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const apps = db
    .select()
    .from(clientCreditApplications)
    .where(and(eq(clientCreditApplications.orgId, actor.orgId), eq(clientCreditApplications.memoId, row.id)))
    .all();
  const invoiceNumbers = new Map(db.select().from(invoices).where(eq(invoices.orgId, actor.orgId)).all().map((invoice) => [invoice.id, invoice.number]));
  const paymentStatus = new Map(db.select().from(payments).where(eq(payments.orgId, actor.orgId)).all().map((payment) => [payment.id, payment.status]));
  const openInvoices = db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, actor.orgId), eq(invoices.projectId, row.projectId)))
    .all()
    .filter((invoice) => invoice.status === "open")
    .map((invoice) => ({ id: invoice.id, number: invoice.number, dueCents: cashDueCents(invoice.totalCents, invoice.amountPaidCents) }));
  return {
    ...toList(row, applied, clients.get(row.clientContactId) ?? "Client", jobs.get(row.projectId) ?? "Job", seeMoney),
    description: row.description,
    voidReason: row.voidReason,
    lines: lines.map((line) => ({
      id: line.id,
      costCode: line.costCode,
      description: line.description,
      amountCents: seeMoney ? line.amountCents : 0,
    })),
    applications: apps.map((app) => ({
      id: app.id,
      invoiceId: app.invoiceId,
      invoiceNumber: invoiceNumbers.get(app.invoiceId) ?? "Invoice",
      amountCents: seeMoney ? app.amountCents : 0,
      status: paymentStatus.get(app.paymentId) ?? "void",
    })),
    openInvoices,
  };
}

export function clientCreditCsv(actor: Actor, filter: { projectId?: string; clientContactId?: string; status?: string; attention?: boolean } = {}): string | null {
  if (!canSeeMoney(actor.role as Role)) return null;
  const rows = listClientCredits(actor, filter);
  const header = ["Memo", "Client", "Job", "Status", "Title", "Amount", "Applied", "Remaining"];
  const lines = rows.map((row) =>
    [row.number, row.clientName, row.projectName, row.statusLabel, row.title, formatMoney(row.amountCents), formatMoney(row.appliedCents), formatMoney(row.remainingCents)]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function clientCreditAttention(orgId: string, role: Role) {
  if (!canManageSettings(role)) return { count: 0, cents: 0, href: null as string | null };
  const db = officeDb(orgId);
  if (!db) return { count: 0, cents: 0, href: null as string | null };
  const applied = appliedMap(db, orgId);
  let count = 0;
  let cents = 0;
  for (const row of db.select().from(clientCreditMemos).where(eq(clientCreditMemos.orgId, orgId)).all()) {
    if (!ATTENTION.has(row.status)) continue;
    const left = memoRemainingCents(row.amountCents, applied.get(row.id) ?? 0, row.status);
    if (left < 1) continue;
    count += 1;
    cents += left;
  }
  return { count, cents, href: count ? "/credit-memos?attention=1" : null };
}

export function jobClientCredits(orgId: string, projectId: string) {
  const db = officeDb(orgId);
  if (!db) return null;
  const applied = appliedMap(db, orgId);
  let openCents = 0;
  let appliedCents = 0;
  let count = 0;
  for (const row of db.select().from(clientCreditMemos).where(and(eq(clientCreditMemos.orgId, orgId), eq(clientCreditMemos.projectId, projectId))).all()) {
    if (row.status === "draft" || row.status === "void") continue;
    count += 1;
    const used = applied.get(row.id) ?? 0;
    appliedCents += used;
    openCents += memoRemainingCents(row.amountCents, used, row.status);
  }
  if (!count) return null;
  return { count, openCents, appliedCents, href: `/credit-memos?job=${projectId}` };
}

export function clientOpenCredit(orgId: string, contactId: string) {
  const db = officeDb(orgId);
  if (!db) return { cents: 0, count: 0 };
  const applied = appliedMap(db, orgId);
  let cents = 0;
  let count = 0;
  for (const row of db.select().from(clientCreditMemos).where(and(eq(clientCreditMemos.orgId, orgId), eq(clientCreditMemos.clientContactId, contactId))).all()) {
    if (!ATTENTION.has(row.status)) continue;
    const left = memoRemainingCents(row.amountCents, applied.get(row.id) ?? 0, row.status);
    if (left < 1) continue;
    cents += left;
    count += 1;
  }
  return { cents, count };
}

export function invoiceCreditApplications(orgId: string, invoiceId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  const memos = new Map(db.select().from(clientCreditMemos).where(eq(clientCreditMemos.orgId, orgId)).all().map((row) => [row.id, row]));
  const paymentStatus = new Map(db.select().from(payments).where(eq(payments.orgId, orgId)).all().map((row) => [row.id, row]));
  return db
    .select()
    .from(clientCreditApplications)
    .where(and(eq(clientCreditApplications.orgId, orgId), eq(clientCreditApplications.invoiceId, invoiceId)))
    .all()
    .map((row) => ({
      id: row.id,
      memoId: row.memoId,
      number: memos.get(row.memoId)?.number ?? "Credit memo",
      amountCents: row.amountCents,
      status: paymentStatus.get(row.paymentId)?.status ?? "void",
      netCents: paymentStatus.get(row.paymentId)?.netCents ?? 0,
    }));
}

export function openMemosForInvoice(orgId: string, projectId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  const applied = appliedMap(db, orgId);
  return db
    .select()
    .from(clientCreditMemos)
    .where(and(eq(clientCreditMemos.orgId, orgId), eq(clientCreditMemos.projectId, projectId)))
    .all()
    .filter((row) => APPLY.has(row.status))
    .map((row) => ({ id: row.id, number: row.number, title: row.title, remainingCents: memoRemainingCents(row.amountCents, applied.get(row.id) ?? 0, row.status) }))
    .filter((row) => row.remainingCents > 0);
}

const PORTAL = new Set(["ready", "partial", "applied"]);

export function portalClientCredits(token: string) {
  const db = officeDbFromToken(token);
  if (!db) return [];
  const project = db.project;
  const applied = appliedMap(db.db, project.orgId);
  return db.db
    .select()
    .from(clientCreditMemos)
    .where(and(eq(clientCreditMemos.orgId, project.orgId), eq(clientCreditMemos.projectId, project.id)))
    .all()
    .filter((row) => PORTAL.has(row.status))
    .sort((a, b) => a.number.localeCompare(b.number))
    .map((row) => ({
      id: row.id,
      number: row.number,
      title: row.title,
      description: row.description,
      status: row.status,
      statusLabel: clientCreditStatusLabel(row.status),
      amountCents: row.amountCents,
      remainingCents: memoRemainingCents(row.amountCents, applied.get(row.id) ?? 0, row.status),
      lines: db.db
        .select()
        .from(clientCreditMemoLines)
        .where(and(eq(clientCreditMemoLines.orgId, project.orgId), eq(clientCreditMemoLines.memoId, row.id)))
        .all()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((line) => ({ id: line.id, costCode: line.costCode, description: line.description, amountCents: line.amountCents })),
    }));
}

function officeDbFromToken(token: string) {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, token)).get();
  if (!project) return null;
  return { db, project };
}

export function creditMemoNotice(db: AppDatabase, orgId: string, memoId: string) {
  const row = db.select().from(clientCreditMemos).where(and(eq(clientCreditMemos.orgId, orgId), eq(clientCreditMemos.id, memoId))).get();
  if (!row) return null;
  return { record: row.number, href: `/credit-memos/${row.id}` };
}

export function jobContractCents(orgId: string, projectId: string) {
  const db = officeDb(orgId);
  if (!db) return null;
  return db.select({ contractValueCents: projects.contractValueCents }).from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).get()?.contractValueCents ?? null;
}
