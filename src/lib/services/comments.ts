import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDir, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  bills,
  changeOrders,
  commentAttempts,
  commentFiles,
  commentMentions,
  comments,
  dailyLogs,
  documents,
  estimates,
  leads,
  memberships,
  notificationSettings,
  notifications,
  projects,
  punchItems,
  purchaseOrders,
  rfis,
  scheduleItems,
  tasks,
  users,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canAddFieldNotes, canSeeMoney, type Role } from "@/lib/permissions";
import { rfiLabel } from "@/lib/rfis/format";
import { sweepTodoReminders } from "@/lib/services/todos";
import { photoExtension, photoUploadError, rasterImageType } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";

export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const COMMENT_USER_LIMIT = 20;
export const COMMENT_WINDOW_MS = 10 * 60 * 1000;
export const FINANCIAL_ENTITIES = ["estimate", "change_order", "purchase_order", "bill"] as const;

export const ROLE_GROUPS = {
  office: ["estimator"],
  field: ["field"],
  admins: ["owner", "admin"],
} as const;

export type MentionRole = keyof typeof ROLE_GROUPS;
export type CommentEntity =
  | "project"
  | "estimate"
  | "change_order"
  | "purchase_order"
  | "bill"
  | "rfi"
  | "punch_item"
  | "daily_log"
  | "schedule_item";

const ENTITIES = new Set<CommentEntity>([
  "project",
  "estimate",
  "change_order",
  "purchase_order",
  "bill",
  "rfi",
  "punch_item",
  "daily_log",
  "schedule_item",
]);

const ROLE_ALIAS: Record<string, MentionRole> = {
  office: "office",
  field: "field",
  admins: "admins",
  admin: "admins",
};

export type MentionDraft = { kind: "user"; userId: string } | { kind: "role"; role: MentionRole };

type Member = { id: string; name: string; role: string };

type EntityRef = {
  type: CommentEntity;
  id: string;
  projectId: string | null;
  job: string;
  record: string;
  href: string;
};

export type CommentPart = { kind: "text" | "pill"; text: string };

export type CommentRow = {
  id: string;
  author: string;
  authorId: string;
  age: string;
  edited: boolean;
  parts: CommentPart[];
  plain: string;
  files: { id: string; filename: string }[];
  canEdit: boolean;
  canDelete: boolean;
};

export type CommentThread = {
  comments: CommentRow[];
  people: { id: string; name: string }[];
  canPost: boolean;
};

export type InboxItem = {
  id: string;
  kind: string;
  who: string;
  record: string;
  snippet: string;
  age: string;
  unread: boolean;
};

type PhotoUpload = { filename: string; bytes: Buffer };

function dbFor(actor: Actor): AppDatabase {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("That record is not in your company.");
  return db;
}

function roleOf(actor: Actor): Role {
  return actor.role as Role;
}

export function shortAge(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function roleWord(role: string): string {
  if (role === "office") return "Office";
  if (role === "field") return "Field";
  if (role === "admins") return "Admins";
  return role;
}

function financial(type: string): boolean {
  return (FINANCIAL_ENTITIES as readonly string[]).includes(type);
}

function membersOf(db: AppDatabase, orgId: string): Member[] {
  return db
    .select({ id: users.id, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all();
}

function canMemberSee(member: Member, type: string): boolean {
  if (financial(type) && !canSeeMoney(member.role as Role)) return false;
  return true;
}

function jobName(db: AppDatabase, orgId: string, projectId: string | null): string {
  if (!projectId) return "";
  const row = db
    .select({ name: projects.name })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId)))
    .get();
  return row?.name ?? "";
}

function taskNotice(db: AppDatabase, orgId: string, entityId: string): { record: string; href: string } | null {
  const row = db.select().from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.id, entityId))).get();
  if (!row) return null;
  return { record: row.title, href: `/todos?task=${row.id}` };
}

