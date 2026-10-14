import { and, eq } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import { auditLogs, contacts, invoiceFollowUps, invoices, memberships, notifications, organizations, projects } from "@/lib/db/schema";
import { formatDate } from "@/lib/format";
import { id, nowIso } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { canManageMoney, canManageSettings, canSeeMoney, type Role } from "@/lib/permissions";
import { appOrigin } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import type { AutomationEvent } from "@/lib/services/automations";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

export const COLLECT_TEMPLATE = "{client}, {invoice} for {amount} was due {due}. {link}";

const OPEN = new Set(["draft", "ready", "copied"]);
const STATUSES = ["draft", "ready", "copied", "sent", "skipped", "void"] as const;

type Writer = Pick<AppDatabase, "insert" | "select" | "update" | "delete" | "transaction">;

let emit: (event: AutomationEvent) => void = () => {};

export function bindCollectEmit(fn: (event: AutomationEvent) => void) {
  emit = fn;
}

function dbFor(orgId: string): Writer {
  return officeDb(orgId) ?? getDb();
}

export function collectStatusLabel(status: string): string {
  if (status === "draft") return "Draft";
  if (status === "ready") return "Ready";
  if (status === "copied") return "Copied";
  if (status === "sent") return "Sent";
  if (status === "skipped") return "Skipped";
  if (status === "void") return "Void";
  return status;
}

export function pastCadence(today: string, due: string, days: number): boolean {
  return today >= addCalendarDays(due.slice(0, 10), days);
}

function tagSet(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 8),
  );
}

function excluded(projectTags: string, ban: string): boolean {
  const blocked = tagSet(ban);
  if (blocked.size === 0) return false;
  for (const tag of tagSet(projectTags)) if (blocked.has(tag)) return true;
  return false;
}

function fill(template: string, client: string, invoice: string, amount: string, due: string, link: string): string {
  return template
    .replaceAll("{client}", client)
    .replaceAll("{invoice}", invoice)
    .replaceAll("{amount}", amount)
    .replaceAll("{due}", due)
    .replaceAll("{link}", link)
    .slice(0, 500);
}

function payLink(token: string): string {
  if (!token) return "";
  const origin = appOrigin(process.env);
  return `${origin ?? ""}/pay/${token}`;
}

function cadences(org: { collectDay1: number; collectDay2: number }): number[] {
  return [org.collectDay1, org.collectDay2].filter((day) => day > 0);
}

