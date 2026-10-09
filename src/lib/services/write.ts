import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import { dataDir, getDb } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  activities,
  aiRuns,
  auditLogs,
  budgetLines,
  changeOrderLines,
  changeOrders,
  consents,
  contacts,
  costItems,
  documents,
  estimateMeasurements,
  estimateSections,
  estimates,
  followUpDrafts,
  invoiceLines,
  invoices,
  leads,
  lineItems,
  memberships,
  messageThreads,
  messages,
  organizations,
  payments,
  pipelineStages,
  priceBookItems,
  projects,
  proposals,
  signatures,
  tasks,
  testerFeedback,
} from "@/lib/db/schema";
import { estimateFromScope } from "@/lib/ai/gateway";
import { extractIntake } from "@/lib/ai/intake";
import {
  needsOfficeFollowUpCall,
  needsProposalNudge,
  needsStaleLead,
  proposalNudgeCopy,
  staleLeadCopy,
  unsignedProposalTaskTitle,
} from "@/lib/ai/nurture";
import { suggestCostCode } from "@/lib/ai/cost-code";
import { extractReceiptText, readReceiptMeta, type StoredReceipt } from "@/lib/ai/receipt";
import { applyCatalogQuantity, evaluateFormula, FormulaError, measurementName, measurementUnit, measuresFromValues, referencedNames } from "@/lib/estimate/formula";
import { parseGridSync } from "@/lib/estimate/grid";
import { countsTowardTotal, type Billing } from "@/lib/estimate/pricing";
import { assembleSnapshot, defaultSchedule, type StoredSnapshot } from "@/lib/domain/snapshot";
import { canonicalJson, sha256 } from "@/lib/esign/hash";
import { daysFromNow, id, nowIso, token } from "@/lib/ids";
import { deliverMessage } from "@/lib/messages/outbox";
import { achFeeCents, cardFeeCents, lineAmounts, lineInputError, marginBps, positiveMoneyError, qtyToMilli } from "@/lib/money";
import { decideAch, decideCard } from "@/lib/payments/decide";
import { canAddFieldNotes, canEditCrm, canManageMoney, type Role } from "@/lib/permissions";
import { CONSENT_VERSION } from "@/lib/product";
import { photoExtension, photoUploadError, rasterImageType, receiptUploadError } from "@/lib/security";
import { attachApprovedChange, attachSignedDraws, billNextDraw } from "@/lib/services/draws";
import { ServiceError } from "@/lib/services/errors";
import { leadPhotoCues, type Actor } from "@/lib/services/read";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Writer = Tx | ReturnType<typeof getDb>;

function assertCrm(actor: Actor) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role can view this, not change it.");
}

function assertMoney(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Your role cannot change prices or invoices.");
}

/** Office mutation. A verified claim for another company throws so WITH CHECK is never skipped. */
function staffDb(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function dismissOpenFollowUps(db: Writer, orgId: string, scope: { proposalId?: string; leadId?: string; allForLead?: boolean }) {
  const pending = db
    .select()
    .from(followUpDrafts)
    .where(and(eq(followUpDrafts.orgId, orgId), eq(followUpDrafts.status, "pending")))
    .all();
  const now = nowIso();
  for (const draft of pending) {
    if (draft.kind !== "proposal_unsigned" && draft.kind !== "stale_lead") continue;
    const proposalHit = Boolean(scope.proposalId && draft.proposalId === scope.proposalId && draft.kind === "proposal_unsigned");
    const staleHit = Boolean(scope.leadId && draft.leadId === scope.leadId && draft.kind === "stale_lead");
    const leadClosed = Boolean(scope.allForLead && scope.leadId && draft.leadId === scope.leadId);
    if (!proposalHit && !staleHit && !leadClosed) continue;
    db.update(followUpDrafts).set({ status: "dismissed", updatedAt: now }).where(eq(followUpDrafts.id, draft.id)).run();
  }
}

function log(
  tx: Writer,
  orgId: string,
  entityType: string,
  entityId: string,
  type: string,
  summary: string,
  actorType: string,
  actorId: string | null,
) {
  tx.insert(activities)
    .values({
      id: id("act"),
      orgId,
      entityType,
      entityId,
      type,
      actorType,
      actorId,
      summary,
      payloadJson: null,
      createdAt: nowIso(),
    })
    .run();
}

function audit(tx: Writer, orgId: string, actorId: string | null, action: string, entityType: string, entityId: string, ip?: string) {
  tx.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType,
      entityId,
      payloadJson: null,
      ip: ip ?? null,
      createdAt: nowIso(),
    })
    .run();
}

export function moveLead(actor: Actor, leadId: string, stageId: string) {
  assertCrm(actor);
  const db = staffDb(actor);
  const lead = db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, actor.orgId))).get();
  const stage = db.select().from(pipelineStages).where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.orgId, actor.orgId))).get();
  if (!lead || !stage) throw new ServiceError("That deal is not in your company.");
  const status = stage.kind === "won" ? "won" : stage.kind === "lost" ? "lost" : "open";
  db.update(leads)
    .set({ stageId, status, updatedAt: nowIso() })
    .where(eq(leads.id, leadId))
    .run();
  if (status === "won" || status === "lost") dismissOpenFollowUps(db, actor.orgId, { leadId, allForLead: true });
  log(db, actor.orgId, "lead", leadId, "stage", `Moved to ${stage.name}.`, "user", actor.userId);
}

export function logNote(actor: Actor, entityType: string, entityId: string, summary: string) {
  if (actor.role === "viewer") throw new ServiceError("Viewers cannot add notes.");
  const text = summary.trim();
  if (!text) throw new ServiceError("Write a note first.");
  const db = staffDb(actor);
  if (entityType === "lead") {
    const lead = db.select().from(leads).where(and(eq(leads.id, entityId), eq(leads.orgId, actor.orgId))).get();
    if (!lead) throw new ServiceError("Deal not found.");
    db.update(leads).set({ updatedAt: nowIso() }).where(eq(leads.id, entityId)).run();
  }
  log(db, actor.orgId, entityType, entityId, "note", text, "user", actor.userId);
}

export function createTask(actor: Actor, input: { title: string; relatedType: string; relatedId: string; assigneeUserId?: string; dueAt?: string }) {
  if (!canAddFieldNotes(actor.role as Role)) throw new ServiceError("Viewers cannot add tasks.");
  if (!input.title.trim()) throw new ServiceError("A task needs a title.");
  staffDb(actor)
    .insert(tasks)
    .values({
      id: id("task"),
      orgId: actor.orgId,
      title: input.title.trim(),
      assigneeUserId: input.assigneeUserId || actor.userId,
      dueAt: input.dueAt || null,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      status: "open",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: actor.userId,
    })
    .run();
}

export function completeTask(actor: Actor, taskId: string) {
  if (actor.role === "viewer") throw new ServiceError("Viewers cannot complete tasks.");
  const db = staffDb(actor);
  const task = db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.orgId, actor.orgId))).get();
  if (!task) throw new ServiceError("Task not found.");
  const now = nowIso();
  db.update(tasks).set({ status: "done", updatedAt: now }).where(and(eq(tasks.id, taskId), eq(tasks.orgId, actor.orgId))).run();
  audit(db, actor.orgId, actor.userId, "todo.complete", "task", taskId);
}