function resolveEntity(db: AppDatabase, orgId: string, type: string, entityId: string): EntityRef | null {
  if (!ENTITIES.has(type as CommentEntity)) return null;
  const kind = type as CommentEntity;
  if (kind === "project") {
    const row = db.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, entityId))).get();
    if (!row) return null;
    return { type: kind, id: row.id, projectId: row.id, job: row.name, record: row.name, href: `/projects/${row.id}` };
  }
  if (kind === "estimate") {
    const row = db.select().from(estimates).where(and(eq(estimates.orgId, orgId), eq(estimates.id, entityId))).get();
    if (!row) return null;
    const lead = db.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.id, row.leadId))).get();
    const job = lead?.title ?? row.title;
    return { type: kind, id: row.id, projectId: null, job, record: row.title, href: `/estimates/${row.id}` };
  }
  if (kind === "change_order") {
    const row = db.select().from(changeOrders).where(and(eq(changeOrders.orgId, orgId), eq(changeOrders.id, entityId))).get();
    if (!row) return null;
    const job = jobName(db, orgId, row.projectId);
    return { type: kind, id: row.id, projectId: row.projectId, job, record: `CO-${row.number}`, href: `/projects/${row.projectId}/orders/${row.id}` };
  }
  if (kind === "purchase_order") {
    const row = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.id, entityId))).get();
    if (!row) return null;
    const job = jobName(db, orgId, row.projectId);
    return { type: kind, id: row.id, projectId: row.projectId, job, record: row.number, href: `/purchase-orders/${row.id}` };
  }
  if (kind === "bill") {
    const row = db.select().from(bills).where(and(eq(bills.orgId, orgId), eq(bills.id, entityId))).get();
    if (!row) return null;
    const job = jobName(db, orgId, row.projectId);
    return { type: kind, id: row.id, projectId: row.projectId, job, record: row.billNumber || "Bill", href: `/bills/${row.id}` };
  }
  if (kind === "rfi") {
    const row = db.select().from(rfis).where(and(eq(rfis.orgId, orgId), eq(rfis.id, entityId))).get();
    if (!row) return null;
    const job = jobName(db, orgId, row.projectId);
    return { type: kind, id: row.id, projectId: row.projectId, job, record: rfiLabel(row.number), href: `/projects/${row.projectId}/rfis/${row.id}` };
  }
  if (kind === "punch_item") {
    const row = db.select().from(punchItems).where(and(eq(punchItems.orgId, orgId), eq(punchItems.id, entityId))).get();
    if (!row) return null;
    const job = jobName(db, orgId, row.projectId);
    return { type: kind, id: row.id, projectId: row.projectId, job, record: row.title, href: `/projects/${row.projectId}/punch/${row.id}` };
  }
  if (kind === "daily_log") {
    const row = db.select().from(dailyLogs).where(and(eq(dailyLogs.orgId, orgId), eq(dailyLogs.id, entityId))).get();
    if (!row) return null;
    const job = jobName(db, orgId, row.projectId);
    return { type: kind, id: row.id, projectId: row.projectId, job, record: `Log ${row.logDate}`, href: `/projects/${row.projectId}/logs/${row.id}` };
  }
  const row = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.id, entityId))).get();
  if (!row) return null;
  const job = jobName(db, orgId, row.projectId);
  return { type: kind, id: row.id, projectId: row.projectId, job, record: row.title, href: `/schedule/items/${row.id}` };
}

function recordLine(entity: EntityRef): string {
  if (entity.type === "project" || entity.job === entity.record) return entity.job;
  return `${entity.job} · ${entity.record}`;
}

export function commentParts(body: string, names: Map<string, string>): CommentPart[] {
  const parts: CommentPart[] = [];
  const re = /@\[(user|role):([a-z0-9_]+)\]/g;
  let last = 0;
  for (const match of body.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ kind: "text", text: body.slice(last, index) });
    const label = match[1] === "role" ? roleWord(match[2] ?? "") : names.get(match[2] ?? "") ?? "Someone";
    parts.push({ kind: "pill", text: label });
    last = index + match[0].length;
  }
  if (last < body.length) parts.push({ kind: "text", text: body.slice(last) });
  return parts;
}

export function commentPlain(body: string, names: Map<string, string>): string {
  return body.replace(/@\[(user|role):([a-z0-9_]+)\]/g, (_full, kind: string, value: string) => {
    if (kind === "role") return `@${value}`;
    return `@${names.get(value) ?? value}`;
  });
}

