import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  budgetLines,
  changeOrderLines,
  changeOrders,
  costItems,
  documents,
  projects,
  selectionChoices,
  selectionEvents,
  selections,
} from "@/lib/db/schema";
import { canonicalJson, sha256 } from "@/lib/esign/hash";
import { id, nowIso } from "@/lib/ids";
import { formatWhole, MAX_MONEY_CENTS, MAX_QTY, qtyToMilli } from "@/lib/money";
import { canManageMoney, canSeeMoney, type Role } from "@/lib/permissions";
import { CONSENT_VERSION } from "@/lib/product";
import {
  changeOrderPrefill,
  choiceAmounts,
  formatSelectionDelta,
  publicSnapshot,
} from "@/lib/selections/money";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { createChangeOrder } from "@/lib/services/write";

const choiceSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(160),
  vendor: z.string().trim().max(160).optional().default(""),
  sku: z.string().trim().max(160).optional().default(""),
  link: z.string().trim().max(500).optional().default(""),
  photoDocumentId: z.string().min(1).max(80).nullable().optional(),
  unitPriceCents: z.number().int().min(0).max(MAX_MONEY_CENTS),
  unitCostCents: z.number().int().min(0).max(MAX_MONEY_CENTS),
  note: z.string().trim().max(500).optional().default(""),
});

const selectionSchema = z.object({
  title: z.string().trim().min(1).max(160),
  area: z.string().trim().max(120).optional().default(""),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  qtyMilli: z.number().int().positive().max(qtyToMilli(MAX_QTY)),
  allowanceBudgetLineId: z.string().min(1).max(80).nullable(),
  choices: z.array(choiceSchema).min(2).max(12),
});

export type SelectionInput = z.infer<typeof selectionSchema>;

type ChoiceRow = typeof selectionChoices.$inferSelect;
type SelectionRow = typeof selections.$inferSelect;
type BudgetRow = typeof budgetLines.$inferSelect;

export type SelectionChoiceView = {
  id: string;
  name: string;
  vendor: string | null;
  sku: string | null;
  link: string | null;
  note: string | null;
  photoDocumentId: string | null;
  unitPriceCents: number | null;
  unitCostCents: number | null;
  deltaCents: number | null;
  deltaLabel: string | null;
};

export type SelectionView = {
  id: string;
  title: string;
  area: string;
  dueDate: string | null;
  status: string;
  statusLabel: string;
  overdue: boolean;
  chosenName: string | null;
  chosenChoiceId: string | null;
  allowanceName: string | null;
  allowancePriceCents: number | null;
  allowanceLabel: string | null;
  chosenPriceCents: number | null;
  differenceCents: number | null;
  differenceLabel: string | null;
  draftLabel: string | null;
  changeOrderId: string | null;
  changeOrderStatus: string | null;
  qty: number;
  choices: SelectionChoiceView[];
};

export type SelectionBoard = {
  projectId: string;
  projectName: string;
  showMoney: boolean;
  canEdit: boolean;
  today: string;
  allowanceTotalCents: number | null;
  chosenTotalCents: number | null;
  differenceCents: number | null;
  allowances: { id: string; name: string; priceCents: number | null }[];
  rows: SelectionView[];
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  released: "Released",
  chosen: "Chosen",
  locked: "Locked",
};

function assertEditor(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Your role cannot change prices or invoices.");
}

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function projectInOrg(actor: Actor) {
  return dbFor(actor);
}

function parseInput(input: SelectionInput): SelectionInput {
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError("A selection needs a title and two choices.");
  return parsed.data;
}

function amountsFor(selection: SelectionRow, choice: ChoiceRow, allowance: BudgetRow | null) {
  return choiceAmounts({
    qtyMilli: selection.qtyMilli,
    unitPriceCents: choice.unitPriceCents,
    unitCostCents: choice.unitCostCents,
    allowancePriceCents: allowance?.budgetPriceCents ?? null,
    allowanceCostCents: allowance?.budgetCostCents ?? null,
  });
}

function snapshotFor(selection: SelectionRow, choice: ChoiceRow, allowance: BudgetRow | null) {
  const amounts = amountsFor(selection, choice, allowance);
  return publicSnapshot({
    selectionId: selection.id,
    title: selection.title,
    qtyMilli: selection.qtyMilli,
    allowancePriceCents: allowance?.budgetPriceCents ?? null,
    choice: {
      id: choice.id,
      name: choice.name,
      priceCents: amounts.extendedPriceCents,
      differenceCents: amounts.differenceCents,
    },
  });
}

