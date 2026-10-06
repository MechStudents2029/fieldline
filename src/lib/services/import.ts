import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { parseCsv, ImportParseError } from "@/lib/import/csv";
import { autoMap, fieldsFor, isImportKind, type ImportKind } from "@/lib/import/map";
import {
  mapContactRow,
  mapItemRow,
  reviewContacts,
  reviewPriceBook,
  rowCounts,
  toView,
  withChoices,
  type ContactDraft,
  type ImportCounts,
  type ImportHistoryRow,
  type ImportViewRow,
  type ItemDraft,
  type ReviewedRow,
} from "@/lib/import/review";
import { undoDecision } from "@/lib/import/undo";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  budgetLines,
  changeOrderLines,
  changeOrders,
  contacts,
  costItems,
  estimates,
  importBatches,
  importRows,
  invoices,
  leads,
  lineItems,
  organizations,
  pipelineStages,
  priceBookItems,
  projects,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canManageSettings, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";

type Choice = { index: number; choice?: string; mapToCode?: string };

type ContactSnapshot = {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  notes: string | null;
  type: string;
};

type ItemSnapshot = {
  code: string;
  name: string;
  category: string;
  unit: string;
  unitCostCents: number;
  defaultMarkupBps: number;
};

export type ImportPreview = {
  rows: ImportViewRow[];
  counts: ImportCounts;
  codes: { code: string; name: string }[];
};

