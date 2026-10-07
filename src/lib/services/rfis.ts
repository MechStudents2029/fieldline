import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  bidInvites,
  bidRequests,
  changeOrders,
  contacts,
  documents,
  memberships,
  organizations,
  projects,
  punchItems,
  purchaseOrders,
  rfiAttempts,
  rfiFiles,
  rfiMessages,
  rfis,
  scheduleItems,
  selections,
  users,
  vendorPortals,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { IP_WINDOW_MS, ORG_WINDOW_MS, rateLimitError } from "@/lib/lead-form/rules";
import { MAX_MONEY_CENTS } from "@/lib/money";
import { canAddFieldNotes, canEditCrm, canEditSchedule, canManageMoney, canSeeMoney, type Role } from "@/lib/permissions";
import { ageDays, impactText, isOverdueRfi, nextRfiNumber, RFI_STATUS_LABEL, rfiLabel } from "@/lib/rfis/format";
import { shiftSpan } from "@/lib/schedule/range";
import { photoExtension, photoUploadError, rasterImageType } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { createChangeOrder } from "@/lib/services/write";
import { addCalendarDays, localDay } from "@/lib/time/calendar";
import { hashVendorToken, vendorTokenMatches } from "@/lib/vendor/token";

const RELATED = ["schedule", "selection", "purchase_order", "bid", "punch", "change_order"] as const;
type RelatedType = (typeof RELATED)[number];
const VENDOR_TYPES = new Set(["sub", "vendor"]);

export type RfiUpload = { filename: string; bytes: Buffer };

export type RfiFileView = { id: string; filename: string };

export type RfiMessageView = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  files: RfiFileView[];
};

export type RfiListItem = {
  id: string;
  number: number;
  label: string;
  title: string;
  assigneeName: string;
  assigneeKind: string;
  dueOn: string | null;
  ageDays: number;
  status: string;
  statusLabel: string;
  overdue: boolean;
  impact: string;
  relatedType: string | null;
  relatedId: string | null;
  relatedLabel: string | null;
  href: string;
};

export type JobRfiBoard = {
  projectId: string;
  projectName: string;
  today: string;
  showMoney: boolean;
  canAdd: boolean;
  canClose: boolean;
  items: RfiListItem[];
  assignees: { value: string; label: string }[];
  related: { value: string; label: string }[];
};

export type RfiDetail = RfiListItem & {
  question: string;
  internalNote: string | null;
  showMoney: boolean;
  canAnswer: boolean;
  canClose: boolean;
  canDraft: boolean;
  canShift: boolean;
  costImpact: boolean;
  costCents: number | null;
  scheduleImpactDays: number | null;
  changeOrderId: string | null;
  changeOrderLabel: string | null;
  messages: RfiMessageView[];
  files: RfiFileView[];
};

export type PortalRfi = {
  id: string;
  label: string;
  title: string;
  question: string;
  job: string;
  dueOn: string | null;
  status: string;
  statusLabel: string;
  related: string | null;
  canAnswer: boolean;
  messages: RfiMessageView[];
  files: RfiFileView[];
};

export type RfiPrint = {
  orgName: string;
  projectName: string;
  address: string | null;
  today: string;
  showMoney: boolean;
  items: RfiListItem[];
};

type RfiRow = typeof rfis.$inferSelect;

function dbFor(actor: Actor): AppDatabase {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("That job is not in your company.");
  return db;
}

function role(actor: Actor): Role {
  return actor.role as Role;
}

function cleanText(value: string | null | undefined, max: number, label: string, required: boolean): string {
  const text = (value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  if (required && !text) throw new ServiceError(`Add a ${label}.`);
  if (text.length > max) throw new ServiceError(`${label} is too long.`);
  return text;
}

function cleanDate(value: string | null | undefined, required: boolean): string | null {
  const text = (value ?? "").trim();
  if (!text) {
    if (required) throw new ServiceError("Add a due date.");
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ServiceError("Use a date.");
  return text;
}

function cleanDays(value: number | null | undefined): number | null {
  if (value == null || value === 0) return null;
  if (!Number.isInteger(value) || value < -60 || value > 60) throw new ServiceError("Schedule days must be a whole number.");
  return value;
}

function cleanCents(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0 || value > MAX_MONEY_CENTS) throw new ServiceError("Enter a cost.");
  return value;
}

function writeAudit(tx: AppDatabase, orgId: string, actorId: string | null, action: string, entityId: string, payload: Record<string, unknown> | null, ip?: string) {
  tx.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "rfi",
      entityId,
      payloadJson: payload ? JSON.stringify(payload) : null,
      ip: ip ?? null,
      createdAt: nowIso(),
    })
    .run();
}

function orgRow(db: AppDatabase, orgId: string) {
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) throw new ServiceError("Company not found.");
  return org;
}

function todayFor(db: AppDatabase, orgId: string) {
  return localDay(Date.now(), orgRow(db, orgId).timeZone);
}

function projectIn(db: AppDatabase, orgId: string, projectId: string) {
  return db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
}