function stateOf(selection: SelectionRow) {
  return {
    status: selection.status,
    chosenChoiceId: selection.chosenChoiceId,
    costItemId: selection.costItemId,
    changeOrderId: selection.changeOrderId,
  };
}

function recordEvent(
  tx: ReturnType<typeof getDb>,
  input: {
    orgId: string;
    selectionId: string;
    actorId: string | null;
    action: string;
    reason: string | null;
    before: unknown;
    after: unknown;
    signerName?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    docHash?: string | null;
    consentTextVersion?: string | null;
  },
) {
  const now = nowIso();
  tx.insert(selectionEvents)
    .values({
      id: id("slev"),
      orgId: input.orgId,
      selectionId: input.selectionId,
      actorId: input.actorId,
      action: input.action,
      reason: input.reason,
      beforeJson: JSON.stringify(input.before),
      afterJson: JSON.stringify(input.after),
      signerName: input.signerName ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      docHash: input.docHash ?? null,
      consentTextVersion: input.consentTextVersion ?? null,
      createdAt: now,
    })
    .run();
  tx.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: input.orgId,
      actorId: input.actorId,
      action: `selection.${input.action}`,
      entityType: "selection",
      entityId: input.selectionId,
      payloadJson: JSON.stringify({ reason: input.reason, before: input.before, after: input.after }),
      ip: input.ip ?? null,
      createdAt: now,
    })
    .run();
}

function loadBundle(db: ReturnType<typeof getDb>, orgId: string, projectId: string) {
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
  if (!project) return null;
  const rows = db
    .select()
    .from(selections)
    .where(and(eq(selections.orgId, orgId), eq(selections.projectId, projectId)))
    .orderBy(asc(selections.dueDate), asc(selections.title))
    .all();
  const ids = rows.map((row) => row.id);
  const choices = ids.length
    ? db
        .select()
        .from(selectionChoices)
        .where(and(eq(selectionChoices.orgId, orgId), inArray(selectionChoices.selectionId, ids)))
        .orderBy(asc(selectionChoices.sortOrder))
        .all()
    : [];
  const lines = db.select().from(budgetLines).where(and(eq(budgetLines.orgId, orgId), eq(budgetLines.projectId, projectId))).all();
  const orderIds = rows.map((row) => row.changeOrderId).filter((value): value is string => Boolean(value));
  const orders = orderIds.length
    ? db
        .select()
        .from(changeOrders)
        .where(and(eq(changeOrders.orgId, orgId), inArray(changeOrders.id, orderIds)))
        .all()
    : [];
  return { project, rows, choices, lines, orders };
}