export function createLeadFromText(actor: Actor, text: string, source = "manual") {
  assertCrm(actor);
  const intake = extractIntake(text);
  const db = staffDb(actor);
  const stage = db
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.orgId, actor.orgId), eq(pipelineStages.kind, "open")))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
  if (!stage) throw new ServiceError("This company has no pipeline.");
  const contactId = id("c");
  const leadId = id("lead");
  const name = intake.name || "New client";
  const now = nowIso();
  db.transaction((tx) => {
    tx.insert(contacts)
      .values({
        id: contactId,
        orgId: actor.orgId,
        type: "client",
        name,
        company: null,
        email: intake.email,
        phone: intake.phone,
        address: intake.address,
        city: intake.city,
        state: null,
        zip: null,
        notes: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    if (intake.email) {
      tx.insert(consents)
        .values({
          id: id("consent"),
          orgId: actor.orgId,
          contactId,
          channel: "email",
          status: "opt_in",
          source: "intake",
          createdAt: now,
        })
        .run();
    }
    tx.insert(leads)
      .values({
        id: leadId,
        orgId: actor.orgId,
        contactId,
        stageId: stage.id,
        title: `${name} ${intake.projectType}`.trim(),
        source,
        valueEstCents: intake.valueHighCents ?? intake.valueLowCents,
        ownerUserId: actor.userId,
        status: "open",
        lostReason: null,
        scopeText: intake.scope,
        sqft: intake.sqft,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    const threadId = id("thread");
    tx.insert(messageThreads)
      .values({
        id: threadId,
        orgId: actor.orgId,
        contactId,
        leadId,
        projectId: null,
        subject: `${intake.projectType} inquiry`,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(messages)
      .values({
        id: id("msg"),
        orgId: actor.orgId,
        threadId,
        channel: "email",
        direction: "in",
        body: intake.scope,
        status: "received",
        consentOk: 1,
        createdAt: now,
        createdBy: null,
      })
      .run();
    log(tx, actor.orgId, "lead", leadId, "intake", `Created from pasted scope for ${name}.`, "user", actor.userId);
    tx.insert(aiRuns)
      .values({
        id: id("airun"),
        orgId: actor.orgId,
        feature: "intake",
        model: "fieldline-intake-v1",
        tokensIn: Math.ceil(text.length / 4),
        tokensOut: 80,
        costCents: 0,
        inputRef: leadId,
        outputJson: JSON.stringify(intake),
        latencyMs: 1,
        createdAt: now,
        createdBy: actor.userId,
      })
      .run();
  });
  return { leadId, contactId, intake };
}

export async function generateEstimate(actor: Actor, leadId: string) {
  assertMoney(actor);
  const db = staffDb(actor);
  const lead = db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, actor.orgId))).get();
  if (!lead) throw new ServiceError("Deal not found.");
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  if (!org) throw new ServiceError("Company not found.");
  const book = db.select().from(priceBookItems).where(eq(priceBookItems.orgId, actor.orgId)).all();
  const started = Date.now();
  const draft = await estimateFromScope({
    scope: lead.scopeText || lead.title,
    photos: leadPhotoCues(actor.orgId, leadId),
    book: book.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      category: item.category,
      unit: item.unit,
      unitCostCents: item.unitCostCents,
      defaultMarkupBps: item.defaultMarkupBps,
      formula: item.defaultFormula,
      wasteBps: item.defaultWasteBps ?? 0,
      roundToMilli: item.defaultRoundToMilli,
    })),
    markupBps: org.defaultMarkupBps,
  });
  const estimateId = id("est");
  const now = nowIso();
  const measureRows = draft.measurements ?? [];
  const measureMilli = measuresFromValues(measureRows);
  const previous = db.select().from(estimates).where(eq(estimates.leadId, leadId)).all();
  const version = previous.reduce((max, row) => Math.max(max, row.version), 0) + 1;
  db.transaction((tx) => {
    for (const old of previous.filter((row) => row.status === "draft")) {
      tx.update(estimates).set({ status: "void", updatedAt: now }).where(eq(estimates.id, old.id)).run();
    }
    tx.insert(estimates)
      .values({
        id: estimateId,
        orgId: actor.orgId,
        leadId,
        version,
        status: "draft",
        title: draft.title,
        markupBps: org.defaultMarkupBps,
        taxBps: org.taxBps,
        marginTargetBps: org.marginAlertBps,
        notes: draft.notes,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    measureRows.forEach((row, index) => {
      tx.insert(estimateMeasurements)
        .values({
          id: id("meas"),
          orgId: actor.orgId,
          estimateId,
          name: row.name,
          valueMilli: qtyToMilli(row.value),
          unit: row.unit,
          sortOrder: index,
        })
        .run();
    });
    draft.sections.forEach((section, sectionIndex) => {
      const sectionId = id("sec");
      tx.insert(estimateSections)
        .values({ id: sectionId, orgId: actor.orgId, estimateId, name: section.name, sortOrder: sectionIndex })
        .run();
      section.lines.forEach((line, lineIndex) => {
        const applied = line.formula
          ? { qty: line.qty, formula: line.formula, wasteBps: line.wasteBps ?? 0, roundToMilli: line.roundToMilli ?? null, needsMeasure: false }
          : applyCatalogQuantity(line.code, line.qty, measureMilli);
        const reason = applied.formula == null && applied.needsMeasure && !/site measure/i.test(line.reason) ? `${line.reason} Needs a site measure.` : line.reason;
        tx.insert(lineItems)
          .values({
            id: id("li"),
            orgId: actor.orgId,
            sectionId,
            estimateId,
            priceBookItemId: line.priceBookItemId ?? null,
            name: line.name,
            description: null,
            qtyMilli: qtyToMilli(applied.qty),
            unit: line.unit,
            unitCostCents: line.unitCostCents,
            markupBps: line.markupBps,
            costCode: line.code,
            source: "ai",
            aiConfidenceMilli: Math.round(line.confidence * 1000),
            sourceNote: reason,
            sortOrder: lineIndex,
            qtyFormula: applied.formula,
            wasteBps: applied.wasteBps,
            roundToMilli: applied.roundToMilli,
          })
          .run();
        if (line.priceBookItemId) {
          tx.update(priceBookItems).set({ lastUsedAt: now }).where(eq(priceBookItems.id, line.priceBookItemId)).run();
        }
      });
    });
    tx.insert(aiRuns)
      .values({
        id: id("airun"),
        orgId: actor.orgId,
        feature: "estimate",
        model: draft.model,
        tokensIn: Math.ceil((lead.scopeText || "").length / 4) + book.length * 12,
        tokensOut: draft.sections.reduce((sum, section) => sum + section.lines.length, 0) * 40,
        costCents: 0,
        inputRef: leadId,
        outputJson: JSON.stringify({ title: draft.title, notes: draft.notes }),
        latencyMs: Date.now() - started,
        createdAt: now,
        createdBy: actor.userId,
      })
      .run();
    log(tx, actor.orgId, "lead", leadId, "estimate", `Drafted estimate v${version} from the price book.`, "user", actor.userId);
  });
  return { estimateId };
}

function loadEditableEstimate(actor: Actor, estimateId: string) {
  const db = staffDb(actor);
  const estimate = db.select().from(estimates).where(and(eq(estimates.id, estimateId), eq(estimates.orgId, actor.orgId))).get();
  if (!estimate) throw new ServiceError("Estimate not found.");
  const sent = db.select().from(proposals).where(eq(proposals.estimateId, estimateId)).all();
  if (sent.some((row) => row.status !== "superseded")) {
    throw new ServiceError("This estimate was already sent. Revise it to make a new version.");
  }
  return estimate;
}

export function updateLine(
  actor: Actor,
  lineId: string,
  patch: { qty?: number; unitCostCents?: number; markupBps?: number; name?: string },
) {
  assertMoney(actor);
  const db = staffDb(actor);
  const line = db.select().from(lineItems).where(and(eq(lineItems.id, lineId), eq(lineItems.orgId, actor.orgId))).get();
  if (!line) throw new ServiceError("Line not found.");
  loadEditableEstimate(actor, line.estimateId);
  const invalid = lineInputError(patch);
  if (invalid) throw new ServiceError(invalid);
  db.update(lineItems)
    .set({
      qtyMilli: patch.qty != null ? qtyToMilli(patch.qty) : line.qtyMilli,
      unitCostCents: patch.unitCostCents ?? line.unitCostCents,
      markupBps: patch.markupBps ?? line.markupBps,
      name: patch.name?.trim() || line.name,
      source: line.source === "ai" ? "manual" : line.source,
      ...(patch.qty != null ? { qtyFormula: null, wasteBps: 0, roundToMilli: null } : {}),
    })
    .where(eq(lineItems.id, lineId))
    .run();
  db.update(estimates).set({ updatedAt: nowIso() }).where(eq(estimates.id, line.estimateId)).run();
}

export function addManualLine(
  actor: Actor,
  estimateId: string,
  input: { name: string; qty: number; unit: string; unitCostCents: number; markupBps: number; costCode?: string },
) {
  assertMoney(actor);
  loadEditableEstimate(actor, estimateId);
  const db = staffDb(actor);
  const sections = db.select().from(estimateSections).where(eq(estimateSections.estimateId, estimateId)).all();
  let sectionId = sections[0]?.id;
  if (!sectionId) {
    sectionId = id("sec");
    db.insert(estimateSections).values({ id: sectionId, orgId: actor.orgId, estimateId, name: "Added", sortOrder: 0 }).run();
  }
  if (!input.name.trim()) throw new ServiceError("A line needs a name and a quantity.");
  const invalid = lineInputError({ qty: input.qty, unitCostCents: input.unitCostCents, markupBps: input.markupBps });
  if (invalid) throw new ServiceError(invalid);
  const book = input.costCode
    ? db.select().from(priceBookItems).where(and(eq(priceBookItems.orgId, actor.orgId), eq(priceBookItems.code, input.costCode))).get()
    : undefined;
  const stored = book?.defaultFormula
    ? { expr: book.defaultFormula, wasteBps: book.defaultWasteBps ?? 0, roundToMilli: book.defaultRoundToMilli ?? null }
    : undefined;
  const applied = input.costCode
    ? applyCatalogQuantity(
        input.costCode,
        input.qty,
        measurementRows(db, actor.orgId, estimateId).map((row) => ({ name: row.name, valueMilli: row.valueMilli })),
        stored,
      )
    : null;
  db.insert(lineItems)
    .values({
      id: id("li"),
      orgId: actor.orgId,
      sectionId,
      estimateId,
      priceBookItemId: null,
      name: input.name.trim(),
      description: null,
      qtyMilli: qtyToMilli(applied?.formula ? applied.qty : input.qty),
      unit: input.unit || "ea",
      unitCostCents: input.unitCostCents,
      markupBps: input.markupBps,
      costCode: input.costCode || null,
      source: "manual",
      aiConfidenceMilli: null,
      sourceNote: "Added by hand.",
      sortOrder: 100,
      qtyFormula: applied?.formula ?? null,
      wasteBps: applied?.wasteBps ?? 0,
      roundToMilli: applied?.roundToMilli ?? null,
    })
    .run();
}

function measurementRows(db: Writer, orgId: string, estimateId: string) {
  return db
    .select()
    .from(estimateMeasurements)
    .where(and(eq(estimateMeasurements.orgId, orgId), eq(estimateMeasurements.estimateId, estimateId)))
    .all();
}

function linesUsingMeasurement(db: Writer, orgId: string, estimateId: string, name: string): string | null {
  const lines = db
    .select()
    .from(lineItems)
    .where(and(eq(lineItems.orgId, orgId), eq(lineItems.estimateId, estimateId)))
    .all();
  const count = lines.filter((line) => {
    if (!line.qtyFormula) return false;
    try {
      return referencedNames(line.qtyFormula).includes(name);
    } catch {
      return false;
    }
  }).length;
  if (!count) return null;
  return count === 1 ? `1 line uses ${name}.` : `${count} lines use ${name}.`;
}

function recalcFormulas(db: Writer, orgId: string, estimateId: string) {
  const packed = measurementRows(db, orgId, estimateId).map((row) => ({ name: row.name, valueMilli: row.valueMilli }));
  const lines = db
    .select()
    .from(lineItems)
    .where(and(eq(lineItems.orgId, orgId), eq(lineItems.estimateId, estimateId)))
    .all();
  for (const line of lines) {
    if (!line.qtyFormula) continue;
    let qtyMilli: number;
    try {
      qtyMilli = evaluateFormula({
        expr: line.qtyFormula,
        wasteBps: line.wasteBps ?? 0,
        roundToMilli: line.roundToMilli,
        measurements: packed,
      });
    } catch (error) {
      throw new ServiceError(error instanceof FormulaError ? error.message : "Check the formula.");
    }
    if (qtyMilli !== line.qtyMilli) {
      db.update(lineItems).set({ qtyMilli }).where(and(eq(lineItems.id, line.id), eq(lineItems.orgId, orgId))).run();
    }
  }
}

function formulaQty(
  orgId: string,
  estimateId: string,
  line: { formula?: string | null; wasteBps?: number; roundToMilli?: number | null },
): { qtyMilli: number; formula: string; wasteBps: number; roundToMilli: number | null } | null {
  const formula = line.formula?.trim() ?? "";
  if (!formula) return null;
  const db = officeDb(orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  try {
    const qtyMilli = evaluateFormula({
      expr: formula,
      wasteBps: line.wasteBps ?? 0,
      roundToMilli: line.roundToMilli ?? null,
      measurements: measurementRows(db, orgId, estimateId).map((row) => ({ name: row.name, valueMilli: row.valueMilli })),
    });
    return { qtyMilli, formula, wasteBps: line.wasteBps ?? 0, roundToMilli: line.roundToMilli ?? null };
  } catch (error) {
    throw new ServiceError(error instanceof FormulaError ? error.message : "Check the formula.");
  }
}

export function saveMeasurement(
  actor: Actor,
  estimateId: string,
  input: { id?: string; name: string; value: number; unit: string },
) {
  assertMoney(actor);
  loadEditableEstimate(actor, estimateId);
  let name: string;
  let unit: string;
  try {
    name = measurementName(input.name);
    unit = measurementUnit(input.unit);
  } catch (error) {
    throw new ServiceError(error instanceof FormulaError ? error.message : "Check the measurement.");
  }
  if (!Number.isFinite(input.value) || input.value <= 0 || input.value > 1_000_000) {
    throw new ServiceError("Enter a number greater than zero.");
  }
  const valueMilli = qtyToMilli(input.value);
  const db = staffDb(actor);
  const existing = measurementRows(db, actor.orgId, estimateId);
  const row = input.id ? existing.find((item) => item.id === input.id) : existing.find((item) => item.name === name);
  if (row && row.name !== name) {
    const used = linesUsingMeasurement(db, actor.orgId, estimateId, row.name);
    if (used) throw new ServiceError(used);
  }
  if (existing.some((item) => item.name === name && item.id !== row?.id)) throw new ServiceError(`${name} is already on this estimate.`);
  db.transaction((tx) => {
    if (row) {
      tx.update(estimateMeasurements).set({ name, valueMilli, unit }).where(eq(estimateMeasurements.id, row.id)).run();
    } else {
      tx.insert(estimateMeasurements)
        .values({
          id: id("meas"),
          orgId: actor.orgId,
          estimateId,
          name,
          valueMilli,
          unit,
          sortOrder: existing.length,
        })
        .run();
    }
    recalcFormulas(tx, actor.orgId, estimateId);
    tx.update(estimates).set({ updatedAt: nowIso() }).where(eq(estimates.id, estimateId)).run();
  });
}

export function deleteMeasurement(actor: Actor, estimateId: string, measurementId: string) {
  assertMoney(actor);
  loadEditableEstimate(actor, estimateId);
  const db = staffDb(actor);
  const row = measurementRows(db, actor.orgId, estimateId).find((item) => item.id === measurementId);
  if (!row) throw new ServiceError("Measurement not found.");
  const used = linesUsingMeasurement(db, actor.orgId, estimateId, row.name);
  if (used) throw new ServiceError(used);
  db.delete(estimateMeasurements).where(and(eq(estimateMeasurements.id, row.id), eq(estimateMeasurements.orgId, actor.orgId))).run();
  db.update(estimates).set({ updatedAt: nowIso() }).where(eq(estimates.id, estimateId)).run();
}

export function syncEstimateGrid(actor: Actor, input: unknown) {
  assertMoney(actor);
  let parsed: ReturnType<typeof parseGridSync>;
  try {
    parsed = parseGridSync(input);
  } catch (error) {
    throw new ServiceError(error instanceof Error ? error.message : "Check the line.");
  }
  const estimate = loadEditableEstimate(actor, parsed.estimateId);
  const db = staffDb(actor);
  const sections = db
    .select()
    .from(estimateSections)
    .where(and(eq(estimateSections.estimateId, estimate.id), eq(estimateSections.orgId, actor.orgId)))
    .all();
  const sectionIds = new Set(sections.map((section) => section.id));
  const existing = db
    .select()
    .from(lineItems)
    .where(and(eq(lineItems.estimateId, estimate.id), eq(lineItems.orgId, actor.orgId)))
    .all();
  const byId = new Map(existing.map((line) => [line.id, line]));
  for (const line of parsed.lines) {
    if (!sectionIds.has(line.sectionId) && !/^sec_[A-Za-z0-9_-]{1,80}$/.test(line.sectionId)) {
      throw new ServiceError("That group is not on this estimate.");
    }
    const row = byId.get(line.id);
    if (!row) {
      const other = db.select().from(lineItems).where(eq(lineItems.id, line.id)).get();
      if (other) throw new ServiceError("Line not found.");
    }
  }
  const now = nowIso();
  db.transaction((tx) => {
    for (const line of parsed.lines) {
      if (!sectionIds.has(line.sectionId)) {
        tx.insert(estimateSections)
          .values({ id: line.sectionId, orgId: actor.orgId, estimateId: estimate.id, name: "Added", sortOrder: sectionIds.size })
          .run();
        sectionIds.add(line.sectionId);
      }
      const row = byId.get(line.id);
      const stored = formulaQty(actor.orgId, estimate.id, line);
      const qtyMilli = stored?.qtyMilli ?? qtyToMilli(line.qty);
      const formulaFields = stored
        ? { qtyFormula: stored.formula, wasteBps: stored.wasteBps, roundToMilli: stored.roundToMilli }
        : { qtyFormula: null, wasteBps: 0, roundToMilli: null };
      if (!row) {
        tx.insert(lineItems)
          .values({
            id: line.id,
            orgId: actor.orgId,
            sectionId: line.sectionId,
            estimateId: estimate.id,
            priceBookItemId: null,
            name: line.name,
            description: null,
            qtyMilli,
            unit: line.unit,
            unitCostCents: line.unitCostCents,
            markupBps: line.markupBps,
            costCode: line.costCode,
            source: "manual",
            aiConfidenceMilli: null,
            sourceNote: null,
            sortOrder: line.sortOrder,
            billing: line.billing,
            ...formulaFields,
          })
          .run();
        continue;
      }
      const changed =
        row.name !== line.name ||
        row.qtyMilli !== qtyMilli ||
        row.unit !== line.unit ||
        row.unitCostCents !== line.unitCostCents ||
        row.markupBps !== line.markupBps ||
        row.sectionId !== line.sectionId ||
        (row.billing || "included") !== line.billing ||
        (row.qtyFormula ?? null) !== formulaFields.qtyFormula;
      tx.update(lineItems)
        .set({
          sectionId: line.sectionId,
          name: line.name,
          qtyMilli,
          unit: line.unit,
          unitCostCents: line.unitCostCents,
          markupBps: line.markupBps,
          costCode: line.costCode,
          sortOrder: line.sortOrder,
          billing: line.billing,
          ...formulaFields,
          source: changed && row.source === "ai" ? "manual" : row.source,
          aiConfidenceMilli: changed && row.source === "ai" ? null : row.aiConfidenceMilli,
        })
        .where(and(eq(lineItems.id, line.id), eq(lineItems.orgId, actor.orgId)))
        .run();
    }
    for (const id of parsed.deletedIds) {
      tx.delete(lineItems)
        .where(and(eq(lineItems.id, id), eq(lineItems.estimateId, estimate.id), eq(lineItems.orgId, actor.orgId)))
        .run();
    }
    tx.update(estimates)
      .set({
        updatedAt: now,
        ...(parsed.marginTargetBps != null ? { marginTargetBps: parsed.marginTargetBps } : {}),
      })
      .where(and(eq(estimates.id, estimate.id), eq(estimates.orgId, actor.orgId)))
      .run();
  });
}

export function removeLine(actor: Actor, lineId: string) {
  assertMoney(actor);
  const db = staffDb(actor);
  const line = db.select().from(lineItems).where(and(eq(lineItems.id, lineId), eq(lineItems.orgId, actor.orgId))).get();
  if (!line) throw new ServiceError("Line not found.");
  loadEditableEstimate(actor, line.estimateId);
  db.delete(lineItems).where(eq(lineItems.id, lineId)).run();
}

export function reviseEstimate(actor: Actor, estimateId: string) {
  assertMoney(actor);
  const db = staffDb(actor);
  const estimate = db.select().from(estimates).where(and(eq(estimates.id, estimateId), eq(estimates.orgId, actor.orgId))).get();
  if (!estimate) throw new ServiceError("Estimate not found.");
  const sections = db.select().from(estimateSections).where(eq(estimateSections.estimateId, estimateId)).all();
  const lines = db.select().from(lineItems).where(eq(lineItems.estimateId, estimateId)).all();
  const measures = measurementRows(db, actor.orgId, estimateId);
  const previous = db.select().from(estimates).where(eq(estimates.leadId, estimate.leadId)).all();
  const nextId = id("est");
  const now = nowIso();
  db.transaction((tx) => {
    tx.insert(estimates)
      .values({
        ...estimate,
        id: nextId,
        version: previous.reduce((max, row) => Math.max(max, row.version), 0) + 1,
        status: "draft",
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    for (const section of sections) {
      const sectionId = id("sec");
      tx.insert(estimateSections)
        .values({ ...section, id: sectionId, estimateId: nextId })
        .run();
      for (const line of lines.filter((item) => item.sectionId === section.id)) {
        tx.insert(lineItems)
          .values({ ...line, id: id("li"), sectionId, estimateId: nextId })
          .run();
      }
    }
    for (const row of measures) {
      tx.insert(estimateMeasurements)
        .values({ ...row, id: id("meas"), estimateId: nextId })
        .run();
    }
    log(tx, actor.orgId, "lead", estimate.leadId, "estimate", `Revised estimate into v${previous.reduce((max, row) => Math.max(max, row.version), 0) + 1}.`, "user", actor.userId);
  });
  return { estimateId: nextId };
}

export async function sendProposal(actor: Actor, estimateId: string, overrideMargin = false) {
  assertMoney(actor);
  const db = staffDb(actor);
  const estimate = db.select().from(estimates).where(and(eq(estimates.id, estimateId), eq(estimates.orgId, actor.orgId))).get();
  if (!estimate) throw new ServiceError("Estimate not found.");
  if (estimate.status === "void") throw new ServiceError("This draft was replaced. Open the latest version.");
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get()!;
  const lead = db.select().from(leads).where(eq(leads.id, estimate.leadId)).get()!;
  const contact = db.select().from(contacts).where(eq(contacts.id, lead.contactId)).get()!;
  const sections = db.select().from(estimateSections).where(eq(estimateSections.estimateId, estimateId)).all();
  const lines = db.select().from(lineItems).where(eq(lineItems.estimateId, estimateId)).all();
  const counting = lines.filter((line) => countsTowardTotal((line.billing || "included") as Billing));
  if (counting.length === 0) throw new ServiceError("Add at least one line before sending.");
  let cost = 0;
  let price = 0;
  for (const line of counting) {
    const amounts = lineAmounts(line.qtyMilli, line.unitCostCents, line.markupBps);
    cost += amounts.cost;
    price += amounts.price;
  }
  const margin = marginBps(price, cost);
  if (margin != null && margin < estimate.marginTargetBps && !overrideMargin) {
    throw new ServiceError(`Margin is under the ${(estimate.marginTargetBps / 100).toFixed(1)}% target. Edit the lines or send with an override.`);
  }
  const stored = assembleSnapshot({
    title: estimate.title,
    company: org.name,
    clientName: contact.name,
    address: [contact.address, contact.city, contact.state].filter(Boolean).join(", "),
    sections: sections.map((section) => ({
      name: section.name,
      lines: lines
        .filter((line) => line.sectionId === section.id)
        .map((line) => ({
          name: line.name,
          qtyMilli: line.qtyMilli,
          unit: line.unit,
          unitCostCents: line.unitCostCents,
          markupBps: line.markupBps,
          costCode: line.costCode,
          billing: (line.billing || "included") as Billing,
        })),
    })),
    taxBps: estimate.taxBps,
    scheduleParts: defaultSchedule(org),
    termsVersion: org.termsVersion,
  });
  const proposalId = id("prop");
  const publicToken = token();
  const now = nowIso();
  db.transaction((tx) => {
    const older = tx
      .select()
      .from(proposals)
      .where(and(eq(proposals.leadId, lead.id), inArray(proposals.status, ["sent", "viewed", "draft"])))
      .all();
    for (const old of older) {
      tx.update(proposals).set({ status: "superseded", updatedAt: now }).where(eq(proposals.id, old.id)).run();
    }
    tx.insert(proposals)
      .values({
        id: proposalId,
        orgId: actor.orgId,
        estimateId,
        leadId: lead.id,
        projectId: null,
        status: "sent",
        publicToken,
        snapshotJson: JSON.stringify(stored),
        paymentScheduleJson: JSON.stringify(stored.public.schedule),
        termsVersion: org.termsVersion,
        totalCents: stored.public.totalCents,
        sentAt: now,
        viewedAt: null,
        signedAt: null,
        declinedAt: null,
        expiresAt: daysFromNow(30),
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    tx.update(estimates).set({ status: "sent", updatedAt: now }).where(eq(estimates.id, estimateId)).run();
    const sentStage = tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.orgId, actor.orgId), eq(pipelineStages.name, "Estimate sent")))
      .get();
    if (sentStage && lead.status === "open") {
      tx.update(leads).set({ stageId: sentStage.id, updatedAt: now }).where(eq(leads.id, lead.id)).run();
    }
    log(tx, actor.orgId, "lead", lead.id, "proposal", `Sent proposal for ${stored.public.totalCents / 100} dollars.`, "user", actor.userId);
    audit(tx, actor.orgId, actor.userId, "proposal.send", "proposal", proposalId);
  });

  if (contact.email) {
    const link = `/p/${publicToken}`;
    await deliverMessage({
      channel: "email",
      to: contact.email,
      subject: `${estimate.title} proposal from ${org.name}`,
      body: `Hi ${contact.name.split(" ")[0]},\n\nYour proposal is ready: ${link}\nThe link expires in 30 days.\n\n${org.name}`,
      stub: true,
    });
    const threadId = id("thread");
    db.insert(messageThreads)
      .values({
        id: threadId,
        orgId: actor.orgId,
        contactId: contact.id,
        leadId: lead.id,
        projectId: null,
        subject: `${estimate.title} proposal`,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(messages)
      .values({
        id: id("msg"),
        orgId: actor.orgId,
        threadId,
        channel: "email",
        direction: "out",
        body: `Proposal sent. Client link /p/${publicToken}`,
        status: process.env.RESEND_API_KEY ? "sent" : "sent_stub",
        consentOk: 1,
        createdAt: now,
        createdBy: actor.userId,
      })
      .run();
  }
  return { proposalId, publicToken, totalCents: stored.public.totalCents };
}

export function markProposalViewed(tokenValue: string, ip?: string) {
  const db = getDb();
  const proposal = db.select().from(proposals).where(eq(proposals.publicToken, tokenValue)).get();
  if (!proposal || proposal.status !== "sent") return;
  const now = nowIso();
  db.update(proposals).set({ status: "viewed", viewedAt: now, updatedAt: now }).where(eq(proposals.id, proposal.id)).run();
  log(db, proposal.orgId, "lead", proposal.leadId, "proposal", "Client opened the proposal.", "system", null);
  audit(db, proposal.orgId, null, "proposal.view", "proposal", proposal.id, ip);
}

export function signProposal(input: {
  token: string;
  signerName: string;
  signerEmail?: string;
  typedName: string;
  drawnDataUrl?: string;
  consent: boolean;
  ip?: string;
  userAgent?: string;
}) {
  if (!input.consent) throw new ServiceError("Check the consent box before signing.");
  if (input.typedName.trim().length < 2) throw new ServiceError("Type your full name to sign.");
  const db = getDb();
  return db.transaction((tx) => {
    const proposal = tx.select().from(proposals).where(eq(proposals.publicToken, input.token)).get();
    if (!proposal) throw new ServiceError("This link does not match a proposal.");
    if (proposal.status === "signed") throw new ServiceError("This proposal is already signed.");
    if (proposal.status === "declined") throw new ServiceError("This proposal was declined.");
    if (proposal.status === "superseded") throw new ServiceError("A newer proposal replaced this one.");
    if (proposal.status !== "sent" && proposal.status !== "viewed") throw new ServiceError("This proposal is not open for signature.");
    if (proposal.expiresAt && new Date(proposal.expiresAt).getTime() < Date.now()) {
      throw new ServiceError("This link has expired. Ask the contractor for a new one.");
    }
    const stored = JSON.parse(proposal.snapshotJson) as StoredSnapshot;
    const hash = sha256(canonicalJson(stored.public));
    const now = nowIso();
    const projectId = id("proj");
    const portalToken = token();
    tx.insert(signatures)
      .values({
        id: id("sig"),
        orgId: proposal.orgId,
        proposalId: proposal.id,
        changeOrderId: null,
        signerName: input.signerName.trim() || input.typedName.trim(),
        signerEmail: input.signerEmail || null,
        typedName: input.typedName.trim(),
        drawnDataUrl: input.drawnDataUrl || null,
        signedAt: now,
        ip: input.ip || null,
        userAgent: input.userAgent || null,
        docHash: hash,
        consentTextVersion: CONSENT_VERSION,
        consentAccepted: 1,
      })
      .run();
    const lead = tx.select().from(leads).where(eq(leads.id, proposal.leadId)).get();
    const contact = lead ? tx.select().from(contacts).where(eq(contacts.id, lead.contactId)).get() : null;
    tx.insert(projects)
      .values({
        id: projectId,
        orgId: proposal.orgId,
        leadId: proposal.leadId,
        proposalId: proposal.id,
        contactId: lead?.contactId || "",
        name: stored.public.title,
        status: "active",
        address: stored.public.address,
        contractValueCents: stored.public.totalCents,
        originalContractCents: stored.public.totalCents,
        startDate: null,
        endDate: null,
        portalToken,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
      })
      .run();
    stored.lines.forEach((line, index) => {
      tx.insert(budgetLines)
        .values({
          id: id("bud"),
          orgId: proposal.orgId,
          projectId,
          changeOrderId: null,
          name: line.name,
          costCode: line.costCode,
          budgetCostCents: line.costCents,
          budgetPriceCents: line.priceCents,
          sourceLineId: null,
          createdAt: now,
        })
        .run();
      void index;
    });
    const deposit = stored.public.schedule[0];
    const invoiceId = id("inv");
    const payToken = token();
    const count = tx.select().from(invoices).where(eq(invoices.orgId, proposal.orgId)).all().length + 1;
    tx.insert(invoices)
      .values({
        id: invoiceId,
        orgId: proposal.orgId,
        projectId,
        changeOrderId: null,
        number: `RR-${1000 + count}`,
        type: "deposit",
        status: "open",
        scheduleIndex: 0,
        issueDate: now.slice(0, 10),
        dueDate: daysFromNow(7).slice(0, 10),
        subtotalCents: deposit.amountCents,
        taxCents: 0,
        totalCents: deposit.amountCents,
        amountPaidCents: 0,
        payToken,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
      })
      .run();
    tx.insert(invoiceLines)
      .values({
        id: id("invl"),
        orgId: proposal.orgId,
        invoiceId,
        description: deposit.label,
        amountCents: deposit.amountCents,
        sortOrder: 0,
      })
      .run();
    attachSignedDraws(tx, {
      orgId: proposal.orgId,
      projectId,
      contractCents: stored.public.totalCents,
      depositInvoiceId: invoiceId,
    });
    tx.update(proposals)
      .set({ status: "signed", signedAt: now, projectId, updatedAt: now })
      .where(eq(proposals.id, proposal.id))
      .run();
    const won = tx.select().from(pipelineStages).where(and(eq(pipelineStages.orgId, proposal.orgId), eq(pipelineStages.kind, "won"))).get();
    if (won) {
      tx.update(leads).set({ status: "won", stageId: won.id, updatedAt: now }).where(eq(leads.id, proposal.leadId)).run();
    }
    log(tx, proposal.orgId, "lead", proposal.leadId, "signature", `${input.typedName.trim()} signed the proposal.`, "contact", contact?.id ?? null);
    log(tx, proposal.orgId, "project", projectId, "project", "Project opened from the signed proposal. Deposit invoice is ready.", "system", null);
    audit(tx, proposal.orgId, null, "proposal.sign", "proposal", proposal.id, input.ip);
    dismissOpenFollowUps(tx, proposal.orgId, { proposalId: proposal.id, leadId: proposal.leadId });
    return { projectId, portalToken, payToken, invoiceId, totalCents: stored.public.totalCents };
  });
}

export function declineProposal(tokenValue: string, reason: string) {
  const db = getDb();
  const proposal = db.select().from(proposals).where(eq(proposals.publicToken, tokenValue)).get();
  if (!proposal) throw new ServiceError("This link does not match a proposal.");
  if (proposal.status === "signed") throw new ServiceError("This proposal is already signed.");
  if (proposal.status === "declined") throw new ServiceError("This proposal was already declined.");
  const now = nowIso();
  db.update(proposals).set({ status: "declined", declinedAt: now, updatedAt: now }).where(eq(proposals.id, proposal.id)).run();
  dismissOpenFollowUps(db, proposal.orgId, { proposalId: proposal.id, leadId: proposal.leadId });
  log(db, proposal.orgId, "lead", proposal.leadId, "proposal", `Client declined. ${reason.trim() || "No reason given."}`, "contact", null);
}

export function payInvoice(input: {
  token: string;
  method: "ach" | "card";
  routing?: string;
  account?: string;
  card?: string;
  exp?: string;
  cvc?: string;
  idempotencyKey: string;
  ip?: string;
}) {
  if (!input.idempotencyKey) throw new ServiceError("Missing idempotency key.");
  const db = getDb();
  return db.transaction((tx) => {
    const invoice = tx.select().from(invoices).where(eq(invoices.payToken, input.token)).get();
    if (!invoice) throw new ServiceError("Invoice not found.");
    const existing = tx.select().from(payments).where(eq(payments.idempotencyKey, input.idempotencyKey)).get();
    if (existing) {
      return { ok: existing.status === "succeeded", duplicate: true, reason: existing.failureReason, paymentId: existing.id };
    }
    if (invoice.status === "paid") {
      return { ok: true, duplicate: true, reason: null, paymentId: null };
    }
    if (invoice.status === "void") throw new ServiceError("This invoice was voided.");
    const decision =
      input.method === "ach"
        ? decideAch(input.routing || "", input.account || "")
        : decideCard(input.card || "", input.exp || "", input.cvc || "");
    const org = tx.select().from(organizations).where(eq(organizations.id, invoice.orgId)).get();
    if (input.method === "card" && org && !org.cardEnabled) {
      throw new ServiceError("This contractor accepts ACH only.");
    }
    const fee = input.method === "ach" ? achFeeCents(invoice.totalCents) : cardFeeCents(invoice.totalCents);
    const now = nowIso();
    const paymentId = id("pay");
    tx.insert(payments)
      .values({
        id: paymentId,
        orgId: invoice.orgId,
        invoiceId: invoice.id,
        method: input.method,
        amountCents: invoice.totalCents,
        feeCents: decision.ok ? fee : 0,
        netCents: decision.ok ? invoice.totalCents - fee : 0,
        status: decision.ok ? "succeeded" : "failed",
        stripePaymentIntent: `pi_mock_${paymentId}`,
        idempotencyKey: input.idempotencyKey,
        failureReason: decision.ok ? null : decision.reason,
        stub: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    if (decision.ok) {
      tx.update(invoices)
        .set({ status: "paid", amountPaidCents: invoice.totalCents, updatedAt: now })
        .where(eq(invoices.id, invoice.id))
        .run();
      log(tx, invoice.orgId, "project", invoice.projectId, "payment", `Payment received for ${invoice.number}.`, "system", null);
    } else {
      log(tx, invoice.orgId, "project", invoice.projectId, "payment", `Payment failed for ${invoice.number}: ${decision.reason}`, "system", null);
    }
    audit(tx, invoice.orgId, null, decision.ok ? "payment.succeeded" : "payment.failed", "invoice", invoice.id, input.ip);
    return { ok: decision.ok, duplicate: false, reason: decision.ok ? null : decision.reason, paymentId };
  });
}

export function issueNextInvoice(actor: Actor, projectId: string) {
  assertMoney(actor);
  const nextDraw = billNextDraw(actor, projectId);
  if (nextDraw) return { invoiceId: nextDraw.invoiceId, payToken: nextDraw.payToken };
  const db = staffDb(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project?.proposalId) throw new ServiceError("This job has no signed proposal.");
  const proposal = db.select().from(proposals).where(eq(proposals.id, project.proposalId)).get();
  if (!proposal) throw new ServiceError("Proposal missing.");
  const stored = JSON.parse(proposal.snapshotJson) as StoredSnapshot;
  const existing = db.select().from(invoices).where(eq(invoices.projectId, projectId)).all();
  const used = new Set(existing.filter((row) => row.status !== "void" && row.scheduleIndex != null).map((row) => row.scheduleIndex));
  const nextIndex = stored.public.schedule.findIndex((_, index) => !used.has(index));
  if (nextIndex < 0) throw new ServiceError("Every scheduled draw has already been invoiced.");
  const part = stored.public.schedule[nextIndex];
  const billed = existing.filter((row) => row.status !== "void").reduce((sum, row) => sum + row.totalCents, 0);
  if (billed + part.amountCents > project.contractValueCents) {
    throw new ServiceError("That invoice would bill more than the contract plus approved change orders.");
  }
  const now = nowIso();
  const invoiceId = id("inv");
  const payToken = token();
  const count = db.select().from(invoices).where(eq(invoices.orgId, actor.orgId)).all().length + 1;
  db.insert(invoices)
    .values({
      id: invoiceId,
      orgId: actor.orgId,
      projectId,
      changeOrderId: null,
      number: `RR-${1000 + count}`,
      type: part.type,
      status: "open",
      scheduleIndex: nextIndex,
      issueDate: now.slice(0, 10),
      dueDate: daysFromNow(7).slice(0, 10),
      subtotalCents: part.amountCents,
      taxCents: 0,
      totalCents: part.amountCents,
      amountPaidCents: 0,
      payToken,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  db.insert(invoiceLines)
    .values({ id: id("invl"), orgId: actor.orgId, invoiceId, description: part.label, amountCents: part.amountCents, sortOrder: 0 })
    .run();
  log(db, actor.orgId, "project", projectId, "invoice", `Issued ${part.type} invoice ${part.label}.`, "user", actor.userId);
  return { invoiceId, payToken };
}

export function createChangeOrder(
  actor: Actor,
  projectId: string,
  input: { title: string; description: string; name: string; qty: number; unit: string; unitCostCents: number; markupBps: number; costCode?: string },
) {
  assertMoney(actor);
  const db = staffDb(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  if (!input.title.trim() || input.qty <= 0) throw new ServiceError("A change order needs a title and a quantity.");
  const amounts = lineAmounts(qtyToMilli(input.qty), input.unitCostCents, input.markupBps);
  const number = db.select().from(changeOrders).where(eq(changeOrders.projectId, projectId)).all().length + 1;
  const changeOrderId = id("co");
  const publicToken = token();
  const now = nowIso();
  db.transaction((tx) => {
    tx.insert(changeOrders)
      .values({
        id: changeOrderId,
        orgId: actor.orgId,
        projectId,
        number,
        title: input.title.trim(),
        status: "draft",
        description: input.description.trim(),
        priceDeltaCents: amounts.price,
        costDeltaCents: amounts.cost,
        publicToken,
        sentAt: null,
        approvedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    tx.insert(changeOrderLines)
      .values({
        id: id("col"),
        orgId: actor.orgId,
        changeOrderId,
        name: input.name.trim() || input.title.trim(),
        qtyMilli: qtyToMilli(input.qty),
        unit: input.unit || "ea",
        unitCostCents: input.unitCostCents,
        markupBps: input.markupBps,
        priceCents: amounts.price,
        costCode: input.costCode || null,
        sortOrder: 0,
      })
      .run();
  });
  return { changeOrderId, publicToken };
}

export async function sendChangeOrder(actor: Actor, changeOrderId: string) {
  assertMoney(actor);
  const db = staffDb(actor);
  const order = db.select().from(changeOrders).where(and(eq(changeOrders.id, changeOrderId), eq(changeOrders.orgId, actor.orgId))).get();
  if (!order) throw new ServiceError("Change order not found.");
  if (order.status !== "draft") throw new ServiceError("Only a draft change order can be sent.");
  const project = db.select().from(projects).where(eq(projects.id, order.projectId)).get()!;
  const contact = db.select().from(contacts).where(eq(contacts.id, project.contactId)).get();
  const now = nowIso();
  db.update(changeOrders).set({ status: "sent", sentAt: now, updatedAt: now }).where(eq(changeOrders.id, order.id)).run();
  log(db, actor.orgId, "project", project.id, "change_order", `Sent change order ${order.number}: ${order.title}.`, "user", actor.userId);
  if (contact?.email) {
    await deliverMessage({
      channel: "email",
      to: contact.email,
      subject: `Change order ${order.number} for ${project.name}`,
      body: `Hi ${contact.name.split(" ")[0]},\n\nA change order is waiting in your project link: /portal/${project.portalToken}\n\n${order.title}`,
      stub: true,
    });
  }
}

export function approveChangeOrder(input: { token: string; typedName: string; consent: boolean; ip?: string; userAgent?: string }) {
  if (!input.consent) throw new ServiceError("Check the consent box before approving.");
  if (input.typedName.trim().length < 2) throw new ServiceError("Type your name to approve.");
  const db = getDb();
  return db.transaction((tx) => {
    const order = tx.select().from(changeOrders).where(eq(changeOrders.publicToken, input.token)).get();
    if (!order) throw new ServiceError("Change order not found.");
    if (order.status === "approved") throw new ServiceError("This change order is already approved.");
    if (order.status !== "sent") throw new ServiceError("This change order has not been sent.");
    const project = tx.select().from(projects).where(eq(projects.id, order.projectId)).get()!;
    const now = nowIso();
    const lines = tx.select().from(changeOrderLines).where(eq(changeOrderLines.changeOrderId, order.id)).all();
    const hash = sha256(canonicalJson({ id: order.id, title: order.title, price: order.priceDeltaCents, lines }));
    tx.insert(signatures)
      .values({
        id: id("sig"),
        orgId: order.orgId,
        proposalId: null,
        changeOrderId: order.id,
        signerName: input.typedName.trim(),
        signerEmail: null,
        typedName: input.typedName.trim(),
        drawnDataUrl: null,
        signedAt: now,
        ip: input.ip || null,
        userAgent: input.userAgent || null,
        docHash: hash,
        consentTextVersion: CONSENT_VERSION,
        consentAccepted: 1,
      })
      .run();
    tx.update(changeOrders).set({ status: "approved", approvedAt: now, updatedAt: now }).where(eq(changeOrders.id, order.id)).run();
    tx.update(projects)
      .set({ contractValueCents: project.contractValueCents + order.priceDeltaCents, updatedAt: now })
      .where(eq(projects.id, project.id))
      .run();
    for (const line of lines) {
      tx.insert(budgetLines)
        .values({
          id: id("bud"),
          orgId: order.orgId,
          projectId: project.id,
          changeOrderId: order.id,
          name: line.name,
          costCode: line.costCode,
          budgetCostCents: lineAmounts(line.qtyMilli, line.unitCostCents, line.markupBps).cost,
          budgetPriceCents: line.priceCents,
          sourceLineId: line.id,
          createdAt: now,
        })
        .run();
    }
    const invoiceId = id("inv");
    const payToken = token();
    const count = tx.select().from(invoices).where(eq(invoices.orgId, order.orgId)).all().length + 1;
    tx.insert(invoices)
      .values({
        id: invoiceId,
        orgId: order.orgId,
        projectId: project.id,
        changeOrderId: order.id,
        number: `RR-${1000 + count}`,
        type: "co",
        status: "open",
        scheduleIndex: null,
        issueDate: now.slice(0, 10),
        dueDate: daysFromNow(7).slice(0, 10),
        subtotalCents: order.priceDeltaCents,
        taxCents: 0,
        totalCents: order.priceDeltaCents,
        amountPaidCents: 0,
        payToken,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
      })
      .run();
    tx.insert(invoiceLines)
      .values({
        id: id("invl"),
        orgId: order.orgId,
        invoiceId,
        description: `Change order ${order.number}: ${order.title}`,
        amountCents: order.priceDeltaCents,
        sortOrder: 0,
      })
      .run();
    attachApprovedChange(tx, {
      orgId: order.orgId,
      projectId: project.id,
      changeOrderId: order.id,
      number: order.number,
      title: order.title,
      amountCents: order.priceDeltaCents,
      invoiceId,
    });
    log(tx, order.orgId, "project", project.id, "change_order", `Approved CO ${order.number}. Contract and budget updated.`, "contact", null);
    audit(tx, order.orgId, null, "change_order.approve", "change_order", order.id, input.ip);
    return { projectId: project.id, payToken, invoiceId, portalToken: project.portalToken };
  });
}

export function addCost(
  actor: Actor,
  projectId: string,
  input: { amountCents: number; vendorName: string; costCode?: string; memo?: string; source: string; aiExtracted?: boolean; documentId?: string },
) {
  assertMoney(actor);
  const invalidAmount = positiveMoneyError(input.amountCents);
  if (invalidAmount) throw new ServiceError(invalidAmount);
  const db = staffDb(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get()!;
  const now = nowIso();
  const costId = id("cost");
  db.insert(costItems)
    .values({
      id: costId,
      orgId: actor.orgId,
      projectId,
      budgetLineId: null,
      costCode: input.costCode || null,
      amountCents: input.amountCents,
      vendorName: input.vendorName.trim() || null,
      memo: input.memo || null,
      source: input.source,
      aiExtracted: input.aiExtracted ? 1 : 0,
      documentId: input.documentId || null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  const costs = db.select().from(costItems).where(eq(costItems.projectId, projectId)).all();
  const actual = costs.reduce((sum, cost) => sum + cost.amountCents, 0);
  const margin = marginBps(project.contractValueCents, actual);
  const alert = margin != null && margin < org.marginAlertBps;
  log(
    db,
    actor.orgId,
    "project",
    projectId,
    alert ? "alert" : "cost",
    alert
      ? `Margin fell to ${((margin ?? 0) / 100).toFixed(1)}% after posting ${input.vendorName || "a cost"}.`
      : `Posted a cost from ${input.vendorName || "the job"}.`,
    "user",
    actor.userId,
  );
  if (alert) {
    db.insert(tasks)
      .values({
        id: id("task"),
        orgId: actor.orgId,
        title: `Margin watch: ${project.name} is under ${(org.marginAlertBps / 100).toFixed(0)}%`,
        assigneeUserId: actor.userId,
        dueAt: now,
        relatedType: "project",
        relatedId: projectId,
        status: "open",
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
  }
  return { costId, marginBps: margin, alert };
}

export function previewReceipt(text: string) {
  return extractReceiptText(text);
}

const DEMO_RECEIPT_NAMES = new Set(["casa-tile.svg", "harbor-plumbing.svg", "summit-lumber.svg"]);

function receiptStorageName(filename: string): string {
  const base = path.basename(filename);
  if (DEMO_RECEIPT_NAMES.has(base.toLowerCase())) return base.replace(/\.svg$/i, ".txt");
  return base;
}

export function saveUploadedText(actor: Actor, projectId: string, filename: string, text: string, metadataJson: string | null = null) {
  if (actor.role === "viewer") throw new ServiceError("Viewers cannot upload files.");
  const storedName = receiptStorageName(filename);
  const uploadError = receiptUploadError(storedName, text);
  if (uploadError) throw new ServiceError(uploadError);
  const db = staffDb(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  const documentId = id("doc");
  const relative = path.join("uploads", actor.orgId, `${documentId}-${storedName.replace(/[^\w.\-]+/g, "_")}`);
  const absolute = path.join(dataDir(), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, text);
  db.insert(documents)
    .values({
      id: documentId,
      orgId: actor.orgId,
      projectId,
      leadId: null,
      contactId: null,
      type: "receipt",
      filename: storedName,
      storagePath: relative,
      metadataJson,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy: actor.userId,
    })
    .run();
  return { documentId, extraction: extractReceiptText(text) };
}

export function captureReceipt(actor: Actor, projectId: string, filename: string, text: string) {
  const extraction = extractReceiptText(text);
  const db = staffDb(actor);
  const book = db.select().from(priceBookItems).where(eq(priceBookItems.orgId, actor.orgId)).all();
  const history = db
    .select({ costCode: costItems.costCode, vendorName: costItems.vendorName, projectId: costItems.projectId })
    .from(costItems)
    .where(eq(costItems.orgId, actor.orgId))
    .all();
  const suggestion = suggestCostCode({
    vendor: extraction.vendor,
    lineText: extraction.lines.map((line) => line.description).join(" "),
    book: book.map((item) => ({ code: item.code, name: item.name, vendor: item.vendor, keywords: item.keywords })),
    history,
    projectId,
  });
  const meta: StoredReceipt = {
    vendor: extraction.vendor,
    amountCents: extraction.amountCents,
    purchasedOn: extraction.purchasedOn,
    confidence: extraction.confidence,
    note: extraction.note,
    lines: extraction.lines,
    suggestedCode: suggestion?.code ?? null,
    suggestedReason: suggestion?.reason ?? null,
    posted: false,
  };
  const saved = saveUploadedText(actor, projectId, filename, text, JSON.stringify(meta));
  return { documentId: saved.documentId, extraction, suggestion };
}

export function confirmReceiptCost(
  actor: Actor,
  projectId: string,
  input: { documentId: string; amountCents: number; vendorName: string; costCode?: string; memo?: string },
) {
  const db = staffDb(actor);
  const document = db
    .select()
    .from(documents)
    .where(and(eq(documents.id, input.documentId), eq(documents.orgId, actor.orgId), eq(documents.projectId, projectId)))
    .get();
  if (!document || document.deletedAt) throw new ServiceError("That receipt is not on this job.");
  const posted = addCost(actor, projectId, {
    amountCents: input.amountCents,
    vendorName: input.vendorName,
    costCode: input.costCode,
    memo: input.memo,
    source: "receipt",
    aiExtracted: true,
    documentId: document.id,
  });
  const meta = readReceiptMeta(document.metadataJson);
  db.update(documents)
    .set({ metadataJson: JSON.stringify({ ...meta, posted: true, vendor: input.vendorName, amountCents: input.amountCents }) })
    .where(and(eq(documents.id, document.id), eq(documents.orgId, actor.orgId)))
    .run();
  return posted;
}

const DEMO_RECEIPT_TEXT: Record<string, string> = {
  "casa-tile.svg": "Vendor: Casa Tile\nDate: 03/12/2026\nBacksplash tile $820.00\nThinset $44.50\nTotal $864.50",
  "harbor-plumbing.svg": "Vendor: Harbor Plumbing\nDate: 02/02/2026\nSupply lines $400.00\nFittings $26.00\nTotal $426.00",
  "summit-lumber.svg": "Vendor: Summit Lumber\nDate: 01/18/2026\nFraming package $18,425.00\nTotal $18,425.00",
};

export function readDemoReceipt(fileName: string): string {
  const safe = path.basename(fileName);
  const file = path.join(process.cwd(), "public", "demo", "receipts", safe);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const fallback = DEMO_RECEIPT_TEXT[safe];
  if (fallback) return fallback;
  throw new ServiceError("That sample receipt is not in the demo set.");
}

function closeFinishedFollowUps(db: Writer, orgId: string) {
  const pending = db
    .select()
    .from(followUpDrafts)
    .where(and(eq(followUpDrafts.orgId, orgId), eq(followUpDrafts.status, "pending")))
    .all();
  if (pending.length === 0) return;
  const proposalRows = db.select().from(proposals).where(eq(proposals.orgId, orgId)).all();
  const leadRows = db.select().from(leads).where(eq(leads.orgId, orgId)).all();
  const stages = db.select().from(pipelineStages).where(eq(pipelineStages.orgId, orgId)).all();
  const proposalById = new Map(proposalRows.map((row) => [row.id, row]));
  const leadById = new Map(leadRows.map((row) => [row.id, row]));
  const stageById = new Map(stages.map((row) => [row.id, row]));
  const now = nowIso();
  for (const draft of pending) {
    if (draft.kind !== "proposal_unsigned" && draft.kind !== "stale_lead") continue;
    const lead = draft.leadId ? leadById.get(draft.leadId) : undefined;
    const stage = lead ? stageById.get(lead.stageId) : undefined;
    const dealClosed = !lead || lead.status === "won" || lead.status === "lost" || stage?.kind === "won" || stage?.kind === "lost";
    const proposal = draft.proposalId ? proposalById.get(draft.proposalId) : undefined;
    const proposalOpen = proposal?.status === "sent" || proposal?.status === "viewed";
    const drop = draft.kind === "stale_lead" ? dealClosed || lead?.status !== "open" : dealClosed || !proposalOpen;
    if (!drop) continue;
    db.update(followUpDrafts).set({ status: "dismissed", updatedAt: now }).where(eq(followUpDrafts.id, draft.id)).run();
  }
}

export function scanFollowUps(orgId: string) {
  const db = getDb();
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) return { created: 0 };
  closeFinishedFollowUps(db, orgId);
  const existing = db.select().from(followUpDrafts).where(eq(followUpDrafts.orgId, orgId)).all();
  const pendingKeys = new Set(
    existing.filter((row) => row.status === "pending").map((row) => `${row.kind}:${row.proposalId ?? row.leadId}`),
  );
  const nudgeSent = new Set(
    existing.filter((row) => row.kind === "proposal_unsigned" && row.status === "sent" && row.proposalId).map((row) => row.proposalId as string),
  );
  let created = 0;
  const proposalRows = db
    .select({ proposal: proposals, lead: leads, contact: contacts })
    .from(proposals)
    .innerJoin(leads, eq(leads.id, proposals.leadId))
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .where(eq(proposals.orgId, orgId))
    .all();
  for (const row of proposalRows) {
    if (row.lead.status === "won" || row.lead.status === "lost") continue;
    if (!needsProposalNudge(row.proposal.status, row.proposal.sentAt, Date.now(), row.proposal.viewedAt)) continue;
    const key = `proposal_unsigned:${row.proposal.id}`;
    if (pendingKeys.has(key)) continue;
    if (existing.some((draft) => draft.kind === "proposal_unsigned" && draft.proposalId === row.proposal.id && draft.status === "sent")) continue;
    const opened = row.proposal.status === "viewed";
    const anchor = opened ? row.proposal.viewedAt || row.proposal.sentAt : row.proposal.sentAt;
    const days = anchor ? Math.max(1, Math.floor((Date.now() - new Date(anchor).getTime()) / 86_400_000)) : 1;
    const copy = proposalNudgeCopy({
      firstName: row.contact.name.split(" ")[0],
      jobTitle: row.lead.title,
      company: org.name,
      days,
      opened,
    });
    db.insert(followUpDrafts)
      .values({
        id: id("draft"),
        orgId,
        contactId: row.contact.id,
        leadId: row.lead.id,
        proposalId: row.proposal.id,
        kind: "proposal_unsigned",
        status: "pending",
        subject: copy.subject,
        body: copy.body,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      })
      .run();
    pendingKeys.add(key);
    created += 1;
  }
  const owner = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner")))
    .get();
  if (owner) {
    const openTasks = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.orgId, orgId), eq(tasks.relatedType, "proposal")))
      .all();
    const tasked = new Set(openTasks.map((task) => task.relatedId));
    for (const row of proposalRows) {
      if (row.lead.status === "won" || row.lead.status === "lost") continue;
      if (!needsOfficeFollowUpCall(row.proposal.status, row.proposal.sentAt, row.proposal.viewedAt, nudgeSent.has(row.proposal.id))) continue;
      if (tasked.has(row.proposal.id)) continue;
      const now = nowIso();
      db.insert(tasks)
        .values({
          id: id("task"),
          orgId,
          title: unsignedProposalTaskTitle(row.lead.title),
          assigneeUserId: owner.userId,
          dueAt: now,
          relatedType: "proposal",
          relatedId: row.proposal.id,
          status: "open",
          createdAt: now,
          updatedAt: now,
          createdBy: owner.userId,
        })
        .run();
      tasked.add(row.proposal.id);
    }
  }
  const leadRows = db
    .select({ lead: leads, contact: contacts, stage: pipelineStages })
    .from(leads)
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
    .where(eq(leads.orgId, orgId))
    .all();
  for (const row of leadRows) {
    if (!needsStaleLead(row.lead.status, row.stage.kind, row.lead.updatedAt)) continue;
    const key = `stale_lead:${row.lead.id}`;
    if (pendingKeys.has(key) || existing.some((draft) => draft.kind === "stale_lead" && draft.leadId === row.lead.id && draft.status !== "dismissed")) continue;
    const copy = staleLeadCopy({
      firstName: row.contact.name.split(" ")[0],
      jobTitle: row.lead.title,
      company: org.name,
    });
    db.insert(followUpDrafts)
      .values({
        id: id("draft"),
        orgId,
        contactId: row.contact.id,
        leadId: row.lead.id,
        proposalId: null,
        kind: "stale_lead",
        status: "pending",
        subject: copy.subject,
        body: copy.body,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      })
      .run();
    created += 1;
  }
  return { created };
}

export async function approveDraft(actor: Actor, draftId: string, body?: string) {
  assertCrm(actor);
  const db = staffDb(actor);
  const draft = db.select().from(followUpDrafts).where(and(eq(followUpDrafts.id, draftId), eq(followUpDrafts.orgId, actor.orgId))).get();
  if (!draft || draft.status !== "pending") throw new ServiceError("That draft is not waiting for approval.");
  const contact = draft.contactId ? db.select().from(contacts).where(eq(contacts.id, draft.contactId)).get() : null;
  if (!contact?.email) throw new ServiceError("This contact has no email address.");
  const consent = db
    .select()
    .from(consents)
    .where(and(eq(consents.contactId, contact.id), eq(consents.channel, "email")))
    .orderBy(desc(consents.createdAt))
    .get();
  if (consent?.status === "opt_out") throw new ServiceError("This contact opted out of email.");
  const text = (body ?? draft.body).trim();
  const delivered = await deliverMessage({
    channel: "email",
    to: contact.email,
    subject: draft.subject,
    body: text,
    stub: true,
  });
  const now = nowIso();
  db.update(followUpDrafts).set({ status: "sent", body: text, updatedAt: now }).where(eq(followUpDrafts.id, draft.id)).run();
  const threadId = id("thread");
  db.insert(messageThreads)
    .values({
      id: threadId,
      orgId: actor.orgId,
      contactId: contact.id,
      leadId: draft.leadId,
      projectId: null,
      subject: draft.subject,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(messages)
    .values({
      id: id("msg"),
      orgId: actor.orgId,
      threadId,
      channel: "email",
      direction: "out",
      body: text,
      status: delivered.stub ? "sent_stub" : "sent",
      consentOk: 1,
      createdAt: now,
      createdBy: actor.userId,
    })
    .run();
  if (draft.leadId) log(db, actor.orgId, "lead", draft.leadId, "email", "Approved and sent a follow-up.", "user", actor.userId);
  return { stub: delivered.stub };
}

export function dismissDraft(actor: Actor, draftId: string) {
  assertCrm(actor);
  const db = staffDb(actor);
  const draft = db.select().from(followUpDrafts).where(and(eq(followUpDrafts.id, draftId), eq(followUpDrafts.orgId, actor.orgId))).get();
  if (!draft) throw new ServiceError("Draft not found.");
  db.update(followUpDrafts).set({ status: "dismissed", updatedAt: nowIso() }).where(eq(followUpDrafts.id, draftId)).run();
}

export function addPortalMessage(
  portalToken: string,
  body: string,
  upload?: { filename: string; bytes: Buffer } | null,
) {
  const text = body.trim();
  if (!text) throw new ServiceError("Write a message first.");
  const photo = upload && upload.bytes.length > 0 ? upload : null;
  if (photo) {
    const error = photoUploadError(photo.filename, photo.bytes);
    if (error) throw new ServiceError(error);
  }
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, portalToken)).get();
  if (!project) throw new ServiceError("Project link not found.");
  const now = nowIso();
  if (/^\s*stop\s*$/i.test(text)) {
    db.insert(consents)
      .values({
        id: id("consent"),
        orgId: project.orgId,
        contactId: project.contactId,
        channel: "sms",
        status: "opt_out",
        source: "STOP",
        createdAt: now,
      })
      .run();
  }
  let thread = db.select().from(messageThreads).where(eq(messageThreads.projectId, project.id)).get();
  if (!thread) {
    const threadId = id("thread");
    db.insert(messageThreads)
      .values({
        id: threadId,
        orgId: project.orgId,
        contactId: project.contactId,
        leadId: project.leadId,
        projectId: project.id,
        subject: project.name,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    thread = db.select().from(messageThreads).where(eq(messageThreads.id, threadId)).get()!;
  }
  const messageId = id("msg");
  db.insert(messages)
    .values({
      id: messageId,
      orgId: project.orgId,
      threadId: thread.id,
      channel: "email",
      direction: "in",
      body: text,
      status: "received",
      consentOk: 1,
      createdAt: now,
      createdBy: null,
    })
    .run();
  if (photo) {
    const documentId = id("doc");
    const stored = storedPhoto(project.orgId, documentId, "", project.name, photo);
    const meta = JSON.parse(stored.metadataJson) as { caption?: string };
    db.insert(documents)
      .values({
        id: documentId,
        orgId: project.orgId,
        projectId: project.id,
        leadId: project.leadId,
        contactId: null,
        type: "photo",
        filename: stored.filename,
        storagePath: stored.storagePath,
        metadataJson: JSON.stringify({ caption: meta.caption ?? "", messageId, portal: true }),
        deletedAt: null,
        createdAt: now,
        createdBy: null,
      })
      .run();
  }
  log(db, project.orgId, "contact", project.contactId, "email", "Client replied from the portal.", "contact", project.contactId);
  log(db, project.orgId, "project", project.id, "email", "Client reply is on the contact timeline.", "contact", project.contactId);
}

export function updateOrgSettings(
  actor: Actor,
  input: { marginAlertBps: number; defaultMarkupBps: number; cardEnabled: boolean; licenseNumber?: string },
) {
  if (actor.role !== "owner" && actor.role !== "admin") throw new ServiceError("Only an owner or admin can change company settings.");
  if (input.marginAlertBps < 0 || input.defaultMarkupBps < 0) throw new ServiceError("Percentages cannot be negative.");
  const license = input.licenseNumber?.trim().slice(0, 80);
  staffDb(actor)
    .update(organizations)
    .set({
      marginAlertBps: input.marginAlertBps,
      defaultMarkupBps: input.defaultMarkupBps,
      cardEnabled: input.cardEnabled ? 1 : 0,
      ...(input.licenseNumber !== undefined ? { licenseNumber: license || null } : {}),
      updatedAt: nowIso(),
    })
    .where(eq(organizations.id, actor.orgId))
    .run();
}

function writeUpload(orgId: string, documentId: string, ext: string, body: Buffer | string) {
  const relative = path.join("uploads", orgId, `${documentId}.${ext}`);
  const absolute = path.join(dataDir(), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, body);
  return relative;
}

function photoFileName(original: string, ext: string) {
  const stem = path.basename(original).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80);
  return `${stem || "photo"}.${ext}`;
}

function storedPhoto(orgId: string, documentId: string, caption: string, fallbackLabel: string, upload?: { filename: string; bytes: Buffer } | null) {
  if (upload && upload.bytes.length > 0) {
    const error = photoUploadError(upload.filename, upload.bytes);
    if (error) throw new ServiceError(error);
    const type = rasterImageType(upload.bytes);
    if (!type) throw new ServiceError("Use a JPEG, PNG, or WebP photo.");
    const ext = photoExtension(type);
    return {
      storagePath: writeUpload(orgId, documentId, ext, upload.bytes),
      filename: photoFileName(upload.filename, ext),
      metadataJson: JSON.stringify({ caption }),
    };
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="100%" height="100%" fill="#efe6d6"/><text x="32" y="80" font-family="Georgia" font-size="28" fill="#1c3a2e">${escapeXml(caption || fallbackLabel)}</text></svg>`;
  return {
    storagePath: writeUpload(orgId, documentId, "svg", svg),
    filename: `${documentId}.svg`,
    metadataJson: JSON.stringify({ caption }),
  };
}

export function submitTesterFeedback(
  actor: Actor,
  input: { path: string; body: string; context?: string; userAgent?: string },
) {
  const body = input.body.trim();
  if (!body) throw new ServiceError("Write a short note before saving.");
  if (body.length > 2000) throw new ServiceError("Keep the note under 2,000 characters.");
  if (/data:image\//i.test(body) || /data:image\//i.test(input.context || "")) {
    throw new ServiceError("Leave screenshots out. A short note is enough.");
  }
  const pagePath = input.path.trim().slice(0, 180);
  if (!pagePath.startsWith("/") || pagePath.startsWith("//")) throw new ServiceError("That page path is not in Fieldline.");
  const context = input.context?.trim().slice(0, 500) || null;
  const db = staffDb(actor);
  const noteId = id("fb");
  db.insert(testerFeedback)
    .values({
      id: noteId,
      orgId: actor.orgId,
      userId: actor.userId,
      path: pagePath,
      body,
      context,
      userAgent: input.userAgent?.trim().slice(0, 300) || null,
      createdAt: nowIso(),
    })
    .run();
  return { id: noteId };
}

export function attachPhotoNote(actor: Actor, projectId: string, caption: string, upload?: { filename: string; bytes: Buffer } | null) {
  if (!canAddFieldNotes(actor.role as Role)) throw new ServiceError("Viewers cannot add photos.");
  const db = staffDb(actor);
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  const documentId = id("doc");
  const stored = storedPhoto(actor.orgId, documentId, caption, project.name, upload);
  db.insert(documents)
    .values({
      id: documentId,
      orgId: actor.orgId,
      projectId,
      leadId: project.leadId,
      contactId: null,
      type: "photo",
      filename: stored.filename,
      storagePath: stored.storagePath,
      metadataJson: stored.metadataJson,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy: actor.userId,
    })
    .run();
  log(db, actor.orgId, "project", projectId, "photo", caption.trim() || "Photo added from the field.", "user", actor.userId);
  return { documentId };
}

export function attachLeadPhoto(actor: Actor, leadId: string, caption: string, upload?: { filename: string; bytes: Buffer } | null) {
  if (!canAddFieldNotes(actor.role as Role)) throw new ServiceError("Viewers cannot add photos.");
  const db = staffDb(actor);
  const lead = db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, actor.orgId))).get();
  if (!lead) throw new ServiceError("Lead not found.");
  const documentId = id("doc");
  const stored = storedPhoto(actor.orgId, documentId, caption, lead.title, upload);
  db.insert(documents)
    .values({
      id: documentId,
      orgId: actor.orgId,
      projectId: null,
      leadId,
      contactId: lead.contactId,
      type: "photo",
      filename: stored.filename,
      storagePath: stored.storagePath,
      metadataJson: stored.metadataJson,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy: actor.userId,
    })
    .run();
  log(db, actor.orgId, "lead", leadId, "photo", caption.trim() || "Site photo added.", "user", actor.userId);
  return { documentId };
}

function escapeXml(value: string) {
  return value.replace(/[<>&"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[char] || char);
}
