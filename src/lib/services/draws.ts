import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  budgetLines,
  changeOrders,
  draws,
  invoiceLines,
  invoices,
  organizations,
  payAppLines,
  projects,
  scheduleItems,
} from "@/lib/db/schema";
import {
  allocatePercents,
  billingGap,
  buildProgress,
  drawPhase,
  drawPhaseLabel,
  earnedDrawCents,
  gapLabel,
  parseDefaultDraws,
  type DrawBasis,
  type DrawPhase,
} from "@/lib/draws/math";
import { defaultSchedule } from "@/lib/domain/snapshot";
import { daysFromNow, id, nowIso, token } from "@/lib/ids";
import { canManageMoney, canManageSettings, canSeeMoney, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

type Writer = Pick<AppDatabase, "insert" | "select" | "update" | "delete">;

export type DrawRow = {
  id: string;
  title: string;
  basis: DrawBasis;
  bps: number;
  amountCents: number;
  scheduleItemId: string | null;
  scheduleTitle: string | null;
  dueOn: string | null;
  phase: DrawPhase;
  label: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  locked: boolean;
};

export type DrawBoard = {
  projectId: string;
  projectName: string;
  contractCents: number;
  billingMode: "draws" | "progress";
  retainageBps: number;
  termsDays: number;
  showMoney: boolean;
  canEdit: boolean;
  draws: DrawRow[];
  remainderCents: number;
  schedule: { id: string; title: string }[];
  billing: ReturnType<typeof billingGap> & { label: string; billedCents: number; earnedCents: number };
};

export type SovRow = {
  key: string;
  name: string;
  scheduledCents: number;
  previousCents: number;
};

export type ProgressBoard = {
  projectId: string;
  projectName: string;
  contractCents: number;
  retainageBps: number;
  closed: boolean;
  showMoney: boolean;
  canEdit: boolean;
  lines: SovRow[];
  applications: {
    id: string;
    number: string;
    applicationNumber: number | null;
    status: string;
    totalCents: number;
    retainageCents: number;
    issueDate: string;
  }[];
  heldCents: number;
  billing: DrawBoard["billing"];
};

function office(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Billing is for the office.");
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function viewDb(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function audit(tx: Writer, orgId: string, actorId: string | null, action: string, entityType: string, entityId: string, payload?: unknown) {
  tx.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType,
      entityId,
      payloadJson: payload == null ? null : JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function companyToday(db: Writer, orgId: string) {
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  return { org, today: localDay(Date.now(), org?.timeZone || "America/New_York") };
}

function nextNumber(db: Writer, orgId: string) {
  const count = db.select().from(invoices).where(eq(invoices.orgId, orgId)).all().length + 1;
  return `RR-${1000 + count}`;
}

function insertDraft(
  tx: Writer,
  input: {
    orgId: string;
    projectId: string;
    changeOrderId?: string | null;
    type: string;
    totalCents: number;
    retainageCents?: number;
    applicationNumber?: number | null;
    description: string;
    lines?: { description: string; amountCents: number }[];
    actorId: string | null;
    termsDays: number;
  },
) {
  const now = nowIso();
  const invoiceId = id("inv");
  const payToken = token();
  const number = nextNumber(tx, input.orgId);
  tx.insert(invoices)
    .values({
      id: invoiceId,
      orgId: input.orgId,
      projectId: input.projectId,
      changeOrderId: input.changeOrderId ?? null,
      number,
      type: input.type,
      status: "draft",
      scheduleIndex: null,
      issueDate: now.slice(0, 10),
      dueDate: daysFromNow(input.termsDays).slice(0, 10),
      subtotalCents: input.totalCents,
      taxCents: 0,
      totalCents: input.totalCents,
      amountPaidCents: 0,
      payToken,
      applicationNumber: input.applicationNumber ?? null,
      retainageCents: input.retainageCents ?? 0,
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
    })
    .run();
  const lines = input.lines?.length ? input.lines : [{ description: input.description, amountCents: input.totalCents }];
  lines.forEach((line, index) => {
    if (line.amountCents === 0) return;
    tx.insert(invoiceLines)
      .values({
        id: id("invl"),
        orgId: input.orgId,
        invoiceId,
        description: line.description,
        amountCents: line.amountCents,
        sortOrder: index,
      })
      .run();
  });
  return { invoiceId, payToken, number };
}

export function attachSignedDraws(
  tx: Writer,
  input: { orgId: string; projectId: string; contractCents: number; depositInvoiceId: string },
) {
  const org = tx.select().from(organizations).where(eq(organizations.id, input.orgId)).get();
  if (!org) return;
  const parts = defaultSchedule(org);
  const amounts = allocatePercents(
    input.contractCents,
    parts.map((part) => part.bps),
  );
  const now = nowIso();
  tx.update(projects)
    .set({ retainageBps: org.defaultRetainageBps ?? 0, updatedAt: now })
    .where(and(eq(projects.id, input.projectId), eq(projects.orgId, input.orgId)))
    .run();
  parts.forEach((part, index) => {
    tx.insert(draws)
      .values({
        id: id("drw"),
        orgId: input.orgId,
        projectId: input.projectId,
        title: part.label,
        basis: "percent",
        bps: part.bps,
        amountCents: amounts[index] ?? 0,
        scheduleItemId: null,
        dueOn: null,
        sortOrder: index,
        invoiceId: index === 0 ? input.depositInvoiceId : null,
        changeOrderId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
}

export function attachApprovedChange(
  tx: Writer,
  input: { orgId: string; projectId: string; changeOrderId: string; number: number; title: string; amountCents: number; invoiceId: string },
) {
  const project = tx.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.orgId, input.orgId))).get();
  if (!project || project.billingMode === "progress") return;
  const existing = tx.select().from(draws).where(and(eq(draws.projectId, input.projectId), eq(draws.orgId, input.orgId))).all();
  if (existing.length === 0) return;
  const now = nowIso();
  tx.insert(draws)
    .values({
      id: id("drw"),
      orgId: input.orgId,
      projectId: input.projectId,
      title: `CO ${input.number}`,
      basis: "fixed",
      bps: 0,
      amountCents: input.amountCents,
      scheduleItemId: null,
      dueOn: null,
      sortOrder: existing.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 1,
      invoiceId: input.invoiceId,
      changeOrderId: input.changeOrderId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function phaseFor(
  draw: { invoiceId: string | null; scheduleItemId: string | null; dueOn: string | null },
  invoiceStatus: string | null,
  item: { status: string; endDate: string } | undefined,
  today: string,
): DrawPhase {
  return drawPhase({
    invoiceStatus: invoiceStatus === "void" ? null : invoiceStatus,
    scheduleStatus: item?.status ?? null,
    scheduleEnd: item?.endDate ?? null,
    dueOn: draw.dueOn,
    today,
  });
}

function dueFor(draw: { dueOn: string | null; scheduleItemId: string | null }, item: { endDate: string } | undefined, termsDays: number) {
  if (item) return addCalendarDays(item.endDate, termsDays);
  return draw.dueOn;
}

function billedCents(db: Writer, orgId: string, projectId: string) {
  return db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.projectId, projectId)))
    .all()
    .filter((invoice) => invoice.status !== "void")
    .reduce((sum, invoice) => sum + invoice.totalCents, 0);
}

function position(db: Writer, orgId: string, projectId: string, contractCents: number, mode: string) {
  const billed = billedCents(db, orgId, projectId);
  const apps = db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.projectId, projectId)))
    .all()
    .filter((invoice) => invoice.status !== "void" && invoice.applicationNumber != null);
  let earned = billed;
  if (mode === "progress" && apps.length > 0) {
    const ids = apps.map((invoice) => invoice.id);
    earned = db
      .select()
      .from(payAppLines)
      .where(eq(payAppLines.orgId, orgId))
      .all()
      .filter((line) => ids.includes(line.invoiceId))
      .reduce((sum, line) => sum + line.thisCents, 0);
  } else if (mode !== "progress") {
    const { today } = companyToday(db, orgId);
    const rows = db.select().from(draws).where(and(eq(draws.orgId, orgId), eq(draws.projectId, projectId))).all();
    if (rows.length > 0) {
      const invoiceRows = db.select().from(invoices).where(eq(invoices.orgId, orgId)).all();
      const items = db.select().from(scheduleItems).where(eq(scheduleItems.orgId, orgId)).all();
      earned = earnedDrawCents(
        rows.map((draw) => ({
          amountCents: draw.amountCents,
          phase: phaseFor(
            draw,
            invoiceRows.find((invoice) => invoice.id === draw.invoiceId)?.status ?? null,
            items.find((item) => item.id === draw.scheduleItemId),
            today,
          ),
        })),
      );
    }
  }
  const gap = billingGap(contractCents, billed, earned);
  return { ...gap, label: gapLabel(gap.state), billedCents: billed, earnedCents: earned };
}

export function drawSchedule(actor: Actor, projectId: string): DrawBoard | null {
  const db = viewDb(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) return null;
  const showMoney = canSeeMoney(actor.role as Role);
  if (!showMoney) {
    return {
      projectId,
      projectName: project.name,
      contractCents: 0,
      billingMode: "draws",
      retainageBps: 0,
      termsDays: 0,
      showMoney: false,
      canEdit: false,
      draws: [],
      remainderCents: 0,
      schedule: [],
      billing: { billedBps: 0, completeBps: 0, gapCents: 0, state: "even", label: "Even", billedCents: 0, earnedCents: 0 },
    };
  }
  const { org, today } = companyToday(db, actor.orgId);
  const termsDays = org?.paymentTermsDays ?? 7;
  const rows = db
    .select()
    .from(draws)
    .where(and(eq(draws.orgId, actor.orgId), eq(draws.projectId, projectId)))
    .orderBy(asc(draws.sortOrder))
    .all();
  const invoiceRows = db.select().from(invoices).where(and(eq(invoices.orgId, actor.orgId), eq(invoices.projectId, projectId))).all();
  const items = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, projectId))).all();
  const listed = rows.map((draw) => {
    const invoice = invoiceRows.find((row) => row.id === draw.invoiceId && row.status !== "void");
    const item = items.find((row) => row.id === draw.scheduleItemId);
    const phase = phaseFor(draw, invoice?.status ?? null, item, today);
    return {
      id: draw.id,
      title: draw.title,
      basis: (draw.basis === "percent" ? "percent" : "fixed") as DrawBasis,
      bps: draw.bps,
      amountCents: draw.amountCents,
      scheduleItemId: draw.scheduleItemId,
      scheduleTitle: item?.title ?? null,
      dueOn: dueFor(draw, item, termsDays),
      phase,
      label: drawPhaseLabel(phase),
      invoiceId: invoice?.id ?? null,
      invoiceNumber: invoice?.number ?? null,
      locked: Boolean(invoice),
    };
  });
  const amounts = listed.map((draw) => draw.amountCents);
  return {
    projectId,
    projectName: project.name,
    contractCents: project.contractValueCents,
    billingMode: project.billingMode === "progress" ? "progress" : "draws",
    retainageBps: project.retainageBps,
    termsDays,
    showMoney: true,
    canEdit: canManageMoney(actor.role as Role),
    draws: listed,
    remainderCents: project.contractValueCents - amounts.reduce((sum, amount) => sum + amount, 0),
    schedule: items.map((item) => ({ id: item.id, title: item.title })),
    billing: position(db, actor.orgId, projectId, project.contractValueCents, project.billingMode),
  };
}