function memberName(db: AppDatabase, orgId: string, userId: string): string | null {
  const row = db
    .select({ name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .get();
  return row?.name ?? null;
}

function loadContact(db: AppDatabase, orgId: string, contactId: string) {
  const row = db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId))).get();
  if (!row || row.deletedAt) return null;
  return row;
}

function vendorsOnJob(db: AppDatabase, orgId: string, projectId: string): Map<string, string> {
  const ids = new Set<string>();
  for (const row of db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.projectId, projectId))).all()) {
    if (row.vendorContactId) ids.add(row.vendorContactId);
  }
  for (const row of db.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.projectId, projectId))).all()) {
    ids.add(row.vendorContactId);
  }
  for (const row of db.select().from(punchItems).where(and(eq(punchItems.orgId, orgId), eq(punchItems.projectId, projectId))).all()) {
    if (row.assigneeContactId) ids.add(row.assigneeContactId);
  }
  const bids = db.select().from(bidRequests).where(and(eq(bidRequests.orgId, orgId), eq(bidRequests.projectId, projectId))).all();
  const bidIds = new Set(bids.map((row) => row.id));
  for (const row of db.select().from(bidInvites).where(eq(bidInvites.orgId, orgId)).all()) {
    if (bidIds.has(row.bidId)) ids.add(row.contactId);
  }
  const names = new Map<string, string>();
  for (const contactId of ids) {
    const contact = loadContact(db, orgId, contactId);
    if (!contact || !VENDOR_TYPES.has(contact.type)) continue;
    names.set(contact.id, contact.company?.trim() || contact.name);
  }
  return names;
}

function relatedLabel(db: AppDatabase, orgId: string, projectId: string, type: string | null, relatedId: string | null): string | null {
  if (!type || !relatedId) return null;
  if (type === "schedule") {
    const row = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.id, relatedId), eq(scheduleItems.projectId, projectId))).get();
    return row ? row.title : null;
  }
  if (type === "selection") {
    const row = db.select().from(selections).where(and(eq(selections.orgId, orgId), eq(selections.id, relatedId), eq(selections.projectId, projectId))).get();
    return row ? row.title : null;
  }
  if (type === "purchase_order") {
    const row = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.id, relatedId), eq(purchaseOrders.projectId, projectId))).get();
    return row ? row.number : null;
  }
  if (type === "bid") {
    const row = db.select().from(bidRequests).where(and(eq(bidRequests.orgId, orgId), eq(bidRequests.id, relatedId), eq(bidRequests.projectId, projectId))).get();
    return row ? row.title : null;
  }
  if (type === "punch") {
    const row = db.select().from(punchItems).where(and(eq(punchItems.orgId, orgId), eq(punchItems.id, relatedId), eq(punchItems.projectId, projectId))).get();
    return row ? row.title : null;
  }
  if (type === "change_order") {
    const row = db.select().from(changeOrders).where(and(eq(changeOrders.orgId, orgId), eq(changeOrders.id, relatedId), eq(changeOrders.projectId, projectId))).get();
    return row ? `CO ${row.number}` : null;
  }
  return null;
}

function assertRelated(db: AppDatabase, orgId: string, projectId: string, type: string | null, relatedId: string | null) {
  if (!type && !relatedId) return { type: null as string | null, id: null as string | null };
  if (!type || !relatedId || !(RELATED as readonly string[]).includes(type)) throw new ServiceError("Pick a related item.");
  if (!relatedLabel(db, orgId, projectId, type, relatedId)) throw new ServiceError("That item is not on this job.");
  return { type, id: relatedId };
}

function assigneeName(db: AppDatabase, orgId: string, row: { assigneeKind: string; assigneeUserId: string | null; assigneeContactId: string | null }): string {
  if (row.assigneeKind === "user" && row.assigneeUserId) return memberName(db, orgId, row.assigneeUserId) ?? "Crew";
  if (row.assigneeContactId) {
    const contact = loadContact(db, orgId, row.assigneeContactId);
    if (!contact) return "Assignee";
    return row.assigneeKind === "vendor" ? contact.company?.trim() || contact.name : contact.name;
  }
  return "Assignee";
}

function fileMap(db: AppDatabase, orgId: string, rfiIds: string[]) {
  const files = rfiIds.length ? db.select().from(rfiFiles).where(eq(rfiFiles.orgId, orgId)).all().filter((row) => rfiIds.includes(row.rfiId)) : [];
  const docIds = [...new Set(files.map((row) => row.documentId))];
  const docs = docIds.length ? db.select().from(documents).where(eq(documents.orgId, orgId)).all().filter((row) => docIds.includes(row.id) && !row.deletedAt) : [];
  const names = new Map(docs.map((row) => [row.id, row.filename]));
  return files
    .filter((row) => names.has(row.documentId))
    .map((row) => ({ rfiId: row.rfiId, messageId: row.messageId, id: row.documentId, filename: names.get(row.documentId) ?? "file" }));
}

