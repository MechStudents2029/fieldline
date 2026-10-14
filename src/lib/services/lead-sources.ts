import { and, asc, eq, isNull } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  changeOrders,
  contacts,
  invoices,
  leadSourceSpend,
  leadSources,
  leads,
  organizations,
  payments,
  projects,
  proposals,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import {
  attribute,
  contractSoldCents,
  divideCents,
  formatReturn,
  rateBps,
  ratioHundredths,
  type AttributionRow,
  type CashFact,
  type DayRange,
  type JobFact,
  type LeadFact,
  type SpendFact,
  type WinFact,
} from "@/lib/leads/attribution";
import { formatPercent, formatWhole, parseMoneyToCents, MAX_MONEY_CENTS } from "@/lib/money";
import { CLIENT_CREDIT_METHOD } from "@/lib/credits/client-memo";
import { canEditCrm, canManageSettings, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { localDay } from "@/lib/time/calendar";
import type { EngineRow } from "@/lib/reports/engine";

export const DEFAULT_SOURCE_NAMES = ["Website form", "Referral", "Google", "Repeat client", "Yard sign", "Other"] as const;

export const ONLINE_BOOKING_SOURCE = "Online booking";

const ALIASES: Record<string, string> = {
  "website form": "Website form",
  website: "Website form",
  referral: "Referral",
  google: "Google",
  repeat: "Repeat client",
  "repeat client": "Repeat client",
  "yard sign": "Yard sign",
  other: "Other",
  manual: "Other",
  "home show": "Home show",
  angi: "Other",
  neighbor: "Referral",
  "online booking": ONLINE_BOOKING_SOURCE,
};

type Writer = Pick<AppDatabase, "select" | "insert" | "update" | "delete">;

function dbFor(orgId: string): AppDatabase {
  const db = officeDb(orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function assertAdmin(actor: Actor) {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("Only an owner or admin can change lead sources.");
}

export function canonicalSourceName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!trimmed) return "Other";
  return ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

export function ensureDefaultSources(db: Writer, orgId: string) {
  const existing = db.select().from(leadSources).where(eq(leadSources.orgId, orgId)).all();
  const names = new Set(existing.map((row) => row.name));
  const now = nowIso();
  DEFAULT_SOURCE_NAMES.forEach((name, sortOrder) => {
    if (names.has(name)) return;
    db.insert(leadSources)
      .values({ id: id("src"), orgId, name, status: "active", sortOrder, createdAt: now, updatedAt: now })
      .run();
  });
}

export function bindLeadSource(db: Writer, orgId: string, raw: string): { id: string; name: string } {
  ensureDefaultSources(db, orgId);
  const trimmed = raw.trim();
  if (trimmed) {
    const byId = db.select().from(leadSources).where(and(eq(leadSources.id, trimmed), eq(leadSources.orgId, orgId))).get();
    if (byId) return { id: byId.id, name: byId.name };
  }
  const name = canonicalSourceName(trimmed);
  const found = db.select().from(leadSources).where(and(eq(leadSources.orgId, orgId), eq(leadSources.name, name))).get();
  if (found) return { id: found.id, name: found.name };
  const now = nowIso();
  const created = id("src");
  const sortOrder = db.select().from(leadSources).where(eq(leadSources.orgId, orgId)).all().length;
  db.insert(leadSources)
    .values({ id: created, orgId, name, status: "active", sortOrder, createdAt: now, updatedAt: now })
    .run();
  return { id: created, name };
}

function syncContactSource(db: Writer, orgId: string, contactId: string) {
  const rows = db
    .select()
    .from(leads)
    .where(and(eq(leads.orgId, orgId), eq(leads.contactId, contactId), isNull(leads.deletedAt)))
    .all()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const sourceId = rows[0]?.sourceId ?? null;
  db.update(contacts).set({ sourceId }).where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId))).run();
}