function viewOf(
  selection: SelectionRow,
  choices: ChoiceRow[],
  allowance: BudgetRow | null,
  order: { id: string; status: string } | null,
  showMoney: boolean,
  today: string,
): SelectionView {
  const mine = choices.filter((choice) => choice.selectionId === selection.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const chosen = mine.find((choice) => choice.id === selection.chosenChoiceId) ?? null;
  const chosenAmounts = chosen ? amountsFor(selection, chosen, allowance) : null;
  const prefill = chosen
    ? changeOrderPrefill({
        linked: Boolean(allowance),
        extendedPriceCents: chosenAmounts!.extendedPriceCents,
        extendedCostCents: chosenAmounts!.extendedCostCents,
        allowancePriceCents: allowance?.budgetPriceCents ?? null,
        allowanceCostCents: allowance?.budgetCostCents ?? null,
      })
    : null;
  const openDraft = order?.status === "draft" || order?.status === "sent" || order?.status === "approved";
  const draftLabel = prefill && !openDraft && (selection.status === "chosen" || selection.status === "locked") ? formatSelectionDelta(prefill.priceCents) : null;
  return {
    id: selection.id,
    title: selection.title,
    area: selection.area ?? "",
    dueDate: selection.dueDate,
    status: selection.status,
    statusLabel: STATUS_LABEL[selection.status] ?? selection.status,
    overdue: Boolean(selection.dueDate && selection.dueDate < today && (selection.status === "draft" || selection.status === "released")),
    chosenName: chosen?.name ?? null,
    chosenChoiceId: chosen?.id ?? null,
    allowanceName: allowance?.name ?? null,
    allowancePriceCents: showMoney ? (allowance?.budgetPriceCents ?? null) : null,
    allowanceLabel: showMoney && allowance ? formatWhole(allowance.budgetPriceCents) : null,
    chosenPriceCents: showMoney ? (chosenAmounts?.extendedPriceCents ?? null) : null,
    differenceCents: showMoney && chosenAmounts ? chosenAmounts.differenceCents : null,
    differenceLabel: showMoney && chosenAmounts ? formatSelectionDelta(chosenAmounts.differenceCents) : null,
    draftLabel: showMoney ? draftLabel : null,
    changeOrderId: showMoney ? selection.changeOrderId : null,
    changeOrderStatus: showMoney ? (order?.status ?? null) : null,
    qty: selection.qtyMilli / 1000,
    choices: mine.map((choice) => {
      const amounts = amountsFor(selection, choice, allowance);
      return {
        id: choice.id,
        name: choice.name,
        vendor: choice.vendor,
        sku: choice.sku,
        link: choice.link,
        note: choice.note,
        photoDocumentId: choice.photoDocumentId,
        unitPriceCents: showMoney ? choice.unitPriceCents : null,
        unitCostCents: showMoney ? choice.unitCostCents : null,
        deltaCents: showMoney ? amounts.differenceCents : null,
        deltaLabel: showMoney ? formatSelectionDelta(amounts.differenceCents) : null,
      };
    }),
  };
}

function present(bundle: NonNullable<ReturnType<typeof loadBundle>>, role: Role, today: string): SelectionBoard {
  const showMoney = canSeeMoney(role);
  const lineById = new Map(bundle.lines.map((line) => [line.id, line]));
  const orderById = new Map(bundle.orders.map((order) => [order.id, order]));
  const rows = bundle.rows.map((selection) =>
    viewOf(
      selection,
      bundle.choices,
      selection.allowanceBudgetLineId ? (lineById.get(selection.allowanceBudgetLineId) ?? null) : null,
      selection.changeOrderId ? (orderById.get(selection.changeOrderId) ?? null) : null,
      showMoney,
      today,
    ),
  );
  const allowanceTotal = rows.reduce((sum, row) => sum + (row.allowancePriceCents ?? 0), 0);
  const chosenTotal = rows.reduce((sum, row) => sum + (row.chosenPriceCents ?? 0), 0);
  const difference = rows.reduce((sum, row) => sum + (row.differenceCents ?? 0), 0);
  return {
    projectId: bundle.project.id,
    projectName: bundle.project.name,
    showMoney,
    canEdit: canManageMoney(role),
    today,
    allowanceTotalCents: showMoney ? allowanceTotal : null,
    chosenTotalCents: showMoney ? chosenTotal : null,
    differenceCents: showMoney ? difference : null,
    allowances: showMoney
      ? bundle.lines.map((line) => ({ id: line.id, name: line.name, priceCents: line.budgetPriceCents }))
      : [],
    rows,
  };
}

export function selectionBoard(actor: Actor, projectId: string, today: string): SelectionBoard | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const bundle = loadBundle(db, actor.orgId, projectId);
  if (!bundle) return null;
  return present(bundle, actor.role, today);
}

export function overdueSelections(orgId: string, today: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  const rows = db
    .select({
      id: selections.id,
      projectId: selections.projectId,
      title: selections.title,
      dueDate: selections.dueDate,
      status: selections.status,
      projectName: projects.name,
    })
    .from(selections)
    .innerJoin(projects, and(eq(projects.id, selections.projectId), eq(projects.orgId, selections.orgId)))
    .where(and(eq(selections.orgId, orgId), inArray(selections.status, ["draft", "released"])))
    .all();
  return rows
    .filter((row) => row.dueDate != null && row.dueDate < today)
    .map((row) => ({
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      dueDate: row.dueDate as string,
      projectName: row.projectName,
    }));
}

function requireSelection(db: ReturnType<typeof getDb>, actor: Actor, selectionId: string) {
  const selection = db
    .select()
    .from(selections)
    .where(and(eq(selections.id, selectionId), eq(selections.orgId, actor.orgId)))
    .get();
  if (!selection) throw new ServiceError("Selection not found.");
  const project = db
    .select()
    .from(projects)
    .where(and(eq(projects.id, selection.projectId), eq(projects.orgId, actor.orgId)))
    .get();
  if (!project) throw new ServiceError("Job not found.");
  return { selection, project };
}