function listItem(db: AppDatabase, orgId: string, row: RfiRow, today: string, showMoney: boolean): RfiListItem {
  const createdDay = localDay(Date.parse(row.createdAt), orgRow(db, orgId).timeZone);
  return {
    id: row.id,
    number: row.number,
    label: rfiLabel(row.number),
    title: row.title,
    assigneeName: assigneeName(db, orgId, row),
    assigneeKind: row.assigneeKind,
    dueOn: row.dueOn,
    ageDays: ageDays(createdDay, today),
    status: row.status,
    statusLabel: RFI_STATUS_LABEL[row.status] ?? row.status,
    overdue: isOverdueRfi(row.status, row.dueOn, today),
    impact: impactText({
      costImpact: row.costImpact === 1,
      costImpactCents: showMoney ? row.costImpactCents : null,
      scheduleImpactDays: row.scheduleImpactDays,
      showMoney,
    }),
    relatedType: row.relatedType,
    relatedId: row.relatedId,
    relatedLabel: relatedLabel(db, orgId, row.projectId, row.relatedType, row.relatedId),
    href: `/projects/${row.projectId}/rfis/${row.id}`,
  };
}

function storeFile(db: AppDatabase, orgId: string, projectId: string, upload: RfiUpload, createdBy: string | null, contactId: string | null) {
  const error = photoUploadError(upload.filename, upload.bytes);
  if (error) throw new ServiceError(error);
  const type = rasterImageType(upload.bytes);
  if (!type) throw new ServiceError("Use a JPEG, PNG, or WebP photo.");
  const documentId = id("doc");
  const ext = photoExtension(type);
  const relative = path.join("uploads", orgId, `${documentId}.${ext}`);
  const absolute = path.join(dataDir(), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, upload.bytes);
  const stem = path.basename(upload.filename).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80);
  db.insert(documents)
    .values({
      id: documentId,
      orgId,
      projectId,
      leadId: null,
      contactId,
      type: "rfi",
      filename: `${stem || "file"}.${ext}`,
      storagePath: relative,
      metadataJson: null,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy,
    })
    .run();
  return documentId;
}

function attachFiles(db: AppDatabase, orgId: string, projectId: string, rfiId: string, messageId: string | null, uploads: RfiUpload[], createdBy: string | null, contactId: string | null) {
  for (const upload of uploads.slice(0, 3)) {
    const documentId = storeFile(db, orgId, projectId, upload, createdBy, contactId);
    db.insert(rfiFiles)
      .values({ id: id("rfif"), orgId, rfiId, messageId, documentId, createdAt: nowIso() })
      .run();
  }
}

export type RfiCreateInput = {
  title: string;
  question: string;
  dueOn: string;
  assignee: string;
  related: string | null;
  internalNote: string | null;
};

function parseAssignee(db: AppDatabase, orgId: string, projectId: string, value: string) {
  const project = projectIn(db, orgId, projectId);
  if (!project) throw new ServiceError("Job not found.");
  if (value === "client") {
    const contact = loadContact(db, orgId, project.contactId);
    if (!contact) throw new ServiceError("This job has no client.");
    return { kind: "client" as const, userId: null as string | null, contactId: contact.id };
  }
  const [kind, idValue] = value.split(":");
  if (kind === "user" && idValue) {
    if (!memberName(db, orgId, idValue)) throw new ServiceError("Assign someone in this company.");
    return { kind: "user" as const, userId: idValue, contactId: null as string | null };
  }
  if (kind === "vendor" && idValue) {
    const vendors = vendorsOnJob(db, orgId, projectId);
    if (!vendors.has(idValue)) throw new ServiceError("That vendor is not on this job.");
    return { kind: "vendor" as const, userId: null as string | null, contactId: idValue };
  }
  throw new ServiceError("Assign someone.");
}

function parseRelated(value: string | null) {
  const text = (value ?? "").trim();
  if (!text) return { type: null as string | null, id: null as string | null };
  const split = text.indexOf(":");
  if (split < 1) throw new ServiceError("Pick a related item.");
  return { type: text.slice(0, split), id: text.slice(split + 1) };
}