export function prepareLeadSources(db: Writer, orgId: string) {
  ensureDefaultSources(db, orgId);
  const unbound = db
    .select()
    .from(leads)
    .where(and(eq(leads.orgId, orgId), isNull(leads.deletedAt)))
    .all()
    .filter((lead) => !lead.sourceId);
  for (const lead of unbound) {
    const bound = bindLeadSource(db, orgId, lead.source);
    db.update(leads)
      .set({ sourceId: bound.id, source: bound.name })
      .where(and(eq(leads.id, lead.id), eq(leads.orgId, orgId)))
      .run();
  }
  const jobs = db.select().from(projects).where(eq(projects.orgId, orgId)).all().filter((project) => project.leadId && !project.leadSourceId);
  for (const project of jobs) {
    const lead = db.select().from(leads).where(and(eq(leads.id, project.leadId!), eq(leads.orgId, orgId))).get();
    if (!lead?.sourceId) continue;
    db.update(projects).set({ leadSourceId: lead.sourceId }).where(and(eq(projects.id, project.id), eq(projects.orgId, orgId))).run();
  }
  const clients = db.select().from(contacts).where(and(eq(contacts.orgId, orgId), isNull(contacts.deletedAt))).all().filter((contact) => !contact.sourceId);
  for (const contact of clients) syncContactSource(db, orgId, contact.id);
}

export function sourceChoices(orgId: string) {
  const db = dbFor(orgId);
  prepareLeadSources(db, orgId);
  return db.select().from(leadSources).where(eq(leadSources.orgId, orgId)).all().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function activeLeadSources(orgId: string) {
  return sourceChoices(orgId).filter((source) => source.status === "active");
}

export function sourceName(orgId: string, sourceId: string | null | undefined): string {
  if (!sourceId) return "";
  const row = sourceChoices(orgId).find((source) => source.id === sourceId);
  return row?.name ?? "";
}

function monthKey(day: string): string {
  return /^\d{4}-\d{2}/.test(day) ? day.slice(0, 7) : new Date().toISOString().slice(0, 7);
}

export function leadSourceBoard(actor: Actor, month?: string) {
  if (!canManageSettings(actor.role as Role)) return null;
  const db = dbFor(actor.orgId);
  prepareLeadSources(db, actor.orgId);
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  const today = localDay(Date.now(), org?.timeZone || "America/New_York");
  const key = month && /^\d{4}-\d{2}$/.test(month) ? month : monthKey(today);
  const spend = db.select().from(leadSourceSpend).where(and(eq(leadSourceSpend.orgId, actor.orgId), eq(leadSourceSpend.month, key))).all();
  const bySource = new Map(spend.map((row) => [row.sourceId, row.spendCents]));
  const sources = db
    .select()
    .from(leadSources)
    .where(eq(leadSources.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((source) => ({
      id: source.id,
      name: source.name,
      archived: source.status === "archived",
      spendCents: bySource.has(source.id) ? (bySource.get(source.id) ?? 0) : null,
    }));
  return { month: key, sources };
}

export function createLeadSource(actor: Actor, name: string) {
  assertAdmin(actor);
  const db = dbFor(actor.orgId);
  prepareLeadSources(db, actor.orgId);
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!clean) throw new ServiceError("Name the source.");
  const taken = db.select().from(leadSources).where(and(eq(leadSources.orgId, actor.orgId), eq(leadSources.name, clean))).get();
  if (taken) throw new ServiceError("That source already exists.");
  const now = nowIso();
  const sortOrder = db.select().from(leadSources).where(eq(leadSources.orgId, actor.orgId)).all().length;
  const sourceId = id("src");
  db.insert(leadSources)
    .values({ id: sourceId, orgId: actor.orgId, name: clean, status: "active", sortOrder, createdAt: now, updatedAt: now })
    .run();
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action: "lead_source.create",
      entityType: "lead_source",
      entityId: sourceId,
      payloadJson: JSON.stringify({ name: clean }),
      ip: null,
      createdAt: now,
    })
    .run();
  return sourceId;
}

export function setLeadSourceStatus(actor: Actor, sourceId: string, archived: boolean) {
  assertAdmin(actor);
  const db = dbFor(actor.orgId);
  const row = db.select().from(leadSources).where(and(eq(leadSources.id, sourceId), eq(leadSources.orgId, actor.orgId))).get();
  if (!row) throw new ServiceError("That source is not in your company.");
  const status = archived ? "archived" : "active";
  if (row.status === status) return;
  const now = nowIso();
  db.update(leadSources).set({ status, updatedAt: now }).where(and(eq(leadSources.id, sourceId), eq(leadSources.orgId, actor.orgId))).run();
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action: archived ? "lead_source.archive" : "lead_source.restore",
      entityType: "lead_source",
      entityId: sourceId,
      payloadJson: JSON.stringify({ name: row.name }),
      ip: null,
      createdAt: now,
    })
    .run();
}