export type DrawInput = {
  id?: string;
  title: string;
  basis: DrawBasis;
  bps: number;
  amountCents: number;
  scheduleItemId: string | null;
  dueOn: string | null;
};

export function saveDrawSchedule(actor: Actor, projectId: string, input: DrawInput[]) {
  const db = office(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  if (input.length === 0) throw new ServiceError("Add at least one draw.");
  const existing = db.select().from(draws).where(and(eq(draws.orgId, actor.orgId), eq(draws.projectId, projectId))).all();
  const invoiceRows = db.select().from(invoices).where(and(eq(invoices.orgId, actor.orgId), eq(invoices.projectId, projectId))).all();
  const locked = new Set(
    existing
      .filter((draw) => invoiceRows.some((invoice) => invoice.id === draw.invoiceId && invoice.status !== "void"))
      .map((draw) => draw.id),
  );
  for (const idValue of locked) {
    if (!input.some((row) => row.id === idValue)) throw new ServiceError("An invoiced draw stays on the schedule.");
  }
  const openPercent =
    locked.size === 0 && input.every((row) => row.basis === "percent") && input.reduce((sum, row) => sum + row.bps, 0) === 10000;
  const amounts = openPercent
    ? allocatePercents(
        project.contractValueCents,
        input.map((row) => row.bps),
      )
    : input.map((row) => {
        if (row.id && locked.has(row.id)) return existing.find((draw) => draw.id === row.id)!.amountCents;
        return row.basis === "fixed" ? row.amountCents : Math.round((project.contractValueCents * row.bps) / 10000);
      });
  if (amounts.reduce((sum, amount) => sum + amount, 0) !== project.contractValueCents) throw new ServiceError("Draws must equal the contract.");
  const now = nowIso();
  const before = existing.map((draw) => ({ id: draw.id, amountCents: draw.amountCents, title: draw.title }));
  db.transaction((tx) => {
    const keep = new Set<string>();
    input.forEach((row, index) => {
      const amount = amounts[index] ?? 0;
      const title = row.title.trim().slice(0, 80) || "Draw";
      if (row.id && existing.some((draw) => draw.id === row.id)) {
        keep.add(row.id);
        const stored = existing.find((draw) => draw.id === row.id)!;
        if (locked.has(row.id)) {
          tx.update(draws).set({ sortOrder: index, updatedAt: now }).where(eq(draws.id, row.id)).run();
          return;
        }
        tx.update(draws)
          .set({
            title,
            basis: row.basis,
            bps: row.basis === "percent" ? row.bps : 0,
            amountCents: amount,
            scheduleItemId: row.scheduleItemId,
            dueOn: row.scheduleItemId ? null : row.dueOn,
            sortOrder: index,
            updatedAt: now,
          })
          .where(and(eq(draws.id, row.id), eq(draws.orgId, actor.orgId)))
          .run();
        void stored;
        return;
      }
      const created = id("drw");
      keep.add(created);
      tx.insert(draws)
        .values({
          id: created,
          orgId: actor.orgId,
          projectId,
          title,
          basis: row.basis,
          bps: row.basis === "percent" ? row.bps : 0,
          amountCents: amount,
          scheduleItemId: row.scheduleItemId,
          dueOn: row.scheduleItemId ? null : row.dueOn,
          sortOrder: index,
          invoiceId: null,
          changeOrderId: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
    for (const draw of existing) {
      if (!keep.has(draw.id) && !locked.has(draw.id)) {
        tx.delete(draws).where(and(eq(draws.id, draw.id), eq(draws.orgId, actor.orgId))).run();
      }
    }
    audit(tx, actor.orgId, actor.userId, "draw.edit", "project", projectId, { before, count: input.length });
  });
}

export function billDraw(actor: Actor, drawId: string) {
  const db = office(actor);
  const draw = db.select().from(draws).where(and(eq(draws.id, drawId), eq(draws.orgId, actor.orgId))).get();
  if (!draw) throw new ServiceError("Draw not found.");
  if (draw.invoiceId) {
    const current = db.select().from(invoices).where(eq(invoices.id, draw.invoiceId)).get();
    if (current && current.status !== "void") throw new ServiceError("That draw is already invoiced.");
  }
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  return db.transaction((tx) => {
    const issued = insertDraft(tx, {
      orgId: actor.orgId,
      projectId: draw.projectId,
      type: "progress",
      totalCents: draw.amountCents,
      description: draw.title,
      actorId: actor.userId,
      termsDays: org?.paymentTermsDays ?? 7,
    });
    tx.update(draws)
      .set({ invoiceId: issued.invoiceId, updatedAt: nowIso() })
      .where(and(eq(draws.id, draw.id), eq(draws.orgId, actor.orgId)))
      .run();
    audit(tx, actor.orgId, actor.userId, "draw.invoice", "invoice", issued.invoiceId, { drawId: draw.id, amountCents: draw.amountCents });
    return issued;
  });
}

export function billNextDraw(actor: Actor, projectId: string) {
  const db = office(actor);
  const rows = db
    .select()
    .from(draws)
    .where(and(eq(draws.orgId, actor.orgId), eq(draws.projectId, projectId)))
    .orderBy(asc(draws.sortOrder))
    .all();
  if (rows.length === 0) return null;
  const invoiceRows = db.select().from(invoices).where(and(eq(invoices.orgId, actor.orgId), eq(invoices.projectId, projectId))).all();
  const next = rows.find((draw) => {
    const invoice = invoiceRows.find((row) => row.id === draw.invoiceId);
    return !invoice || invoice.status === "void";
  });
  if (!next) throw new ServiceError("Every scheduled draw has already been invoiced.");
  return billDraw(actor, next.id);
}

export function readyToBill(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return { count: 0, cents: 0, href: null as string | null };
  const { today } = companyToday(db, orgId);
  const rows = db.select().from(draws).where(eq(draws.orgId, orgId)).all();
  const invoiceRows = db.select().from(invoices).where(eq(invoices.orgId, orgId)).all();
  const items = db.select().from(scheduleItems).where(eq(scheduleItems.orgId, orgId)).all();
  const ready = rows.filter((draw) => {
    const invoice = invoiceRows.find((row) => row.id === draw.invoiceId);
    const phase = phaseFor(draw, invoice?.status ?? null, items.find((item) => item.id === draw.scheduleItemId), today);
    return phase === "ready";
  });
  const first = ready[0];
  return {
    count: ready.length,
    cents: ready.reduce((sum, draw) => sum + draw.amountCents, 0),
    href: first ? `/projects/${first.projectId}/draws` : null,
  };
}

export function setBillingMode(actor: Actor, projectId: string, mode: "draws" | "progress", retainageBps: number) {
  const db = office(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  if (retainageBps < 0 || retainageBps > 10000) throw new ServiceError("Retainage is 0 to 100%.");
  db.update(projects)
    .set({ billingMode: mode, retainageBps, updatedAt: nowIso() })
    .where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId)))
    .run();
  audit(db, actor.orgId, actor.userId, "billing.mode", "project", projectId, { mode, retainageBps });
}

function sovLines(db: Writer, orgId: string, projectId: string): SovRow[] {
  const budget = db
    .select()
    .from(budgetLines)
    .where(and(eq(budgetLines.orgId, orgId), eq(budgetLines.projectId, projectId)))
    .all()
    .filter((line) => line.budgetPriceCents > 0);
  const apps = db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.projectId, projectId)))
    .all()
    .filter((invoice) => invoice.status !== "void" && invoice.applicationNumber != null);
  const appIds = new Set(apps.map((invoice) => invoice.id));
  const lines = db
    .select()
    .from(payAppLines)
    .where(eq(payAppLines.orgId, orgId))
    .all()
    .filter((line) => appIds.has(line.invoiceId));
  const previous = new Map<string, number>();
  for (const line of lines) previous.set(line.sourceKey, (previous.get(line.sourceKey) ?? 0) + line.thisCents);
  const covered = new Set(lines.map((line) => line.sourceKey));
  const coInvoices = db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.projectId, projectId)))
    .all()
    .filter((invoice) => invoice.status !== "void" && invoice.changeOrderId);
  for (const invoice of coInvoices) {
    const matches = budget.filter((line) => line.changeOrderId === invoice.changeOrderId);
    if (matches.length === 0) continue;
    if (matches.some((line) => covered.has(line.id))) continue;
    const first = matches[0];
    if (!first) continue;
    previous.set(first.id, (previous.get(first.id) ?? 0) + invoice.totalCents);
  }
  return budget.map((line) => ({
    key: line.id,
    name: line.name,
    scheduledCents: line.budgetPriceCents,
    previousCents: Math.min(line.budgetPriceCents, previous.get(line.id) ?? 0),
  }));
}