function officeOrThrow(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function assertImporter(actor: Actor) {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("Only an owner or admin can import.");
}

function parseKind(kind: string): ImportKind {
  if (!isImportKind(kind)) throw new ServiceError("Pick contacts, vendors, or the price book.");
  return kind;
}

function reviewed(actor: Actor, kind: ImportKind, csv: string, mapping: string[] | null, choices: Choice[]) {
  let table;
  try {
    table = parseCsv(csv);
  } catch (error) {
    if (error instanceof ImportParseError) throw new ServiceError(error.message);
    throw error;
  }
  const fields = new Set(fieldsFor(kind));
  const used = autoMap(table.headers, kind);
  const applied = table.headers.map((_, index) => {
    const picked = mapping?.[index];
    if (picked == null || picked === "") return mapping ? "" : used[index];
    return fields.has(picked) ? picked : "";
  });
  if (mapping) {
    const seen = new Set<string>();
    for (let index = 0; index < applied.length; index += 1) {
      const field = applied[index];
      if (!field) continue;
      if (seen.has(field)) applied[index] = "";
      else seen.add(field);
    }
  }
  const db = officeOrThrow(actor);
  if (kind === "price_book") {
    const existing = db
      .select({ id: priceBookItems.id, code: priceBookItems.code, name: priceBookItems.name, category: priceBookItems.category })
      .from(priceBookItems)
      .where(eq(priceBookItems.orgId, actor.orgId))
      .all();
    const org = db
      .select({ defaultMarkupBps: organizations.defaultMarkupBps })
      .from(organizations)
      .where(eq(organizations.id, actor.orgId))
      .get();
    const rows = withChoices(
      reviewPriceBook(
        table.rows.map((row, index) => mapItemRow(row, applied, index)),
        existing,
        org?.defaultMarkupBps ?? 3500,
      ),
      choices,
      existing,
    );
    return { rows, codes: existing.map((item) => ({ code: item.code, name: item.name })) };
  }
  const existing = db
    .select({ id: contacts.id, type: contacts.type, name: contacts.name, email: contacts.email, phone: contacts.phone })
    .from(contacts)
    .where(and(eq(contacts.orgId, actor.orgId), isNull(contacts.deletedAt)))
    .all();
  return { rows: withChoices(reviewContacts(table.rows.map((row, index) => mapContactRow(row, applied, index)), existing, kind), choices, []), codes: [] as { code: string; name: string }[] };
}

export function previewImport(actor: Actor, input: { kind: string; csv: string; mapping: string[] | null }): ImportPreview {
  assertImporter(actor);
  const kind = parseKind(input.kind);
  const { rows, codes } = reviewed(actor, kind, input.csv, input.mapping, []);
  return { rows: rows.map(toView), counts: rowCounts(rows), codes };
}

export function commitImport(actor: Actor, input: { kind: string; csv: string; mapping: string[]; choices: Choice[] }): { batchId: string; counts: ImportCounts } {
  assertImporter(actor);
  const kind = parseKind(input.kind);
  const { rows } = reviewed(actor, kind, input.csv, input.mapping, input.choices);
  const counts = rowCounts(rows);
  const db = officeOrThrow(actor);
  const now = nowIso();
  const batchId = id("imp");
  const applicable = rows.filter((row) => row.status !== "error" && (row.choice === "import" || row.choice === "update"));
  db.transaction((tx) => {
    const created = new Map<number, { id: string; kind: "contact" | "item" }>();
    tx.insert(importBatches)
      .values({
        id: batchId,
        orgId: actor.orgId,
        kind,
        createdBy: actor.userId,
        createdAt: now,
        undoneAt: applicable.length === 0 ? now : null,
        summaryJson: JSON.stringify(counts),
      })
      .run();
    for (const row of applicable) {
      if (kind === "price_book" && row.item) applyItem(tx, actor, batchId, now, row, created);
      else if (row.contact) applyContact(tx, actor, batchId, now, row, created);
    }
    tx.insert(auditLogs)
      .values({
        id: id("aud"),
        orgId: actor.orgId,
        actorId: actor.userId,
        action: "import",
        entityType: "import_batch",
        entityId: batchId,
        payloadJson: JSON.stringify({ kind, ...counts }),
        ip: null,
        createdAt: now,
      })
      .run();
  });
  return { batchId, counts };
}

export function undoImport(actor: Actor, batchId: string): { blocked: number; reason: string | null } {
  assertImporter(actor);
  const db = officeOrThrow(actor);
  const batch = db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.id, batchId), eq(importBatches.orgId, actor.orgId)))
    .get();
  if (!batch) throw new ServiceError("That import is not in this company.");
  if (batch.undoneAt) return { blocked: 0, reason: null };
  const rows = db
    .select()
    .from(importRows)
    .where(and(eq(importRows.batchId, batchId), eq(importRows.orgId, actor.orgId)))
    .all()
    .sort((a, b) => b.rowIndex - a.rowIndex);
  let blocked = 0;
  let reason: string | null = null;
  db.transaction((tx) => {
    for (const row of rows) {
      if (row.undoneAt || !row.recordId) continue;
      const created = row.action === "create";
      const block = row.recordKind === "contact" ? contactBlock(tx, actor.orgId, row, batch.createdAt, created) : itemBlock(tx, actor.orgId, row, batch.createdAt, created);
      if (block) {
        blocked += 1;
        reason = reason || block;
        tx.update(importRows)
          .set({ undoBlock: block })
          .where(and(eq(importRows.id, row.id), eq(importRows.orgId, actor.orgId)))
          .run();
        continue;
      }
      if (row.recordKind === "contact") undoContact(tx, actor.orgId, row, batch.createdAt);
      else undoItem(tx, actor.orgId, row, batch.createdAt);
      tx.update(importRows)
        .set({ undoneAt: nowIso(), undoBlock: null })
        .where(and(eq(importRows.id, row.id), eq(importRows.orgId, actor.orgId)))
        .run();
    }
    const left = tx
      .select({ id: importRows.id })
      .from(importRows)
      .where(and(eq(importRows.batchId, batchId), eq(importRows.orgId, actor.orgId), isNull(importRows.undoneAt)))
      .all();
    if (left.length === 0) {
      tx.update(importBatches)
        .set({ undoneAt: nowIso() })
        .where(and(eq(importBatches.id, batchId), eq(importBatches.orgId, actor.orgId)))
        .run();
    }
  });
  return { blocked, reason };
}

export function listImports(actor: Actor): ImportHistoryRow[] {
  assertImporter(actor);
  const db = officeOrThrow(actor);
  const batches = db
    .select()
    .from(importBatches)
    .where(eq(importBatches.orgId, actor.orgId))
    .orderBy(desc(importBatches.createdAt))
    .all();
  return batches.map((batch) => {
    const blocked = db
      .select({ undoBlock: importRows.undoBlock })
      .from(importRows)
      .where(and(eq(importRows.batchId, batch.id), eq(importRows.orgId, actor.orgId)))
      .all()
      .filter((row) => row.undoBlock);
    const summary = JSON.parse(batch.summaryJson) as ImportCounts;
    return {
      id: batch.id,
      kind: parseKind(batch.kind),
      createdAt: batch.createdAt,
      undoneAt: batch.undoneAt,
      summary,
      reason: blocked[0]?.undoBlock ?? null,
    };
  });
}