export function parseMentions(raw: string, members: { id: string; name: string }[]): { body: string; mentions: MentionDraft[]; error?: string } {
  let text = raw.replace(/\u0000/g, "").replace(/\r\n/g, "\n");
  if (text.trim().length > 2000) return { body: text, mentions: [], error: "Comment is too long." };
  const mentions: MentionDraft[] = [];
  const seen = new Set<string>();
  let error: string | undefined;
  const add = (mention: MentionDraft) => {
    const key = mention.kind === "user" ? `user:${mention.userId}` : `role:${mention.role}`;
    if (seen.has(key)) return;
    seen.add(key);
    mentions.push(mention);
  };
  text = text.replace(/@\[(user|role):([a-z0-9_]+)\]/g, (full, kind: string, value: string) => {
    if (kind === "user") {
      if (!members.some((member) => member.id === value)) {
        error = `No match for @${value}`;
        return full;
      }
      add({ kind: "user", userId: value });
      return `@[user:${value}]`;
    }
    const role = ROLE_ALIAS[value];
    if (!role) {
      error = `No match for @${value}`;
      return full;
    }
    add({ kind: "role", role });
    return `@[role:${role}]`;
  });
  if (error) return { body: text, mentions, error };
  const names = [...members].sort((a, b) => b.name.length - a.name.length);
  for (const member of names) {
    const escaped = member.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^\\w])@${escaped}(?=$|[^\\w])`, "i");
    if (!re.test(text)) continue;
    add({ kind: "user", userId: member.id });
    text = text.replace(new RegExp(`(^|[^\\w])@${escaped}(?=$|[^\\w])`, "gi"), `$1@[user:${member.id}]`);
  }
  text = text.replace(/(^|[^\w])@(office|field|admins|admin)(?=$|[^\w])/gi, (_full, pre: string, word: string) => {
    const role = ROLE_ALIAS[word.toLowerCase()];
    if (!role) return `${pre}@${word}`;
    add({ kind: "role", role });
    return `${pre}@[role:${role}]`;
  });
  const stripped = text.replace(/@\[(?:user|role):[a-z0-9_]+\]/g, "");
  const leftover = stripped.match(/(^|[^\w@])@([A-Za-z][\w.'-]*)/);
  if (leftover) return { body: text, mentions, error: `No match for @${leftover[2]}` };
  return { body: text.trim(), mentions };
}

function snippetOf(body: string, names: Map<string, string>): string {
  return commentPlain(body, names).replace(/\s+/g, " ").trim().slice(0, 90);
}

function notifyMode(db: AppDatabase, orgId: string, userId: string): "mentions" | "all" {
  const row = db
    .select()
    .from(notificationSettings)
    .where(and(eq(notificationSettings.orgId, orgId), eq(notificationSettings.userId, userId)))
    .get();
  return row?.mode === "mentions" ? "mentions" : "all";
}

function expandMentions(mentions: MentionDraft[], members: Member[], type: string): Map<string, "mention"> {
  const recipients = new Map<string, "mention">();
  for (const mention of mentions) {
    if (mention.kind === "user") {
      const member = members.find((row) => row.id === mention.userId);
      if (member && canMemberSee(member, type)) recipients.set(member.id, "mention");
      continue;
    }
    for (const member of members) {
      if (!(ROLE_GROUPS[mention.role] as readonly string[]).includes(member.role)) continue;
      if (!canMemberSee(member, type)) continue;
      if (!recipients.has(member.id)) recipients.set(member.id, "mention");
    }
  }
  return recipients;
}

function insertNotice(
  db: AppDatabase,
  orgId: string,
  userId: string,
  kind: string,
  entity: EntityRef,
  actorId: string | null,
  actorName: string,
  snippet: string,
  commentId: string | null,
) {
  const href = commentId ? `${entity.href}#comment-${commentId}` : `${entity.href}#comments`;
  db.insert(notifications)
    .values({
      id: id("note"),
      orgId,
      userId,
      kind,
      commentId,
      entityType: entity.type,
      entityId: entity.id,
      projectId: entity.projectId,
      actorId,
      actorName,
      snippet,
      readAt: null,
      createdAt: nowIso(),
    })
    .run();
}