export function progressSheet(actor: Actor, projectId: string): ProgressBoard | null {
  const db = viewDb(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) return null;
  const showMoney = canSeeMoney(actor.role as Role);
  if (!showMoney) {
    return {
      projectId,
      projectName: project.name,
      contractCents: 0,
      retainageBps: 0,
      closed: false,
      showMoney: false,
      canEdit: false,
      lines: [],
      applications: [],
      heldCents: 0,
      billing: { billedBps: 0, completeBps: 0, gapCents: 0, state: "even", label: "Even", billedCents: 0, earnedCents: 0 },
    };
  }
  const apps = db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, actor.orgId), eq(invoices.projectId, projectId)))
    .orderBy(desc(invoices.createdAt))
    .all()
    .filter((invoice) => invoice.applicationNumber != null || invoice.type === "retainage" || invoice.type === "pay_app");
  const held = heldRetainage(db, actor.orgId, projectId);
  return {
    projectId,
    projectName: project.name,
    contractCents: project.contractValueCents,
    retainageBps: project.retainageBps,
    closed: Boolean(project.closedAt) || project.status === "complete",
    showMoney: true,
    canEdit: canManageMoney(actor.role as Role),
    lines: sovLines(db, actor.orgId, projectId),
    applications: apps.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      applicationNumber: invoice.applicationNumber,
      status: invoice.status,
      totalCents: invoice.totalCents,
      retainageCents: invoice.retainageCents,
      issueDate: invoice.issueDate,
    })),
    heldCents: held,
    billing: position(db, actor.orgId, projectId, project.contractValueCents, "progress"),
  };
}

