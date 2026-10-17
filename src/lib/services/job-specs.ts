import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb } from "@/lib/db/client";
import {
  auditLogs,
  budgetLines,
  documents,
  jobSpecAttempts,
  jobSpecFiles,
  jobSpecLines,
  jobSpecs,
  organizations,
  projects,
} from "@/lib/db/schema";
import { id, nowIso, token } from "@/lib/ids";
import { IP_WINDOW_MS, ORG_WINDOW_MS, rateLimitError } from "@/lib/lead-form/rules";
import { canEditCrm, canSeeMoney, type Role } from "@/lib/permissions";
import { appOrigin, attachmentExtension, attachmentUploadError, resolveInside } from "@/lib/security";
import { budgetChanged, draftPastDue, groupOf, kept, publishedForToken, pulledLine, refreshed } from "@/lib/specs/pack";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { localDay } from "@/lib/time/calendar";

type Database = ReturnType<typeof getDb>;
type SpecRow = typeof jobSpecs.$inferSelect;
type LineRow = typeof jobSpecLines.$inferSelect;

export type SpecFilter = {
  projectId?: string;
  status?: string;
  flag?: boolean;
};

export type SpecListRow = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: string;
  version: number;
  dueOn: string | null;
  overdue: boolean;
  changed: boolean;
  latest: boolean;
};

export type SpecFileView = { id: string; documentId: string; filename: string };

export type SpecLineView = {
  id: string;
  budgetLineId: string | null;
  groupLabel: string;
  costCode: string;
  description: string;
  notes: string;
  sortOrder: number;
  changed: boolean;
  priceCents: number | null;
  files: SpecFileView[];
};

export type SpecVersion = { id: string; version: number; status: string };

export type SpecView = SpecListRow & {
  shareToken: string;
  link: string;
  sentAt: string | null;
  sentBy: string | null;
  lines: SpecLineView[];
  versions: SpecVersion[];
  unlinked: number;
  showMoney: boolean;
  canEdit: boolean;
};

export type PublicFile = { id: string; filename: string };

export type PublicSpec =
  | { state: "missing" }
  | { state: "limited" }
  | { state: "unpublished"; orgName: string }
  | {
      state: "published";
      token: string;
      orgName: string;
      title: string;
      version: number;
      groups: { label: string; lines: { costCode: string; description: string; notes: string; files: PublicFile[] }[] }[];
    };

const MAX_TITLE = 80;
const MAX_TEXT = 500;
const MAX_NOTES = 2_000;

function roleOf(actor: Actor): Role {
  return actor.role as Role;
}

function assertEdit(actor: Actor) {
  if (!canEditCrm(roleOf(actor))) throw new ServiceError("Your role cannot edit specifications.");
}

function audit(db: Database, orgId: string, actorId: string | null, action: string, entityId: string) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "job_spec",
      entityId,
      payloadJson: "{}",
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function orgToday(db: Database, orgId: string): string {
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  return localDay(Date.now(), org?.timeZone || "America/New_York");
}

function orgName(db: Database, orgId: string): string {
  return db.select().from(organizations).where(eq(organizations.id, orgId)).get()?.name || "Fieldline";
}

function bound(value: string, max: number, label: string): string {
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  if (text.length > max) throw new ServiceError(`${label} is too long.`);
  return text;
}

function shareLink(shareToken: string): string {
  const origin = appOrigin(process.env);
  const href = `/spec/${shareToken}`;
  return origin ? `${origin}${href}` : href;
}

function specsFor(db: Database, orgId: string): SpecRow[] {
  return db.select().from(jobSpecs).where(eq(jobSpecs.orgId, orgId)).all();
}