export function createRfi(actor: Actor, projectId: string, input: RfiCreateInput, files: RfiUpload[] = []) {
  if (!canAddFieldNotes(role(actor))) throw new ServiceError("Your role cannot change this.");
  const db = dbFor(actor);
  const project = projectIn(db, actor.orgId, projectId);
  if (!project) throw new ServiceError("Job not found.");
  const title = cleanText(input.title, 80, "title", true);
  const question = cleanText(input.question, 2000, "question", true);
  const dueOn = cleanDate(input.dueOn, true);
  const assignee = parseAssignee(db, actor.orgId, projectId, input.assignee.trim());
  const related = assertRelated(db, actor.orgId, projectId, parseRelated(input.related).type, parseRelated(input.related).id);
  const internal = canEditCrm(role(actor)) ? cleanText(input.internalNote, 500, "note", false) || null : null;
  const rfiId = id("rfi");
  const now = nowIso();
  db.transaction((tx) => {
    const numbers = tx
      .select({ number: rfis.number })
      .from(rfis)
      .where(and(eq(rfis.orgId, actor.orgId), eq(rfis.projectId, projectId)))
      .all();
    const number = nextRfiNumber(numbers.map((row) => row.number));
    tx.insert(rfis)
      .values({
        id: rfiId,
        orgId: actor.orgId,
        projectId,
        number,
        title,
        question,
        dueOn,
        status: "open",
        assigneeKind: assignee.kind,
        assigneeUserId: assignee.userId,
        assigneeContactId: assignee.contactId,
        relatedType: related.type,
        relatedId: related.id,
        internalNote: internal,
        costImpact: 0,
        costImpactCents: null,
        scheduleImpactDays: null,
        changeOrderId: null,
        scheduleShiftedAt: null,
        answeredAt: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    attachFiles(tx as unknown as AppDatabase, actor.orgId, projectId, rfiId, null, files, actor.userId, assignee.contactId);
    writeAudit(tx as unknown as AppDatabase, actor.orgId, actor.userId, "rfi.create", rfiId, { number, title, assignee: assignee.kind });
  });
  return rfiId;
}

function loadRfi(db: AppDatabase, orgId: string, rfiId: string) {
  const row = db.select().from(rfis).where(and(eq(rfis.id, rfiId), eq(rfis.orgId, orgId))).get();
  if (!row) throw new ServiceError("RFI not found.");
  return row;
}

function applyImpact(actor: Actor, row: RfiRow, input: { costImpact?: boolean; costImpactCents?: number | null; scheduleImpactDays?: number | null }) {
  const touched = input.costImpact != null || input.costImpactCents != null || input.scheduleImpactDays != null;
  if (!touched) return null;
  if (!canEditCrm(role(actor))) throw new ServiceError("Your role cannot change this.");
  const costImpact = Boolean(input.costImpact);
  let cents: number | null = null;
  if (costImpact) {
    if (!canManageMoney(role(actor))) throw new ServiceError("Your role cannot change this.");
    cents = cleanCents(input.costImpactCents);
    if (cents == null) throw new ServiceError("Enter a cost.");
  }
  const days = input.scheduleImpactDays == null ? row.scheduleImpactDays : cleanDays(input.scheduleImpactDays);
  if (days && !canEditSchedule(role(actor))) throw new ServiceError("Your role cannot change this.");
  return { costImpact, cents, days };
}

export function answerRfi(
  actor: Actor,
  rfiId: string,
  input: { body: string; internal?: boolean; costImpact?: boolean; costImpactCents?: number | null; scheduleImpactDays?: number | null },
  files: RfiUpload[] = [],
) {
  const db = dbFor(actor);
  const row = loadRfi(db, actor.orgId, rfiId);
  if (row.status === "closed" || row.status === "void") throw new ServiceError("This RFI is closed.");
  const internal = Boolean(input.internal);
  if (internal && !canEditCrm(role(actor))) throw new ServiceError("Your role cannot change this.");
  const isAssignee = row.assigneeKind === "user" && row.assigneeUserId === actor.userId;
  if (!internal && !isAssignee && !canEditCrm(role(actor))) throw new ServiceError("Your role cannot change this.");
  const body = cleanText(input.body, 2000, "answer", true);
  const impact = internal ? null : applyImpact(actor, row, input);
  const name = memberName(db, actor.orgId, actor.userId) ?? "Office";
  const now = nowIso();
  const messageId = id("rfim");
  db.transaction((tx) => {
    tx.insert(rfiMessages)
      .values({
        id: messageId,
        orgId: actor.orgId,
        rfiId: row.id,
        body,
        authorKind: "user",
        authorUserId: actor.userId,
        authorName: name,
        internal: internal ? 1 : 0,
        createdAt: now,
      })
      .run();
    attachFiles(tx as unknown as AppDatabase, actor.orgId, row.projectId, row.id, messageId, files, actor.userId, row.assigneeContactId);
    const patch: Partial<RfiRow> = { updatedAt: now };
    if (!internal && isAssignee && row.status === "open") {
      patch.status = "answered";
      patch.answeredAt = now;
    }
    if (impact) {
      patch.costImpact = impact.costImpact ? 1 : 0;
      patch.costImpactCents = impact.cents;
      patch.scheduleImpactDays = impact.days;
    }
    tx.update(rfis).set(patch).where(and(eq(rfis.orgId, actor.orgId), eq(rfis.id, row.id))).run();
    writeAudit(tx as unknown as AppDatabase, actor.orgId, actor.userId, internal ? "rfi.note" : "rfi.answer", row.id, { internal });
    if (impact) writeAudit(tx as unknown as AppDatabase, actor.orgId, actor.userId, "rfi.impact", row.id, { costImpact: impact.costImpact, scheduleImpactDays: impact.days });
  });
}

export function closeRfi(actor: Actor, rfiId: string, input: { costImpact?: boolean; costImpactCents?: number | null; scheduleImpactDays?: number | null }) {
  if (!canEditCrm(role(actor))) throw new ServiceError("Your role cannot change this.");
  const db = dbFor(actor);
  const row = loadRfi(db, actor.orgId, rfiId);
  if (row.status === "void" || row.status === "closed") throw new ServiceError("This RFI is closed.");
  const impact = applyImpact(actor, row, {
    costImpact: input.costImpact ?? false,
    costImpactCents: input.costImpact ? input.costImpactCents : null,
    scheduleImpactDays: input.scheduleImpactDays,
  });
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(rfis)
      .set({
        status: "closed",
        closedAt: now,
        updatedAt: now,
        costImpact: impact ? (impact.costImpact ? 1 : 0) : row.costImpact,
        costImpactCents: impact ? impact.cents : row.costImpactCents,
        scheduleImpactDays: impact ? impact.days : row.scheduleImpactDays,
      })
      .where(and(eq(rfis.orgId, actor.orgId), eq(rfis.id, row.id)))
      .run();
    writeAudit(tx as unknown as AppDatabase, actor.orgId, actor.userId, "rfi.close", row.id, {
      costImpact: impact?.costImpact ?? row.costImpact === 1,
      scheduleImpactDays: impact?.days ?? row.scheduleImpactDays,
    });
    if (impact) writeAudit(tx as unknown as AppDatabase, actor.orgId, actor.userId, "rfi.impact", row.id, { costImpact: impact.costImpact, scheduleImpactDays: impact.days });
  });
}