function notify(tx: Writer, orgId: string, followId: string, snippet: string, stamp: string) {
  const owners = tx
    .select({ id: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.orgId, orgId))
    .all()
    .filter((row) => row.role === "owner" || row.role === "admin");
  for (const owner of owners) {
    tx.insert(notifications)
      .values({
        id: id("note"),
        orgId,
        userId: owner.id,
        kind: "collection",
        commentId: null,
        entityType: "invoice_followup",
        entityId: followId,
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

function dismissOpen(db: Writer, orgId: string, invoiceId: string) {
  const stamp = nowIso();
  const rows = db
    .select()
    .from(invoiceFollowUps)
    .where(and(eq(invoiceFollowUps.orgId, orgId), eq(invoiceFollowUps.invoiceId, invoiceId)))
    .all()
    .filter((row) => OPEN.has(row.status));
  for (const row of rows) {
    db.update(invoiceFollowUps)
      .set({ status: "void", updatedAt: stamp })
      .where(and(eq(invoiceFollowUps.orgId, orgId), eq(invoiceFollowUps.id, row.id)))
      .run();
  }
}

/** Paid, void, and draft invoices drop open follow-ups. One row per invoice and cadence. */
export function scanCollections(orgId: string): { created: number } {
  const db = dbFor(orgId);
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) return { created: 0 };
  const today = localDay(Date.now(), org.timeZone || "America/New_York");
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row]));
  const people = new Map(db.select().from(contacts).where(eq(contacts.orgId, orgId)).all().map((row) => [row.id, row.name]));
  let created = 0;
  for (const invoice of db.select().from(invoices).where(eq(invoices.orgId, orgId)).all()) {
    if (invoice.status !== "open") {
      dismissOpen(db, orgId, invoice.id);
      continue;
    }
    if (org.collectEnabled !== 1) continue;
    const project = jobs.get(invoice.projectId);
    if (!project || excluded(project.tags, org.collectExcludeTags)) continue;
    const due = invoice.dueDate.slice(0, 10);
    for (const cadence of cadences(org)) {
      if (!pastCadence(today, due, cadence)) continue;
      const existing = db
        .select()
        .from(invoiceFollowUps)
        .where(and(eq(invoiceFollowUps.orgId, orgId), eq(invoiceFollowUps.invoiceId, invoice.id), eq(invoiceFollowUps.cadenceDays, cadence)))
        .get();
      if (existing) continue;
      const link = payLink(invoice.payToken);
      const client = people.get(project.contactId) || "Client";
      const balance = Math.max(0, invoice.totalCents - invoice.amountPaidCents);
      const template = org.collectTemplate.trim() || COLLECT_TEMPLATE;
      const stamp = nowIso();
      const followId = id("fol");
      const status = link ? "ready" : "draft";
      db.insert(invoiceFollowUps)
        .values({
          id: followId,
          orgId,
          invoiceId: invoice.id,
          projectId: project.id,
          contactId: project.contactId,
          cadenceDays: cadence,
          status,
          url: link,
          message: fill(template, client, invoice.number, formatMoney(balance), formatDate(due), link),
          skipReason: "",
          createdAt: stamp,
          updatedAt: stamp,
          copiedAt: null,
          sentAt: null,
        })
        .run();
      db.insert(auditLogs)
        .values({
          id: id("audit"),
          orgId,
          actorId: null,
          action: "collect.create",
          entityType: "invoice_followup",
          entityId: followId,
          payloadJson: JSON.stringify({ invoiceId: invoice.id, cadence, status }),
          ip: null,
          createdAt: stamp,
        })
        .run();
      notify(db, orgId, followId, invoice.number, stamp);
      created += 1;
      emit({
        orgId,
        kind: "invoice_followup_created",
        recordType: "invoice_followup",
        recordId: followId,
        recordLabel: invoice.number,
        projectId: project.id,
        name: client,
        amountCents: balance,
      });
    }
  }
  return { created };
}

export function dismissCollections(orgId: string, invoiceId: string) {
  dismissOpen(dbFor(orgId), orgId, invoiceId);
}

export function collectAttention(orgId: string) {
  const count = dbFor(orgId)
    .select()
    .from(invoiceFollowUps)
    .where(eq(invoiceFollowUps.orgId, orgId))
    .all()
    .filter((row) => row.status === "ready").length;
  return { count, href: count > 0 ? "/collections" : null };
}

export function collectNotice(db: Writer, orgId: string, followId: string) {
  const row = db.select().from(invoiceFollowUps).where(and(eq(invoiceFollowUps.orgId, orgId), eq(invoiceFollowUps.id, followId))).get();
  if (!row) return null;
  const invoice = db.select().from(invoices).where(and(eq(invoices.orgId, orgId), eq(invoices.id, row.invoiceId))).get();
  return { record: invoice?.number || "Invoice", href: `/collections/${row.id}` };
}

export function collectMonth(orgId: string) {
  const db = dbFor(orgId);
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  const month = localDay(Date.now(), org?.timeZone || "America/New_York").slice(0, 7);
  const rows = db.select().from(invoiceFollowUps).where(eq(invoiceFollowUps.orgId, orgId)).all();
  const bills = new Map(db.select().from(invoices).where(eq(invoices.orgId, orgId)).all().map((row) => [row.id, row]));
  const ready = rows.filter((row) => row.status === "ready");
  const openCents = ready.reduce((sum, row) => {
    const invoice = bills.get(row.invoiceId);
    if (!invoice || invoice.status !== "open") return sum;
    return sum + Math.max(0, invoice.totalCents - invoice.amountPaidCents);
  }, 0);
  return {
    created: rows.filter((row) => row.createdAt.slice(0, 7) === month).length,
    sent: rows.filter((row) => row.sentAt && row.sentAt.slice(0, 7) === month).length,
    skipped: rows.filter((row) => row.status === "skipped" && row.updatedAt.slice(0, 7) === month).length,
    ready: ready.length,
    openCents,
  };
}