function linesFor(db: Database, orgId: string, specId?: string): LineRow[] {
  return db
    .select()
    .from(jobSpecLines)
    .where(eq(jobSpecLines.orgId, orgId))
    .all()
    .filter((row) => !specId || row.specId === specId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function filesFor(db: Database, orgId: string): (typeof jobSpecFiles.$inferSelect)[] {
  return db.select().from(jobSpecFiles).where(eq(jobSpecFiles.orgId, orgId)).all();
}

function budgetsFor(db: Database, orgId: string, projectId?: string) {
  return db
    .select()
    .from(budgetLines)
    .where(eq(budgetLines.orgId, orgId))
    .all()
    .filter((row) => (!projectId || row.projectId === projectId) && row.kind !== "contingency");
}

function liveOf(db: Database, orgId: string, projectId: string, budgetLineId: string | null) {
  if (!budgetLineId) return null;
  const row = db
    .select()
    .from(budgetLines)
    .where(and(eq(budgetLines.id, budgetLineId), eq(budgetLines.orgId, orgId), eq(budgetLines.projectId, projectId)))
    .get();
  if (!row) return null;
  return { name: row.name, priceCents: row.budgetPriceCents, costCode: row.costCode };
}

function projectOf(db: Database, orgId: string, projectId: string) {
  return db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get() ?? null;
}

function loadSpec(db: Database, orgId: string, specId: string): SpecRow | null {
  return db.select().from(jobSpecs).where(and(eq(jobSpecs.id, specId), eq(jobSpecs.orgId, orgId))).get() ?? null;
}

function isLatest(rows: SpecRow[], row: SpecRow): boolean {
  return !rows.some((other) => other.shareToken === row.shareToken && other.version > row.version);
}

function visible(actor: Actor, row: SpecRow): boolean {
  return roleOf(actor) !== "field" || row.status === "published";
}

function lineChanged(db: Database, row: SpecRow, line: LineRow): boolean {
  return budgetChanged(
    { budgetLineId: line.budgetLineId, sourceName: line.sourceName, sourceCents: line.sourceCents },
    liveOf(db, row.orgId, row.projectId, line.budgetLineId),
  );
}

function packChanged(db: Database, row: SpecRow): boolean {
  return linesFor(db, row.orgId, row.id).some((line) => lineChanged(db, row, line));
}

function toList(db: Database, actor: Actor, row: SpecRow, today: string, rows: SpecRow[]): SpecListRow | null {
  if (!visible(actor, row)) return null;
  const project = projectOf(db, actor.orgId, row.projectId);
  const latest = isLatest(rows, row);
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: project?.name || "Job",
    title: row.title,
    status: row.status,
    version: row.version,
    dueOn: row.dueOn,
    overdue: latest && draftPastDue(row.status, row.dueOn, today),
    changed: latest && packChanged(db, row),
    latest,
  };
}

export function specPacks(actor: Actor, filter: SpecFilter = {}): SpecListRow[] {
  const db = getDb();
  const rows = specsFor(db, actor.orgId);
  const today = orgToday(db, actor.orgId);
  return rows
    .map((row) => toList(db, actor, row, today, rows))
    .filter((row): row is SpecListRow => {
      if (!row) return false;
      if (filter.projectId && row.projectId !== filter.projectId) return false;
      if (filter.status && row.status !== filter.status) return false;
      if (filter.flag && !(row.latest && (row.overdue || row.changed))) return false;
      return true;
    })
    .sort((a, b) => a.projectName.localeCompare(b.projectName) || b.version - a.version || a.title.localeCompare(b.title));
}

function documentName(db: Database, orgId: string, documentId: string): string {
  return db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.orgId, orgId))).get()?.filename || "File";
}

