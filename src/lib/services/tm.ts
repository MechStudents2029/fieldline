import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  activities,
  auditLogs,
  changeOrderLines,
  changeOrders,
  contacts,
  documents,
  equipment,
  invoiceLines,
  invoices,
  laborRates,
  memberships,
  notifications,
  organizations,
  priceBookItems,
  projects,
  tmLines,
  tmTickets,
  users,
} from "@/lib/db/schema";
import { daysFromNow, id, nowIso, token } from "@/lib/ids";
import { MAX_MARKUP_BPS, MAX_MONEY_CENTS, MAX_QTY, qtyToMilli, taxCents } from "@/lib/money";
import { canAddFieldNotes, canManageMoney, canSeeMoney, type Role } from "@/lib/permissions";
import { photoExtension, photoUploadError, rasterImageType } from "@/lib/security";
import { emitAutomation } from "@/lib/services/automations";
import { ServiceError } from "@/lib/services/errors";
import { nextTicketNumber, ticketLabel } from "@/lib/tm/number";
import type { Actor } from "@/lib/services/read";
import { localDay } from "@/lib/time/calendar";
import { lineCharge, linesLocked, nextTicketStatus, ticketPill, ticketTotals, unitPriceFromMarkup, type TicketStatus } from "@/lib/tm/ticket";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Writer = Tx | AppDatabase;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type TicketLineInput = {
  kind: "labor" | "material" | "equipment";
  userId?: string;
  hours?: number;
  catalogCode?: string;
  label?: string;
  qty?: number;
  equipmentId?: string;
  unitCostCents?: number;
  markupBps?: number;
};

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function assertNotes(actor: Actor) {
  if (!canAddFieldNotes(actor.role as Role)) throw new ServiceError("Your role can view this, not change it.");
}

function assertMoney(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Billing is for the office.");
}

function seeMoney(actor: Actor) {
  return canSeeMoney(actor.role as Role);
}

function audit(tx: Writer, orgId: string, actorId: string | null, action: string, entityId: string, payload: unknown) {
  tx.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "tm_ticket",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function cleanDay(value: string) {
  const day = value.trim();
  if (!DAY.test(day)) throw new ServiceError("Enter the date the work was done.");
  return day;
}

function cleanText(value: string, max: number, empty: string) {
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) throw new ServiceError(empty);
  if (text.length > max) throw new ServiceError(`Keep it under ${max} characters.`);
  return text;
}

function qtyOf(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_QTY) throw new ServiceError(`${label} must be greater than zero.`);
  const milli = qtyToMilli(value);
  if (!Number.isSafeInteger(milli) || milli <= 0) throw new ServiceError(`${label} must be greater than zero.`);
  return milli;
}

function signatureImage(value: string) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(value.trim());
  if (!match) throw new ServiceError("Draw a signature.");
  const raw = match[1].replace(/\s/g, "");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length < 20 || bytes.length > 400_000) throw new ServiceError("Draw a signature.");
  return `data:image/png;base64,${raw}`;
}

function signerName(value: string) {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new ServiceError("Type the signer's name.");
  if (name.length > 80) throw new ServiceError("Keep the name under 80 characters.");
  return name;
}

function loadTicket(db: Writer, orgId: string, ticketId: string) {
  return db.select().from(tmTickets).where(and(eq(tmTickets.id, ticketId), eq(tmTickets.orgId, orgId))).get();
}