type Writer = ReturnType<typeof officeOrThrow>;

function applyContact(tx: Writer, actor: Actor, batchId: string, now: string, row: ReviewedRow, created: Map<number, { id: string; kind: "contact" | "item" }>) {
  const draft = row.contact as ContactDraft;
  if (row.choice === "update") {
    const recordId = resolveId(tx, actor.orgId, row, created, "contact");
    if (!recordId) return;
    const current = tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, recordId), eq(contacts.orgId, actor.orgId), isNull(contacts.deletedAt)))
      .get();
    if (!current) return;
    const before = contactSnapshot(current);
    tx.update(contacts)
      .set({ ...snapshotFromDraft(draft), updatedAt: now })
      .where(and(eq(contacts.id, current.id), eq(contacts.orgId, actor.orgId)))
      .run();
    insertRow(tx, actor.orgId, batchId, row.index, "update", "contact", current.id, before, { contactId: current.id, leadId: null, fields: snapshotFromDraft(draft) });
    return;
  }
  const contactId = id("c");
  const fields = snapshotFromDraft(draft);
  tx.insert(contacts)
    .values({ id: contactId, orgId: actor.orgId, ...fields, deletedAt: null, createdAt: now, updatedAt: now, createdBy: actor.userId })
    .run();
  let leadId: string | null = null;
  if (draft.asLead) {
    const stage = tx
      .select({ id: pipelineStages.id })
      .from(pipelineStages)
      .where(and(eq(pipelineStages.orgId, actor.orgId), eq(pipelineStages.kind, "open")))
      .orderBy(asc(pipelineStages.sortOrder))
      .get();
    if (stage) {
      leadId = id("lead");
      tx.insert(leads)
        .values({
          id: leadId,
          orgId: actor.orgId,
          contactId,
          stageId: stage.id,
          title: draft.name,
          source: "import",
          valueEstCents: null,
          ownerUserId: actor.userId,
          status: "open",
          lostReason: null,
          scopeText: null,
          sqft: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.userId,
        })
        .run();
    }
  }
  created.set(row.index, { id: contactId, kind: "contact" });
  insertRow(tx, actor.orgId, batchId, row.index, "create", "contact", contactId, null, { contactId, leadId, fields });
}

function applyItem(tx: Writer, actor: Actor, batchId: string, now: string, row: ReviewedRow, created: Map<number, { id: string; kind: "contact" | "item" }>) {
  const draft = row.item as ItemDraft;
  if (row.choice === "update") {
    const recordId = resolveId(tx, actor.orgId, row, created, "item");
    if (!recordId) return;
    const current = tx
      .select()
      .from(priceBookItems)
      .where(and(eq(priceBookItems.id, recordId), eq(priceBookItems.orgId, actor.orgId)))
      .get();
    if (!current) return;
    const before = itemSnapshot(current);
    const category = draft.categoryProvided ? draft.category : current.category;
    const fields: ItemSnapshot = { ...itemSnapshotFromDraft(draft), category };
    tx.update(priceBookItems)
      .set({ ...fields, updatedAt: now })
      .where(and(eq(priceBookItems.id, current.id), eq(priceBookItems.orgId, actor.orgId)))
      .run();
    insertRow(tx, actor.orgId, batchId, row.index, "update", "item", current.id, before, { itemId: current.id, fields });
    return;
  }
  const itemId = id("pb");
  const fields = itemSnapshotFromDraft(draft);
  tx.insert(priceBookItems)
    .values({
      id: itemId,
      orgId: actor.orgId,
      ...fields,
      vendor: null,
      keywords: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  created.set(row.index, { id: itemId, kind: "item" });
  insertRow(tx, actor.orgId, batchId, row.index, "create", "item", itemId, null, { itemId, fields });
}

function resolveId(tx: Writer, orgId: string, row: ReviewedRow, created: Map<number, { id: string; kind: "contact" | "item" }>, kind: "contact" | "item"): string | null {
  const match = row.matchId || "";
  if (match.startsWith("file:")) {
    const earlier = created.get(Number(match.slice(5)));
    return earlier && earlier.kind === kind ? earlier.id : null;
  }
  if (!match) return null;
  if (kind === "contact") {
    const rowHit = tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, match), eq(contacts.orgId, orgId))).get();
    return rowHit?.id ?? null;
  }
  const item = tx.select({ id: priceBookItems.id }).from(priceBookItems).where(and(eq(priceBookItems.id, match), eq(priceBookItems.orgId, orgId))).get();
  return item?.id ?? null;
}