export function specPack(actor: Actor, specId: string): SpecView | null {
  const db = getDb();
  const row = loadSpec(db, actor.orgId, specId);
  if (!row || !visible(actor, row)) return null;
  const rows = specsFor(db, actor.orgId);
  const today = orgToday(db, actor.orgId);
  const list = toList(db, actor, row, today, rows);
  if (!list) return null;
  const fileRows = filesFor(db, actor.orgId);
  const role = roleOf(actor);
  const lines = linesFor(db, actor.orgId, row.id).map((line) => {
    const live = liveOf(db, actor.orgId, row.projectId, line.budgetLineId);
    return {
      id: line.id,
      budgetLineId: line.budgetLineId,
      groupLabel: line.groupLabel,
      costCode: line.costCode,
      description: line.description,
      notes: line.notes,
      sortOrder: line.sortOrder,
      changed: lineChanged(db, row, line),
      priceCents: canSeeMoney(role) ? (live?.priceCents ?? line.sourceCents) : null,
      files: fileRows
        .filter((file) => file.lineId === line.id)
        .map((file) => ({ id: file.id, documentId: file.documentId, filename: documentName(db, actor.orgId, file.documentId) })),
    };
  });
  const linked = new Set(lines.map((line) => line.budgetLineId).filter((value): value is string => Boolean(value)));
  const unlinked = budgetsFor(db, actor.orgId, row.projectId).filter((budget) => !linked.has(budget.id)).length;
  const versions = rows
    .filter((other) => other.shareToken === row.shareToken)
    .sort((a, b) => b.version - a.version)
    .map((other) => ({ id: other.id, version: other.version, status: other.status }));
  return {
    ...list,
    shareToken: row.shareToken,
    link: shareLink(row.shareToken),
    sentAt: row.sentAt,
    sentBy: row.sentBy,
    lines,
    versions,
    unlinked,
    showMoney: canSeeMoney(role),
    canEdit: canEditCrm(role),
  };
}

function requireLatest(db: Database, actor: Actor, specId: string, draft: boolean): SpecRow {
  assertEdit(actor);
  const row = loadSpec(db, actor.orgId, specId);
  if (!row) throw new ServiceError("That specification is not here.");
  if (!isLatest(specsFor(db, actor.orgId), row)) throw new ServiceError("That version is closed.");
  if (draft && row.status !== "draft") throw new ServiceError("Revise it first.");
  return row;
}

export function createFromBudget(actor: Actor, projectId: string, title = ""): { id: string; shareToken: string } {
  assertEdit(actor);
  const db = getDb();
  const project = projectOf(db, actor.orgId, projectId);
  if (!project) throw new ServiceError("That job is not here.");
  const budgets = budgetsFor(db, actor.orgId, projectId).sort(
    (a, b) => (a.costCode || "").localeCompare(b.costCode || "") || a.name.localeCompare(b.name),
  );
  if (budgets.length === 0) throw new ServiceError("That job has no budget lines.");
  const specId = id("spec");
  const shareToken = token();
  const at = nowIso();
  const name = bound(title || "Specifications", MAX_TITLE, "Title") || "Specifications";
  db.insert(jobSpecs)
    .values({
      id: specId,
      orgId: actor.orgId,
      projectId,
      title: name,
      status: "draft",
      version: 1,
      replacesId: null,
      shareToken,
      dueOn: null,
      sentAt: null,
      sentBy: null,
      publishedAt: null,
      createdAt: at,
      updatedAt: at,
      createdBy: actor.userId,
    })
    .run();
  for (const [index, budget] of budgets.entries()) {
    const line = pulledLine({ id: budget.id, name: budget.name, costCode: budget.costCode, priceCents: budget.budgetPriceCents }, index);
    db.insert(jobSpecLines)
      .values({
        id: id("spl"),
        orgId: actor.orgId,
        specId,
        budgetLineId: line.budgetLineId,
        groupLabel: line.groupLabel,
        costCode: line.costCode,
        description: line.description,
        notes: "",
        sortOrder: line.sortOrder,
        sourceName: line.sourceName,
        sourceCents: line.sourceCents,
      })
      .run();
  }
  audit(db, actor.orgId, actor.userId, "spec.create", specId);
  return { id: specId, shareToken };
}

export function updateSpec(actor: Actor, specId: string, input: { title?: string; dueOn?: string }) {
  const db = getDb();
  const row = requireLatest(db, actor, specId, true);
  const title = input.title == null ? row.title : bound(input.title, MAX_TITLE, "Title");
  if (!title) throw new ServiceError("Add a title.");
  const due = input.dueOn == null ? row.dueOn : input.dueOn.trim() || null;
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new ServiceError("Use a date.");
  db.update(jobSpecs)
    .set({ title, dueOn: due, updatedAt: nowIso() })
    .where(and(eq(jobSpecs.id, row.id), eq(jobSpecs.orgId, actor.orgId)))
    .run();
}