function loadLines(db: Writer, orgId: string, ticketId: string) {
  return db
    .select()
    .from(tmLines)
    .where(and(eq(tmLines.orgId, orgId), eq(tmLines.ticketId, ticketId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function projectOf(db: Writer, orgId: string, projectId: string) {
  return db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
}

function laborPrice(db: Writer, orgId: string, userId: string) {
  const rows = db.select().from(laborRates).where(eq(laborRates.orgId, orgId)).all();
  const member = rows.find((row) => row.userId === userId);
  const company = rows.find((row) => row.userId === "");
  const cost = member?.hourlyCostCents ?? company?.hourlyCostCents;
  if (cost == null) throw new ServiceError("No labor rate for that person.");
  const price = member?.hourlyBillCents ?? company?.hourlyBillCents ?? cost;
  return { cost, price };
}

function markupOf(cost: number, price: number) {
  if (cost <= 0 || price <= cost) return 0;
  return Math.min(MAX_MARKUP_BPS, Math.round(((price - cost) * 10000) / cost));
}

function moneyPair(unitCostCents: number, markupBps: number) {
  if (!Number.isSafeInteger(unitCostCents) || unitCostCents < 0 || unitCostCents > MAX_MONEY_CENTS) {
    throw new ServiceError("Unit cost must be zero or a positive amount under $10,000,000.");
  }
  if (!Number.isSafeInteger(markupBps) || markupBps < 0 || markupBps > MAX_MARKUP_BPS) {
    throw new ServiceError("Markup must be between 0% and 500%.");
  }
  return { unitCostCents, markupBps, unitPriceCents: unitPriceFromMarkup(unitCostCents, markupBps) };
}

function notifyOffice(tx: Writer, orgId: string, ticket: { id: string; projectId: string; number: number }, actorName: string) {
  const members = tx.select().from(memberships).where(eq(memberships.orgId, orgId)).all();
  const now = nowIso();
  for (const member of members) {
    if (member.role !== "owner" && member.role !== "admin") continue;
    tx.insert(notifications)
      .values({
        id: id("note"),
        orgId,
        userId: member.userId,
        kind: "tm",
        commentId: null,
        entityType: "tm_ticket",
        entityId: ticket.id,
        projectId: ticket.projectId,
        actorId: null,
        actorName,
        snippet: `Field verified ${ticketLabel(ticket.number)}`,
        readAt: null,
        createdAt: now,
      })
      .run();
  }
}

function photoMeta(raw: string | null): { ticketId?: string; changeOrderId?: string; caption?: string } {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as { ticketId?: string; changeOrderId?: string; caption?: string };
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function ticketPhotos(db: Writer, orgId: string, projectId: string, ticketId: string) {
  return db
    .select()
    .from(documents)
    .where(and(eq(documents.orgId, orgId), eq(documents.projectId, projectId), eq(documents.type, "photo")))
    .all()
    .filter((row) => !row.deletedAt && photoMeta(row.metadataJson).ticketId === ticketId)
    .map((row) => ({ id: row.id, filename: row.filename, caption: photoMeta(row.metadataJson).caption || "" }));
}

type LineRow = typeof tmLines.$inferSelect;

function presentLine(line: LineRow, money: boolean) {
  const charge = lineCharge(line);
  const base = {
    id: line.id,
    kind: line.kind,
    label: line.label,
    qtyMilli: line.qtyMilli,
    unit: line.unit,
  };
  if (!money) return base;
  return {
    ...base,
    unitCostCents: line.unitCostCents,
    unitPriceCents: line.unitPriceCents,
    markupBps: line.markupBps,
    costCents: charge.costCents,
    priceCents: charge.priceCents,
  };
}

function presentTicket(db: Writer, actor: Actor | null, ticket: typeof tmTickets.$inferSelect, money: boolean) {
  const project = projectOf(db, ticket.orgId, ticket.projectId);
  const lines = loadLines(db, ticket.orgId, ticket.id);
  const contact = ticket.orderedById
    ? db.select().from(contacts).where(and(eq(contacts.id, ticket.orderedById), eq(contacts.orgId, ticket.orgId))).get()
    : undefined;
  const order = ticket.changeOrderId
    ? db.select().from(changeOrders).where(and(eq(changeOrders.id, ticket.changeOrderId), eq(changeOrders.orgId, ticket.orgId))).get()
    : undefined;
  const invoice = ticket.invoiceId
    ? db.select().from(invoices).where(and(eq(invoices.id, ticket.invoiceId), eq(invoices.orgId, ticket.orgId))).get()
    : undefined;
  const totals = money ? ticketTotals(lines, project?.taxBps ?? 0) : null;
  const status = ticket.status as TicketStatus;
  const locked = linesLocked(status);
  return {
    id: ticket.id,
    number: ticket.number,
    title: ticketLabel(ticket.number),
    projectId: ticket.projectId,
    job: project?.name ?? "",
    billingMode: project?.billingMode ?? "draws",
    performedOn: ticket.performedOn,
    location: ticket.location,
    orderedById: ticket.orderedById,
    orderedBy: contact?.name ?? "",
    description: ticket.description,
    status,
    pill: ticketPill(status),
    locked,
    companySigner: ticket.companySigner,
    companySignature: ticket.companySignature,
    companySignedAt: ticket.companySignedAt,
    clientSigner: ticket.clientSigner,
    clientSignature: ticket.clientSignature,
    clientSignedAt: ticket.clientSignedAt,
    requestedAt: ticket.requestedAt,
    changeOrderId: ticket.changeOrderId,
    changeOrderLabel: order ? `CO-${order.number}` : null,
    changeOrderStatus: order?.status ?? null,
    invoiceId: ticket.invoiceId,
    invoiceLabel: invoice?.number ?? null,
    lines: lines.map((line) => presentLine(line, money)),
    photos: ticketPhotos(db, ticket.orgId, ticket.projectId, ticket.id),
    money: totals,
    canEdit: Boolean(actor && canAddFieldNotes(actor.role as Role) && !locked),
    canVoid: Boolean(actor && canAddFieldNotes(actor.role as Role) && (status === "draft" || status === "ready" || status === "verified")),
    canBill: Boolean(actor && canManageMoney(actor.role as Role)),
    orgName: db.select().from(organizations).where(eq(organizations.id, ticket.orgId)).get()?.name ?? "",
  };
}

export function listTickets(actor: Actor, filters: { status?: string; projectId?: string }) {
  const db = dbFor(actor);
  const money = seeMoney(actor);
  const jobs = db
    .select()
    .from(projects)
    .where(eq(projects.orgId, actor.orgId))
    .all()
    .filter((row) => row.status === "active")
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const names = new Map(db.select().from(projects).where(eq(projects.orgId, actor.orgId)).all().map((row) => [row.id, row]));
  const rows = db
    .select()
    .from(tmTickets)
    .where(eq(tmTickets.orgId, actor.orgId))
    .all()
    .filter((row) => (filters.status ? row.status === filters.status : true))
    .filter((row) => (filters.projectId ? row.projectId === filters.projectId : true))
    .sort((a, b) => b.performedOn.localeCompare(a.performedOn) || b.number - a.number)
    .map((row) => {
      const project = names.get(row.projectId);
      const lines = loadLines(db, actor.orgId, row.id);
      const totals = money ? ticketTotals(lines, project?.taxBps ?? 0) : null;
      return {
        id: row.id,
        number: row.number,
        title: ticketLabel(row.number),
        projectId: row.projectId,
        job: project?.name ?? "",
        billingMode: project?.billingMode ?? "draws",
        performedOn: row.performedOn,
        status: row.status as TicketStatus,
        pill: ticketPill(row.status as TicketStatus),
        description: row.description,
        priceCents: totals?.totalCents ?? null,
      };
    });
  return { rows, jobs, canBill: canManageMoney(actor.role as Role) };
}

export function ticketDetail(actor: Actor, ticketId: string) {
  const db = dbFor(actor);
  const ticket = loadTicket(db, actor.orgId, ticketId);
  if (!ticket) return null;
  return presentTicket(db, actor, ticket, seeMoney(actor));
}

export function ticketPrint(actor: Actor, ticketId: string) {
  return ticketDetail(actor, ticketId);
}

export function ticketsCsv(actor: Actor, filters: { status?: string; projectId?: string }) {
  const board = listTickets(actor, filters);
  const money = seeMoney(actor);
  const header = money ? ["Number", "Job", "Date", "Status", "Description", "Total"] : ["Number", "Job", "Date", "Status", "Description"];
  const lines = [header.join(",")];
  for (const row of board.rows) {
    const cells = [row.title, row.job, row.performedOn, row.pill, row.description];
    if (money) cells.push(((row.priceCents ?? 0) / 100).toFixed(2));
    lines.push(cells.map(csvCell).join(","));
  }
  return { filename: "tm-tickets.csv", body: `${lines.join("\n")}\n` };
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function unbilledTm(orgId: string) {
  const db = getDb();
  const tickets = db
    .select()
    .from(tmTickets)
    .where(and(eq(tmTickets.orgId, orgId), eq(tmTickets.status, "verified")))
    .all();
  let totalCents = 0;
  for (const ticket of tickets) {
    const project = projectOf(db, orgId, ticket.projectId);
    totalCents += ticketTotals(loadLines(db, orgId, ticket.id), project?.taxBps ?? 0).totalCents;
  }
  return { count: tickets.length, totalCents, href: "/tm?status=verified" };
}

export function jobUnbilledTm(actor: Actor, projectId: string) {
  const db = dbFor(actor);
  const project = projectOf(db, actor.orgId, projectId);
  if (!project) return { count: 0, totalCents: 0 };
  const tickets = db
    .select()
    .from(tmTickets)
    .where(and(eq(tmTickets.orgId, actor.orgId), eq(tmTickets.projectId, projectId), eq(tmTickets.status, "verified")))
    .all();
  const totalCents = tickets.reduce((sum, ticket) => sum + ticketTotals(loadLines(db, actor.orgId, ticket.id), project.taxBps).totalCents, 0);
  return { count: tickets.length, totalCents };
}

export function fieldOpenTickets(actor: Actor) {
  const db = dbFor(actor);
  const names = new Map(db.select().from(projects).where(eq(projects.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  return db
    .select()
    .from(tmTickets)
    .where(eq(tmTickets.orgId, actor.orgId))
    .all()
    .filter((row) => row.status === "draft" || row.status === "ready")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      title: ticketLabel(row.number),
      job: names.get(row.projectId) ?? "",
      pill: ticketPill(row.status as TicketStatus),
      href: `/tm/${row.id}`,
    }));
}

export function ticketComposer(actor: Actor) {
  const db = dbFor(actor);
  const jobs = db
    .select()
    .from(projects)
    .where(eq(projects.orgId, actor.orgId))
    .all()
    .filter((row) => row.status === "active")
    .map((row) => ({ id: row.id, name: row.name, contactId: row.contactId }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const crew = db
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, actor.orgId))
    .all()
    .filter((row) => row.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const gear = db
    .select()
    .from(equipment)
    .where(eq(equipment.orgId, actor.orgId))
    .all()
    .filter((row) => row.rateCents != null && (row.rateUnit === "hour" || row.rateUnit === "day"))
    .map((row) => ({ id: row.id, name: row.name, unit: row.rateUnit === "hour" ? "hr" : "day" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const clients = db
    .select()
    .from(contacts)
    .where(eq(contacts.orgId, actor.orgId))
    .all()
    .filter((row) => row.type === "client")
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const zone = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get()?.timeZone || "America/New_York";
  return { jobs, crew, gear, clients, today: localDay(Date.now(), zone), money: seeMoney(actor) };
}

export function createTicket(
  actor: Actor,
  input: { projectId: string; performedOn: string; location: string; orderedById: string; description: string },
) {
  assertNotes(actor);
  const db = dbFor(actor);
  const project = projectOf(db, actor.orgId, input.projectId);
  if (!project) throw new ServiceError("Job not found.");
  const ordered = db.select().from(contacts).where(and(eq(contacts.id, input.orderedById), eq(contacts.orgId, actor.orgId))).get();
  if (!ordered) throw new ServiceError("Pick who ordered the work.");
  const description = cleanText(input.description, 500, "Describe the extra work.");
  const location = input.location.trim().replace(/\s+/g, " ").slice(0, 120);
  const performedOn = cleanDay(input.performedOn);
  const now = nowIso();
  const ticketId = id("tm");
  db.transaction((tx) => {
    const number = nextTicketNumber(tx.select({ number: tmTickets.number }).from(tmTickets).where(eq(tmTickets.orgId, actor.orgId)).all().map((row) => row.number));
    tx.insert(tmTickets)
      .values({
        id: ticketId,
        orgId: actor.orgId,
        projectId: project.id,
        number,
        performedOn,
        location,
        orderedById: ordered.id,
        description,
        status: "draft",
        companySigner: null,
        companySignature: null,
        companySignedAt: null,
        clientSigner: null,
        clientSignature: null,
        clientSignedAt: null,
        requestedAt: null,
        changeOrderId: null,
        invoiceId: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    audit(tx, actor.orgId, actor.userId, "tm.create", ticketId, { projectId: project.id, number });
  });
  return { id: ticketId };
}

export function addTicketLine(actor: Actor, ticketId: string, input: TicketLineInput) {
  assertNotes(actor);
  const db = dbFor(actor);
  const ticket = loadTicket(db, actor.orgId, ticketId);
  if (!ticket) throw new ServiceError("Ticket not found.");
  if (linesLocked(ticket.status as TicketStatus)) throw new ServiceError("Signed lines stay locked.");
  const priced = priceLine(db, actor, input);
  const now = nowIso();
  const lineId = id("tml");
  db.transaction((tx) => {
    const sort = loadLines(tx, actor.orgId, ticket.id).length;
    tx.insert(tmLines)
      .values({
        id: lineId,
        orgId: actor.orgId,
        ticketId: ticket.id,
        kind: input.kind,
        label: priced.label,
        userId: priced.userId,
        catalogId: priced.catalogId,
        equipmentId: priced.equipmentId,
        qtyMilli: priced.qtyMilli,
        unit: priced.unit,
        unitCostCents: priced.unitCostCents,
        unitPriceCents: priced.unitPriceCents,
        markupBps: priced.markupBps,
        sortOrder: sort,
      })
      .run();
    tx.update(tmTickets).set({ updatedAt: now }).where(eq(tmTickets.id, ticket.id)).run();
    audit(tx, actor.orgId, actor.userId, "tm.line", ticket.id, { lineId, kind: input.kind });
  });
  return { id: lineId };
}

function priceLine(db: Writer, actor: Actor, input: TicketLineInput) {
  if (input.kind === "labor") {
    const userId = (input.userId || "").trim();
    const member = db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, userId)))
      .get();
    if (!member) throw new ServiceError("Pick a crew member.");
    const person = db.select().from(users).where(eq(users.id, userId)).get();
    const rate = laborPrice(db, actor.orgId, userId);
    const office = seeMoney(actor) && input.unitCostCents != null ? moneyPair(input.unitCostCents, input.markupBps ?? markupOf(rate.cost, rate.price)) : null;
    return {
      label: person?.name || "Labor",
      userId,
      catalogId: null,
      equipmentId: null,
      qtyMilli: qtyOf(input.hours ?? 0, "Hours"),
      unit: "hr",
      unitCostCents: office?.unitCostCents ?? rate.cost,
      unitPriceCents: office?.unitPriceCents ?? rate.price,
      markupBps: office?.markupBps ?? markupOf(rate.cost, rate.price),
    };
  }
  if (input.kind === "equipment") {
    const gear = db.select().from(equipment).where(and(eq(equipment.id, input.equipmentId || ""), eq(equipment.orgId, actor.orgId))).get();
    if (!gear || gear.rateCents == null || (gear.rateUnit !== "hour" && gear.rateUnit !== "day")) {
      throw new ServiceError("Pick equipment that has a rate.");
    }
    return {
      label: gear.name,
      userId: null,
      catalogId: null,
      equipmentId: gear.id,
      qtyMilli: qtyOf(input.qty ?? 0, "Quantity"),
      unit: gear.rateUnit === "hour" ? "hr" : "day",
      unitCostCents: gear.rateCents,
      unitPriceCents: gear.rateCents,
      markupBps: 0,
    };
  }
  const code = (input.catalogCode || "").trim().toUpperCase();
  const catalog = code
    ? db.select().from(priceBookItems).where(and(eq(priceBookItems.orgId, actor.orgId), eq(priceBookItems.code, code))).get()
    : undefined;
  if (code && !catalog) throw new ServiceError("That catalog code is not in the price book.");
  const label = catalog?.name || cleanText(input.label || "", 120, "Name the material.");
  const baseCost = catalog?.unitCostCents ?? 0;
  const baseMarkup = catalog?.defaultMarkupBps ?? 0;
  const office = seeMoney(actor) && (input.unitCostCents != null || input.markupBps != null) ? moneyPair(input.unitCostCents ?? baseCost, input.markupBps ?? baseMarkup) : null;
  const unitCostCents = office?.unitCostCents ?? baseCost;
  const markupBps = office?.markupBps ?? baseMarkup;
  return {
    label,
    userId: null,
    catalogId: catalog?.id ?? null,
    equipmentId: null,
    qtyMilli: qtyOf(input.qty ?? 0, "Quantity"),
    unit: catalog?.unit || "ea",
    unitCostCents,
    unitPriceCents: office?.unitPriceCents ?? unitPriceFromMarkup(unitCostCents, markupBps),
    markupBps,
  };
}

export function updateTicketLine(actor: Actor, lineId: string, input: { qty: number; unitCostCents?: number; markupBps?: number }) {
  assertMoney(actor);
  const db = dbFor(actor);
  const line = db.select().from(tmLines).where(and(eq(tmLines.id, lineId), eq(tmLines.orgId, actor.orgId))).get();
  if (!line) throw new ServiceError("Line not found.");
  const ticket = loadTicket(db, actor.orgId, line.ticketId);
  if (!ticket) throw new ServiceError("Ticket not found.");
  if (linesLocked(ticket.status as TicketStatus)) throw new ServiceError("Signed lines stay locked.");
  const qtyMilli = qtyOf(input.qty, "Quantity");
  const next =
    input.unitCostCents != null || input.markupBps != null
      ? moneyPair(input.unitCostCents ?? line.unitCostCents, input.markupBps ?? line.markupBps)
      : { unitCostCents: line.unitCostCents, unitPriceCents: line.unitPriceCents, markupBps: line.markupBps };
  db.transaction((tx) => {
    tx.update(tmLines)
      .set({ qtyMilli, unitCostCents: next.unitCostCents, unitPriceCents: next.unitPriceCents, markupBps: next.markupBps })
      .where(and(eq(tmLines.id, line.id), eq(tmLines.orgId, actor.orgId)))
      .run();
    tx.update(tmTickets).set({ updatedAt: nowIso() }).where(eq(tmTickets.id, ticket.id)).run();
    audit(tx, actor.orgId, actor.userId, "tm.line", ticket.id, { lineId: line.id, qtyMilli });
  });
}

export function removeTicketLine(actor: Actor, lineId: string) {
  assertNotes(actor);
  const db = dbFor(actor);
  const line = db.select().from(tmLines).where(and(eq(tmLines.id, lineId), eq(tmLines.orgId, actor.orgId))).get();
  if (!line) throw new ServiceError("Line not found.");
  const ticket = loadTicket(db, actor.orgId, line.ticketId);
  if (!ticket) throw new ServiceError("Ticket not found.");
  if (linesLocked(ticket.status as TicketStatus)) throw new ServiceError("Signed lines stay locked.");
  db.delete(tmLines).where(and(eq(tmLines.id, line.id), eq(tmLines.orgId, actor.orgId))).run();
  db.update(tmTickets).set({ updatedAt: nowIso() }).where(eq(tmTickets.id, ticket.id)).run();
}

export function attachTicketPhoto(actor: Actor, ticketId: string, upload: { filename: string; bytes: Buffer } | null) {
  assertNotes(actor);
  const db = dbFor(actor);
  const ticket = loadTicket(db, actor.orgId, ticketId);
  if (!ticket) throw new ServiceError("Ticket not found.");
  if (linesLocked(ticket.status as TicketStatus)) throw new ServiceError("Signed lines stay locked.");
  if (!upload || upload.bytes.length === 0) throw new ServiceError("Choose a photo.");
  const error = photoUploadError(upload.filename, upload.bytes);
  if (error) throw new ServiceError(error);
  const type = rasterImageType(upload.bytes);
  if (!type) throw new ServiceError("Use a JPEG, PNG, or WebP photo.");
  const documentId = id("doc");
  const ext = photoExtension(type);
  const relative = path.join("uploads", actor.orgId, `${documentId}.${ext}`);
  const absolute = path.join(dataDir(), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, upload.bytes);
  const stem = path.basename(upload.filename).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").slice(0, 80);
  db.insert(documents)
    .values({
      id: documentId,
      orgId: actor.orgId,
      projectId: ticket.projectId,
      leadId: null,
      contactId: null,
      type: "photo",
      filename: `${stem || "photo"}.${ext}`,
      storagePath: relative,
      metadataJson: JSON.stringify({ ticketId: ticket.id, caption: "" }),
      deletedAt: null,
      createdAt: nowIso(),
      createdBy: actor.userId,
    })
    .run();
  return { id: documentId };
}

export function signTicket(actor: Actor, ticketId: string, side: "company" | "client", input: { name: string; drawn: string }) {
  assertNotes(actor);
  const db = dbFor(actor);
  const ticket = loadTicket(db, actor.orgId, ticketId);
  if (!ticket) throw new ServiceError("Ticket not found.");
  return applySignature(db, ticket, side, signerName(input.name), signatureImage(input.drawn), actor.userId, actor.name);
}

function applySignature(
  db: AppDatabase,
  ticket: typeof tmTickets.$inferSelect,
  side: "company" | "client",
  name: string,
  drawn: string,
  actorId: string | null,
  actorName: string,
) {
  const event = side === "company" ? "company" : "client";
  const next = nextTicketStatus(ticket.status as TicketStatus, event);
  if (!next) throw new ServiceError(side === "company" ? "That ticket is not waiting on a company signature." : "That ticket is already signed.");
  if (loadLines(db, ticket.orgId, ticket.id).length === 0) throw new ServiceError("Add a line first.");
  const now = nowIso();
  const project = projectOf(db, ticket.orgId, ticket.projectId);
  db.transaction((tx) => {
    tx.update(tmTickets)
      .set(
        side === "company"
          ? { status: next, companySigner: name, companySignature: drawn, companySignedAt: now, updatedAt: now }
          : { status: next, clientSigner: name, clientSignature: drawn, clientSignedAt: now, updatedAt: now },
      )
      .where(and(eq(tmTickets.id, ticket.id), eq(tmTickets.orgId, ticket.orgId)))
      .run();
    audit(tx, ticket.orgId, actorId, side === "company" ? "tm.company_sign" : "tm.client_sign", ticket.id, { status: next });
    if (side === "client") notifyOffice(tx, ticket.orgId, ticket, name);
  });
  if (side === "client" && project) {
    const lines = loadLines(db, ticket.orgId, ticket.id);
    emitAutomation({
      orgId: ticket.orgId,
      kind: "tm_verified",
      recordType: "tm_ticket",
      recordId: ticket.id,
      recordLabel: ticketLabel(ticket.number),
      projectId: ticket.projectId,
      name: ticketLabel(ticket.number),
      amountCents: ticketTotals(lines, project.taxBps).totalCents,
    });
  }
  return { status: next, actorName };
}

export function requestTicketSignature(actor: Actor, ticketId: string) {
  assertNotes(actor);
  const db = dbFor(actor);
  const ticket = loadTicket(db, actor.orgId, ticketId);
  if (!ticket) throw new ServiceError("Ticket not found.");
  if (ticket.status !== "draft" && ticket.status !== "ready") throw new ServiceError("That ticket is already signed.");
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(tmTickets).set({ requestedAt: now, updatedAt: now }).where(eq(tmTickets.id, ticket.id)).run();
    tx.insert(activities)
      .values({
        id: id("act"),
        orgId: actor.orgId,
        entityType: "project",
        entityId: ticket.projectId,
        type: "tm_request",
        actorType: "user",
        actorId: actor.userId,
        summary: `T&M ${ticketLabel(ticket.number)} is in the portal to sign.`,
        payloadJson: JSON.stringify({ ticketId: ticket.id }),
        createdAt: now,
      })
      .run();
    audit(tx, actor.orgId, actor.userId, "tm.request", ticket.id, { projectId: ticket.projectId });
  });
}

export function voidTicket(actor: Actor, ticketId: string) {
  assertNotes(actor);
  const db = dbFor(actor);
  const ticket = loadTicket(db, actor.orgId, ticketId);
  if (!ticket) throw new ServiceError("Ticket not found.");
  const next = nextTicketStatus(ticket.status as TicketStatus, "void");
  if (!next) throw new ServiceError("A billed ticket stays until the change order or invoice is voided.");
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(tmTickets).set({ status: next, updatedAt: now }).where(eq(tmTickets.id, ticket.id)).run();
    audit(tx, actor.orgId, actor.userId, "tm.void", ticket.id, { from: ticket.status });
  });
}

export function portalTmTickets(portalToken: string) {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, portalToken)).get();
  if (!project) return [];
  return db
    .select()
    .from(tmTickets)
    .where(and(eq(tmTickets.orgId, project.orgId), eq(tmTickets.projectId, project.id)))
    .all()
    .filter((row) => row.status !== "void")
    .sort((a, b) => a.number - b.number)
    .map((ticket) => {
      const view = presentTicket(db, null, ticket, true);
      return { ...view, canSign: ticket.status === "draft" || ticket.status === "ready" };
    });
}

export function portalSignTicket(portalToken: string, ticketId: string, input: { name: string; drawn: string }) {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, portalToken)).get();
  if (!project) throw new ServiceError("Ticket not found.");
  const ticket = loadTicket(db, project.orgId, ticketId);
  if (!ticket || ticket.projectId !== project.id) throw new ServiceError("Ticket not found.");
  applySignature(db, ticket, "client", signerName(input.name), signatureImage(input.drawn), null, signerName(input.name));
}

function verifiedSelection(actor: Actor, ticketIds: string[]) {
  assertMoney(actor);
  const db = dbFor(actor);
  const unique = [...new Set(ticketIds.filter(Boolean))];
  if (unique.length === 0) throw new ServiceError("Select a ticket.");
  const tickets = unique.map((ticketId) => {
    const ticket = loadTicket(db, actor.orgId, ticketId);
    if (!ticket) throw new ServiceError("Ticket not found.");
    if (ticket.status !== "verified") throw new ServiceError("Only field-verified tickets can be billed.");
    return ticket;
  });
  const projectId = tickets[0].projectId;
  if (tickets.some((ticket) => ticket.projectId !== projectId)) throw new ServiceError("Select tickets from the same job.");
  const project = projectOf(db, actor.orgId, projectId);
  if (!project) throw new ServiceError("Job not found.");
  return { db, tickets, project };
}

export function convertTicketsToChangeOrder(actor: Actor, ticketIds: string[]) {
  const { db, tickets, project } = verifiedSelection(actor, ticketIds);
  const groups = tickets.map((ticket) => ({ ticket, lines: loadLines(db, actor.orgId, ticket.id) }));
  let costDelta = 0;
  let priceDelta = 0;
  for (const group of groups) {
    const totals = ticketTotals(group.lines, 0);
    costDelta += totals.costCents;
    priceDelta += totals.priceCents;
  }
  const now = nowIso();
  const changeOrderId = id("co");
  const publicToken = token();
  db.transaction((tx) => {
    const number = tx.select().from(changeOrders).where(and(eq(changeOrders.orgId, actor.orgId), eq(changeOrders.projectId, project.id))).all().length + 1;
    const title = groups.length === 1 ? `T&M ${ticketLabel(groups[0].ticket.number)}` : `T&M ${groups.map((group) => ticketLabel(group.ticket.number)).join(", ")}`;
    tx.insert(changeOrders)
      .values({
        id: changeOrderId,
        orgId: actor.orgId,
        projectId: project.id,
        number,
        title,
        status: "draft",
        description: groups.map((group) => group.ticket.description).join(" "),
        priceDeltaCents: priceDelta,
        costDeltaCents: costDelta,
        publicToken,
        sentAt: null,
        approvedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    let sort = 0;
    for (const group of groups) {
      for (const line of group.lines) {
        const charge = lineCharge(line);
        tx.insert(changeOrderLines)
          .values({
            id: id("col"),
            orgId: actor.orgId,
            changeOrderId,
            name: `${group.ticket.number > 0 ? `${ticketLabel(group.ticket.number)} · ` : ""}${line.label}`,
            qtyMilli: line.qtyMilli,
            unit: line.unit,
            unitCostCents: line.unitPriceCents,
            markupBps: 0,
            priceCents: charge.priceCents,
            costCode: null,
            sortOrder: sort,
          })
          .run();
        sort += 1;
      }
      tx.update(tmTickets)
        .set({ status: "billed", changeOrderId, invoiceId: null, updatedAt: now })
        .where(and(eq(tmTickets.id, group.ticket.id), eq(tmTickets.orgId, actor.orgId)))
        .run();
      audit(tx, actor.orgId, actor.userId, "tm.bill", group.ticket.id, { changeOrderId });
    }
    const photos = tx
      .select()
      .from(documents)
      .where(and(eq(documents.orgId, actor.orgId), eq(documents.projectId, project.id), eq(documents.type, "photo")))
      .all();
    const ids = new Set(groups.map((group) => group.ticket.id));
    for (const photo of photos) {
      const meta = photoMeta(photo.metadataJson);
      if (!meta.ticketId || !ids.has(meta.ticketId)) continue;
      tx.update(documents)
        .set({ metadataJson: JSON.stringify({ ...meta, changeOrderId }) })
        .where(eq(documents.id, photo.id))
        .run();
    }
  });
  return { changeOrderId, projectId: project.id };
}

export function addTicketsToCostPlus(actor: Actor, ticketIds: string[]) {
  const { db, tickets, project } = verifiedSelection(actor, ticketIds);
  if (project.billingMode !== "cost_plus") throw new ServiceError("This job is not cost-plus.");
  const groups = tickets.map((ticket) => ({ ticket, lines: loadLines(db, actor.orgId, ticket.id) }));
  const added = groups.reduce((sum, group) => sum + ticketTotals(group.lines, 0).priceCents, 0);
  const now = nowIso();
  let invoiceId = "";
  db.transaction((tx) => {
    const draft = tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.orgId, actor.orgId), eq(invoices.projectId, project.id)))
      .all()
      .find((row) => row.type === "cost_plus" && row.status === "draft");
    if (draft) {
      invoiceId = draft.id;
      const subtotal = draft.subtotalCents + added;
      const tax = taxCents(subtotal, project.taxBps);
      tx.update(invoices)
        .set({ subtotalCents: subtotal, taxCents: tax, totalCents: subtotal + tax, updatedAt: now })
        .where(eq(invoices.id, draft.id))
        .run();
      let sort = tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, draft.id)).all().length;
      for (const group of groups) {
        for (const line of group.lines) {
          tx.insert(invoiceLines)
            .values({
              id: id("invl"),
              orgId: actor.orgId,
              invoiceId: draft.id,
              description: `${ticketLabel(group.ticket.number)} · ${line.label}`,
              amountCents: lineCharge(line).priceCents,
              sortOrder: sort,
            })
            .run();
          sort += 1;
        }
      }
    } else {
      invoiceId = id("inv");
      const org = tx.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
      const existingNumbers = tx.select({ number: invoices.number }).from(invoices).where(eq(invoices.orgId, actor.orgId)).all();
      const maxNumber = existingNumbers.reduce((max, row) => {
        const value = Number(row.number.replace(/^\D+/, ""));
        return Number.isFinite(value) ? Math.max(max, value) : max;
      }, 1000);
      const totals = ticketTotals(
        groups.flatMap((group) => group.lines),
        project.taxBps,
      );
      tx.insert(invoices)
        .values({
          id: invoiceId,
          orgId: actor.orgId,
          projectId: project.id,
          changeOrderId: null,
          number: `RR-${maxNumber + 1}`,
          type: "cost_plus",
          status: "draft",
          scheduleIndex: null,
          issueDate: now.slice(0, 10),
          dueDate: daysFromNow(org?.paymentTermsDays ?? 7).slice(0, 10),
          subtotalCents: totals.priceCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          amountPaidCents: 0,
          payToken: token(),
          applicationNumber: null,
          retainageCents: 0,
          presentAs: "itemized",
          markupDisplay: "baked",
          createdAt: now,
          updatedAt: now,
          createdBy: actor.userId,
        })
        .run();
      let sort = 0;
      for (const group of groups) {
        for (const line of group.lines) {
          tx.insert(invoiceLines)
            .values({
              id: id("invl"),
              orgId: actor.orgId,
              invoiceId,
              description: `${ticketLabel(group.ticket.number)} · ${line.label}`,
              amountCents: lineCharge(line).priceCents,
              sortOrder: sort,
            })
            .run();
          sort += 1;
        }
      }
      tx.insert(auditLogs)
        .values({
          id: id("audit"),
          orgId: actor.orgId,
          actorId: actor.userId,
          action: "invoice.create",
          entityType: "invoice",
          entityId: invoiceId,
          payloadJson: JSON.stringify({ type: "cost_plus", source: "tm" }),
          ip: null,
          createdAt: now,
        })
        .run();
    }
    for (const group of groups) {
      tx.update(tmTickets)
        .set({ status: "billed", invoiceId, changeOrderId: null, updatedAt: now })
        .where(and(eq(tmTickets.id, group.ticket.id), eq(tmTickets.orgId, actor.orgId)))
        .run();
      audit(tx, actor.orgId, actor.userId, "tm.bill", group.ticket.id, { invoiceId });
    }
  });
  return { invoiceId, projectId: project.id };
}

