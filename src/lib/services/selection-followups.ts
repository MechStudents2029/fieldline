import { and, eq } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import { auditLogs, contacts, memberships, notifications, organizations, projects, selectionFollowUps, selections } from "@/lib/db/schema";
import { formatDate } from "@/lib/format";
import { id, nowIso } from "@/lib/ids";
import { canManageMoney, canManageSettings, canSeeMoney, type Role } from "@/lib/permissions";
import { appOrigin } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import type { AutomationEvent } from "@/lib/services/automations";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

export const SEL_FOLLOW_TEMPLATE = "{client}, {selection} on {job} is due {due}. {link}";

const OPEN = new Set(["draft", "ready", "copied"]);
const WAITING = new Set(["draft", "released"]);
const STATUSES = ["draft", "ready", "copied", "sent", "skipped", "void"] as const;

type Writer = Pick<AppDatabase, "insert" | "select" | "update" | "delete" | "transaction">;

let emit: (event: AutomationEvent) => void = () => {};

export function bindSelectionFollowEmit(fn: (event: AutomationEvent) => void) {
  emit = fn;
}

function dbFor(orgId: string): Writer {
  return officeDb(orgId) ?? getDb();
}

export function selectionFollowStatusLabel(status: string): string {
  if (status === "draft") return "Draft";
  if (status === "ready") return "Ready";
  if (status === "copied") return "Copied";
  if (status === "sent") return "Sent";
  if (status === "skipped") return "Skipped";
  if (status === "void") return "Void";
  return status;
}

/** True once today has reached `days` before the due date. Past due still counts. */
export function beforeWindow(today: string, due: string, days: number): boolean {
  return today >= addCalendarDays(due.slice(0, 10), -days);
}

/** True once today is `days` after the due date. */
export function afterWindow(today: string, due: string, days: number): boolean {
  return today >= addCalendarDays(due.slice(0, 10), days);
}

function tagSet(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 8),
  );
}

function excluded(projectTags: string, ban: string): boolean {
  const blocked = tagSet(ban);
  if (blocked.size === 0) return false;
  for (const tag of tagSet(projectTags)) if (blocked.has(tag)) return true;
  return false;
}

function fill(template: string, client: string, job: string, selection: string, due: string, link: string): string {
  return template
    .replaceAll("{client}", client)
    .replaceAll("{job}", job)
    .replaceAll("{selection}", selection)
    .replaceAll("{due}", due)
    .replaceAll("{link}", link)
    .slice(0, 500);
}

function selectionLink(token: string, selectionId: string): string {
  if (!token) return "";
  const origin = appOrigin(process.env);
  return `${origin ?? ""}/portal/${token}#selection-${selectionId}`;
}

function cadences(org: { selFollowBefore: number; selFollowAfter: number }): number[] {
  const rows: number[] = [];
  if (org.selFollowBefore > 0) rows.push(org.selFollowBefore);
  if (org.selFollowAfter > 0) rows.push(-org.selFollowAfter);
  return rows;
}

function dueFor(status: string, today: string, due: string, cadence: number): boolean {
  if (!WAITING.has(status)) return false;
  if (cadence > 0) {
    if (!beforeWindow(today, due, cadence)) return false;
    if (status === "released") return true;
    return today > due.slice(0, 10);
  }
  if (cadence < 0) return afterWindow(today, due, -cadence);
  return false;
}

function notify(tx: Writer, orgId: string, followId: string, snippet: string, stamp: string) {
  const owners = tx
    .select({ id: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.orgId, orgId))
    .all()
    .filter((row) => row.role === "owner" || row.role === "admin");
  for (const owner of owners) {
    tx.insert(notifications)
      .values({
        id: id("note"),
        orgId,
        userId: owner.id,
        kind: "selection",
        commentId: null,
        entityType: "selection_followup",
        entityId: followId,
        projectId: null,
        actorId: null,
        actorName: "Fieldline",
        snippet,
        readAt: null,
        createdAt: stamp,
      })
      .run();
  }
}

function dismissOpen(db: Writer, orgId: string, selectionId: string) {
  const stamp = nowIso();
  const rows = db
    .select()
    .from(selectionFollowUps)
    .where(and(eq(selectionFollowUps.orgId, orgId), eq(selectionFollowUps.selectionId, selectionId)))
    .all()
    .filter((row) => OPEN.has(row.status));
  for (const row of rows) {
    db.update(selectionFollowUps)
      .set({ status: "void", updatedAt: stamp })
      .where(and(eq(selectionFollowUps.orgId, orgId), eq(selectionFollowUps.id, row.id)))
      .run();
  }
}