function insertRow(tx: Writer, orgId: string, batchId: string, rowIndex: number, action: string, recordKind: string, recordId: string, before: unknown, after: unknown) {
  tx.insert(importRows)
    .values({
      id: id("impr"),
      orgId,
      batchId,
      rowIndex,
      action,
      recordKind,
      recordId,
      beforeJson: before ? JSON.stringify(before) : null,
      afterJson: JSON.stringify(after),
      undoneAt: null,
      undoBlock: null,
    })
    .run();
}

function contactBlock(tx: Writer, orgId: string, row: { recordId: string | null; afterJson: string | null }, batchCreatedAt: string, created: boolean): string | null {
  const contactId = row.recordId;
  if (!contactId) return "Used on a job";
  const after = created ? null : batchCreatedAt;
  const importedLeadId = created ? ((JSON.parse(row.afterJson || "{}") as { leadId?: string | null }).leadId ?? null) : null;
  const times: string[] = [];
  const projectRows = tx
    .select({ id: projects.id, createdAt: projects.createdAt })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.contactId, contactId)))
    .all();
  for (const project of projectRows) if (after == null || project.createdAt > after) times.push(project.createdAt);
  const leadRows = tx
    .select({ id: leads.id, createdAt: leads.createdAt })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), eq(leads.contactId, contactId), isNull(leads.deletedAt)))
    .all();
  if (created) {
    for (const lead of leadRows) if (lead.id !== importedLeadId) times.push(lead.createdAt);
  }
  if (leadRows.length > 0) {
    const estimateRows = tx
      .select({ createdAt: estimates.createdAt })
      .from(estimates)
      .where(and(eq(estimates.orgId, orgId), inArray(estimates.leadId, leadRows.map((lead) => lead.id))))
      .all();
    for (const estimate of estimateRows) if (after == null || estimate.createdAt > after) times.push(estimate.createdAt);
  }
  if (projectRows.length > 0) {
    const invoiceRows = tx
      .select({ createdAt: invoices.createdAt })
      .from(invoices)
      .where(and(eq(invoices.orgId, orgId), inArray(invoices.projectId, projectRows.map((project) => project.id))))
      .all();
    for (const invoice of invoiceRows) if (after == null || invoice.createdAt > after) times.push(invoice.createdAt);
  }
  const contact = tx.select({ updatedAt: contacts.updatedAt }).from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId))).get();
  return undoDecision({ created, recordUpdatedAt: contact?.updatedAt || batchCreatedAt, batchCreatedAt, usedAt: times.sort()[0] ?? null });
}