function heldRetainage(db: Writer, orgId: string, projectId: string) {
  const rows = db.select().from(invoices).where(and(eq(invoices.orgId, orgId), eq(invoices.projectId, projectId))).all();
  const held = rows.filter((invoice) => invoice.status !== "void" && invoice.applicationNumber != null).reduce((sum, invoice) => sum + invoice.retainageCents, 0);
  const released = rows.filter((invoice) => invoice.status !== "void" && invoice.type === "retainage").reduce((sum, invoice) => sum + invoice.totalCents, 0);
  return Math.max(0, held - released);
}

export function createPayApp(
  actor: Actor,
  projectId: string,
  entries: { key: string; thisCents: number | null; percentBps: number | null }[],
) {
  const db = office(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  if (project.billingMode !== "progress") throw new ServiceError("This job bills by draws.");
  const lines = sovLines(db, actor.orgId, projectId);
  let built;
  try {
    built = buildProgress(lines, entries, project.retainageBps);
  } catch (error) {
    throw new ServiceError(error instanceof Error ? error.message : "Check the lines.");
  }
  if (built.thisPeriodCents <= 0) throw new ServiceError("Enter an amount for this period.");
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  const prior = db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, actor.orgId), eq(invoices.projectId, projectId)))
    .all()
    .filter((invoice) => invoice.status !== "void" && invoice.applicationNumber != null);
  const applicationNumber = prior.reduce((max, invoice) => Math.max(max, invoice.applicationNumber ?? 0), 0) + 1;
  return db.transaction((tx) => {
    const issued = insertDraft(tx, {
      orgId: actor.orgId,
      projectId,
      type: "pay_app",
      totalCents: built.dueCents,
      retainageCents: built.retainageCents,
      applicationNumber,
      description: `Pay application ${applicationNumber}`,
      lines: built.lines.filter((line) => line.netCents > 0).map((line) => ({ description: line.name, amountCents: line.netCents })),
      actorId: actor.userId,
      termsDays: org?.paymentTermsDays ?? 7,
    });
    built.lines.forEach((line, index) => {
      tx.insert(payAppLines)
        .values({
          id: id("pal"),
          orgId: actor.orgId,
          invoiceId: issued.invoiceId,
          sourceKey: line.key,
          name: line.name,
          scheduledCents: line.scheduledCents,
          previousCents: line.previousCents,
          thisCents: line.thisCents,
          percentBps: line.percentBps,
          retainageCents: line.retainageCents,
          sortOrder: index,
        })
        .run();
    });
    audit(tx, actor.orgId, actor.userId, "invoice.create", "invoice", issued.invoiceId, { applicationNumber, dueCents: built.dueCents });
    return { ...issued, applicationNumber };
  });
}