/** Chosen and locked selections drop open follow-ups. One row per selection and cadence. */
export function scanSelectionFollowUps(orgId: string): { created: number } {
  const db = dbFor(orgId);
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) return { created: 0 };
  const today = localDay(Date.now(), org.timeZone || "America/New_York");
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row]));
  const people = new Map(db.select().from(contacts).where(eq(contacts.orgId, orgId)).all().map((row) => [row.id, row.name]));
  let created = 0;
  for (const selection of db.select().from(selections).where(eq(selections.orgId, orgId)).all()) {
    if (!WAITING.has(selection.status)) {
      dismissOpen(db, orgId, selection.id);
      continue;
    }
    if (org.selFollowEnabled !== 1) continue;
    const project = jobs.get(selection.projectId);
    if (!project || excluded(project.tags, org.selFollowExcludeTags)) continue;
    const due = selection.dueDate?.slice(0, 10);
    if (!due) continue;
    for (const cadence of cadences(org)) {
      if (!dueFor(selection.status, today, due, cadence)) continue;
      const existing = db
        .select()
        .from(selectionFollowUps)
        .where(and(eq(selectionFollowUps.orgId, orgId), eq(selectionFollowUps.selectionId, selection.id), eq(selectionFollowUps.cadenceDays, cadence)))
        .get();
      if (existing) continue;
      const link = selectionLink(project.portalToken, selection.id);
      const client = people.get(project.contactId) || "Client";
      const template = org.selFollowTemplate.trim() || SEL_FOLLOW_TEMPLATE;
      const stamp = nowIso();
      const followId = id("sfol");
      const status = link ? "ready" : "draft";
      db.insert(selectionFollowUps)
        .values({
          id: followId,
          orgId,
          selectionId: selection.id,
          projectId: project.id,
          contactId: project.contactId,
          cadenceDays: cadence,
          status,
          url: link,
          message: fill(template, client, project.name, selection.title, formatDate(due), link),
          skipReason: "",
          createdAt: stamp,
          updatedAt: stamp,
          copiedAt: null,
          sentAt: null,
        })
        .run();
      db.insert(auditLogs)
        .values({
          id: id("audit"),
          orgId,
          actorId: null,
          action: "selfollow.create",
          entityType: "selection_followup",
          entityId: followId,
          payloadJson: JSON.stringify({ selectionId: selection.id, cadence, status }),
          ip: null,
          createdAt: stamp,
        })
        .run();
      notify(db, orgId, followId, selection.title, stamp);
      created += 1;
      emit({
        orgId,
        kind: "selection_followup_created",
        recordType: "selection_followup",
        recordId: followId,
        recordLabel: selection.title,
        projectId: project.id,
        name: client,
      });
    }
  }
  return { created };
}

export function dismissSelectionFollowUps(orgId: string, selectionId: string) {
  dismissOpen(dbFor(orgId), orgId, selectionId);
}

export function selectionFollowAttention(orgId: string) {
  const count = dbFor(orgId)
    .select()
    .from(selectionFollowUps)
    .where(eq(selectionFollowUps.orgId, orgId))
    .all()
    .filter((row) => row.status === "ready").length;
  return { count, href: count > 0 ? "/selection-followups" : null };
}

export function selectionFollowNotice(db: Writer, orgId: string, followId: string) {
  const row = db.select().from(selectionFollowUps).where(and(eq(selectionFollowUps.orgId, orgId), eq(selectionFollowUps.id, followId))).get();
  if (!row) return null;
  const selection = db.select().from(selections).where(and(eq(selections.orgId, orgId), eq(selections.id, row.selectionId))).get();
  return { record: selection?.title || "Selection", href: `/selection-followups/${row.id}` };
}