export function saveSpecLine(actor: Actor, lineId: string, input: { description: string; notes: string; groupLabel: string; costCode: string }) {
  const db = getDb();
  const line = db.select().from(jobSpecLines).where(and(eq(jobSpecLines.id, lineId), eq(jobSpecLines.orgId, actor.orgId))).get();
  if (!line) throw new ServiceError("That line is not here.");
  requireLatest(db, actor, line.specId, true);
  const description = bound(input.description, MAX_TEXT, "Description");
  if (!description) throw new ServiceError("Add a description.");
  db.update(jobSpecLines)
    .set({
      description,
      notes: bound(input.notes, MAX_NOTES, "Notes"),
      groupLabel: bound(input.groupLabel, MAX_TITLE, "Group") || "General",
      costCode: bound(input.costCode, 40, "Cost code"),
    })
    .where(and(eq(jobSpecLines.id, line.id), eq(jobSpecLines.orgId, actor.orgId)))
    .run();
}

export function moveSpecLine(actor: Actor, lineId: string, direction: "up" | "down") {
  const db = getDb();
  const line = db.select().from(jobSpecLines).where(and(eq(jobSpecLines.id, lineId), eq(jobSpecLines.orgId, actor.orgId))).get();
  if (!line) throw new ServiceError("That line is not here.");
  requireLatest(db, actor, line.specId, true);
  const lines = linesFor(db, actor.orgId, line.specId);
  const index = lines.findIndex((row) => row.id === line.id);
  const swap = direction === "up" ? index - 1 : index + 1;
  const other = lines[swap];
  if (!other || index < 0) return;
  db.update(jobSpecLines).set({ sortOrder: other.sortOrder }).where(and(eq(jobSpecLines.id, line.id), eq(jobSpecLines.orgId, actor.orgId))).run();
  db.update(jobSpecLines).set({ sortOrder: line.sortOrder }).where(and(eq(jobSpecLines.id, other.id), eq(jobSpecLines.orgId, actor.orgId))).run();
  if (line.sortOrder === other.sortOrder) {
    linesFor(db, actor.orgId, line.specId).forEach((row, order) => {
      db.update(jobSpecLines).set({ sortOrder: order }).where(and(eq(jobSpecLines.id, row.id), eq(jobSpecLines.orgId, actor.orgId))).run();
    });
  }
}

export function addSpecLine(actor: Actor, specId: string, input: { description: string; costCode?: string; groupLabel?: string; notes?: string }) {
  const db = getDb();
  requireLatest(db, actor, specId, true);
  const description = bound(input.description, MAX_TEXT, "Description");
  if (!description) throw new ServiceError("Add a description.");
  const lines = linesFor(db, actor.orgId, specId);
  const sortOrder = lines.length === 0 ? 0 : Math.max(...lines.map((row) => row.sortOrder)) + 1;
  const costCode = bound(input.costCode ?? "", 40, "Cost code");
  db.insert(jobSpecLines)
    .values({
      id: id("spl"),
      orgId: actor.orgId,
      specId,
      budgetLineId: null,
      groupLabel: bound(input.groupLabel || groupOf(costCode), MAX_TITLE, "Group") || "General",
      costCode,
      description,
      notes: bound(input.notes ?? "", MAX_NOTES, "Notes"),
      sortOrder,
      sourceName: null,
      sourceCents: null,
    })
    .run();
}