function allowanceFor(db: ReturnType<typeof getDb>, orgId: string, projectId: string, lineId: string | null) {
  if (!lineId) return null;
  const line = db
    .select()
    .from(budgetLines)
    .where(and(eq(budgetLines.id, lineId), eq(budgetLines.orgId, orgId), eq(budgetLines.projectId, projectId)))
    .get();
  if (!line) throw new ServiceError("That allowance is not on this job.");
  return line;
}

function writeChoices(
  tx: ReturnType<typeof getDb>,
  orgId: string,
  projectId: string,
  selectionId: string,
  choices: SelectionInput["choices"],
) {
  tx.delete(selectionChoices).where(and(eq(selectionChoices.orgId, orgId), eq(selectionChoices.selectionId, selectionId))).run();
  choices.forEach((choice, index) => {
    if (choice.photoDocumentId) {
      const photo = tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, choice.photoDocumentId), eq(documents.orgId, orgId), eq(documents.projectId, projectId)))
        .get();
      if (!photo) throw new ServiceError("That photo is not on this job.");
    }
    tx.insert(selectionChoices)
      .values({
        id: choice.id && choice.id.startsWith("choc_") ? choice.id : id("choc"),
        orgId,
        selectionId,
        name: choice.name,
        vendor: choice.vendor || null,
        sku: choice.sku || null,
        link: choice.link || null,
        photoDocumentId: choice.photoDocumentId ?? null,
        unitPriceCents: choice.unitPriceCents,
        unitCostCents: choice.unitCostCents,
        note: choice.note || null,
        sortOrder: index,
      })
      .run();
  });
}