export function selectionFollowMonth(orgId: string) {
  const db = dbFor(orgId);
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  const month = localDay(Date.now(), org?.timeZone || "America/New_York").slice(0, 7);
  const rows = db.select().from(selectionFollowUps).where(eq(selectionFollowUps.orgId, orgId)).all();
  const ready = rows.filter((row) => row.status === "ready");
  return {
    created: rows.filter((row) => row.createdAt.slice(0, 7) === month).length,
    sent: rows.filter((row) => row.sentAt && row.sentAt.slice(0, 7) === month).length,
    skipped: rows.filter((row) => row.status === "skipped" && row.updatedAt.slice(0, 7) === month).length,
    ready: ready.length,
  };
}

export function selectionFollowSettings(actor: Actor) {
  if (!canManageSettings(actor.role as Role)) return null;
  const org = dbFor(actor.orgId).select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  if (!org) return null;
  return {
    enabled: org.selFollowEnabled === 1,
    before: org.selFollowBefore,
    after: org.selFollowAfter,
    exclude: org.selFollowExcludeTags || "",
    template: org.selFollowTemplate || SEL_FOLLOW_TEMPLATE,
  };
}

export function saveSelectionFollowSettings(
  actor: Actor,
  input: { enabled: boolean; before: number; after: number; exclude: string; template: string },
) {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("Only an owner or admin can change selection follow-ups.");
  const before = Math.trunc(Number(input.before));
  const afterRaw = Math.trunc(Number(input.after));
  if (!Number.isInteger(before) || before < 1 || before > 90) throw new ServiceError("Use a day from 1 to 90.");
  let after = afterRaw;
  if (!after) after = 0;
  else if (!Number.isInteger(after) || after < 1 || after > 90) throw new ServiceError("Use a day from 1 to 90.");
  const exclude = [...tagSet(input.exclude)].join(", ");
  const template = input.template.trim().slice(0, 400) || SEL_FOLLOW_TEMPLATE;
  dbFor(actor.orgId)
    .update(organizations)
    .set({
      selFollowEnabled: input.enabled ? 1 : 0,
      selFollowBefore: before,
      selFollowAfter: after,
      selFollowExcludeTags: exclude,
      selFollowTemplate: template,
      updatedAt: nowIso(),
    })
    .where(eq(organizations.id, actor.orgId))
    .run();
}

function canSee(actor: Actor) {
  return canSeeMoney(actor.role as Role) && actor.role !== "field";
}

export function listSelectionFollowUps(actor: Actor, status?: string) {
  if (!canSee(actor)) return [];
  const wanted = status && (STATUSES as readonly string[]).includes(status) ? status : "";
  const db = dbFor(actor.orgId);
  const rows = new Map(db.select().from(selections).where(eq(selections.orgId, actor.orgId)).all().map((row) => [row.id, row]));
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  const people = new Map(db.select().from(contacts).where(eq(contacts.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  return db
    .select()
    .from(selectionFollowUps)
    .where(eq(selectionFollowUps.orgId, actor.orgId))
    .all()
    .filter((row) => !wanted || row.status === wanted)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((row) => {
      const selection = rows.get(row.selectionId);
      return {
        id: row.id,
        selection: selection?.title || "Selection",
        job: jobs.get(row.projectId) || "Job",
        client: people.get(row.contactId) || "Client",
        status: row.status,
        statusLabel: selectionFollowStatusLabel(row.status),
        due: selection?.dueDate ? formatDate(selection.dueDate) : "",
        cadence: row.cadenceDays,
      };
    });
}

export function selectionFollowCsv(actor: Actor, status?: string): string | null {
  if (!canSee(actor)) return null;
  const lines = ["Selection,Job,Client,Status,Due,Days,Link"];
  const db = dbFor(actor.orgId);
  const links = new Map(db.select().from(selectionFollowUps).where(eq(selectionFollowUps.orgId, actor.orgId)).all().map((row) => [row.id, row.url]));
  for (const row of listSelectionFollowUps(actor, status)) {
    lines.push(
      [row.selection, row.job, row.client, row.statusLabel, row.due, String(row.cadence), links.get(row.id) || ""].map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
    );
  }
  return lines.join("\n");
}

export function selectionFollowDetail(actor: Actor, followId: string) {
  if (!canSee(actor)) return null;
  const db = dbFor(actor.orgId);
  const row = db.select().from(selectionFollowUps).where(and(eq(selectionFollowUps.orgId, actor.orgId), eq(selectionFollowUps.id, followId))).get();
  if (!row) return null;
  const selection = db.select().from(selections).where(and(eq(selections.orgId, actor.orgId), eq(selections.id, row.selectionId))).get();
  const contact = db.select().from(contacts).where(and(eq(contacts.orgId, actor.orgId), eq(contacts.id, row.contactId))).get();
  const project = db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, row.projectId))).get();
  return {
    id: row.id,
    selection: selection?.title || "Selection",
    client: contact?.name || "Client",
    job: project?.name || "Job",
    status: row.status,
    statusLabel: selectionFollowStatusLabel(row.status),
    url: row.url,
    message: row.message,
    skipReason: row.skipReason,
    tags: project?.tags || "",
    cadence: row.cadenceDays,
    due: selection?.dueDate ? formatDate(selection.dueDate) : "",
    canEdit: canManageMoney(actor.role as Role),
  };
}