export function voidBilling(actor: Actor, invoiceId: string) {
  const db = office(actor);
  const invoice = db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, actor.orgId))).get();
  if (!invoice) throw new ServiceError("Invoice not found.");
  if (invoice.status === "paid") throw new ServiceError("A paid invoice stays on the record.");
  if (invoice.status === "void") throw new ServiceError("That invoice is already void.");
  const siblings = db.select().from(invoices).where(and(eq(invoices.orgId, actor.orgId), eq(invoices.projectId, invoice.projectId))).all();
  if (invoice.applicationNumber != null) {
    const later = siblings.some(
      (row) => row.status !== "void" && row.applicationNumber != null && row.applicationNumber > (invoice.applicationNumber ?? 0),
    );
    if (later) throw new ServiceError("Void the latest pay application first.");
  }
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(invoices).set({ status: "void", updatedAt: now }).where(eq(invoices.id, invoice.id)).run();
    const linked = tx.select().from(draws).where(and(eq(draws.orgId, actor.orgId), eq(draws.invoiceId, invoice.id))).all();
    for (const draw of linked) {
      tx.update(draws).set({ invoiceId: null, updatedAt: now }).where(eq(draws.id, draw.id)).run();
    }
    audit(tx, actor.orgId, actor.userId, "invoice.void", "invoice", invoice.id, { number: invoice.number });
  });
}