export function voidRfi(actor: Actor, rfiId: string) {
  if (!canEditCrm(role(actor))) throw new ServiceError("Your role cannot change this.");
  const db = dbFor(actor);
  const row = loadRfi(db, actor.orgId, rfiId);
  if (row.status === "void") throw new ServiceError("This RFI is closed.");
  const now = nowIso();
  db.update(rfis).set({ status: "void", updatedAt: now }).where(and(eq(rfis.orgId, actor.orgId), eq(rfis.id, row.id))).run();
  writeAudit(db, actor.orgId, actor.userId, "rfi.void", row.id, { number: row.number });
}

export function draftChangeFromRfi(actor: Actor, rfiId: string) {
  if (!canManageMoney(role(actor))) throw new ServiceError("Your role cannot change this.");
  const db = dbFor(actor);
  const row = loadRfi(db, actor.orgId, rfiId);
  if (row.changeOrderId) throw new ServiceError("A draft change order is already linked.");
  if (row.costImpact !== 1 || row.costImpactCents == null || row.costImpactCents <= 0) throw new ServiceError("Set a cost before drafting a change order.");
  const created = createChangeOrder(actor, row.projectId, {
    title: row.title,
    description: row.question,
    name: row.title,
    qty: 1,
    unit: "ea",
    unitCostCents: row.costImpactCents,
    markupBps: 0,
  });
  db.update(rfis)
    .set({ changeOrderId: created.changeOrderId, updatedAt: nowIso() })
    .where(and(eq(rfis.orgId, actor.orgId), eq(rfis.id, row.id)))
    .run();
  writeAudit(db, actor.orgId, actor.userId, "rfi.impact", row.id, { changeOrderId: created.changeOrderId, costImpactCents: row.costImpactCents });
  return created.changeOrderId;
}

export function shiftRfiSchedule(actor: Actor, rfiId: string) {
  if (!canEditSchedule(role(actor))) throw new ServiceError("Your role cannot change this.");
  const db = dbFor(actor);
  const row = loadRfi(db, actor.orgId, rfiId);
  if (row.relatedType !== "schedule" || !row.relatedId) throw new ServiceError("Link a schedule item before shifting it.");
  if (!row.scheduleImpactDays) throw new ServiceError("Set the schedule days first.");
  if (row.scheduleShiftedAt) throw new ServiceError("That shift is already on the schedule.");
  const item = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, row.relatedId), eq(scheduleItems.projectId, row.projectId)))
    .get();
  if (!item) throw new ServiceError("That item is not on this job.");
  const next = shiftSpan(item.startDate, item.endDate, addCalendarDays(item.startDate, row.scheduleImpactDays));
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(scheduleItems)
      .set({ startDate: next.startDate, endDate: next.endDate, updatedAt: now })
      .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.id, item.id)))
      .run();
    tx.update(rfis).set({ scheduleShiftedAt: now, updatedAt: now }).where(and(eq(rfis.orgId, actor.orgId), eq(rfis.id, row.id))).run();
    writeAudit(tx as unknown as AppDatabase, actor.orgId, actor.userId, "rfi.impact", row.id, {
      scheduleItemId: item.id,
      days: row.scheduleImpactDays,
      before: { startDate: item.startDate, endDate: item.endDate },
      after: next,
    });
  });
  return next;
}

function rowsFor(db: AppDatabase, orgId: string, projectId?: string) {
  return db
    .select()
    .from(rfis)
    .where(projectId ? and(eq(rfis.orgId, orgId), eq(rfis.projectId, projectId)) : eq(rfis.orgId, orgId))
    .all()
    .sort((a, b) => a.number - b.number || a.createdAt.localeCompare(b.createdAt));
}