function requireRow(actor: Actor, followId: string) {
  const row = dbFor(actor.orgId)
    .select()
    .from(selectionFollowUps)
    .where(and(eq(selectionFollowUps.orgId, actor.orgId), eq(selectionFollowUps.id, followId)))
    .get();
  if (!row) throw new ServiceError("That follow-up is not in your company.");
  return row;
}

export function saveSelectionFollowTags(actor: Actor, followId: string, tags: string) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Your role cannot change this follow-up.");
  const row = requireRow(actor, followId);
  const cleaned = [...tagSet(tags)].join(", ");
  dbFor(actor.orgId).update(projects).set({ tags: cleaned, updatedAt: nowIso() }).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, row.projectId))).run();
}

export function markSelectionFollowUp(actor: Actor, followId: string, action: "copy" | "sent" | "skip" | "void", reason = "") {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Your role cannot change this follow-up.");
  const row = requireRow(actor, followId);
  if (row.status === "void") throw new ServiceError("That follow-up is closed.");
  const stamp = nowIso();
  const db = dbFor(actor.orgId);
  if (action === "skip") {
    const why = reason.trim().slice(0, 200);
    if (why.length < 2) throw new ServiceError("Add a reason.");
    db.update(selectionFollowUps).set({ status: "skipped", skipReason: why, updatedAt: stamp }).where(and(eq(selectionFollowUps.orgId, actor.orgId), eq(selectionFollowUps.id, row.id))).run();
    audit(db, actor, "selfollow.skip", row.id, { reason: why });
    return;
  }
  if (action === "void") {
    db.update(selectionFollowUps).set({ status: "void", updatedAt: stamp }).where(and(eq(selectionFollowUps.orgId, actor.orgId), eq(selectionFollowUps.id, row.id))).run();
    audit(db, actor, "selfollow.void", row.id, null);
    return;
  }
  if (action === "copy") {
    db.update(selectionFollowUps)
      .set({ status: row.status === "sent" || row.status === "skipped" ? row.status : "copied", copiedAt: stamp, updatedAt: stamp })
      .where(and(eq(selectionFollowUps.orgId, actor.orgId), eq(selectionFollowUps.id, row.id)))
      .run();
    audit(db, actor, "selfollow.copy", row.id, null);
    return;
  }
  db.update(selectionFollowUps)
    .set({ status: "sent", sentAt: row.sentAt || stamp, updatedAt: stamp })
    .where(and(eq(selectionFollowUps.orgId, actor.orgId), eq(selectionFollowUps.id, row.id)))
    .run();
  audit(db, actor, "selfollow.sent", row.id, null);
  const selection = db.select().from(selections).where(and(eq(selections.orgId, actor.orgId), eq(selections.id, row.selectionId))).get();
  emit({
    orgId: actor.orgId,
    kind: "selection_followup_marked_sent",
    recordType: "selection_followup",
    recordId: row.id,
    recordLabel: selection?.title || "Selection",
    projectId: row.projectId,
    name: actor.name,
  });
}

function audit(db: Writer, actor: Actor, action: string, entityId: string, payload: unknown) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action,
      entityType: "selection_followup",
      entityId,
      payloadJson: payload ? JSON.stringify(payload) : null,
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

export function portalSelectionDue(token: string): Set<string> {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, token)).get();
  if (!project) return new Set();
  const ids = db
    .select()
    .from(selectionFollowUps)
    .where(eq(selectionFollowUps.orgId, project.orgId))
    .all()
    .filter((row) => row.projectId === project.id && (row.status === "ready" || row.status === "copied"))
    .map((row) => row.selectionId);
  return new Set(ids);
}