export function releaseRetainage(actor: Actor, projectId: string) {
  const db = office(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  if (!project.closedAt && project.status !== "complete") throw new ServiceError("Release retainage after closeout.");
  const held = heldRetainage(db, actor.orgId, projectId);
  if (held <= 0) throw new ServiceError("Retainage is already released.");
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  return db.transaction((tx) => {
    const issued = insertDraft(tx, {
      orgId: actor.orgId,
      projectId,
      type: "retainage",
      totalCents: held,
      description: "Release retainage",
      actorId: actor.userId,
      termsDays: org?.paymentTermsDays ?? 7,
    });
    audit(tx, actor.orgId, actor.userId, "retainage.release", "invoice", issued.invoiceId, { amountCents: held });
    return issued;
  });
}

export function rollChangeOrder(actor: Actor, changeOrderId: string) {
  const db = office(actor);
  const order = db.select().from(changeOrders).where(and(eq(changeOrders.id, changeOrderId), eq(changeOrders.orgId, actor.orgId))).get();
  if (!order || order.status !== "approved") throw new ServiceError("Change order not found.");
  const invoice = db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, actor.orgId), eq(invoices.changeOrderId, order.id)))
    .all()
    .find((row) => row.status === "open" || row.status === "draft");
  if (!invoice || invoice.amountPaidCents > 0) throw new ServiceError("That change order is already billed.");
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(invoices).set({ status: "void", updatedAt: now }).where(eq(invoices.id, invoice.id)).run();
    const linked = tx.select().from(draws).where(and(eq(draws.orgId, actor.orgId), eq(draws.invoiceId, invoice.id))).all();
    for (const draw of linked) tx.delete(draws).where(eq(draws.id, draw.id)).run();
    const open = tx
      .select()
      .from(draws)
      .where(and(eq(draws.orgId, actor.orgId), eq(draws.projectId, order.projectId)))
      .orderBy(asc(draws.sortOrder))
      .all()
      .filter((draw) => !draw.invoiceId);
    const next = open[0];
    if (next) {
      tx.update(draws)
        .set({ amountCents: next.amountCents + order.priceDeltaCents, basis: "fixed", bps: 0, updatedAt: now })
        .where(eq(draws.id, next.id))
        .run();
    }
    audit(tx, actor.orgId, actor.userId, "draw.edit", "change_order", order.id, { rolledCents: order.priceDeltaCents });
  });
}