export function pullSpecLines(actor: Actor, specId: string) {
  const db = getDb();
  const row = requireLatest(db, actor, specId, true);
  const lines = linesFor(db, actor.orgId, specId);
  const linked = new Set(lines.map((line) => line.budgetLineId).filter((value): value is string => Boolean(value)));
  const fresh = budgetsFor(db, actor.orgId, row.projectId)
    .filter((budget) => !linked.has(budget.id))
    .sort((a, b) => (a.costCode || "").localeCompare(b.costCode || "") || a.name.localeCompare(b.name));
  let sortOrder = lines.length === 0 ? 0 : Math.max(...lines.map((line) => line.sortOrder)) + 1;
  for (const budget of fresh) {
    const line = pulledLine({ id: budget.id, name: budget.name, costCode: budget.costCode, priceCents: budget.budgetPriceCents }, sortOrder);
    db.insert(jobSpecLines)
      .values({
        id: id("spl"),
        orgId: actor.orgId,
        specId,
        budgetLineId: line.budgetLineId,
        groupLabel: line.groupLabel,
        costCode: line.costCode,
        description: line.description,
        notes: "",
        sortOrder,
        sourceName: line.sourceName,
        sourceCents: line.sourceCents,
      })
      .run();
    sortOrder += 1;
  }
}

export function attachSpecFile(actor: Actor, lineId: string, upload: { filename: string; bytes: Buffer }) {
  const db = getDb();
  const line = db.select().from(jobSpecLines).where(and(eq(jobSpecLines.id, lineId), eq(jobSpecLines.orgId, actor.orgId))).get();
  if (!line) throw new ServiceError("That line is not here.");
  const spec = requireLatest(db, actor, line.specId, true);
  const error = attachmentUploadError(upload.filename, upload.bytes);
  if (error) throw new ServiceError(error);
  const documentId = id("doc");
  const ext = attachmentExtension(upload.bytes);
  const relative = path.join("uploads", actor.orgId, `${documentId}.${ext}`);
  const absolute = path.join(dataDir(), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, upload.bytes);
  const stem = path.basename(upload.filename).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80);
  db.insert(documents)
    .values({
      id: documentId,
      orgId: actor.orgId,
      projectId: spec.projectId,
      leadId: null,
      contactId: null,
      type: "spec",
      filename: `${stem || "file"}.${ext}`,
      storagePath: relative,
      metadataJson: null,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy: actor.userId,
    })
    .run();
  db.insert(jobSpecFiles).values({ id: id("spf"), orgId: actor.orgId, lineId: line.id, documentId }).run();
  return documentId;
}

export function publishSpec(actor: Actor, specId: string) {
  const db = getDb();
  const row = requireLatest(db, actor, specId, true);
  if (linesFor(db, actor.orgId, row.id).length === 0) throw new ServiceError("Add a line first.");
  const at = nowIso();
  db.update(jobSpecs)
    .set({ status: "published", publishedAt: at, updatedAt: at })
    .where(and(eq(jobSpecs.id, row.id), eq(jobSpecs.orgId, actor.orgId)))
    .run();
  audit(db, actor.orgId, actor.userId, "spec.publish", row.id);
}

export function reviseSpec(actor: Actor, specId: string): { id: string } {
  assertEdit(actor);
  const db = getDb();
  const row = loadSpec(db, actor.orgId, specId);
  if (!row) throw new ServiceError("That specification is not here.");
  if (!isLatest(specsFor(db, actor.orgId), row)) throw new ServiceError("That version is closed.");
  if (row.status !== "published") throw new ServiceError("Publish it first.");
  const specIdNext = id("spec");
  const at = nowIso();
  db.insert(jobSpecs)
    .values({
      id: specIdNext,
      orgId: actor.orgId,
      projectId: row.projectId,
      title: row.title,
      status: "draft",
      version: row.version + 1,
      replacesId: row.id,
      shareToken: row.shareToken,
      dueOn: row.dueOn,
      sentAt: null,
      sentBy: null,
      publishedAt: null,
      createdAt: at,
      updatedAt: at,
      createdBy: actor.userId,
    })
    .run();
  const map = new Map<string, string>();
  for (const line of linesFor(db, actor.orgId, row.id)) {
    const lineId = id("spl");
    map.set(line.id, lineId);
    db.insert(jobSpecLines)
      .values({
        id: lineId,
        orgId: actor.orgId,
        specId: specIdNext,
        budgetLineId: line.budgetLineId,
        groupLabel: line.groupLabel,
        costCode: line.costCode,
        description: line.description,
        notes: line.notes,
        sortOrder: line.sortOrder,
        sourceName: line.sourceName,
        sourceCents: line.sourceCents,
      })
      .run();
  }
  for (const file of filesFor(db, actor.orgId)) {
    const lineId = map.get(file.lineId);
    if (!lineId) continue;
    db.insert(jobSpecFiles).values({ id: id("spf"), orgId: actor.orgId, lineId, documentId: file.documentId }).run();
  }
  audit(db, actor.orgId, actor.userId, "spec.revise", specIdNext);
  return { id: specIdNext };
}