export function saveSelection(actor: Actor, projectId: string, selectionId: string | null, input: SelectionInput) {
  assertEditor(actor);
  const parsed = parseInput(input);
  const db = projectInOrg(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  allowanceFor(db, actor.orgId, projectId, parsed.allowanceBudgetLineId);
  const now = nowIso();
  if (!selectionId) {
    const created = id("sel");
    db.transaction((tx) => {
      tx.insert(selections)
        .values({
          id: created,
          orgId: actor.orgId,
          projectId,
          title: parsed.title,
          area: parsed.area || null,
          dueDate: parsed.dueDate,
          status: "draft",
          allowanceBudgetLineId: parsed.allowanceBudgetLineId,
          qtyMilli: parsed.qtyMilli,
          chosenChoiceId: null,
          costItemId: null,
          changeOrderId: null,
          createdBy: actor.userId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      writeChoices(tx, actor.orgId, projectId, created, parsed.choices);
    });
    return created;
  }
  const { selection } = requireSelection(db, actor, selectionId);
  if (selection.projectId !== projectId) throw new ServiceError("Selection not found.");
  if (selection.status === "chosen" || selection.status === "locked") {
    throw new ServiceError("Reset the selection before editing it.");
  }
  db.transaction((tx) => {
    tx.update(selections)
      .set({
        title: parsed.title,
        area: parsed.area || null,
        dueDate: parsed.dueDate,
        allowanceBudgetLineId: parsed.allowanceBudgetLineId,
        qtyMilli: parsed.qtyMilli,
        updatedAt: now,
      })
      .where(and(eq(selections.id, selection.id), eq(selections.orgId, actor.orgId)))
      .run();
    writeChoices(tx, actor.orgId, projectId, selection.id, parsed.choices);
  });
  return selection.id;
}

export function releaseSelection(actor: Actor, selectionId: string) {
  assertEditor(actor);
  const db = projectInOrg(actor);
  const { selection } = requireSelection(db, actor, selectionId);
  if (selection.status === "released") return selection.id;
  if (selection.status !== "draft") throw new ServiceError("Only a draft can be released.");
  const before = stateOf(selection);
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(selections)
      .set({ status: "released", updatedAt: now })
      .where(and(eq(selections.id, selection.id), eq(selections.orgId, actor.orgId)))
      .run();
    recordEvent(tx, {
      orgId: actor.orgId,
      selectionId: selection.id,
      actorId: actor.userId,
      action: "release",
      reason: null,
      before,
      after: { ...before, status: "released" },
    });
  });
  return selection.id;
}

function postCost(
  tx: ReturnType<typeof getDb>,
  actorId: string | null,
  orgId: string,
  selection: SelectionRow,
  choice: ChoiceRow,
  allowance: BudgetRow,
) {
  const amounts = amountsFor(selection, choice, allowance);
  const costId = id("cost");
  const now = nowIso();
  tx.insert(costItems)
    .values({
      id: costId,
      orgId,
      projectId: selection.projectId,
      budgetLineId: allowance.id,
      costCode: allowance.costCode,
      amountCents: amounts.extendedCostCents,
      vendorName: choice.vendor,
      memo: choice.name,
      source: "selection",
      aiExtracted: 0,
      documentId: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
    })
    .run();
  return costId;
}

function applyChosen(
  tx: ReturnType<typeof getDb>,
  input: {
    orgId: string;
    actorId: string | null;
    selection: SelectionRow;
    choice: ChoiceRow;
    allowance: BudgetRow | null;
    action: "choose" | "approve";
    reason: string | null;
    signerName: string | null;
    ip: string | null;
    userAgent: string | null;
    consent: boolean;
  },
) {
  const before = stateOf(input.selection);
  const costItemId = input.allowance ? postCost(tx, input.actorId, input.orgId, input.selection, input.choice, input.allowance) : null;
  const now = nowIso();
  const after = { ...before, status: "chosen", chosenChoiceId: input.choice.id, costItemId };
  tx.update(selections)
    .set({ status: "chosen", chosenChoiceId: input.choice.id, costItemId, updatedAt: now })
    .where(and(eq(selections.id, input.selection.id), eq(selections.orgId, input.orgId)))
    .run();
  const snap = snapshotFor(input.selection, input.choice, input.allowance);
  recordEvent(tx, {
    orgId: input.orgId,
    selectionId: input.selection.id,
    actorId: input.actorId,
    action: input.action,
    reason: input.reason,
    before,
    after,
    signerName: input.signerName,
    ip: input.ip,
    userAgent: input.userAgent,
    docHash: sha256(canonicalJson(snap)),
    consentTextVersion: input.consent ? CONSENT_VERSION : null,
  });
}

export function approveSelection(actor: Actor, selectionId: string, choiceId: string, note: string, ip?: string) {
  assertEditor(actor);
  const reason = note.trim();
  if (reason.length < 2) throw new ServiceError("Add a note.");
  const db = projectInOrg(actor);
  const { selection } = requireSelection(db, actor, selectionId);
  if (selection.status === "chosen" && selection.chosenChoiceId === choiceId) return { id: selection.id, duplicate: true };
  if (selection.status === "locked") throw new ServiceError("This selection is locked.");
  if (selection.status === "chosen") throw new ServiceError("This selection is already chosen.");
  if (selection.status !== "draft" && selection.status !== "released") throw new ServiceError("This selection cannot be approved.");
  const choice = db
    .select()
    .from(selectionChoices)
    .where(and(eq(selectionChoices.id, choiceId), eq(selectionChoices.selectionId, selection.id), eq(selectionChoices.orgId, actor.orgId)))
    .get();
  if (!choice) throw new ServiceError("Choose one of the options.");
  const allowance = allowanceFor(db, actor.orgId, selection.projectId, selection.allowanceBudgetLineId);
  db.transaction((tx) => {
    applyChosen(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      selection,
      choice,
      allowance,
      action: "approve",
      reason,
      signerName: actor.name,
      ip: ip ?? null,
      userAgent: null,
      consent: false,
    });
  });
  return { id: selection.id, duplicate: false };
}

