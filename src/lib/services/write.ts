import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import { dataDir, getDb } from "@/lib/db/client";
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
  estimateSections,
  estimates,
  followUpDrafts,
  invoiceLines,
  invoices,
  leads,
  lineItems,
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
} from "@/lib/db/schema";
import { estimateFromScope } from "@/lib/ai/gateway";
import { extractIntake } from "@/lib/ai/intake";
import { proposalNudgeCopy, staleLeadCopy, needsProposalNudge, needsStaleLead } from "@/lib/ai/nurture";
import { extractReceiptText } from "@/lib/ai/receipt";
import { assembleSnapshot, defaultSchedule, type StoredSnapshot } from "@/lib/domain/snapshot";
import { canonicalJson, sha256 } from "@/lib/esign/hash";
import { daysFromNow, id, nowIso, token } from "@/lib/ids";
import { deliverMessage } from "@/lib/messages/outbox";
import { achFeeCents, cardFeeCents, lineAmounts, lineInputError, marginBps, positiveMoneyError, qtyToMilli } from "@/lib/money";
import { decideAch, decideCard } from "@/lib/payments/decide";
import { canEditCrm, canManageMoney, type Role } from "@/lib/permissions";
import { CONSENT_VERSION } from "@/lib/product";
import { receiptUploadError } from "@/lib/security";
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
  const db = getDb();
  const lead = db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, actor.orgId))).get();
  const stage = db.select().from(pipelineStages).where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.orgId, actor.orgId))).get();
  if (!lead || !stage) throw new ServiceError("That deal is not in your company.");
  const status = stage.kind === "won" ? "won" : stage.kind === "lost" ? "lost" : "open";
  db.update(leads)
    .set({ stageId, status, updatedAt: nowIso() })
    .where(eq(leads.id, leadId))
    .run();
  log(db, actor.orgId, "lead", leadId, "stage", `Moved to ${stage.name}.`, "user", actor.userId);
}

export function logNote(actor: Actor, entityType: string, entityId: string, summary: string) {
  if (actor.role === "viewer") throw new ServiceError("Viewers cannot add notes.");
  const text = summary.trim();
  if (!text) throw new ServiceError("Write a note first.");
  const db = getDb();
  if (entityType === "lead") {
    const lead = db.select().from(leads).where(and(eq(leads.id, entityId), eq(leads.orgId, actor.orgId))).get();
    if (!lead) throw new ServiceError("Deal not found.");
    db.update(leads).set({ updatedAt: nowIso() }).where(eq(leads.id, entityId)).run();
  }
  log(db, actor.orgId, entityType, entityId, "note", text, "user", actor.userId);
}

export function createTask(actor: Actor, input: { title: string; relatedType: string; relatedId: string; assigneeUserId?: string; dueAt?: string }) {
  assertCrm(actor);
  if (!input.title.trim()) throw new ServiceError("A task needs a title.");
  getDb()
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
  const db = getDb();
  const task = db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.orgId, actor.orgId))).get();
  if (!task) throw new ServiceError("Task not found.");
  db.update(tasks).set({ status: "done", updatedAt: nowIso() }).where(eq(tasks.id, taskId)).run();
}