export function markSpecSent(actor: Actor, specId: string) {
  assertEdit(actor);
  const db = getDb();
  const row = loadSpec(db, actor.orgId, specId);
  if (!row) throw new ServiceError("That specification is not here.");
  if (row.status !== "published") throw new ServiceError("Publish it first.");
  const at = nowIso();
  db.update(jobSpecs)
    .set({ sentAt: at, sentBy: actor.userId, updatedAt: at })
    .where(and(eq(jobSpecs.id, row.id), eq(jobSpecs.orgId, actor.orgId)))
    .run();
  audit(db, actor.orgId, actor.userId, "spec.link", row.id);
}

function syncLine(actor: Actor, lineId: string, mode: "refresh" | "keep") {
  const db = getDb();
  const line = db.select().from(jobSpecLines).where(and(eq(jobSpecLines.id, lineId), eq(jobSpecLines.orgId, actor.orgId))).get();
  if (!line) throw new ServiceError("That line is not here.");
  const spec = requireLatest(db, actor, line.specId, false);
  const live = liveOf(db, actor.orgId, spec.projectId, line.budgetLineId);
  if (!live) throw new ServiceError("That budget line is gone.");
  if (mode === "refresh") {
    const next = refreshed(live);
    db.update(jobSpecLines)
      .set({
        description: next.description,
        costCode: next.costCode,
        groupLabel: next.groupLabel,
        sourceName: next.sourceName,
        sourceCents: next.sourceCents,
      })
      .where(and(eq(jobSpecLines.id, line.id), eq(jobSpecLines.orgId, actor.orgId)))
      .run();
    audit(db, actor.orgId, actor.userId, "spec.refresh", spec.id);
    return;
  }
  const next = kept(live);
  db.update(jobSpecLines)
    .set({ sourceName: next.sourceName, sourceCents: next.sourceCents })
    .where(and(eq(jobSpecLines.id, line.id), eq(jobSpecLines.orgId, actor.orgId)))
    .run();
  audit(db, actor.orgId, actor.userId, "spec.keep", spec.id);
}

export function refreshSpecLine(actor: Actor, lineId: string) {
  syncLine(actor, lineId, "refresh");
}

export function keepSpecLine(actor: Actor, lineId: string) {
  syncLine(actor, lineId, "keep");
}