export function saveBillingDefaults(
  actor: Actor,
  input: { draws: { title: string; bps: number }[]; termsDays: number; retainageBps: number; vendorRetainageBps?: number },
) {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("Only an owner or admin can change company settings.");
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  if (input.draws.length === 0) throw new ServiceError("Add at least one draw.");
  const bps = input.draws.reduce((sum, draw) => sum + draw.bps, 0);
  if (bps !== 10000) throw new ServiceError("Default draws must total 100%.");
  if (input.termsDays < 0 || input.termsDays > 90) throw new ServiceError("Terms are 0 to 90 days.");
  if (input.retainageBps < 0 || input.retainageBps > 10000) throw new ServiceError("Retainage is 0 to 100%.");
  if (input.vendorRetainageBps != null && (input.vendorRetainageBps < 0 || input.vendorRetainageBps > 10000)) {
    throw new ServiceError("Vendor retainage is 0 to 100%.");
  }
  const first = input.draws[0]?.bps ?? 0;
  const last = input.draws[input.draws.length - 1]?.bps ?? 0;
  const middle = 10000 - first - last;
  db.update(organizations)
    .set({
      defaultDrawsJson: JSON.stringify(input.draws.map((draw) => ({ title: draw.title.trim().slice(0, 80) || "Draw", bps: draw.bps }))),
      paymentTermsDays: input.termsDays,
      defaultRetainageBps: input.retainageBps,
      ...(input.vendorRetainageBps == null ? {} : { vendorRetainageBps: input.vendorRetainageBps }),
      depositBps: first,
      progressBps: middle,
      finalBps: last,
      updatedAt: nowIso(),
    })
    .where(eq(organizations.id, actor.orgId))
    .run();
  audit(db, actor.orgId, actor.userId, "draw.edit", "organization", actor.orgId, { draws: input.draws.length });
}