function choiceLists(db: AppDatabase, orgId: string, projectId: string) {
  const project = projectIn(db, orgId, projectId);
  const client = project ? loadContact(db, orgId, project.contactId) : null;
  const people = db
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const assignees = [
    ...people.map((person) => ({ value: `user:${person.id}`, label: person.name })),
    ...[...vendorsOnJob(db, orgId, projectId).entries()].map(([contactId, label]) => ({ value: `vendor:${contactId}`, label })).sort((a, b) => a.label.localeCompare(b.label)),
    ...(client ? [{ value: "client", label: client.name }] : []),
  ];
  const related = [
    ...db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.projectId, projectId))).all().map((row) => ({ value: `schedule:${row.id}`, label: row.title })),
    ...db.select().from(selections).where(and(eq(selections.orgId, orgId), eq(selections.projectId, projectId))).all().map((row) => ({ value: `selection:${row.id}`, label: row.title })),
    ...db.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.projectId, projectId))).all().map((row) => ({ value: `purchase_order:${row.id}`, label: row.number })),
    ...db.select().from(bidRequests).where(and(eq(bidRequests.orgId, orgId), eq(bidRequests.projectId, projectId))).all().map((row) => ({ value: `bid:${row.id}`, label: row.title })),
    ...db.select().from(punchItems).where(and(eq(punchItems.orgId, orgId), eq(punchItems.projectId, projectId))).all().map((row) => ({ value: `punch:${row.id}`, label: row.title })),
    ...db.select().from(changeOrders).where(and(eq(changeOrders.orgId, orgId), eq(changeOrders.projectId, projectId))).all().map((row) => ({ value: `change_order:${row.id}`, label: `CO ${row.number}` })),
  ];
  return { assignees, related };
}

export function jobRfis(actor: Actor, projectId: string): JobRfiBoard | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const project = projectIn(db, actor.orgId, projectId);
  if (!project) return null;
  const today = todayFor(db, actor.orgId);
  const showMoney = canSeeMoney(role(actor));
  const choices = choiceLists(db, actor.orgId, projectId);
  return {
    projectId,
    projectName: project.name,
    today,
    showMoney,
    canAdd: canAddFieldNotes(role(actor)),
    canClose: canEditCrm(role(actor)),
    items: rowsFor(db, actor.orgId, projectId).map((row) => listItem(db, actor.orgId, row, today, showMoney)),
    assignees: choices.assignees,
    related: choices.related,
  };
}

function messagesFor(db: AppDatabase, orgId: string, rfiId: string, includeInternal: boolean): RfiMessageView[] {
  const files = fileMap(db, orgId, [rfiId]);
  return db
    .select()
    .from(rfiMessages)
    .where(and(eq(rfiMessages.orgId, orgId), eq(rfiMessages.rfiId, rfiId)))
    .all()
    .filter((row) => includeInternal || row.internal === 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((row) => ({
      id: row.id,
      body: row.body,
      authorName: row.authorName,
      createdAt: row.createdAt,
      files: files.filter((file) => file.messageId === row.id).map((file) => ({ id: file.id, filename: file.filename })),
    }));
}

export function rfiDetail(actor: Actor, rfiId: string): RfiDetail | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const row = db.select().from(rfis).where(and(eq(rfis.id, rfiId), eq(rfis.orgId, actor.orgId))).get();
  if (!row) return null;
  const showMoney = canSeeMoney(role(actor));
  const office = canEditCrm(role(actor));
  const today = todayFor(db, actor.orgId);
  const base = listItem(db, actor.orgId, row, today, showMoney);
  const order = row.changeOrderId
    ? db.select().from(changeOrders).where(and(eq(changeOrders.orgId, actor.orgId), eq(changeOrders.id, row.changeOrderId))).get()
    : null;
  const files = fileMap(db, actor.orgId, [row.id]).filter((file) => !file.messageId).map((file) => ({ id: file.id, filename: file.filename }));
  return {
    ...base,
    question: row.question,
    internalNote: office ? row.internalNote : null,
    showMoney,
    canAnswer: row.status === "open" || row.status === "answered",
    canClose: office && row.status !== "closed" && row.status !== "void",
    canDraft: canManageMoney(role(actor)) && row.costImpact === 1 && (row.costImpactCents ?? 0) > 0 && !row.changeOrderId && row.status !== "void",
    canShift: canEditSchedule(role(actor)) && row.relatedType === "schedule" && Boolean(row.scheduleImpactDays) && !row.scheduleShiftedAt && row.status !== "void",
    costImpact: row.costImpact === 1,
    costCents: showMoney ? row.costImpactCents : null,
    scheduleImpactDays: row.scheduleImpactDays,
    changeOrderId: row.changeOrderId,
    changeOrderLabel: order ? `CO ${order.number}` : null,
    messages: messagesFor(db, actor.orgId, row.id, office),
    files,
  };
}