function fanOut(
  db: AppDatabase,
  orgId: string,
  actor: { userId: string; name: string },
  entity: EntityRef,
  commentId: string,
  mentions: MentionDraft[],
  members: Member[],
  snippet: string,
) {
  const recipients = expandMentions(mentions, members, entity.type);
  const prior = db
    .select()
    .from(comments)
    .where(and(eq(comments.orgId, orgId), eq(comments.entityType, entity.type), eq(comments.entityId, entity.id)))
    .all()
    .filter((row) => !row.deletedAt && row.id !== commentId);
  const replyIds = new Set(prior.map((row) => row.authorId));
  for (const [userId] of recipients) {
    if (userId === actor.userId) continue;
    insertNotice(db, orgId, userId, "mention", entity, actor.userId, actor.name, snippet, commentId);
  }
  for (const userId of replyIds) {
    if (userId === actor.userId || recipients.has(userId)) continue;
    if (notifyMode(db, orgId, userId) === "mentions") continue;
    const member = members.find((row) => row.id === userId);
    if (!member || !canMemberSee(member, entity.type)) continue;
    insertNotice(db, orgId, userId, "reply", entity, actor.userId, actor.name, snippet, commentId);
  }
}

function guardRate(db: AppDatabase, orgId: string, userId: string) {
  const since = new Date(Date.now() - COMMENT_WINDOW_MS).toISOString();
  const recent = db
    .select()
    .from(commentAttempts)
    .where(and(eq(commentAttempts.orgId, orgId), eq(commentAttempts.userId, userId)))
    .all()
    .filter((row) => row.createdAt >= since);
  if (recent.length >= COMMENT_USER_LIMIT) throw new ServiceError("Wait a few minutes");
  db.insert(commentAttempts)
    .values({ id: id("catt"), orgId, userId, createdAt: nowIso() })
    .run();
}

function cleanBody(raw: string, members: Member[], entity: EntityRef): { body: string; mentions: MentionDraft[] } {
  const parsed = parseMentions(raw, members);
  if (parsed.error) throw new ServiceError(parsed.error);
  if (!parsed.body) throw new ServiceError("Add a comment.");
  for (const mention of parsed.mentions) {
    if (mention.kind !== "user") continue;
    const member = members.find((row) => row.id === mention.userId);
    if (!member || !canMemberSee(member, entity.type)) throw new ServiceError(`${member?.name ?? "That person"} cannot see this`);
  }
  return parsed;
}

function storePhoto(db: AppDatabase, orgId: string, projectId: string | null, upload: PhotoUpload, createdBy: string): string {
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
      contactId: null,
      type: "photo",
      filename: `${stem || "photo"}.${ext}`,
      storagePath: relative,
      metadataJson: null,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy,
    })
    .run();
  return documentId;
}

function writeAudit(db: AppDatabase, orgId: string, actorId: string, action: string, entityId: string, payload: Record<string, unknown>) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "comment",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function assertPost(actor: Actor) {
  if (!canAddFieldNotes(roleOf(actor))) throw new ServiceError("Your role cannot change this.");
}

function loadEntity(actor: Actor, type: string, entityId: string): { db: AppDatabase; entity: EntityRef; members: Member[] } {
  const db = dbFor(actor);
  const entity = resolveEntity(db, actor.orgId, type, entityId);
  if (!entity) throw new ServiceError("That record is not in your company.");
  if (financial(entity.type) && !canSeeMoney(roleOf(actor))) throw new ServiceError("Your role cannot see this.");
  return { db, entity, members: membersOf(db, actor.orgId) };
}

export function recordHeading(actor: Actor, type: string, entityId: string): { title: string; job: string; projectId: string | null } | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const entity = resolveEntity(db, actor.orgId, type, entityId);
  if (!entity) return null;
  if (financial(entity.type) && !canSeeMoney(roleOf(actor))) return null;
  return { title: entity.record, job: entity.job, projectId: entity.projectId };
}