export function specAttention(actor: Actor): { count: number; href: string | null } {
  const jobs = new Set(specPacks(actor, { flag: true }).map((row) => row.projectId));
  const count = jobs.size;
  return { count, href: count > 0 ? "/specs?flag=1" : null };
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function specCsv(actor: Actor): string {
  const db = getDb();
  const rows = specPacks(actor, { status: "published" });
  const header = "job,title,version,group,cost_code,description,notes";
  const body: string[] = [];
  for (const row of rows) {
    for (const line of linesFor(db, actor.orgId, row.id)) {
      body.push([row.projectName, row.title, String(row.version), line.groupLabel, line.costCode, line.description, line.notes].map(csvCell).join(","));
    }
  }
  return [header, ...body].join("\n");
}

function attemptCount(db: Database, orgId: string, sinceIso: string, ip?: string) {
  return db
    .select()
    .from(jobSpecAttempts)
    .where(eq(jobSpecAttempts.orgId, orgId))
    .all()
    .filter((row) => row.createdAt >= sinceIso && (!ip || row.ip === ip)).length;
}

function recordAttempt(db: Database, orgId: string, specId: string, ip: string, atIso: string) {
  const cutoff = new Date(Date.parse(atIso) - ORG_WINDOW_MS).toISOString();
  const stale = db.select().from(jobSpecAttempts).where(eq(jobSpecAttempts.orgId, orgId)).all().filter((row) => row.createdAt < cutoff);
  for (const row of stale) {
    db.delete(jobSpecAttempts).where(and(eq(jobSpecAttempts.id, row.id), eq(jobSpecAttempts.orgId, orgId))).run();
  }
  db.insert(jobSpecAttempts).values({ id: id("spa"), orgId, specId, ip: ip.slice(0, 80) || "local", createdAt: atIso }).run();
}

function groupLines(lines: { groupLabel: string; costCode: string; description: string; notes: string; files: PublicFile[] }[]) {
  const groups: { label: string; lines: { costCode: string; description: string; notes: string; files: PublicFile[] }[] }[] = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    const item = { costCode: line.costCode, description: line.description, notes: line.notes, files: line.files };
    if (!last || last.label !== line.groupLabel) groups.push({ label: line.groupLabel, lines: [item] });
    else last.lines.push(item);
  }
  return groups;
}

export function publicSpec(shareToken: string, ip: string, nowMs = Date.now()): PublicSpec {
  const db = getDb();
  const rows = db.select().from(jobSpecs).where(eq(jobSpecs.shareToken, shareToken)).all();
  if (rows.length === 0) return { state: "missing" };
  const orgId = rows[0]!.orgId;
  const atIso = new Date(nowMs).toISOString();
  const cleanIp = ip.slice(0, 80) || "local";
  const published = publishedForToken(rows, shareToken);
  const limited = rateLimitError({
    ipCount: attemptCount(db, orgId, new Date(nowMs - IP_WINDOW_MS).toISOString(), cleanIp),
    orgCount: attemptCount(db, orgId, new Date(nowMs - ORG_WINDOW_MS).toISOString()),
  });
  recordAttempt(db, orgId, published?.id ?? rows[0]!.id, cleanIp, atIso);
  if (limited) return { state: "limited" };
  if (!published || published.orgId !== orgId) return { state: "unpublished", orgName: orgName(db, orgId) };
  const fileRows = filesFor(db, orgId);
  const lines = linesFor(db, orgId, published.id).map((line) => ({
    groupLabel: line.groupLabel,
    costCode: line.costCode,
    description: line.description,
    notes: line.notes,
    files: fileRows
      .filter((file) => file.lineId === line.id)
      .map((file) => ({ id: file.id, filename: documentName(db, orgId, file.documentId) })),
  }));
  return {
    state: "published",
    token: shareToken,
    orgName: orgName(db, orgId),
    title: published.title,
    version: published.version,
    groups: groupLines(lines),
  };
}

export function specFileByToken(shareToken: string, fileId: string): { filename: string; bytes: Buffer } | null {
  const db = getDb();
  const rows = db.select().from(jobSpecs).where(eq(jobSpecs.shareToken, shareToken)).all();
  const published = publishedForToken(rows, shareToken);
  if (!published) return null;
  const file = db.select().from(jobSpecFiles).where(and(eq(jobSpecFiles.id, fileId), eq(jobSpecFiles.orgId, published.orgId))).get();
  if (!file) return null;
  const line = db
    .select()
    .from(jobSpecLines)
    .where(and(eq(jobSpecLines.id, file.lineId), eq(jobSpecLines.orgId, published.orgId), eq(jobSpecLines.specId, published.id)))
    .get();
  if (!line) return null;
  const document = db.select().from(documents).where(and(eq(documents.id, file.documentId), eq(documents.orgId, published.orgId))).get();
  if (!document || document.deletedAt) return null;
  const absolute = resolveInside(dataDir(), document.storagePath);
  if (!absolute || !fs.existsSync(absolute)) return null;
  return { filename: document.filename, bytes: fs.readFileSync(absolute) };
}