export function setLeadSourceSpend(actor: Actor, sourceId: string, month: string, spendCents: number | null) {
  assertAdmin(actor);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ServiceError("Pick a month.");
  if (spendCents != null && (!Number.isInteger(spendCents) || spendCents < 0 || spendCents > MAX_MONEY_CENTS)) throw new ServiceError("Enter the spend in dollars.");
  const db = dbFor(actor.orgId);
  const source = db.select().from(leadSources).where(and(eq(leadSources.id, sourceId), eq(leadSources.orgId, actor.orgId))).get();
  if (!source) throw new ServiceError("That source is not in your company.");
  const now = nowIso();
  const existing = db
    .select()
    .from(leadSourceSpend)
    .where(and(eq(leadSourceSpend.orgId, actor.orgId), eq(leadSourceSpend.sourceId, sourceId), eq(leadSourceSpend.month, month)))
    .get();
  if (spendCents == null) {
    if (existing) db.delete(leadSourceSpend).where(and(eq(leadSourceSpend.id, existing.id), eq(leadSourceSpend.orgId, actor.orgId))).run();
  } else if (existing) {
    db.update(leadSourceSpend)
      .set({ spendCents, updatedAt: now })
      .where(and(eq(leadSourceSpend.id, existing.id), eq(leadSourceSpend.orgId, actor.orgId)))
      .run();
  } else {
    db.insert(leadSourceSpend)
      .values({ id: id("spend"), orgId: actor.orgId, sourceId, month, spendCents, createdAt: now, updatedAt: now })
      .run();
  }
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action: "lead_source.spend",
      entityType: "lead_source",
      entityId: sourceId,
      payloadJson: JSON.stringify({ month, spendCents }),
      ip: null,
      createdAt: now,
    })
    .run();
}

export function parseSpendInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cents = parseMoneyToCents(trimmed);
  if (cents == null) throw new ServiceError("Enter the spend in dollars.");
  return cents;
}

export function setLeadSource(actor: Actor, leadId: string, sourceId: string) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role can view this, not change it.");
  const db = dbFor(actor.orgId);
  prepareLeadSources(db, actor.orgId);
  const lead = db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, actor.orgId), isNull(leads.deletedAt))).get();
  const source = db.select().from(leadSources).where(and(eq(leadSources.id, sourceId), eq(leadSources.orgId, actor.orgId))).get();
  if (!lead || !source) throw new ServiceError("That lead is not in your company.");
  if (lead.sourceId === source.id && lead.source === source.name) return;
  const now = nowIso();
  db.update(leads)
    .set({ sourceId: source.id, source: source.name, updatedAt: now })
    .where(and(eq(leads.id, lead.id), eq(leads.orgId, actor.orgId)))
    .run();
  syncContactSource(db, actor.orgId, lead.contactId);
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action: "lead.source",
      entityType: "lead",
      entityId: lead.id,
      payloadJson: JSON.stringify({ from: lead.source, to: source.name }),
      ip: null,
      createdAt: now,
    })
    .run();
}

function dayOf(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return localDay(ms, timeZone);
}