export function commentThread(actor: Actor, type: string, entityId: string): CommentThread | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const entity = resolveEntity(db, actor.orgId, type, entityId);
  if (!entity) return null;
  if (financial(entity.type) && !canSeeMoney(roleOf(actor))) return null;
  const members = membersOf(db, actor.orgId);
  const names = new Map(members.map((member) => [member.id, member.name]));
  const rows = db
    .select()
    .from(comments)
    .where(and(eq(comments.orgId, actor.orgId), eq(comments.entityType, entity.type), eq(comments.entityId, entity.id)))
    .all()
    .filter((row) => !row.deletedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ids = rows.map((row) => row.id);
  const files = ids.length
    ? db
        .select()
        .from(commentFiles)
        .where(eq(commentFiles.orgId, actor.orgId))
        .all()
        .filter((row) => ids.includes(row.commentId))
    : [];
  const docIds = [...new Set(files.map((row) => row.documentId))];
  const docs = docIds.length
    ? db
        .select()
        .from(documents)
        .where(eq(documents.orgId, actor.orgId))
        .all()
        .filter((row) => docIds.includes(row.id) && !row.deletedAt)
    : [];
  const now = Date.now();
  return {
    canPost: canAddFieldNotes(roleOf(actor)),
    people: members.filter((member) => canMemberSee(member, entity.type)).map((member) => ({ id: member.id, name: member.name })),
    comments: rows.map((row) => {
      const mine = row.authorId === actor.userId;
      const fresh = now - Date.parse(row.createdAt) <= EDIT_WINDOW_MS;
      return {
        id: row.id,
        authorId: row.authorId,
        author: names.get(row.authorId) ?? "Someone",
        age: shortAge(row.createdAt, now),
        edited: Boolean(row.editedAt),
        parts: commentParts(row.body, names),
        plain: commentPlain(row.body, names),
        files: files
          .filter((file) => file.commentId === row.id)
          .map((file) => docs.find((doc) => doc.id === file.documentId))
          .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc))
          .map((doc) => ({ id: doc.id, filename: doc.filename })),
        canEdit: mine && fresh,
        canDelete: mine,
      };
    }),
  };
}

export function postComment(actor: Actor, type: string, entityId: string, raw: string, photo?: PhotoUpload | null): string {
  assertPost(actor);
  const { db, entity, members } = loadEntity(actor, type, entityId);
  guardRate(db, actor.orgId, actor.userId);
  const parsed = cleanBody(raw, members, entity);
  const commentId = id("cmt");
  const names = new Map(members.map((member) => [member.id, member.name]));
  const documentId = photo && photo.bytes.length > 0 ? storePhoto(db, actor.orgId, entity.projectId, photo, actor.userId) : null;
  const stamp = nowIso();
  db.transaction((tx) => {
    const database = tx as unknown as AppDatabase;
    database
      .insert(comments)
      .values({
        id: commentId,
        orgId: actor.orgId,
        entityType: entity.type,
        entityId: entity.id,
        projectId: entity.projectId,
        authorId: actor.userId,
        body: parsed.body,
        createdAt: stamp,
        editedAt: null,
        deletedAt: null,
      })
      .run();
    for (const mention of parsed.mentions) {
      database
        .insert(commentMentions)
        .values({
          id: id("cmn"),
          orgId: actor.orgId,
          commentId,
          kind: mention.kind,
          userId: mention.kind === "user" ? mention.userId : null,
          role: mention.kind === "role" ? mention.role : null,
        })
        .run();
    }
    if (documentId) {
      database
        .insert(commentFiles)
        .values({ id: id("cfile"), orgId: actor.orgId, commentId, documentId })
        .run();
    }
    fanOut(database, actor.orgId, actor, entity, commentId, parsed.mentions, members, snippetOf(parsed.body, names));
    writeAudit(database, actor.orgId, actor.userId, "comment.create", commentId, { entityType: entity.type, entityId: entity.id });
  });
  return commentId;
}