function itemBlock(tx: Writer, orgId: string, row: { recordId: string | null; afterJson: string | null }, batchCreatedAt: string, created: boolean): string | null {
  const itemId = row.recordId;
  if (!itemId) return "Used on a job";
  const item = tx.select().from(priceBookItems).where(and(eq(priceBookItems.id, itemId), eq(priceBookItems.orgId, orgId))).get();
  if (!item) return null;
  const after = created ? null : batchCreatedAt;
  const code = item.code;
  const times: string[] = [];
  const lines = tx
    .select({ estimateId: lineItems.estimateId })
    .from(lineItems)
    .where(and(eq(lineItems.orgId, orgId), eq(lineItems.priceBookItemId, itemId)))
    .all();
  const coded = code
    ? tx
        .select({ estimateId: lineItems.estimateId })
        .from(lineItems)
        .where(and(eq(lineItems.orgId, orgId), eq(lineItems.costCode, code)))
        .all()
    : [];
  const estimateIds = [...new Set([...lines, ...coded].map((line) => line.estimateId))];
  if (estimateIds.length > 0) {
    const estimateRows = tx
      .select({ createdAt: estimates.createdAt })
      .from(estimates)
      .where(and(eq(estimates.orgId, orgId), inArray(estimates.id, estimateIds)))
      .all();
    for (const estimate of estimateRows) if (after == null || estimate.createdAt > after) times.push(estimate.createdAt);
  }
  const budgets = tx
    .select({ createdAt: budgetLines.createdAt })
    .from(budgetLines)
    .where(and(eq(budgetLines.orgId, orgId), eq(budgetLines.costCode, code)))
    .all();
  for (const budget of budgets) if (after == null || budget.createdAt > after) times.push(budget.createdAt);
  const costs = tx
    .select({ createdAt: costItems.createdAt })
    .from(costItems)
    .where(and(eq(costItems.orgId, orgId), eq(costItems.costCode, code)))
    .all();
  for (const cost of costs) if (after == null || cost.createdAt > after) times.push(cost.createdAt);
  const orders = tx
    .select({ createdAt: changeOrders.createdAt })
    .from(changeOrderLines)
    .innerJoin(changeOrders, eq(changeOrders.id, changeOrderLines.changeOrderId))
    .where(and(eq(changeOrderLines.orgId, orgId), eq(changeOrderLines.costCode, code)))
    .all();
  for (const order of orders) if (after == null || order.createdAt > after) times.push(order.createdAt);
  return undoDecision({ created, recordUpdatedAt: item.updatedAt, batchCreatedAt, usedAt: times.sort()[0] ?? null });
}

function undoContact(tx: Writer, orgId: string, row: { action: string; recordId: string | null; beforeJson: string | null; afterJson: string | null }, batchCreatedAt: string) {
  const contactId = row.recordId;
  if (!contactId) return;
  if (row.action === "create") {
    const leadId = (JSON.parse(row.afterJson || "{}") as { leadId?: string | null }).leadId;
    if (leadId) tx.delete(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId))).run();
    tx.delete(contacts).where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId))).run();
    return;
  }
  const before = JSON.parse(row.beforeJson || "{}") as ContactSnapshot;
  tx.update(contacts)
    .set({ ...before, updatedAt: batchCreatedAt })
    .where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId)))
    .run();
}

function undoItem(tx: Writer, orgId: string, row: { action: string; recordId: string | null; beforeJson: string | null }, batchCreatedAt: string) {
  const itemId = row.recordId;
  if (!itemId) return;
  if (row.action === "create") {
    tx.delete(priceBookItems).where(and(eq(priceBookItems.id, itemId), eq(priceBookItems.orgId, orgId))).run();
    return;
  }
  const before = JSON.parse(row.beforeJson || "{}") as ItemSnapshot;
  tx.update(priceBookItems)
    .set({ ...before, updatedAt: batchCreatedAt })
    .where(and(eq(priceBookItems.id, itemId), eq(priceBookItems.orgId, orgId)))
    .run();
}

function contactSnapshot(row: { name: string; company: string | null; email: string | null; phone: string | null; address: string | null; city: string | null; state: string | null; zip: string | null; notes: string | null; type: string }): ContactSnapshot {
  return {
    name: row.name,
    company: row.company,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    notes: row.notes,
    type: row.type,
  };
}

function snapshotFromDraft(draft: ContactDraft): ContactSnapshot {
  return {
    name: draft.name,
    company: draft.company,
    email: draft.email,
    phone: draft.phone,
    address: draft.address,
    city: draft.city,
    state: draft.state,
    zip: draft.zip,
    notes: draft.notes,
    type: draft.type,
  };
}

function itemSnapshot(row: { code: string; name: string; category: string; unit: string; unitCostCents: number; defaultMarkupBps: number }): ItemSnapshot {
  return {
    code: row.code,
    name: row.name,
    category: row.category,
    unit: row.unit,
    unitCostCents: row.unitCostCents,
    defaultMarkupBps: row.defaultMarkupBps,
  };
}

function itemSnapshotFromDraft(draft: ItemDraft): ItemSnapshot {
  return {
    code: draft.code,
    name: draft.name,
    category: draft.category,
    unit: draft.unit,
    unitCostCents: draft.unitCostCents,
    defaultMarkupBps: draft.defaultMarkupBps,
  };
}