export function billingForProjects(orgId: string) {
  const db = officeDb(orgId);
  const map = new Map<string, { billedBps: number; label: string; gapCents: number }>();
  if (!db) return map;
  const jobs = db.select().from(projects).where(eq(projects.orgId, orgId)).all();
  for (const project of jobs) {
    const gap = position(db, orgId, project.id, project.contractValueCents, project.billingMode);
    map.set(project.id, { billedBps: gap.billedBps, label: gap.label, gapCents: gap.gapCents });
  }
  return map;
}

export function portalBilling(tokenValue: string) {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, tokenValue)).get();
  if (!project) return null;
  const { org, today } = companyToday(db, project.orgId);
  const termsDays = org?.paymentTermsDays ?? 7;
  const rows = db.select().from(draws).where(and(eq(draws.orgId, project.orgId), eq(draws.projectId, project.id))).orderBy(asc(draws.sortOrder)).all();
  const invoiceRows = db.select().from(invoices).where(and(eq(invoices.orgId, project.orgId), eq(invoices.projectId, project.id))).all();
  const items = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, project.orgId), eq(scheduleItems.projectId, project.id))).all();
  const applications = invoiceRows.filter((invoice) => invoice.status !== "void" && invoice.applicationNumber != null);
  const lineRows = db.select().from(payAppLines).where(eq(payAppLines.orgId, project.orgId)).all();
  return {
    mode: project.billingMode === "progress" ? "progress" : "draws",
    retainedCents: heldRetainage(db, project.orgId, project.id),
    draws: rows.map((draw) => {
      const invoice = invoiceRows.find((row) => row.id === draw.invoiceId && row.status !== "void");
      const item = items.find((row) => row.id === draw.scheduleItemId);
      const phase = phaseFor(draw, invoice?.status ?? null, item, today);
      return { id: draw.id, title: draw.title, amountCents: draw.amountCents, dueOn: dueFor(draw, item, termsDays), label: drawPhaseLabel(phase) };
    }),
    applications: applications.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      applicationNumber: invoice.applicationNumber,
      status: invoice.status,
      totalCents: invoice.totalCents,
      retainageCents: invoice.retainageCents,
      payToken: invoice.payToken,
      lines: lineRows
        .filter((line) => line.invoiceId === invoice.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((line) => ({
          name: line.name,
          scheduledCents: line.scheduledCents,
          previousCents: line.previousCents,
          thisCents: line.thisCents,
          percentBps: line.percentBps,
          balanceCents: line.scheduledCents - line.previousCents - line.thisCents,
          retainageCents: line.retainageCents,
        })),
    })),
  };
}

export function payAppDocument(actor: Actor, invoiceId: string) {
  const db = viewDb(actor);
  if (!canSeeMoney(actor.role as Role)) return null;
  const invoice = db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, actor.orgId))).get();
  if (!invoice) return null;
  const project = db.select().from(projects).where(and(eq(projects.id, invoice.projectId), eq(projects.orgId, actor.orgId))).get();
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  const lines = db
    .select()
    .from(payAppLines)
    .where(and(eq(payAppLines.orgId, actor.orgId), eq(payAppLines.invoiceId, invoice.id)))
    .orderBy(asc(payAppLines.sortOrder))
    .all();
  return { invoice, project, orgName: org?.name ?? "", lines };
}

export function defaultDrawForm(org: { depositBps: number; progressBps: number; finalBps: number; defaultDrawsJson?: string | null; paymentTermsDays?: number; defaultRetainageBps?: number; vendorRetainageBps?: number }) {
  const custom = parseDefaultDraws(org.defaultDrawsJson);
  const draws =
    custom && custom.reduce((sum, row) => sum + row.bps, 0) === 10000
      ? custom
      : defaultSchedule(org).map((part) => ({ title: part.label, bps: part.bps }));
  return { draws, termsDays: org.paymentTermsDays ?? 7, retainageBps: org.defaultRetainageBps ?? 0, vendorRetainageBps: org.vendorRetainageBps ?? 0 };
}
