import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb, type AppDatabase } from "@/lib/db/client";
import { auditLogs, bills, contacts, documents, invoices, lienNotices, lienRules, organizations, projects, receipts, timeEntries } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import {
  asDay,
  attentionCount,
  evaluateLien,
  furnishSpan,
  stateFromAddress,
  type DeadlineKind,
  type LienDeadline,
  type LienEvaluation,
  type LienNoticeMark,
  type LienRole,
  type LienRuleSpec,
  type LienStatus,
  type NoticeKind,
} from "@/lib/liens/deadlines";
import { canManageMoney, canManageSettings, canSeeMoney, type Role } from "@/lib/permissions";
import { attachmentExtension, attachmentUploadError } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";

type Writer = Pick<AppDatabase, "insert" | "update" | "select" | "delete">;

const ROLES: LienRole[] = ["prime", "sub", "supplier"];
const PRELIM_KINDS = ["none", "calendar", "business", "month_day"] as const;
const NOI_KINDS = ["none", "calendar", "business"] as const;
const FILE_KINDS = ["none", "calendar", "business", "month_day"] as const;
const ANCHORS = ["last", "completion"] as const;
const ENFORCE_KINDS = ["none", "calendar", "business", "anniversary"] as const;
const ENFORCE_FROM = ["filed", "file_deadline"] as const;
const METHODS = ["certified", "hand", "other"] as const;
const NOTICE_KINDS: NoticeKind[] = ["prelim", "intent", "filing"];

export type LienMethod = (typeof METHODS)[number];

export type LienJobView = {
  projectId: string;
  name: string;
  client: string;
  address: string;
  tracked: boolean;
  state: string;
  role: LienRole;
  first: string;
  last: string;
  status: LienStatus;
  openCents: number;
  deadlines: LienDeadline[];
  citation: string;
  canEdit: boolean;
  today: string;
  marks: { kind: NoticeKind; sentOn: string; method: string }[];
};

export type LienListRow = {
  projectId: string;
  name: string;
  client: string;
  state: string;
  role: string;
  status: LienStatus;
  openCents: number;
  deadlines: LienDeadline[];
};

export type LienPrint = {
  kind: "prelim" | "intent";
  title: string;
  orgName: string;
  orgPlace: string;
  client: string;
  job: string;
  address: string;
  unpaidCents: number;
  first: string | null;
  last: string | null;
  deadline: string | null;
  citation: string;
};

export type LienRuleInput = {
  state: string;
  role: string;
  prelimKind: string;
  prelimDays: string;
  prelimMonths: string;
  prelimDay: string;
  noiKind: string;
  noiDays: string;
  fileKind: string;
  fileAnchor: string;
  fileDays: string;
  fileMonths: string;
  fileDay: string;
  enforceKind: string;
  enforceFrom: string;
  enforceDays: string;
  prelimLapses: boolean;
  citation: string;
};

function roleOf(actor: Actor): Role {
  return actor.role as Role;
}

function see(actor: Actor) {
  if (!canSeeMoney(roleOf(actor))) throw new ServiceError("Your role cannot see this.");
}

function office(actor: Actor) {
  see(actor);
  if (!canManageMoney(roleOf(actor))) throw new ServiceError("Your role cannot change this.");
}

function settings(actor: Actor) {
  see(actor);
  if (!canManageSettings(roleOf(actor))) throw new ServiceError("Your role cannot change this.");
}