export function resetSelection(actor: Actor, selectionId: string, reason: string) {
  assertEditor(actor);
  const note = reason.trim();
  if (note.length < 2) throw new ServiceError("Add a reason.");
  const db = projectInOrg(actor);
  const { selection } = requireSelection(db, actor, selectionId);
  if (selection.status !== "chosen" && selection.status !== "locked") throw new ServiceError("Only a chosen selection can be reset.");
  const before = stateOf(selection);
  db.transaction((tx) => {
    if (selection.costItemId) {
      tx.delete(costItems)
        .where(and(eq(costItems.id, selection.costItemId), eq(costItems.orgId, actor.orgId), eq(costItems.source, "selection")))
        .run();
    }
    let changeOrderId: string | null = selection.changeOrderId;
    if (selection.changeOrderId) {
      const order = tx
        .select()
        .from(changeOrders)
        .where(and(eq(changeOrders.id, selection.changeOrderId), eq(changeOrders.orgId, actor.orgId)))
        .get();
      if (order?.status === "draft") {
        tx.delete(changeOrderLines)
          .where(and(eq(changeOrderLines.changeOrderId, order.id), eq(changeOrderLines.orgId, actor.orgId)))
          .run();
        tx.delete(changeOrders).where(and(eq(changeOrders.id, order.id), eq(changeOrders.orgId, actor.orgId))).run();
        changeOrderId = null;
      }
    }
    const now = nowIso();
    tx.update(selections)
      .set({
        status: "released",
        chosenChoiceId: null,
        costItemId: null,
        changeOrderId,
        updatedAt: now,
      })
      .where(and(eq(selections.id, selection.id), eq(selections.orgId, actor.orgId)))
      .run();
    recordEvent(tx, {
      orgId: actor.orgId,
      selectionId: selection.id,
      actorId: actor.userId,
      action: "reset",
      reason: note,
      before,
      after: { status: "released", chosenChoiceId: null, costItemId: null, changeOrderId },
    });
  });
  return selection.id;
}

export function lockSelection(actor: Actor, selectionId: string) {
  assertEditor(actor);
  const db = projectInOrg(actor);
  const { selection } = requireSelection(db, actor, selectionId);
  if (selection.status === "locked") return selection.id;
  if (selection.status !== "released" && selection.status !== "chosen") throw new ServiceError("Release the selection before locking it.");
  const before = stateOf(selection);
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(selections)
      .set({ status: "locked", updatedAt: now })
      .where(and(eq(selections.id, selection.id), eq(selections.orgId, actor.orgId)))
      .run();
    recordEvent(tx, {
      orgId: actor.orgId,
      selectionId: selection.id,
      actorId: actor.userId,
      action: "lock",
      reason: null,
      before,
      after: { ...before, status: "locked" },
    });
  });
  return selection.id;
}

export function draftSelectionChangeOrder(actor: Actor, selectionId: string) {
  assertEditor(actor);
  const db = projectInOrg(actor);
  const { selection, project } = requireSelection(db, actor, selectionId);
  if (selection.status !== "chosen" && selection.status !== "locked") throw new ServiceError("Choose an option before drafting a change order.");
  if (selection.changeOrderId) {
    const existing = db
      .select()
      .from(changeOrders)
      .where(and(eq(changeOrders.id, selection.changeOrderId), eq(changeOrders.orgId, actor.orgId)))
      .get();
    if (existing && existing.status !== "declined" && existing.status !== "void") {
      return { changeOrderId: existing.id, publicToken: existing.publicToken };
    }
  }
  const choice = db
    .select()
    .from(selectionChoices)
    .where(and(eq(selectionChoices.id, selection.chosenChoiceId ?? ""), eq(selectionChoices.orgId, actor.orgId)))
    .get();
  if (!choice) throw new ServiceError("Choose one of the options.");
  const allowance = allowanceFor(db, actor.orgId, selection.projectId, selection.allowanceBudgetLineId);
  const amounts = amountsFor(selection, choice, allowance);
  const prefill = changeOrderPrefill({
    linked: Boolean(allowance),
    extendedPriceCents: amounts.extendedPriceCents,
    extendedCostCents: amounts.extendedCostCents,
    allowancePriceCents: allowance?.budgetPriceCents ?? null,
    allowanceCostCents: allowance?.budgetCostCents ?? null,
  });
  if (!prefill) throw new ServiceError("This choice is not over the allowance.");
  const created = createChangeOrder(actor, project.id, {
    title: `${selection.title} · ${choice.name}`,
    description: choice.name,
    name: choice.name,
    qty: prefill.qty,
    unit: "ea",
    unitCostCents: prefill.unitCostCents,
    markupBps: prefill.markupBps,
    costCode: allowance?.costCode ?? undefined,
  });
  db.update(selections)
    .set({ changeOrderId: created.changeOrderId, updatedAt: nowIso() })
    .where(and(eq(selections.id, selection.id), eq(selections.orgId, actor.orgId)))
    .run();
  return created;
}

export type PortalChoice = {
  id: string;
  name: string;
  vendor: string | null;
  sku: string | null;
  link: string | null;
  note: string | null;
  photoDocumentId: string | null;
  priceCents: number;
  differenceCents: number;
  deltaLabel: string;
};