export function editComment(actor: Actor, commentId: string, raw: string) {
  assertPost(actor);
  const db = dbFor(actor);
  const row = db.select().from(comments).where(and(eq(comments.orgId, actor.orgId), eq(comments.id, commentId))).get();
  if (!row || row.deletedAt) throw new ServiceError("That comment is not in your company.");
  if (row.authorId !== actor.userId) throw new ServiceError("You can edit your own comment");
  if (Date.now() - Date.parse(row.createdAt) > EDIT_WINDOW_MS) throw new ServiceError("Edits close after 15 minutes");
  const entity = resolveEntity(db, actor.orgId, row.entityType, row.entityId);
  if (!entity) throw new ServiceError("That record is not in your company.");
  if (financial(entity.type) && !canSeeMoney(roleOf(actor))) throw new ServiceError("Your role cannot see this.");
  const members = membersOf(db, actor.orgId);
  const parsed = cleanBody(raw, members, entity);
  const names = new Map(members.map((member) => [member.id, member.name]));
  const already = new Set(
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.orgId, actor.orgId), eq(notifications.commentId, row.id)))
      .all()
      .map((notice) => notice.userId),
  );
  db.transaction((tx) => {
    const database = tx as unknown as AppDatabase;
    database
      .update(comments)
      .set({ body: parsed.body, editedAt: nowIso() })
      .where(and(eq(comments.orgId, actor.orgId), eq(comments.id, row.id)))
      .run();
    database.delete(commentMentions).where(and(eq(commentMentions.orgId, actor.orgId), eq(commentMentions.commentId, row.id))).run();
    for (const mention of parsed.mentions) {
      database
        .insert(commentMentions)
        .values({
          id: id("cmn"),
          orgId: actor.orgId,
          commentId: row.id,
          kind: mention.kind,
          userId: mention.kind === "user" ? mention.userId : null,
          role: mention.kind === "role" ? mention.role : null,
        })
        .run();
    }
    const recipients = expandMentions(parsed.mentions, members, entity.type);
    for (const [userId] of recipients) {
      if (userId === actor.userId || already.has(userId)) continue;
      insertNotice(database, actor.orgId, userId, "mention", entity, actor.userId, actor.name, snippetOf(parsed.body, names), row.id);
    }
    writeAudit(database, actor.orgId, actor.userId, "comment.edit", row.id, { entityType: entity.type, entityId: entity.id });
  });
}

export function deleteComment(actor: Actor, commentId: string) {
  assertPost(actor);
  const db = dbFor(actor);
  const row = db.select().from(comments).where(and(eq(comments.orgId, actor.orgId), eq(comments.id, commentId))).get();
  if (!row || row.deletedAt) throw new ServiceError("That comment is not in your company.");
  if (row.authorId !== actor.userId) throw new ServiceError("You can delete your own comment");
  const entity = resolveEntity(db, actor.orgId, row.entityType, row.entityId);
  if (!entity) throw new ServiceError("That record is not in your company.");
  if (financial(entity.type) && !canSeeMoney(roleOf(actor))) throw new ServiceError("Your role cannot see this.");
  db.transaction((tx) => {
    const database = tx as unknown as AppDatabase;
    database
      .update(comments)
      .set({ deletedAt: nowIso() })
      .where(and(eq(comments.orgId, actor.orgId), eq(comments.id, row.id)))
      .run();
    writeAudit(database, actor.orgId, actor.userId, "comment.delete", row.id, { entityType: row.entityType, entityId: row.entityId });
  });
}