export function orgRfis(actor: Actor, filter: { projectId?: string | null; assignee?: string | null; status?: string | null; overdue?: boolean }): RfiListItem[] {
  const db = officeDb(actor.orgId);
  if (!db) return [];
  const today = todayFor(db, actor.orgId);
  const showMoney = canSeeMoney(role(actor));
  return rowsFor(db, actor.orgId)
    .filter((row) => {
      if (filter.projectId && row.projectId !== filter.projectId) return false;
      if (filter.status && row.status !== filter.status) return false;
      if (filter.overdue && !isOverdueRfi(row.status, row.dueOn, today)) return false;
      if (filter.assignee) {
        if (filter.assignee.startsWith("user:") && row.assigneeUserId !== filter.assignee.slice(5)) return false;
        if (filter.assignee.startsWith("contact:") && row.assigneeContactId !== filter.assignee.slice(8)) return false;
      }
      return true;
    })
    .map((row) => listItem(db, actor.orgId, row, today, showMoney));
}

export function rfiQueue(actor: Actor): { overdue: { count: number; href: string | null }; awaiting: { count: number; href: string | null } } {
  const db = officeDb(actor.orgId);
  if (!db) return { overdue: { count: 0, href: null }, awaiting: { count: 0, href: null } };
  const today = todayFor(db, actor.orgId);
  const rows = rowsFor(db, actor.orgId);
  const overdue = rows.filter((row) => isOverdueRfi(row.status, row.dueOn, today)).length;
  const awaiting = rows.filter((row) => row.status === "open" && row.assigneeKind === "user" && row.assigneeUserId === actor.userId).length;
  return {
    overdue: { count: overdue, href: overdue ? "/rfis?overdue=1" : null },
    awaiting: { count: awaiting, href: awaiting ? `/rfis?assignee=user:${actor.userId}&status=open` : null },
  };
}

export function relatedRfis(actor: Actor, relatedType: string, relatedId: string): RfiListItem[] {
  const db = officeDb(actor.orgId);
  if (!db) return [];
  const today = todayFor(db, actor.orgId);
  const showMoney = canSeeMoney(role(actor));
  return rowsFor(db, actor.orgId)
    .filter((row) => row.relatedType === relatedType && row.relatedId === relatedId && row.status !== "void")
    .map((row) => listItem(db, actor.orgId, row, today, showMoney));
}

export function overdueScheduleIds(orgId: string, today: string): Set<string> {
  const db = officeDb(orgId);
  if (!db) return new Set();
  return new Set(
    db
      .select()
      .from(rfis)
      .where(and(eq(rfis.orgId, orgId), eq(rfis.status, "open"), eq(rfis.relatedType, "schedule")))
      .all()
      .filter((row) => row.relatedId && row.dueOn && row.dueOn < today)
      .map((row) => row.relatedId as string),
  );
}

export function rfiPrint(actor: Actor, projectId: string): RfiPrint | null {
  const board = jobRfis(actor, projectId);
  if (!board) return null;
  const db = dbFor(actor);
  const project = projectIn(db, actor.orgId, projectId);
  const org = orgRow(db, actor.orgId);
  return {
    orgName: org.name,
    projectName: board.projectName,
    address: project?.address ?? null,
    today: board.today,
    showMoney: board.showMoney,
    items: board.items.filter((item) => item.status !== "void"),
  };
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function rfiCsv(actor: Actor, projectId?: string | null): string {
  const items = projectId ? (jobRfis(actor, projectId)?.items ?? []) : orgRfis(actor, {});
  const header = ["Number", "Title", "Assignee", "Due", "Age", "Status", "Impact", "Related"];
  const lines = items.map((item) =>
    [item.label, item.title, item.assigneeName, item.dueOn ?? "", String(item.ageDays), item.statusLabel, item.impact, item.relatedLabel ?? ""].map(csvCell).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function attemptCount(db: AppDatabase, orgId: string, since: string, ip?: string) {
  return db
    .select()
    .from(rfiAttempts)
    .where(eq(rfiAttempts.orgId, orgId))
    .all()
    .filter((row) => row.createdAt >= since && (!ip || row.ip === ip)).length;
}

function guardPortal(db: AppDatabase, orgId: string, ip: string) {
  const nowMs = Date.now();
  const limited = rateLimitError({
    ipCount: attemptCount(db, orgId, new Date(nowMs - IP_WINDOW_MS).toISOString(), ip),
    orgCount: attemptCount(db, orgId, new Date(nowMs - ORG_WINDOW_MS).toISOString()),
  });
  if (limited) throw new ServiceError(limited);
  db.insert(rfiAttempts)
    .values({ id: id("rfia"), orgId, ip: ip.slice(0, 80) || "local", createdAt: new Date(nowMs).toISOString() })
    .run();
}

function portalCards(db: AppDatabase, orgId: string, rows: RfiRow[], today: string): PortalRfi[] {
  const projectsById = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row]));
  return rows.map((row) => {
    const files = fileMap(db, orgId, [row.id]);
    return {
      id: row.id,
      label: rfiLabel(row.number),
      title: row.title,
      question: row.question,
      job: projectsById.get(row.projectId)?.name ?? "Job",
      dueOn: row.dueOn,
      status: row.status,
      statusLabel: RFI_STATUS_LABEL[row.status] ?? row.status,
      related: relatedLabel(db, orgId, row.projectId, row.relatedType, row.relatedId),
      canAnswer: row.status === "open" || row.status === "answered",
      messages: messagesFor(db, orgId, row.id, false),
      files: files.filter((file) => !file.messageId).map((file) => ({ id: file.id, filename: file.filename })),
    };
  });
}