export function collectSettings(actor: Actor) {
  if (!canManageSettings(actor.role as Role)) return null;
  const org = dbFor(actor.orgId).select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  if (!org) return null;
  return {
    enabled: org.collectEnabled === 1,
    first: org.collectDay1,
    second: org.collectDay2,
    exclude: org.collectExcludeTags || "",
    template: org.collectTemplate || COLLECT_TEMPLATE,
  };
}

export function saveCollectSettings(
  actor: Actor,
  input: { enabled: boolean; first: number; second: number; exclude: string; template: string },
) {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("Only an owner or admin can change collections.");
  const first = Math.trunc(Number(input.first));
  const secondRaw = Math.trunc(Number(input.second));
  if (!Number.isInteger(first) || first < 1 || first > 90) throw new ServiceError("Use a day from 1 to 90.");
  let second = secondRaw;
  if (!second) second = 0;
  else if (!Number.isInteger(second) || second < 1 || second > 90) throw new ServiceError("Use a day from 1 to 90.");
  if (second && second === first) throw new ServiceError("Use two different days.");
  let day1 = first;
  let day2 = second;
  if (day2 && day2 < day1) {
    day1 = day2;
    day2 = first;
  }
  const exclude = [...tagSet(input.exclude)].join(", ");
  const template = input.template.trim().slice(0, 400) || COLLECT_TEMPLATE;
  dbFor(actor.orgId)
    .update(organizations)
    .set({
      collectEnabled: input.enabled ? 1 : 0,
      collectDay1: day1,
      collectDay2: day2,
      collectExcludeTags: exclude,
      collectTemplate: template,
      updatedAt: nowIso(),
    })
    .where(eq(organizations.id, actor.orgId))
    .run();
}

function canSee(actor: Actor) {
  return canSeeMoney(actor.role as Role) && actor.role !== "field";
}

export function listFollowUps(actor: Actor, status?: string) {
  if (!canSee(actor)) return [];
  const wanted = status && (STATUSES as readonly string[]).includes(status) ? status : "";
  const db = dbFor(actor.orgId);
  const bills = new Map(db.select().from(invoices).where(eq(invoices.orgId, actor.orgId)).all().map((row) => [row.id, row]));
  const people = new Map(db.select().from(contacts).where(eq(contacts.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  return db
    .select()
    .from(invoiceFollowUps)
    .where(eq(invoiceFollowUps.orgId, actor.orgId))
    .all()
    .filter((row) => !wanted || row.status === wanted)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((row) => {
      const invoice = bills.get(row.invoiceId);
      const balance = invoice ? Math.max(0, invoice.totalCents - invoice.amountPaidCents) : 0;
      return {
        id: row.id,
        invoice: invoice?.number || "Invoice",
        client: people.get(row.contactId) || "Client",
        status: row.status,
        statusLabel: collectStatusLabel(row.status),
        amount: formatMoney(balance),
        cadence: row.cadenceDays,
      };
    });
}

export function followUpCsv(actor: Actor, status?: string): string | null {
  if (!canSee(actor)) return null;
  const lines = ["Invoice,Client,Status,Amount,Days,Link"];
  const db = dbFor(actor.orgId);
  const links = new Map(db.select().from(invoiceFollowUps).where(eq(invoiceFollowUps.orgId, actor.orgId)).all().map((row) => [row.id, row.url]));
  for (const row of listFollowUps(actor, status)) {
    lines.push([row.invoice, row.client, row.statusLabel, row.amount, String(row.cadence), links.get(row.id) || ""].map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","));
  }
  return lines.join("\n");
}

export function followUpDetail(actor: Actor, followId: string) {
  if (!canSee(actor)) return null;
  const db = dbFor(actor.orgId);
  const row = db.select().from(invoiceFollowUps).where(and(eq(invoiceFollowUps.orgId, actor.orgId), eq(invoiceFollowUps.id, followId))).get();
  if (!row) return null;
  const invoice = db.select().from(invoices).where(and(eq(invoices.orgId, actor.orgId), eq(invoices.id, row.invoiceId))).get();
  const contact = db.select().from(contacts).where(and(eq(contacts.orgId, actor.orgId), eq(contacts.id, row.contactId))).get();
  const project = db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, row.projectId))).get();
  const balance = invoice ? Math.max(0, invoice.totalCents - invoice.amountPaidCents) : 0;
  return {
    id: row.id,
    invoice: invoice?.number || "Invoice",
    client: contact?.name || "Client",
    job: project?.name || "Job",
    status: row.status,
    statusLabel: collectStatusLabel(row.status),
    url: row.url,
    message: row.message,
    skipReason: row.skipReason,
    tags: project?.tags || "",
    cadence: row.cadenceDays,
    amount: formatMoney(balance),
    canEdit: canManageMoney(actor.role as Role),
  };
}