export function listInbox(actor: Actor, filter: "unread" | "mentions" | "all"): InboxItem[] {
  const db = officeDb(actor.orgId);
  if (!db) return [];
  sweepTodoReminders(db, actor.orgId);
  const members = membersOf(db, actor.orgId);
  const names = new Map(members.map((member) => [member.id, member.name]));
  const rows = db
    .select()
    .from(notifications)
    .where(and(eq(notifications.orgId, actor.orgId), eq(notifications.userId, actor.userId)))
    .all()
    .filter((row) => {
      if (filter === "unread" && row.readAt) return false;
      if (filter === "mentions" && row.kind !== "mention") return false;
      if (row.entityType === "task") return Boolean(taskNotice(db, actor.orgId, row.entityId));
      const entity = resolveEntity(db, actor.orgId, row.entityType, row.entityId);
      if (!entity) return false;
      if (financial(entity.type) && !canSeeMoney(roleOf(actor))) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows.map((row) => {
    const task = row.entityType === "task" ? taskNotice(db, actor.orgId, row.entityId) : null;
    const entity = task ? null : resolveEntity(db, actor.orgId, row.entityType, row.entityId);
    return {
      id: row.id,
      kind: row.kind,
      who: (row.actorId && names.get(row.actorId)) || row.actorName,
      record: task?.record ?? (entity ? recordLine(entity) : row.entityType),
      snippet: row.snippet,
      age: shortAge(row.createdAt),
      unread: !row.readAt,
    };
  });
}

export function inboxUnread(actor: Actor): number {
  return listInbox(actor, "unread").length;
}

export function mentionUnread(actor: Actor): number {
  return listInbox(actor, "unread").filter((row) => row.kind === "mention").length;
}

export function openNotification(actor: Actor, noticeId: string): string | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const row = db
    .select()
    .from(notifications)
    .where(and(eq(notifications.orgId, actor.orgId), eq(notifications.userId, actor.userId), eq(notifications.id, noticeId)))
    .get();
  if (!row) return null;
  if (row.entityType === "task") {
    const task = taskNotice(db, actor.orgId, row.entityId);
    if (!task) return null;
    if (!row.readAt) {
      db.update(notifications)
        .set({ readAt: nowIso() })
        .where(and(eq(notifications.orgId, actor.orgId), eq(notifications.id, row.id)))
        .run();
    }
    return task.href;
  }
  const entity = resolveEntity(db, actor.orgId, row.entityType, row.entityId);
  if (!entity) return null;
  if (financial(entity.type) && !canSeeMoney(roleOf(actor))) return null;
  if (!row.readAt) {
    db.update(notifications)
      .set({ readAt: nowIso() })
      .where(and(eq(notifications.orgId, actor.orgId), eq(notifications.id, row.id)))
      .run();
  }
  return row.commentId ? `${entity.href}#comment-${row.commentId}` : `${entity.href}#comments`;
}

export function markAllRead(actor: Actor) {
  const db = dbFor(actor);
  const stamp = nowIso();
  const rows = db
    .select()
    .from(notifications)
    .where(and(eq(notifications.orgId, actor.orgId), eq(notifications.userId, actor.userId)))
    .all()
    .filter((row) => !row.readAt);
  for (const row of rows) {
    db.update(notifications)
      .set({ readAt: stamp })
      .where(and(eq(notifications.orgId, actor.orgId), eq(notifications.id, row.id)))
      .run();
  }
}

export function notifyPreference(actor: Actor): "mentions" | "all" {
  const db = officeDb(actor.orgId);
  if (!db) return "all";
  return notifyMode(db, actor.orgId, actor.userId);
}

export function setNotifyPreference(actor: Actor, mode: string) {
  const next = mode === "mentions" ? "mentions" : mode === "all" ? "all" : null;
  if (!next) throw new ServiceError("Pick Mentions or My jobs");
  const db = dbFor(actor);
  const existing = db
    .select()
    .from(notificationSettings)
    .where(and(eq(notificationSettings.orgId, actor.orgId), eq(notificationSettings.userId, actor.userId)))
    .get();
  if (existing) {
    db.update(notificationSettings)
      .set({ mode: next })
      .where(eq(notificationSettings.userId, actor.userId))
      .run();
    return;
  }
  db.insert(notificationSettings).values({ userId: actor.userId, orgId: actor.orgId, mode: next }).run();
}

export function notifyAssignment(actor: Actor, input: { entityType: CommentEntity; entityId: string; userIds: string[] }) {
  const db = officeDb(actor.orgId);
  if (!db) return;
  const entity = resolveEntity(db, actor.orgId, input.entityType, input.entityId);
  if (!entity) return;
  const members = membersOf(db, actor.orgId);
  for (const userId of new Set(input.userIds)) {
    if (!userId || userId === actor.userId) continue;
    const member = members.find((row) => row.id === userId);
    if (!member || !canMemberSee(member, entity.type)) continue;
    if (notifyMode(db, actor.orgId, userId) === "mentions") continue;
    insertNotice(db, actor.orgId, userId, "assignment", entity, actor.userId, actor.name, "Assigned", null);
  }
}

export function notifyRfiAnswer(
  db: AppDatabase,
  orgId: string,
  rfi: { id: string; projectId: string; number: number; title: string; createdBy: string | null },
  actorName: string,
) {
  if (!rfi.createdBy) return;
  if (notifyMode(db, orgId, rfi.createdBy) === "mentions") return;
  const entity = resolveEntity(db, orgId, "rfi", rfi.id);
  if (!entity) return;
  const members = membersOf(db, orgId);
  const member = members.find((row) => row.id === rfi.createdBy);
  if (!member || !canMemberSee(member, "rfi")) return;
  insertNotice(db, orgId, rfi.createdBy, "answer", entity, null, actorName, `${actorName} answered`, null);
}