export function voidChangeOrder(actor: Actor, changeOrderId: string) {
  assertMoney(actor);
  const db = dbFor(actor);
  const order = db.select().from(changeOrders).where(and(eq(changeOrders.id, changeOrderId), eq(changeOrders.orgId, actor.orgId))).get();
  if (!order) throw new ServiceError("Change order not found.");
  if (order.status === "approved") throw new ServiceError("An approved change order stays on the contract.");
  if (order.status === "void") throw new ServiceError("That change order is already void.");
  if (order.status !== "draft" && order.status !== "sent") throw new ServiceError("That change order cannot be voided.");
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(changeOrders).set({ status: "void", updatedAt: now }).where(eq(changeOrders.id, order.id)).run();
    restoreTmForChangeOrder(tx, actor.orgId, order.id, actor.userId);
    tx.insert(auditLogs)
      .values({
        id: id("audit"),
        orgId: actor.orgId,
        actorId: actor.userId,
        action: "change_order.void",
        entityType: "change_order",
        entityId: order.id,
        payloadJson: JSON.stringify({ number: order.number }),
        ip: null,
        createdAt: now,
      })
      .run();
  });
  return { projectId: order.projectId };
}

function restoreRows(tx: Writer, orgId: string, rows: (typeof tmTickets.$inferSelect)[], actorId: string | null) {
  const now = nowIso();
  for (const ticket of rows) {
    if (ticket.status !== "billed") continue;
    const next = nextTicketStatus("billed", "restore");
    if (!next) continue;
    tx.update(tmTickets)
      .set({ status: next, changeOrderId: null, invoiceId: null, updatedAt: now })
      .where(and(eq(tmTickets.id, ticket.id), eq(tmTickets.orgId, orgId)))
      .run();
    audit(tx, orgId, actorId, "tm.restore", ticket.id, { status: next });
  }
}

export function restoreTmForInvoice(tx: Writer, orgId: string, invoiceId: string) {
  const rows = tx.select().from(tmTickets).where(and(eq(tmTickets.orgId, orgId), eq(tmTickets.invoiceId, invoiceId))).all();
  restoreRows(tx, orgId, rows, null);
}

export function restoreTmForChangeOrder(tx: Writer, orgId: string, changeOrderId: string, actorId: string | null) {
  const rows = tx.select().from(tmTickets).where(and(eq(tmTickets.orgId, orgId), eq(tmTickets.changeOrderId, changeOrderId))).all();
  restoreRows(tx, orgId, rows, actorId);
}