function audit(db: Writer, orgId: string, actorId: string | null, action: string, entityType: string, entityId: string, payload: unknown) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType,
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function clock(db: Writer, orgId: string): { zone: string; mask: number; today: string; name: string; city: string; state: string } {
  const org = db
    .select({
      timeZone: organizations.timeZone,
      workdaysMask: organizations.workdaysMask,
      name: organizations.name,
      city: organizations.city,
      state: organizations.state,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .get();
  const zone = org?.timeZone || "America/New_York";
  return {
    zone,
    mask: org?.workdaysMask && org.workdaysMask > 0 ? org.workdaysMask : 62,
    today: asDay(new Date().toISOString(), zone) || "",
    name: org?.name || "",
    city: org?.city || "",
    state: org?.state || "",
  };
}

function whole(value: string, label: string, max: number): number {
  const text = value.trim();
  if (!/^\d+$/.test(text)) throw new ServiceError(`Enter ${label}.`);
  const number = Number(text);
  if (number > max) throw new ServiceError(`Enter ${label}.`);
  return number;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new ServiceError(`Pick ${label}.`);
}

function specFromRow(row: typeof lienRules.$inferSelect): LienRuleSpec {
  return {
    state: row.state,
    role: (ROLES.includes(row.role as LienRole) ? row.role : "sub") as LienRole,
    prelimKind: oneOr(row.prelimKind, PRELIM_KINDS, "none"),
    prelimDays: row.prelimDays,
    prelimMonths: row.prelimMonths,
    prelimDay: row.prelimDay,
    noiKind: oneOr(row.noiKind, NOI_KINDS, "none"),
    noiDays: row.noiDays,
    fileKind: oneOr(row.fileKind, FILE_KINDS, "none"),
    fileAnchor: oneOr(row.fileAnchor, ANCHORS, "last"),
    fileDays: row.fileDays,
    fileMonths: row.fileMonths,
    fileDay: row.fileDay,
    enforceKind: oneOr(row.enforceKind, ENFORCE_KINDS, "none"),
    enforceFrom: oneOr(row.enforceFrom, ENFORCE_FROM, "filed"),
    enforceDays: row.enforceDays,
    prelimLapses: row.prelimLapses === 1,
    citation: row.citation,
  };
}

function oneOr<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function rulesFor(db: Writer, orgId: string): Map<string, LienRuleSpec> {
  const map = new Map<string, LienRuleSpec>();
  for (const row of db.select().from(lienRules).where(eq(lienRules.orgId, orgId)).all()) map.set(row.state, specFromRow(row));
  return map;
}

function activityDays(db: Writer, orgId: string, zone: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const add = (projectId: string, day: string | null) => {
    if (!day) return;
    const list = map.get(projectId) ?? [];
    list.push(day);
    map.set(projectId, list);
  };
  for (const entry of db.select({ projectId: timeEntries.projectId, clockInAt: timeEntries.clockInAt }).from(timeEntries).where(eq(timeEntries.orgId, orgId)).all()) {
    add(entry.projectId, asDay(entry.clockInAt, zone));
  }
  for (const receipt of db
    .select({ projectId: receipts.projectId, receivedOn: receipts.receivedOn, status: receipts.status })
    .from(receipts)
    .where(eq(receipts.orgId, orgId))
    .all()) {
    if (receipt.status === "void") continue;
    add(receipt.projectId, asDay(receipt.receivedOn, zone));
  }
  for (const bill of db.select({ projectId: bills.projectId, billDate: bills.billDate, status: bills.status }).from(bills).where(eq(bills.orgId, orgId)).all()) {
    if (bill.status === "void" || bill.status === "draft") continue;
    add(bill.projectId, asDay(bill.billDate, zone));
  }
  return map;
}

function openCents(db: Writer, orgId: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const invoice of db.select().from(invoices).where(eq(invoices.orgId, orgId)).all()) {
    if (invoice.status !== "open") continue;
    const due = Math.max(0, invoice.totalCents - invoice.amountPaidCents);
    map.set(invoice.projectId, (map.get(invoice.projectId) ?? 0) + due);
  }
  return map;
}

function noticeMap(db: Writer, orgId: string): Map<string, LienNoticeMark[]> {
  const map = new Map<string, LienNoticeMark[]>();
  for (const row of db.select().from(lienNotices).where(eq(lienNotices.orgId, orgId)).all()) {
    if (!NOTICE_KINDS.includes(row.kind as NoticeKind)) continue;
    const list = map.get(row.projectId) ?? [];
    list.push({ kind: row.kind as NoticeKind, sentOn: row.sentOn });
    map.set(row.projectId, list);
  }
  return map;
}

type ProjectRow = typeof projects.$inferSelect;

function evaluateProject(project: ProjectRow, zone: string, mask: number, today: string, rule: LienRuleSpec | null, days: string[], notices: LienNoticeMark[], balance: number): LienEvaluation & { first: string; last: string; state: string; role: LienRole } {
  const span = furnishSpan(days);
  const completion = asDay(project.substantialAt, zone);
  const first = project.lienFirst || span.first;
  const last = project.lienLast || span.last || completion;
  const state = (project.lienState || stateFromAddress(project.address) || "").toUpperCase();
  const role = (ROLES.includes((project.lienRole || rule?.role || "sub") as LienRole) ? project.lienRole || rule?.role || "sub" : "sub") as LienRole;
  const evaluation = evaluateLien({
    today,
    rule: project.lienState ? rule : null,
    first,
    last,
    completion: completion || last,
    notices,
    openCents: balance,
    mask,
  });
  return { ...evaluation, first: first || "", last: last || "", state, role };
}

function contactsById(db: Writer, orgId: string): Map<string, string> {
  return new Map(db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(eq(contacts.orgId, orgId)).all().map((row) => [row.id, row.name]));
}

export function lienRulesBoard(actor: Actor): { rules: (LienRuleSpec & { id: string })[]; canEdit: boolean } {
  see(actor);
  const db = getDb();
  const rules = db
    .select()
    .from(lienRules)
    .where(eq(lienRules.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.state.localeCompare(b.state))
    .map((row) => ({ ...specFromRow(row), id: row.id }));
  return { rules, canEdit: canManageSettings(roleOf(actor)) };
}

export function saveLienRule(actor: Actor, input: LienRuleInput) {
  settings(actor);
  const state = input.state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new ServiceError("Enter a state.");
  const citation = input.citation.trim();
  if (!citation || citation.length > 160) throw new ServiceError("Enter the citation.");
  const spec: LienRuleSpec = {
    state,
    role: oneOf(input.role, ROLES, "a role"),
    prelimKind: oneOf(input.prelimKind, PRELIM_KINDS, "a preliminary kind"),
    prelimDays: whole(input.prelimDays, "preliminary days", 3650),
    prelimMonths: whole(input.prelimMonths, "preliminary months", 24),
    prelimDay: whole(input.prelimDay, "a day", 31),
    noiKind: oneOf(input.noiKind, NOI_KINDS, "an intent kind"),
    noiDays: whole(input.noiDays, "intent days", 3650),
    fileKind: oneOf(input.fileKind, FILE_KINDS, "a filing kind"),
    fileAnchor: oneOf(input.fileAnchor, ANCHORS, "an anchor"),
    fileDays: whole(input.fileDays, "filing days", 3650),
    fileMonths: whole(input.fileMonths, "filing months", 24),
    fileDay: whole(input.fileDay, "a day", 31),
    enforceKind: oneOf(input.enforceKind, ENFORCE_KINDS, "an enforcement kind"),
    enforceFrom: oneOf(input.enforceFrom, ENFORCE_FROM, "an enforcement start"),
    enforceDays: whole(input.enforceDays, "enforcement days", 3650),
    prelimLapses: input.prelimLapses,
    citation,
  };
  const db = getDb();
  const current = db
    .select()
    .from(lienRules)
    .where(and(eq(lienRules.orgId, actor.orgId), eq(lienRules.state, state)))
    .get();
  if (!current) throw new ServiceError("That state is not on the list.");
  const now = nowIso();
  db.update(lienRules)
    .set({
      role: spec.role,
      prelimKind: spec.prelimKind,
      prelimDays: spec.prelimDays,
      prelimMonths: spec.prelimMonths,
      prelimDay: spec.prelimDay,
      noiKind: spec.noiKind,
      noiDays: spec.noiDays,
      fileKind: spec.fileKind,
      fileAnchor: spec.fileAnchor,
      fileDays: spec.fileDays,
      fileMonths: spec.fileMonths,
      fileDay: spec.fileDay,
      enforceKind: spec.enforceKind,
      enforceFrom: spec.enforceFrom,
      enforceDays: spec.enforceDays,
      prelimLapses: spec.prelimLapses ? 1 : 0,
      citation: spec.citation,
      updatedAt: now,
    })
    .where(eq(lienRules.id, current.id))
    .run();
  audit(db, actor.orgId, actor.userId, "lien.rule", "lien_rule", current.id, spec);
}

export function lienJobs(actor: Actor): LienListRow[] {
  see(actor);
  const db = getDb();
  const { zone, mask, today } = clock(db, actor.orgId);
  const rules = rulesFor(db, actor.orgId);
  const days = activityDays(db, actor.orgId, zone);
  const balances = openCents(db, actor.orgId);
  const notices = noticeMap(db, actor.orgId);
  const names = contactsById(db, actor.orgId);
  return db
    .select()
    .from(projects)
    .where(eq(projects.orgId, actor.orgId))
    .all()
    .filter((project) => project.lienState)
    .map((project) => {
      const state = project.lienState!.toUpperCase();
      const view = evaluateProject(project, zone, mask, today, rules.get(state) ?? null, days.get(project.id) ?? [], notices.get(project.id) ?? [], balances.get(project.id) ?? 0);
      return {
        projectId: project.id,
        name: project.name,
        client: names.get(project.contactId) || "",
        state,
        role: view.role,
        status: view.status,
        openCents: view.openCents,
        deadlines: view.deadlines,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function lienJob(actor: Actor, projectId: string): LienJobView | null {
  see(actor);
  const db = getDb();
  const project = db
    .select()
    .from(projects)
    .where(and(eq(projects.orgId, actor.orgId), eq(projects.id, projectId)))
    .get();
  if (!project) return null;
  const { zone, mask, today } = clock(db, actor.orgId);
  const rules = rulesFor(db, actor.orgId);
  const state = (project.lienState || stateFromAddress(project.address) || "").toUpperCase();
  const view = evaluateProject(project, zone, mask, today, rules.get(state) ?? null, activityDays(db, actor.orgId, zone).get(project.id) ?? [], noticeMap(db, actor.orgId).get(project.id) ?? [], openCents(db, actor.orgId).get(project.id) ?? 0);
  const client = db
    .select({ name: contacts.name })
    .from(contacts)
    .where(and(eq(contacts.orgId, actor.orgId), eq(contacts.id, project.contactId)))
    .get();
  const marks = db
    .select()
    .from(lienNotices)
    .where(and(eq(lienNotices.orgId, actor.orgId), eq(lienNotices.projectId, project.id)))
    .all()
    .filter((row) => NOTICE_KINDS.includes(row.kind as NoticeKind))
    .map((row) => ({ kind: row.kind as NoticeKind, sentOn: row.sentOn, method: row.method }));
  return {
    projectId: project.id,
    name: project.name,
    client: client?.name || "",
    address: project.address || "",
    tracked: Boolean(project.lienState),
    state,
    role: view.role,
    first: view.first,
    last: view.last,
    status: project.lienState ? view.status : "later",
    openCents: view.openCents,
    deadlines: project.lienState ? view.deadlines : [],
    citation: rules.get(state)?.citation || "",
    canEdit: canManageMoney(roleOf(actor)),
    today,
    marks,
  };
}

export function saveLienJob(actor: Actor, projectId: string, input: { state: string; role: string; first: string; last: string }) {
  office(actor);
  const db = getDb();
  const project = db
    .select()
    .from(projects)
    .where(and(eq(projects.orgId, actor.orgId), eq(projects.id, projectId)))
    .get();
  if (!project) throw new ServiceError("Job not found.");
  const state = input.state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new ServiceError("Enter a state.");
  const role = oneOf(input.role, ROLES, "a role");
  const first = cleanOptionalDay(input.first, "the first furnish date");
  const last = cleanOptionalDay(input.last, "the last furnish date");
  const before = { state: project.lienState, role: project.lienRole, first: project.lienFirst, last: project.lienLast };
  db.update(projects)
    .set({ lienState: state, lienRole: role, lienFirst: first, lienLast: last, updatedAt: nowIso() })
    .where(eq(projects.id, project.id))
    .run();
  audit(db, actor.orgId, actor.userId, "lien.override", "project", project.id, { before, state, role, first, last });
}

function cleanOptionalDay(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) throw new ServiceError(`Enter ${label}.`);
  return trimmed;
}

export function markLienSent(actor: Actor, projectId: string, input: { kind: string; sentOn: string; method: string; upload: { filename: string; bytes: Buffer } | null }) {
  office(actor);
  const kind = oneOf(input.kind, NOTICE_KINDS, "a notice");
  const method = oneOf(input.method, METHODS, "a method");
  const sentOn = cleanOptionalDay(input.sentOn, "the sent date");
  if (!sentOn) throw new ServiceError("Enter the sent date.");
  const db = getDb();
  const { today } = clock(db, actor.orgId);
  if (sentOn > today) throw new ServiceError("Sent date is today or earlier.");
  const project = db
    .select()
    .from(projects)
    .where(and(eq(projects.orgId, actor.orgId), eq(projects.id, projectId)))
    .get();
  if (!project?.lienState) throw new ServiceError("Job not found.");
  const documentId = input.upload ? storeProof(actor, project.id, input.upload) : null;
  const now = nowIso();
  const current = db
    .select()
    .from(lienNotices)
    .where(and(eq(lienNotices.orgId, actor.orgId), eq(lienNotices.projectId, project.id), eq(lienNotices.kind, kind)))
    .get();
  if (current) {
    db.update(lienNotices)
      .set({ sentOn, method, documentId: documentId || current.documentId, updatedAt: now })
      .where(eq(lienNotices.id, current.id))
      .run();
  } else {
    db.insert(lienNotices)
      .values({
        id: id("lien"),
        orgId: actor.orgId,
        projectId: project.id,
        kind,
        sentOn,
        method,
        documentId,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
  }
  audit(db, actor.orgId, actor.userId, "lien.sent", "lien_notice", project.id, { kind, sentOn, method });
}

function storeProof(actor: Actor, projectId: string, upload: { filename: string; bytes: Buffer }) {
  const error = attachmentUploadError(upload.filename, upload.bytes);
  if (error) throw new ServiceError(error);
  const documentId = id("doc");
  const ext = attachmentExtension(upload.bytes);
  const relative = path.join("uploads", actor.orgId, `${documentId}.${ext}`);
  const absolute = path.join(dataDir(), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, upload.bytes);
  const stem = path.basename(upload.filename).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80);
  getDb()
    .insert(documents)
    .values({
      id: documentId,
      orgId: actor.orgId,
      projectId,
      leadId: null,
      contactId: null,
      type: "lien",
      filename: `${stem || "notice"}.${ext}`,
      storagePath: relative,
      metadataJson: null,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy: actor.userId,
    })
    .run();
  return documentId;
}

export function lienAttention(actor: Actor): { count: number; href: string | null } {
  if (!canSeeMoney(roleOf(actor))) return { count: 0, href: null };
  const count = lienJobs(actor).reduce((sum, row) => sum + attentionCount(row.deadlines), 0);
  return { count, href: count > 0 ? "/liens" : null };
}

export function lienCsv(actor: Actor, filter: { status?: string; state?: string } = {}): string {
  const rows = filterJobs(lienJobs(actor), filter);
  const header = ["Job", "Client", "State", "Role", "Status", "Open cents", "Preliminary", "Intent", "Filing", "Enforcement"];
  const lines = rows.map((row) => [
    row.name,
    row.client,
    row.state,
    row.role,
    row.status,
    String(row.openCents),
    dayOf(row.deadlines, "prelim"),
    dayOf(row.deadlines, "intent"),
    dayOf(row.deadlines, "filing"),
    dayOf(row.deadlines, "enforcement"),
  ]);
  return [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n");
}

function dayOf(deadlines: LienDeadline[], kind: DeadlineKind): string {
  return deadlines.find((row) => row.kind === kind)?.date || "";
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function filterJobs(rows: LienListRow[], filter: { status?: string; state?: string }): LienListRow[] {
  const status = filter.status?.trim() || "";
  const state = filter.state?.trim().toUpperCase() || "";
  return rows.filter((row) => (!status || row.status === status) && (!state || row.state === state));
}

export function lienPrint(actor: Actor, projectId: string, kind: "prelim" | "intent"): LienPrint | null {
  const job = lienJob(actor, projectId);
  if (!job?.tracked) return null;
  const db = getDb();
  const org = clock(db, actor.orgId);
  const deadline = job.deadlines.find((row) => row.kind === (kind === "prelim" ? "prelim" : "intent"));
  return {
    kind,
    title: kind === "prelim" ? "Preliminary notice" : "Notice of intent",
    orgName: org.name,
    orgPlace: [org.city, org.state].filter(Boolean).join(", "),
    client: job.client,
    job: job.name,
    address: job.address,
    unpaidCents: job.openCents,
    first: job.first || null,
    last: job.last || null,
    deadline: deadline?.date ?? null,
    citation: job.citation,
  };
}