function vendorContext(token: string) {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const db = getDb();
  const portal = db.select().from(vendorPortals).where(eq(vendorPortals.tokenHash, hashVendorToken(trimmed))).get();
  if (!portal || !vendorTokenMatches(trimmed, portal.tokenHash)) return null;
  const contact = loadContact(db, portal.orgId, portal.contactId);
  if (!contact || !VENDOR_TYPES.has(contact.type)) return null;
  return { db, orgId: portal.orgId, contactId: contact.id, name: contact.company?.trim() || contact.name };
}

export function vendorPortalRfis(token: string): PortalRfi[] {
  const ctx = vendorContext(token);
  if (!ctx) return [];
  const today = todayFor(ctx.db, ctx.orgId);
  const rows = ctx.db
    .select()
    .from(rfis)
    .where(and(eq(rfis.orgId, ctx.orgId), eq(rfis.assigneeKind, "vendor"), eq(rfis.assigneeContactId, ctx.contactId)))
    .all()
    .filter((row) => row.status !== "void");
  return portalCards(ctx.db, ctx.orgId, rows, today);
}

function postPortalAnswer(db: AppDatabase, orgId: string, row: RfiRow, body: string, authorKind: "vendor" | "client", authorName: string, files: RfiUpload[], contactId: string | null) {
  if (row.status !== "open" && row.status !== "answered") throw new ServiceError("This RFI is closed.");
  const text = cleanText(body, 2000, "answer", true);
  const now = nowIso();
  const messageId = id("rfim");
  db.transaction((tx) => {
    tx.insert(rfiMessages)
      .values({
        id: messageId,
        orgId,
        rfiId: row.id,
        body: text,
        authorKind,
        authorUserId: null,
        authorName,
        internal: 0,
        createdAt: now,
      })
      .run();
    attachFiles(tx as unknown as AppDatabase, orgId, row.projectId, row.id, messageId, files, null, contactId);
    tx.update(rfis)
      .set({ status: row.status === "open" ? "answered" : row.status, answeredAt: row.answeredAt ?? now, updatedAt: now })
      .where(and(eq(rfis.orgId, orgId), eq(rfis.id, row.id)))
      .run();
    writeAudit(tx as unknown as AppDatabase, orgId, null, "rfi.answer", row.id, { authorKind });
  });
}

export function answerVendorRfi(input: { token: string; rfiId: string; body: string; files?: RfiUpload[]; ip: string }) {
  const ctx = vendorContext(input.token);
  if (!ctx) throw new ServiceError("Portal not found.");
  guardPortal(ctx.db, ctx.orgId, input.ip);
  const row = ctx.db
    .select()
    .from(rfis)
    .where(and(eq(rfis.id, input.rfiId), eq(rfis.orgId, ctx.orgId), eq(rfis.assigneeKind, "vendor"), eq(rfis.assigneeContactId, ctx.contactId)))
    .get();
  if (!row) throw new ServiceError("RFI not found.");
  postPortalAnswer(ctx.db, ctx.orgId, row, input.body, "vendor", ctx.name, input.files ?? [], ctx.contactId);
}

function clientContext(token: string) {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, trimmed)).get();
  if (!project) return null;
  const contact = loadContact(db, project.orgId, project.contactId);
  if (!contact) return null;
  return { db, orgId: project.orgId, projectId: project.id, contactId: contact.id, name: contact.name };
}

export function clientPortalRfis(token: string): PortalRfi[] {
  const ctx = clientContext(token);
  if (!ctx) return [];
  const today = todayFor(ctx.db, ctx.orgId);
  const rows = ctx.db
    .select()
    .from(rfis)
    .where(and(eq(rfis.orgId, ctx.orgId), eq(rfis.projectId, ctx.projectId), eq(rfis.assigneeKind, "client"), eq(rfis.assigneeContactId, ctx.contactId)))
    .all()
    .filter((row) => row.status !== "void");
  return portalCards(ctx.db, ctx.orgId, rows, today);
}

export function answerClientRfi(input: { token: string; rfiId: string; body: string; files?: RfiUpload[]; ip: string }) {
  const ctx = clientContext(input.token);
  if (!ctx) throw new ServiceError("Portal not found.");
  guardPortal(ctx.db, ctx.orgId, input.ip);
  const row = ctx.db
    .select()
    .from(rfis)
    .where(and(eq(rfis.id, input.rfiId), eq(rfis.orgId, ctx.orgId), eq(rfis.projectId, ctx.projectId), eq(rfis.assigneeKind, "client"), eq(rfis.assigneeContactId, ctx.contactId)))
    .get();
  if (!row) throw new ServiceError("RFI not found.");
  postPortalAnswer(ctx.db, ctx.orgId, row, input.body, "client", ctx.name, input.files ?? [], null);
}