export function createLeadFromText(actor: Actor, text: string, source = "manual") {
  assertCrm(actor);
  const intake = extractIntake(text);
  const db = getDb();
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
  const db = getDb();
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
    })),
    markupBps: org.defaultMarkupBps,
  });
  const estimateId = id("est");
  const now = nowIso();
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
    draft.sections.forEach((section, sectionIndex) => {
      const sectionId = id("sec");
      tx.insert(estimateSections)
        .values({ id: sectionId, orgId: actor.orgId, estimateId, name: section.name, sortOrder: sectionIndex })
        .run();
      section.lines.forEach((line, lineIndex) => {
        tx.insert(lineItems)
          .values({
            id: id("li"),
            orgId: actor.orgId,
            sectionId,
            estimateId,
            priceBookItemId: line.priceBookItemId ?? null,
            name: line.name,
            description: null,
            qtyMilli: qtyToMilli(line.qty),
            unit: line.unit,
            unitCostCents: line.unitCostCents,
            markupBps: line.markupBps,
            costCode: line.code,
            source: "ai",
            aiConfidenceMilli: Math.round(line.confidence * 1000),
            sourceNote: line.reason,
            sortOrder: lineIndex,
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
  const db = getDb();
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
  const db = getDb();
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
  const db = getDb();
  const sections = db.select().from(estimateSections).where(eq(estimateSections.estimateId, estimateId)).all();
  let sectionId = sections[0]?.id;
  if (!sectionId) {
    sectionId = id("sec");
    db.insert(estimateSections).values({ id: sectionId, orgId: actor.orgId, estimateId, name: "Added", sortOrder: 0 }).run();
  }
  if (!input.name.trim()) throw new ServiceError("A line needs a name and a quantity.");
  const invalid = lineInputError({ qty: input.qty, unitCostCents: input.unitCostCents, markupBps: input.markupBps });
  if (invalid) throw new ServiceError(invalid);
  db.insert(lineItems)
    .values({
      id: id("li"),
      orgId: actor.orgId,
      sectionId,
      estimateId,
      priceBookItemId: null,
      name: input.name.trim(),
      description: null,
      qtyMilli: qtyToMilli(input.qty),
      unit: input.unit || "ea",
      unitCostCents: input.unitCostCents,
      markupBps: input.markupBps,
      costCode: input.costCode || null,
      source: "manual",
      aiConfidenceMilli: null,
      sourceNote: "Added by hand.",
      sortOrder: 100,
    })
    .run();
}

export function removeLine(actor: Actor, lineId: string) {
  assertMoney(actor);
  const db = getDb();
  const line = db.select().from(lineItems).where(and(eq(lineItems.id, lineId), eq(lineItems.orgId, actor.orgId))).get();
  if (!line) throw new ServiceError("Line not found.");
  loadEditableEstimate(actor, line.estimateId);
  db.delete(lineItems).where(eq(lineItems.id, lineId)).run();
}

export function reviseEstimate(actor: Actor, estimateId: string) {
  assertMoney(actor);
  const db = getDb();
  const estimate = db.select().from(estimates).where(and(eq(estimates.id, estimateId), eq(estimates.orgId, actor.orgId))).get();
  if (!estimate) throw new ServiceError("Estimate not found.");
  const sections = db.select().from(estimateSections).where(eq(estimateSections.estimateId, estimateId)).all();
  const lines = db.select().from(lineItems).where(eq(lineItems.estimateId, estimateId)).all();
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
    log(tx, actor.orgId, "lead", estimate.leadId, "estimate", `Revised estimate into v${previous.reduce((max, row) => Math.max(max, row.version), 0) + 1}.`, "user", actor.userId);
  });
  return { estimateId: nextId };
}

export async function sendProposal(actor: Actor, estimateId: string, overrideMargin = false) {
  assertMoney(actor);
  const db = getDb();
  const estimate = db.select().from(estimates).where(and(eq(estimates.id, estimateId), eq(estimates.orgId, actor.orgId))).get();
  if (!estimate) throw new ServiceError("Estimate not found.");
  if (estimate.status === "void") throw new ServiceError("This draft was replaced. Open the latest version.");
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get()!;
  const lead = db.select().from(leads).where(eq(leads.id, estimate.leadId)).get()!;
  const contact = db.select().from(contacts).where(eq(contacts.id, lead.contactId)).get()!;
  const sections = db.select().from(estimateSections).where(eq(estimateSections.estimateId, estimateId)).all();
  const lines = db.select().from(lineItems).where(eq(lineItems.estimateId, estimateId)).all();
  if (lines.length === 0) throw new ServiceError("Add at least one line before sending.");
  let cost = 0;
  let price = 0;
  for (const line of lines) {
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
  const db = getDb();
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
  const db = getDb();
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
  const db = getDb();
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
    log(tx, order.orgId, "project", project.id, "change_order", `Approved CO ${order.number}. Contract and budget updated.`, "contact", null);
    audit(tx, order.orgId, null, "change_order.approve", "change_order", order.id, input.ip);
    return { projectId: project.id, payToken, invoiceId };
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
  const db = getDb();
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

export function saveUploadedText(actor: Actor, projectId: string, filename: string, text: string) {
  if (actor.role === "viewer") throw new ServiceError("Viewers cannot upload files.");
  const uploadError = receiptUploadError(filename, text);
  if (uploadError) throw new ServiceError(uploadError);
  const db = getDb();
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  const documentId = id("doc");
  const relative = path.join("uploads", actor.orgId, `${documentId}-${filename.replace(/[^\w.\-]+/g, "_")}`);
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
      filename,
      storagePath: relative,
      metadataJson: null,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy: actor.userId,
    })
    .run();
  return { documentId, extraction: extractReceiptText(text) };
}

const DEMO_RECEIPT_TEXT: Record<string, string> = {
  "casa-tile.svg": "Vendor: Casa Tile\nBacksplash tile, Okonkwo bath\nTotal $864.50",
  "harbor-plumbing.svg": "Vendor: Harbor Plumbing\nSupply lines, Chen powder\nTotal $426.00",
  "summit-lumber.svg": "Vendor: Summit Lumber\nFraming package, Brooks addition\nTotal $18,425.00",
};

export function readDemoReceipt(fileName: string): string {
  const safe = path.basename(fileName);
  const file = path.join(process.cwd(), "public", "demo", "receipts", safe);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const fallback = DEMO_RECEIPT_TEXT[safe];
  if (fallback) return fallback;
  throw new ServiceError("That sample receipt is not in the demo set.");
}

export function scanFollowUps(orgId: string) {
  const db = getDb();
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) return { created: 0 };
  const existing = db.select().from(followUpDrafts).where(eq(followUpDrafts.orgId, orgId)).all();
  const pendingKeys = new Set(
    existing.filter((row) => row.status === "pending").map((row) => `${row.kind}:${row.proposalId ?? row.leadId}`),
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
    if (!needsProposalNudge(row.proposal.status, row.proposal.sentAt)) continue;
    const key = `proposal_unsigned:${row.proposal.id}`;
    if (pendingKeys.has(key)) continue;
    const sentDays = row.proposal.sentAt ? Math.floor((Date.now() - new Date(row.proposal.sentAt).getTime()) / 86_400_000) : 3;
    const copy = proposalNudgeCopy({
      firstName: row.contact.name.split(" ")[0],
      jobTitle: row.lead.title,
      company: org.name,
      days: sentDays,
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
  const db = getDb();
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
  const db = getDb();
  const draft = db.select().from(followUpDrafts).where(and(eq(followUpDrafts.id, draftId), eq(followUpDrafts.orgId, actor.orgId))).get();
  if (!draft) throw new ServiceError("Draft not found.");
  db.update(followUpDrafts).set({ status: "dismissed", updatedAt: nowIso() }).where(eq(followUpDrafts.id, draftId)).run();
}

export function addPortalMessage(portalToken: string, body: string) {
  const text = body.trim();
  if (!text) throw new ServiceError("Write a message first.");
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
  db.insert(messages)
    .values({
      id: id("msg"),
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
  log(db, project.orgId, "contact", project.contactId, "email", "Client replied from the portal.", "contact", project.contactId);
  log(db, project.orgId, "project", project.id, "email", "Client reply is on the contact timeline.", "contact", project.contactId);
}

export function updateOrgSettings(actor: Actor, input: { marginAlertBps: number; defaultMarkupBps: number; cardEnabled: boolean }) {
  if (actor.role !== "owner" && actor.role !== "admin") throw new ServiceError("Only an owner or admin can change company settings.");
  if (input.marginAlertBps < 0 || input.defaultMarkupBps < 0) throw new ServiceError("Percentages cannot be negative.");
  getDb()
    .update(organizations)
    .set({
      marginAlertBps: input.marginAlertBps,
      defaultMarkupBps: input.defaultMarkupBps,
      cardEnabled: input.cardEnabled ? 1 : 0,
      updatedAt: nowIso(),
    })
    .where(eq(organizations.id, actor.orgId))
    .run();
}

export function attachPhotoNote(actor: Actor, projectId: string, caption: string) {
  if (actor.role === "viewer") throw new ServiceError("Viewers cannot add photos.");
  const db = getDb();
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  const documentId = id("doc");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="100%" height="100%" fill="#efe6d6"/><text x="32" y="80" font-family="Georgia" font-size="28" fill="#1c3a2e">${escapeXml(caption || "Job photo")}</text><text x="32" y="120" font-family="sans-serif" font-size="16" fill="#5c564c">${escapeXml(project.name)}</text></svg>`;
  const relative = path.join("uploads", actor.orgId, `${documentId}.svg`);
  const absolute = path.join(dataDir(), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, svg);
  db.insert(documents)
    .values({
      id: documentId,
      orgId: actor.orgId,
      projectId,
      leadId: project.leadId,
      contactId: null,
      type: "photo",
      filename: `${documentId}.svg`,
      storagePath: relative,
      metadataJson: JSON.stringify({ caption }),
      deletedAt: null,
      createdAt: nowIso(),
      createdBy: actor.userId,
    })
    .run();
  log(db, actor.orgId, "project", projectId, "photo", caption.trim() || "Photo added from the field.", "user", actor.userId);
  return { documentId };
}

function escapeXml(value: string) {
  return value.replace(/[<>&"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[char] || char);
}
