import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb } from "@/lib/db/client";
import {
  auditLogs,
  contacts,
  costReceiptSplits,
  costReceipts,
  documents,
  memberships,
  organizations,
  priceBookItems,
  projects,
  purchaseOrders,
  users,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { positiveMoneyError } from "@/lib/money";
import { canManageMoney, type Role } from "@/lib/permissions";
import {
  cleanSplits,
  duplicateOf,
  isPayMethod,
  isUncodedStale,
  payLabel,
  reimbursementTotals,
  splitSumError,
  statusLabel,
  type PayMethod,
  type ReceiptStatus,
  type SplitLine,
} from "@/lib/receipts/inbox";
import { photoExtension, photoUploadError, rasterImageType } from "@/lib/security";
import { createBill } from "@/lib/services/bills";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { addCost } from "@/lib/services/write";
import { localDay } from "@/lib/time/calendar";

const STATUSES = new Set(["new", "coded", "posted", "rejected"]);

export type ReceiptListRow = {
  id: string;
  vendorName: string;
  purchasedOn: string | null;
  amountCents: number;
  payMethod: PayMethod;
  payLabel: string;
  status: ReceiptStatus;
  statusLabel: string;
  projectId: string | null;
  projectName: string | null;
  submittedBy: string;
  submitterName: string;
  duplicateId: string | null;
  note: string | null;
  rejectNote: string | null;
  createdAt: string;
  reimbursedAt: string | null;
  reimbursedBy: string | null;
  billId: string | null;
};

export type ReceiptSplitView = SplitLine & { id: string; costItemId: string | null };

function roleOf(actor: Actor): Role {
  return actor.role;
}

function assertSubmit(actor: Actor) {
  if (roleOf(actor) === "viewer") throw new ServiceError("Your role cannot submit a receipt.");
}

function assertOffice(actor: Actor) {
  if (!canManageMoney(roleOf(actor))) throw new ServiceError("Receipts are coded in the office.");
}

function orgToday(orgId: string) {
  const org = getDb().select().from(organizations).where(eq(organizations.id, orgId)).get();
  const timeZone = org?.timeZone || "America/New_York";
  return { today: localDay(Date.now(), timeZone), timeZone };
}

function validDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function loadRows(orgId: string) {
  return getDb().select().from(costReceipts).where(eq(costReceipts.orgId, orgId)).all();
}

function namesFor(orgId: string) {
  const db = getDb();
  const people = db
    .select({ userId: memberships.userId, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all();
  const jobs = db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, orgId)).all();
  return {
    people: new Map(people.map((row) => [row.userId, row.name])),
    jobs: new Map(jobs.map((row) => [row.id, row.name])),
  };
}

function toList(orgId: string, rows: ReturnType<typeof loadRows>, visibleIds: Set<string>): ReceiptListRow[] {
  const names = namesFor(orgId);
  const dupSource = rows.map((row) => ({
    id: row.id,
    vendorName: row.vendorName,
    amountCents: row.amountCents,
    purchasedOn: row.purchasedOn,
    photoHash: row.photoHash,
  }));
  return rows
    .filter((row) => visibleIds.has(row.id))
    .map((row) => {
      const other = duplicateOf(dupSource, row.id);
      const status = (STATUSES.has(row.status) ? row.status : "new") as ReceiptStatus;
      const payMethod = (isPayMethod(row.payMethod) ? row.payMethod : "cash") as PayMethod;
      return {
        id: row.id,
        vendorName: row.vendorName,
        purchasedOn: row.purchasedOn,
        amountCents: row.amountCents,
        payMethod,
        payLabel: payLabel(payMethod),
        status,
        statusLabel: statusLabel(status),
        projectId: row.projectId,
        projectName: row.projectId ? (names.jobs.get(row.projectId) ?? null) : null,
        submittedBy: row.submittedBy,
        submitterName: names.people.get(row.submittedBy) ?? "Crew",
        duplicateId: other && visibleIds.has(other) ? other : null,
        note: row.note,
        rejectNote: row.rejectNote,
        createdAt: row.createdAt,
        reimbursedAt: row.reimbursedAt,
        reimbursedBy: row.reimbursedBy,
        billId: row.billId,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

function visibleRows(actor: Actor) {
  const rows = loadRows(actor.orgId);
  if (roleOf(actor) === "field") return rows.filter((row) => row.submittedBy === actor.userId);
  return rows;
}

export function listCostReceipts(actor: Actor, status?: string | null): ReceiptListRow[] {
  const rows = visibleRows(actor);
  const listed = toList(actor.orgId, loadRows(actor.orgId), new Set(rows.map((row) => row.id)));
  if (!status || status === "all" || !STATUSES.has(status)) return listed;
  return listed.filter((row) => row.status === status);
}

export function receiptAttention(actor: Actor): { count: number; href: string | null } {
  const { today, timeZone } = orgToday(actor.orgId);
  const count = visibleRows(actor).filter((row) => isUncodedStale(row.status, localDay(Date.parse(row.createdAt), timeZone), today)).length;
  return { count, href: count > 0 ? "/receipts?status=new" : null };
}

function requireReceipt(actor: Actor, receiptId: string) {
  const row = getDb()
    .select()
    .from(costReceipts)
    .where(and(eq(costReceipts.id, receiptId), eq(costReceipts.orgId, actor.orgId)))
    .get();
  if (!row) throw new ServiceError("Receipt not found.");
  if (roleOf(actor) === "field" && row.submittedBy !== actor.userId) throw new ServiceError("Receipt not found.");
  return row;
}

function splitsFor(orgId: string, receiptId: string) {
  return getDb()
    .select()
    .from(costReceiptSplits)
    .where(and(eq(costReceiptSplits.orgId, orgId), eq(costReceiptSplits.receiptId, receiptId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

export function costReceiptDetail(actor: Actor, receiptId: string) {
  const row = requireReceipt(actor, receiptId);
  const listed = toList(actor.orgId, loadRows(actor.orgId), new Set(visibleRows(actor).map((item) => item.id))).find((item) => item.id === row.id);
  if (!listed) throw new ServiceError("Receipt not found.");
  const splits: ReceiptSplitView[] = splitsFor(actor.orgId, row.id).map((split) => ({
    id: split.id,
    costCode: split.costCode,
    amountCents: split.amountCents,
    costItemId: split.costItemId,
  }));
  const reimbursedByName = row.reimbursedBy ? (namesFor(actor.orgId).people.get(row.reimbursedBy) ?? null) : null;
  return {
    ...listed,
    splits,
    vendorContactId: row.vendorContactId,
    purchaseOrderId: row.purchaseOrderId,
    reimbursedByName,
    canCode: canManageMoney(roleOf(actor)),
  };
}

export function receiptJobs(orgId: string) {
  return getDb()
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function receiptCodes(orgId: string) {
  return getDb()
    .select({ code: priceBookItems.code })
    .from(priceBookItems)
    .where(eq(priceBookItems.orgId, orgId))
    .all()
    .map((row) => row.code)
    .filter((code, index, all) => code && all.indexOf(code) === index)
    .sort();
}

export function receiptOptions(actor: Actor) {
  if (!canManageMoney(roleOf(actor))) return { vendors: [] as { id: string; label: string }[], orders: [] as { id: string; projectId: string; label: string }[] };
  const db = getDb();
  const vendors = db
    .select()
    .from(contacts)
    .where(eq(contacts.orgId, actor.orgId))
    .all()
    .filter((contact) => contact.type === "vendor" || contact.type === "sub")
    .map((contact) => ({ id: contact.id, label: contact.company || contact.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const orders = db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.orgId, actor.orgId))
    .all()
    .filter((order) => order.status === "issued" || order.status === "closed")
    .map((order) => ({ id: order.id, projectId: order.projectId, label: order.number }));
  return { vendors, orders };
}

function requireProject(orgId: string, projectId: string) {
  const project = getDb().select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
  if (!project) throw new ServiceError("Job not found.");
  return project;
}

function storePhoto(actor: Actor, projectId: string | null, filename: string, bytes: Buffer) {
  const error = photoUploadError(filename, bytes);
  if (error) throw new ServiceError(error);
  const type = rasterImageType(bytes);
  if (!type) throw new ServiceError("Use a JPEG, PNG, or WebP photo.");
  const db = getDb();
  const documentId = id("doc");
  const ext = photoExtension(type);
  const relative = path.join("uploads", actor.orgId, `${documentId}.${ext}`);
  const absolute = path.join(dataDir(), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, bytes);
  const stem = path.basename(filename).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80);
  db.insert(documents)
    .values({
      id: documentId,
      orgId: actor.orgId,
      projectId,
      leadId: null,
      contactId: null,
      type: "cost_receipt",
      filename: `${stem || "receipt"}.${ext}`,
      storagePath: relative,
      metadataJson: null,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy: actor.userId,
    })
    .run();
  return { documentId, hash: createHash("sha256").update(bytes).digest("hex") };
}

function audit(actor: Actor, action: string, receiptId: string, payload: Record<string, unknown>) {
  getDb()
    .insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action,
      entityType: "cost_receipt",
      entityId: receiptId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

export function submitCostReceipt(
  actor: Actor,
  input: {
    filename: string;
    bytes: Buffer;
    projectId?: string | null;
    vendorName: string;
    purchasedOn: string;
    amountCents: number;
    costCode?: string | null;
    note?: string | null;
    payMethod: string;
  },
) {
  assertSubmit(actor);
  const vendorName = input.vendorName.trim();
  if (!vendorName) throw new ServiceError("Enter the store.");
  if (!validDay(input.purchasedOn)) throw new ServiceError("Enter the date.");
  const amountError = positiveMoneyError(input.amountCents);
  if (amountError) throw new ServiceError(amountError);
  if (!isPayMethod(input.payMethod)) throw new ServiceError("Choose how it was paid.");
  const projectId = input.projectId?.trim() || null;
  if (projectId) requireProject(actor.orgId, projectId);
  const costCode = input.costCode?.trim() || "";
  const note = input.note?.trim() || "";
  if (note.length > 500) throw new ServiceError("Keep the note under 500 characters.");
  const photo = storePhoto(actor, projectId, input.filename, input.bytes);
  const status: ReceiptStatus = projectId && costCode ? "coded" : "new";
  const now = nowIso();
  const receiptId = id("cr");
  const db = getDb();
  const existing = loadRows(actor.orgId).map((row) => ({
    id: row.id,
    vendorName: row.vendorName,
    amountCents: row.amountCents,
    purchasedOn: row.purchasedOn,
    photoHash: row.photoHash,
  }));
  const duplicateId = duplicateOf(
    [...existing, { id: receiptId, vendorName, amountCents: input.amountCents, purchasedOn: input.purchasedOn, photoHash: photo.hash }],
    receiptId,
  );
  db.insert(costReceipts)
    .values({
      id: receiptId,
      orgId: actor.orgId,
      projectId,
      submittedBy: actor.userId,
      vendorName,
      purchasedOn: input.purchasedOn,
      amountCents: input.amountCents,
      note: note || null,
      payMethod: input.payMethod,
      status,
      photoDocumentId: photo.documentId,
      photoHash: photo.hash,
      rejectNote: null,
      vendorContactId: null,
      purchaseOrderId: null,
      billId: null,
      postedAt: null,
      rejectedAt: null,
      reimbursedAt: null,
      reimbursedBy: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  if (status === "coded") {
    db.insert(costReceiptSplits)
      .values({
        id: id("crs"),
        orgId: actor.orgId,
        receiptId,
        costCode,
        amountCents: input.amountCents,
        costItemId: null,
        sortOrder: 0,
      })
      .run();
  }
  return { id: receiptId, status, duplicateId };
}

function replaceSplits(orgId: string, receiptId: string, lines: SplitLine[]) {
  const db = getDb();
  db.delete(costReceiptSplits).where(and(eq(costReceiptSplits.orgId, orgId), eq(costReceiptSplits.receiptId, receiptId))).run();
  lines.forEach((line, index) => {
    db.insert(costReceiptSplits)
      .values({
        id: id("crs"),
        orgId,
        receiptId,
        costCode: line.costCode,
        amountCents: line.amountCents,
        costItemId: null,
        sortOrder: index,
      })
      .run();
  });
}

function resolveVendor(actor: Actor, projectId: string, vendorContactId: string | null, purchaseOrderId: string | null) {
  const db = getDb();
  let vendorId = vendorContactId;
  let orderId = purchaseOrderId;
  if (orderId) {
    const order = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, orderId), eq(purchaseOrders.orgId, actor.orgId))).get();
    if (!order || order.projectId !== projectId) throw new ServiceError("That purchase order is not on this job.");
    if (vendorId && vendorId !== order.vendorContactId) throw new ServiceError("That purchase order is for a different vendor.");
    vendorId = order.vendorContactId;
  }
  if (vendorId) {
    const vendor = db.select().from(contacts).where(and(eq(contacts.id, vendorId), eq(contacts.orgId, actor.orgId))).get();
    if (!vendor || (vendor.type !== "vendor" && vendor.type !== "sub")) throw new ServiceError("Choose a vendor.");
  }
  if (!vendorId) orderId = null;
  return { vendorContactId: vendorId, purchaseOrderId: vendorId ? orderId : null };
}

export function codeCostReceipt(
  actor: Actor,
  receiptId: string,
  input: {
    projectId: string;
    vendorName: string;
    purchasedOn: string;
    amountCents: number;
    note?: string | null;
    splits: SplitLine[];
    vendorContactId?: string | null;
    purchaseOrderId?: string | null;
  },
) {
  assertOffice(actor);
  const row = requireReceipt(actor, receiptId);
  if (row.status === "posted" || row.status === "rejected") throw new ServiceError("That receipt is already closed.");
  const vendorName = input.vendorName.trim();
  if (!vendorName) throw new ServiceError("Enter the store.");
  if (!validDay(input.purchasedOn)) throw new ServiceError("Enter the date.");
  const amountError = positiveMoneyError(input.amountCents);
  if (amountError) throw new ServiceError(amountError);
  const project = requireProject(actor.orgId, input.projectId);
  const splits = cleanSplits(input.splits);
  const sumError = splitSumError(input.amountCents, splits);
  if (sumError) throw new ServiceError(sumError);
  const linked = resolveVendor(actor, project.id, input.vendorContactId?.trim() || null, input.purchaseOrderId?.trim() || null);
  const note = input.note?.trim() || "";
  if (note.length > 500) throw new ServiceError("Keep the note under 500 characters.");
  const now = nowIso();
  getDb()
    .update(costReceipts)
    .set({
      projectId: project.id,
      vendorName,
      purchasedOn: input.purchasedOn,
      amountCents: input.amountCents,
      note: note || null,
      status: "coded",
      vendorContactId: linked.vendorContactId,
      purchaseOrderId: linked.purchaseOrderId,
      updatedAt: now,
    })
    .where(and(eq(costReceipts.id, row.id), eq(costReceipts.orgId, actor.orgId)))
    .run();
  replaceSplits(actor.orgId, row.id, splits);
  if (row.photoDocumentId) {
    getDb()
      .update(documents)
      .set({ projectId: project.id })
      .where(and(eq(documents.id, row.photoDocumentId), eq(documents.orgId, actor.orgId)))
      .run();
  }
  return { id: row.id, status: "coded" as const };
}

export function postCostReceipt(actor: Actor, receiptId: string) {
  assertOffice(actor);
  const row = requireReceipt(actor, receiptId);
  if (row.status === "posted") throw new ServiceError("That receipt is already posted.");
  if (row.status !== "coded" || !row.projectId) throw new ServiceError("Code the receipt first.");
  const splits = splitsFor(actor.orgId, row.id).map((split) => ({ costCode: split.costCode, amountCents: split.amountCents, id: split.id }));
  const sumError = splitSumError(row.amountCents, splits);
  if (sumError) throw new ServiceError(sumError);
  const project = requireProject(actor.orgId, row.projectId);
  const now = nowIso();
  let billId: string | null = null;
  if (row.vendorContactId || row.purchaseOrderId) {
    const linked = resolveVendor(actor, project.id, row.vendorContactId, row.purchaseOrderId);
    if (!linked.vendorContactId) throw new ServiceError("Choose a vendor.");
    if (row.photoDocumentId) {
      getDb()
        .update(documents)
        .set({ projectId: project.id })
        .where(and(eq(documents.id, row.photoDocumentId), eq(documents.orgId, actor.orgId)))
        .run();
    }
    const created = createBill(actor, {
      projectId: project.id,
      vendorContactId: linked.vendorContactId,
      purchaseOrderId: linked.purchaseOrderId,
      billNumber: `CR${row.id.replace(/[^a-z0-9]/gi, "").slice(-12)}`,
      billDate: row.purchasedOn || orgToday(actor.orgId).today,
      dueDate: row.purchasedOn || orgToday(actor.orgId).today,
      memo: row.note || row.vendorName,
      documentId: row.photoDocumentId,
      lines: splits.map((split) => ({ costCode: split.costCode, amountCents: split.amountCents, description: row.vendorName })),
    });
    billId = created.id;
  } else {
    const memo = [row.note, payLabel(row.payMethod)].filter(Boolean).join(" · ");
    splits.forEach((split) => {
      const posted = addCost(actor, project.id, {
        amountCents: split.amountCents,
        vendorName: row.vendorName,
        costCode: split.costCode,
        memo,
        source: "receipt",
        documentId: row.photoDocumentId || undefined,
      });
      getDb()
        .update(costReceiptSplits)
        .set({ costItemId: posted.costId })
        .where(and(eq(costReceiptSplits.id, split.id), eq(costReceiptSplits.orgId, actor.orgId)))
        .run();
    });
  }
  getDb()
    .update(costReceipts)
    .set({ status: "posted", postedAt: now, billId, updatedAt: now })
    .where(and(eq(costReceipts.id, row.id), eq(costReceipts.orgId, actor.orgId)))
    .run();
  audit(actor, "receipt.post", row.id, { amountCents: row.amountCents, payMethod: row.payMethod, billId, splits: splits.length });
  return { id: row.id, billId };
}

export function rejectCostReceipt(actor: Actor, receiptId: string, note: string) {
  assertOffice(actor);
  const row = requireReceipt(actor, receiptId);
  if (row.status === "posted") throw new ServiceError("A posted receipt stays on the job.");
  if (row.status === "rejected") throw new ServiceError("That receipt is already rejected.");
  const rejectNote = note.trim();
  if (!rejectNote) throw new ServiceError("Add a note.");
  if (rejectNote.length > 500) throw new ServiceError("Keep the note under 500 characters.");
  const now = nowIso();
  getDb()
    .update(costReceipts)
    .set({ status: "rejected", rejectNote, rejectedAt: now, updatedAt: now })
    .where(and(eq(costReceipts.id, row.id), eq(costReceipts.orgId, actor.orgId)))
    .run();
  audit(actor, "receipt.reject", row.id, { rejectNote });
  return { id: row.id };
}

export function markReceiptReimbursed(actor: Actor, receiptId: string) {
  assertOffice(actor);
  const row = requireReceipt(actor, receiptId);
  if (row.payMethod !== "personal" || row.status !== "posted" || row.reimbursedAt) {
    throw new ServiceError("That receipt is not waiting on reimbursement.");
  }
  const now = nowIso();
  getDb()
    .update(costReceipts)
    .set({ reimbursedAt: now, reimbursedBy: actor.userId, updatedAt: now })
    .where(and(eq(costReceipts.id, row.id), eq(costReceipts.orgId, actor.orgId)))
    .run();
  audit(actor, "receipt.reimburse", row.id, { reimbursedAt: now });
  return { id: row.id, reimbursedAt: now };
}

export type ReimbursementLine = ReceiptListRow & { reimbursedByName: string | null };

export function reimbursementBoard(actor: Actor) {
  const names = namesFor(actor.orgId);
  const rows = listCostReceipts(actor).filter((row) => row.payMethod === "personal" && row.status === "posted");
  const lines: ReimbursementLine[] = rows.map((row) => ({
    ...row,
    reimbursedByName: row.reimbursedBy ? (names.people.get(row.reimbursedBy) ?? null) : null,
  }));
  const totals = reimbursementTotals(
    lines.map((row) => ({
      userId: row.submittedBy,
      name: row.submitterName,
      payMethod: row.payMethod,
      status: row.status,
      amountCents: row.amountCents,
      reimbursedAt: row.reimbursedAt,
    })),
  );
  return {
    lines,
    totals,
    openCents: totals.reduce((sum, row) => sum + row.openCents, 0),
    canMark: canManageMoney(roleOf(actor)),
  };
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

export function reimbursementCsv(actor: Actor) {
  const board = reimbursementBoard(actor);
  const header = ["Person", "Store", "Job", "Date", "Amount", "Status", "Reimbursed"];
  const body = board.lines.map((row) =>
    [
      row.submitterName,
      row.vendorName,
      row.projectName ?? "",
      row.purchasedOn ?? "",
      (row.amountCents / 100).toFixed(2),
      row.reimbursedAt ? "Reimbursed" : "Open",
      row.reimbursedAt ? row.reimbursedAt.slice(0, 10) : "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...body].join("\n");
}