function requireRow(actor: Actor, followId: string) {
  const row = dbFor(actor.orgId)
    .select()
    .from(invoiceFollowUps)
    .where(and(eq(invoiceFollowUps.orgId, actor.orgId), eq(invoiceFollowUps.id, followId)))
    .get();
  if (!row) throw new ServiceError("That follow-up is not in your company.");
  return row;
}

export function saveFollowUpTags(actor: Actor, followId: string, tags: string) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Your role cannot change this follow-up.");
  const row = requireRow(actor, followId);
  const cleaned = [...tagSet(tags)].join(", ");
  dbFor(actor.orgId).update(projects).set({ tags: cleaned, updatedAt: nowIso() }).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, row.projectId))).run();
}

export function markFollowUp(actor: Actor, followId: string, action: "copy" | "sent" | "skip" | "void", reason = "") {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Your role cannot change this follow-up.");
  const row = requireRow(actor, followId);
  if (row.status === "void") throw new ServiceError("That follow-up is closed.");
  const stamp = nowIso();
  const db = dbFor(actor.orgId);
  if (action === "skip") {
    const why = reason.trim().slice(0, 200);
    if (why.length < 2) throw new ServiceError("Add a reason.");
    db.update(invoiceFollowUps).set({ status: "skipped", skipReason: why, updatedAt: stamp }).where(and(eq(invoiceFollowUps.orgId, actor.orgId), eq(invoiceFollowUps.id, row.id))).run();
    audit(db, actor, "collect.skip", row.id, { reason: why });
    return;
  }
  if (action === "void") {
    db.update(invoiceFollowUps).set({ status: "void", updatedAt: stamp }).where(and(eq(invoiceFollowUps.orgId, actor.orgId), eq(invoiceFollowUps.id, row.id))).run();
    audit(db, actor, "collect.void", row.id, null);
    return;
  }
  if (action === "copy") {
    db.update(invoiceFollowUps)
      .set({ status: row.status === "sent" || row.status === "skipped" ? row.status : "copied", copiedAt: stamp, updatedAt: stamp })
      .where(and(eq(invoiceFollowUps.orgId, actor.orgId), eq(invoiceFollowUps.id, row.id)))
      .run();
    audit(db, actor, "collect.copy", row.id, null);
    return;
  }
  db.update(invoiceFollowUps)
    .set({ status: "sent", sentAt: row.sentAt || stamp, updatedAt: stamp })
    .where(and(eq(invoiceFollowUps.orgId, actor.orgId), eq(invoiceFollowUps.id, row.id)))
    .run();
  audit(db, actor, "collect.sent", row.id, null);
  const invoice = db.select().from(invoices).where(and(eq(invoices.orgId, actor.orgId), eq(invoices.id, row.invoiceId))).get();
  emit({
    orgId: actor.orgId,
    kind: "invoice_followup_marked_sent",
    recordType: "invoice_followup",
    recordId: row.id,
    recordLabel: invoice?.number || "Invoice",
    projectId: row.projectId,
    name: actor.name,
  });
}

function audit(db: Writer, actor: Actor, action: string, entityId: string, payload: unknown) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action,
      entityType: "invoice_followup",
      entityId,
      payloadJson: payload ? JSON.stringify(payload) : null,
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

export function portalChase(token: string): Set<string> {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, token)).get();
  if (!project) return new Set();
  const ids = db
    .select()
    .from(invoiceFollowUps)
    .where(eq(invoiceFollowUps.orgId, project.orgId))
    .all()
    .filter((row) => row.projectId === project.id && (row.status === "ready" || row.status === "copied"))
    .map((row) => row.invoiceId);
  return new Set(ids);
}