export type PortalSelection = {
  id: string;
  title: string;
  area: string;
  dueDate: string | null;
  status: string;
  chosenChoiceId: string | null;
  allowancePriceCents: number | null;
  choices: PortalChoice[];
};

export function portalSelections(token: string): PortalSelection[] | null {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, token)).get();
  if (!project) return null;
  const rows = db
    .select()
    .from(selections)
    .where(and(eq(selections.orgId, project.orgId), eq(selections.projectId, project.id), inArray(selections.status, ["released", "chosen", "locked"])))
    .orderBy(asc(selections.title))
    .all();
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const choices = db
    .select()
    .from(selectionChoices)
    .where(and(eq(selectionChoices.orgId, project.orgId), inArray(selectionChoices.selectionId, ids)))
    .orderBy(asc(selectionChoices.sortOrder))
    .all();
  const lineIds = rows.map((row) => row.allowanceBudgetLineId).filter((value): value is string => Boolean(value));
  const lines = lineIds.length
    ? db
        .select()
        .from(budgetLines)
        .where(and(eq(budgetLines.orgId, project.orgId), inArray(budgetLines.id, lineIds)))
        .all()
    : [];
  const lineById = new Map(lines.map((line) => [line.id, line]));
  return rows.map((selection) => {
    const allowance = selection.allowanceBudgetLineId ? (lineById.get(selection.allowanceBudgetLineId) ?? null) : null;
    return {
      id: selection.id,
      title: selection.title,
      area: selection.area ?? "",
      dueDate: selection.dueDate,
      status: selection.status,
      chosenChoiceId: selection.chosenChoiceId,
      allowancePriceCents: allowance?.budgetPriceCents ?? null,
      choices: choices
        .filter((choice) => choice.selectionId === selection.id)
        .map((choice) => {
          const amounts = amountsFor(selection, choice, allowance);
          return {
            id: choice.id,
            name: choice.name,
            vendor: choice.vendor,
            sku: choice.sku,
            link: choice.link,
            note: choice.note,
            photoDocumentId: choice.photoDocumentId,
            priceCents: amounts.extendedPriceCents,
            differenceCents: amounts.differenceCents,
            deltaLabel: formatSelectionDelta(amounts.differenceCents),
          };
        }),
    };
  });
}

export function chooseSelection(input: {
  token: string;
  selectionId: string;
  choiceId: string;
  typedName: string;
  consent: boolean;
  ip?: string;
  userAgent?: string;
}) {
  if (!input.consent) throw new ServiceError("Check the consent box before approving.");
  if (input.typedName.trim().length < 2) throw new ServiceError("Type your name to approve.");
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, input.token)).get();
  if (!project) throw new ServiceError("Selection not found.");
  const selection = db
    .select()
    .from(selections)
    .where(and(eq(selections.id, input.selectionId), eq(selections.orgId, project.orgId), eq(selections.projectId, project.id)))
    .get();
  if (!selection) throw new ServiceError("Selection not found.");
  if (selection.status === "locked") throw new ServiceError("This selection is locked.");
  if (selection.status === "chosen" && selection.chosenChoiceId === input.choiceId) return { duplicate: true, projectId: project.id };
  if (selection.status === "chosen") throw new ServiceError("This selection is already chosen.");
  if (selection.status !== "released") throw new ServiceError("This selection is not on the portal.");
  const choice = db
    .select()
    .from(selectionChoices)
    .where(and(eq(selectionChoices.id, input.choiceId), eq(selectionChoices.selectionId, selection.id), eq(selectionChoices.orgId, project.orgId)))
    .get();
  if (!choice) throw new ServiceError("Choose one of the options.");
  const allowance = selection.allowanceBudgetLineId
    ? (db
        .select()
        .from(budgetLines)
        .where(and(eq(budgetLines.id, selection.allowanceBudgetLineId), eq(budgetLines.orgId, project.orgId)))
        .get() ?? null)
    : null;
  db.transaction((tx) => {
    applyChosen(tx, {
      orgId: project.orgId,
      actorId: null,
      selection,
      choice,
      allowance,
      action: "choose",
      reason: null,
      signerName: input.typedName.trim(),
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      consent: true,
    });
  });
  return { duplicate: false, projectId: project.id };
}