export function leadSourceFacts(orgId: string, range: DayRange): { rows: AttributionRow[]; total: AttributionRow } {
  const db = dbFor(orgId);
  prepareLeadSources(db, orgId);
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  const zone = org?.timeZone || "America/New_York";
  const sources = db
    .select()
    .from(leadSources)
    .where(eq(leadSources.orgId, orgId))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const leadRows = db.select().from(leads).where(and(eq(leads.orgId, orgId), isNull(leads.deletedAt))).all();
  const signed = db
    .select()
    .from(proposals)
    .where(and(eq(proposals.orgId, orgId), eq(proposals.status, "signed")))
    .all();
  const projectRows = db.select().from(projects).where(eq(projects.orgId, orgId)).all();
  const orders = db.select().from(changeOrders).where(eq(changeOrders.orgId, orgId)).all();
  const ordersByProject = new Map<string, typeof orders>();
  for (const order of orders) {
    const list = ordersByProject.get(order.projectId) ?? [];
    list.push(order);
    ordersByProject.set(order.projectId, list);
  }
  const leadFacts: LeadFact[] = leadRows
    .filter((lead) => lead.sourceId)
    .map((lead) => ({ sourceId: lead.sourceId as string, createdOn: dayOf(lead.createdAt, zone) }));
  const wins: WinFact[] = [];
  const jobs: JobFact[] = [];
  const wonLeadIds = new Set<string>();
  const countedProjects = new Set<string>();
  for (const proposal of signed) {
    if (!proposal.signedAt || !proposal.projectId || countedProjects.has(proposal.projectId)) continue;
    const project = projectRows.find((row) => row.id === proposal.projectId);
    if (!project) continue;
    const lead = leadRows.find((row) => row.id === proposal.leadId);
    const sourceId = project.leadSourceId || lead?.sourceId;
    if (!sourceId) continue;
    countedProjects.add(project.id);
    const wonOn = dayOf(proposal.signedAt, zone);
    wins.push({ sourceId, wonOn });
    wonLeadIds.add(proposal.leadId);
    jobs.push({
      sourceId,
      signedOn: wonOn,
      soldCents: contractSoldCents(project.originalContractCents, ordersByProject.get(project.id) ?? []),
    });
  }
  for (const lead of leadRows) {
    if (lead.status !== "won" || !lead.sourceId || wonLeadIds.has(lead.id)) continue;
    wins.push({ sourceId: lead.sourceId, wonOn: dayOf(lead.updatedAt, zone) });
  }
  const invoiceRows = db.select().from(invoices).where(eq(invoices.orgId, orgId)).all();
  const invoiceProject = new Map(invoiceRows.map((invoice) => [invoice.id, invoice.projectId]));
  const projectSource = new Map(projectRows.map((project) => [project.id, project.leadSourceId || ""]));
  const cash: CashFact[] = db
    .select()
    .from(payments)
    .where(eq(payments.orgId, orgId))
    .all()
    .flatMap((payment) => {
      if (payment.status !== "succeeded" || payment.method === CLIENT_CREDIT_METHOD) return [];
      const sourceId = projectSource.get(invoiceProject.get(payment.invoiceId) || "") || "";
      if (!sourceId) return [];
      return [{ sourceId, paidOn: dayOf(payment.createdAt, zone), cents: payment.amountCents }];
    });
  const spend: SpendFact[] = db
    .select()
    .from(leadSourceSpend)
    .where(eq(leadSourceSpend.orgId, orgId))
    .orderBy(asc(leadSourceSpend.month))
    .all()
    .map((row) => ({ sourceId: row.sourceId, month: row.month, cents: row.spendCents }));
  return attribute(
    {
      sources: sources.map((source) => ({ id: source.id, name: source.name, archived: source.status === "archived" })),
      leads: leadFacts,
      wins,
      jobs,
      cash,
      spend,
    },
    range,
  );
}

function moneyText(cents: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return formatWhole(cents);
}

export function leadSourceEngineRows(orgId: string, range: DayRange): EngineRow[] {
  const report = leadSourceFacts(orgId, range);
  return report.rows.map((row) => ({
    id: row.id,
    href: `/pipeline?source=${encodeURIComponent(row.name)}`,
    cells: {
      name: { text: row.name, sort: row.name, value: null },
      leads: { text: String(row.leads), sort: row.leads, value: row.leads },
      won: { text: String(row.won), sort: row.won, value: row.won },
      rate: { text: formatPercent(row.winRateBps), sort: row.winRateBps ?? -1, value: null },
      sold: { text: formatWhole(row.soldCents), sort: row.soldCents, value: row.soldCents },
      collected: { text: formatWhole(row.collectedCents), sort: row.collectedCents, value: row.collectedCents },
      spend: { text: formatWhole(row.spendCents), sort: row.spendCents, value: row.spendCents },
      cpl: { text: moneyText(row.costPerLeadCents), sort: row.costPerLeadCents ?? -1, value: null },
      cpw: { text: moneyText(row.costPerWonCents), sort: row.costPerWonCents ?? -1, value: null },
      ret: { text: formatReturn(row.returnHundredths), sort: row.returnHundredths ?? -1, value: null },
    },
  }));
}

export function leadSourceFooter(rows: EngineRow[]): Record<string, string> {
  const sum = (key: string) => rows.reduce((total, row) => total + (typeof row.cells[key]?.value === "number" ? row.cells[key].value : 0), 0);
  const leads = sum("leads");
  const won = sum("won");
  const sold = sum("sold");
  const collected = sum("collected");
  const spend = sum("spend");
  return {
    name: "Total",
    leads: String(leads),
    won: String(won),
    rate: formatPercent(rateBps(won, leads)),
    sold: formatWhole(sold),
    collected: formatWhole(collected),
    spend: formatWhole(spend),
    cpl: moneyText(divideCents(spend, leads)),
    cpw: moneyText(divideCents(spend, won)),
    ret: formatReturn(ratioHundredths(collected, spend)),
  };
}
