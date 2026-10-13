import { and, eq } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import { auditLogs, contacts, invoices, memberships, notifications, organizations, projects, punchItems, reviewRequests, scheduleAssignees, scheduleItems } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canEditCrm, canManageSettings, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import type { AutomationEvent } from "@/lib/services/automations";
import { localDay } from "@/lib/time/calendar";

export const REVIEW_TEMPLATE = "{client}, {job} is finished. {link}";

const OPEN = new Set(["draft", "ready", "copied"]);
const STATUSES = ["draft", "ready", "copied", "sent", "skipped", "declined"] as const;
export type ReviewStatus = (typeof STATUSES)[number];

type Writer = Pick<AppDatabase, "insert" | "select" | "update" | "delete" | "transaction">;

let emit: (event: AutomationEvent) => void = () => {};

export function bindReviewEmit(fn: (event: AutomationEvent) => void) {
  emit = fn;
}

function dbFor(orgId: string): Writer {
  return officeDb(orgId) ?? getDb();
}

export function reviewStatusLabel(status: string): string {
  if (status === "draft") return "Draft";
  if (status === "ready") return "Ready";
  if (status === "copied") return "Copied";
  if (status === "sent") return "Marked sent";
  if (status === "skipped") return "Skipped";
  if (status === "declined") return "Declined";
  return status;
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

export function cleanReviewUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ServiceError("Review link needs http or https.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ServiceError("Review link needs http or https.");
  if (url.username || url.password) throw new ServiceError("Review link needs http or https.");
  return url.toString().slice(0, 300);
}

function fill(template: string, client: string, job: string, link: string): string {
  return template.replaceAll("{client}", client).replaceAll("{job}", job).replaceAll("{link}", link).slice(0, 500);
}

function linkOf(org: { reviewGoogleUrl: string | null; reviewFacebookUrl: string | null; reviewWebsiteUrl: string | null }): { platform: string; url: string } {
  if (org.reviewGoogleUrl) return { platform: "google", url: org.reviewGoogleUrl };
  if (org.reviewFacebookUrl) return { platform: "facebook", url: org.reviewFacebookUrl };
  if (org.reviewWebsiteUrl) return { platform: "website", url: org.reviewWebsiteUrl };
  return { platform: "", url: "" };
}

function fullyPaid(db: Writer, orgId: string, projectId: string): boolean {
  const rows = db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.projectId, projectId)))
    .all()
    .filter((row) => row.status !== "void");
  return rows.length > 0 && rows.every((row) => row.status === "paid");
}

function notify(tx: Writer, orgId: string, requestId: string, name: string, snippet: string, stamp: string) {
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
        kind: "review",
        commentId: null,
        entityType: "review_request",
        entityId: requestId,
        projectId: null,
        actorId: null,
        actorName: name,
        snippet,
        readAt: null,
        createdAt: stamp,
      })
      .run();
  }
}

/** One request per job. A taken slot is the existing row. Excluded tags create nothing. */
export function considerReview(orgId: string, projectId: string, reason: "complete" | "paid") {
  const db = dbFor(orgId);
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org || org.reviewEnabled !== 1) return null;
  if (reason === "complete" && org.reviewTiming !== "complete") return null;
  if (reason === "paid" && org.reviewTiming !== "paid") return null;
  const project = db.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).get();
  if (!project) return null;
  if (reason === "complete" && project.status !== "complete") return null;
  if (reason === "paid" && !fullyPaid(db, orgId, projectId)) return null;
  if (excluded(project.tags, org.reviewExcludeTags)) return null;
  const existing = db.select().from(reviewRequests).where(and(eq(reviewRequests.orgId, orgId), eq(reviewRequests.projectId, projectId))).get();
  if (existing) return existing;
  const contact = db.select().from(contacts).where(and(eq(contacts.orgId, orgId), eq(contacts.id, project.contactId))).get();
  const client = contact?.name || "Client";
  const link = linkOf(org);
  const template = org.reviewTemplate.trim() || REVIEW_TEMPLATE;
  const stamp = nowIso();
  const requestId = id("rev");
  const status = link.url ? "ready" : "draft";
  db.transaction((tx) => {
    const again = tx.select().from(reviewRequests).where(and(eq(reviewRequests.orgId, orgId), eq(reviewRequests.projectId, projectId))).get();
    if (again) return;
    tx.insert(reviewRequests)
      .values({
        id: requestId,
        orgId,
        projectId,
        contactId: project.contactId,
        status,
        platform: link.platform,
        url: link.url,
        message: fill(template, client, project.name, link.url),
        skipReason: "",
        createdAt: stamp,
        updatedAt: stamp,
        copiedAt: null,
        sentAt: null,
      })
      .run();
    tx.insert(auditLogs)
      .values({
        id: id("audit"),
        orgId,
        actorId: null,
        action: "review.create",
        entityType: "review_request",
        entityId: requestId,
        payloadJson: JSON.stringify({ projectId, status, reason }),
        ip: null,
        createdAt: stamp,
      })
      .run();
    notify(tx, orgId, requestId, "Fieldline", project.name, stamp);
  });
  const row = db.select().from(reviewRequests).where(and(eq(reviewRequests.orgId, orgId), eq(reviewRequests.projectId, projectId))).get();
  if (row?.id === requestId) {
    emit({
      orgId,
      kind: "review_request_created",
      recordType: "review_request",
      recordId: row.id,
      recordLabel: project.name,
      projectId,
      name: client,
    });
  }
  return row ?? null;
}

export function reviewAttention(orgId: string) {
  const count = dbFor(orgId)
    .select()
    .from(reviewRequests)
    .where(eq(reviewRequests.orgId, orgId))
    .all()
    .filter((row) => OPEN.has(row.status)).length;
  return { count, href: count > 0 ? "/reviews" : null };
}

export function reviewNotice(db: Writer, orgId: string, requestId: string) {
  const row = db.select().from(reviewRequests).where(and(eq(reviewRequests.orgId, orgId), eq(reviewRequests.id, requestId))).get();
  if (!row) return null;
  const project = db.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, row.projectId))).get();
  return { record: project?.name || "Review", href: `/reviews/${row.id}` };
}

export function reviewMonth(orgId: string) {
  const db = dbFor(orgId);
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  const month = localDay(Date.now(), org?.timeZone || "America/New_York").slice(0, 7);
  const rows = db.select().from(reviewRequests).where(eq(reviewRequests.orgId, orgId)).all();
  return {
    created: rows.filter((row) => row.createdAt.slice(0, 7) === month).length,
    sent: rows.filter((row) => row.sentAt && row.sentAt.slice(0, 7) === month).length,
    skipped: rows.filter((row) => row.status === "skipped" && row.updatedAt.slice(0, 7) === month).length,
  };
}

export function reviewSettings(actor: Actor) {
  if (!canManageSettings(actor.role as Role)) return null;
  const org = dbFor(actor.orgId).select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  if (!org) return null;
  return {
    enabled: org.reviewEnabled === 1,
    timing: org.reviewTiming === "paid" ? "paid" : "complete",
    google: org.reviewGoogleUrl || "",
    facebook: org.reviewFacebookUrl || "",
    website: org.reviewWebsiteUrl || "",
    exclude: org.reviewExcludeTags || "",
    template: org.reviewTemplate || REVIEW_TEMPLATE,
  };
}

export function saveReviewSettings(
  actor: Actor,
  input: { enabled: boolean; timing: string; google: string; facebook: string; website: string; exclude: string; template: string },
) {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("Only an owner or admin can change reviews.");
  const timing = input.timing === "paid" ? "paid" : "complete";
  const google = cleanReviewUrl(input.google);
  const facebook = cleanReviewUrl(input.facebook);
  const website = cleanReviewUrl(input.website);
  const exclude = [...tagSet(input.exclude)].join(", ");
  const template = input.template.trim().slice(0, 400) || REVIEW_TEMPLATE;
  const stamp = nowIso();
  dbFor(actor.orgId)
    .update(organizations)
    .set({
      reviewEnabled: input.enabled ? 1 : 0,
      reviewTiming: timing,
      reviewGoogleUrl: google,
      reviewFacebookUrl: facebook,
      reviewWebsiteUrl: website,
      reviewExcludeTags: exclude,
      reviewTemplate: template,
      updatedAt: stamp,
    })
    .where(eq(organizations.id, actor.orgId))
    .run();
}

function canSee(actor: Actor) {
  return actor.role !== "field";
}

export function listReviews(actor: Actor, status?: string) {
  if (!canSee(actor)) return [];
  const wanted = status && (STATUSES as readonly string[]).includes(status) ? status : "";
  const db = dbFor(actor.orgId);
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  const people = new Map(db.select().from(contacts).where(eq(contacts.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  return db
    .select()
    .from(reviewRequests)
    .where(eq(reviewRequests.orgId, actor.orgId))
    .all()
    .filter((row) => !wanted || row.status === wanted)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((row) => ({
      id: row.id,
      job: jobs.get(row.projectId) || "Job",
      client: people.get(row.contactId) || "Client",
      status: row.status,
      statusLabel: reviewStatusLabel(row.status),
      url: row.url,
    }));
}

export function reviewCsv(actor: Actor, status?: string): string | null {
  if (!canSee(actor)) return null;
  const lines = ["Job,Client,Status,Link"];
  for (const row of listReviews(actor, status)) {
    lines.push([row.job, row.client, row.statusLabel, row.url].map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","));
  }
  return lines.join("\n");
}

export function reviewDetail(actor: Actor, requestId: string) {
  if (!canSee(actor)) return null;
  const db = dbFor(actor.orgId);
  const row = db.select().from(reviewRequests).where(and(eq(reviewRequests.orgId, actor.orgId), eq(reviewRequests.id, requestId))).get();
  if (!row) return null;
  const project = db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, row.projectId))).get();
  const contact = db.select().from(contacts).where(and(eq(contacts.orgId, actor.orgId), eq(contacts.id, row.contactId))).get();
  return {
    id: row.id,
    job: project?.name || "Job",
    client: contact?.name || "Client",
    projectId: row.projectId,
    status: row.status,
    statusLabel: reviewStatusLabel(row.status),
    url: row.url,
    message: row.message,
    skipReason: row.skipReason,
    tags: project?.tags || "",
    canEdit: canEditCrm(actor.role as Role),
  };
}

function requireRow(actor: Actor, requestId: string) {
  const row = dbFor(actor.orgId).select().from(reviewRequests).where(and(eq(reviewRequests.orgId, actor.orgId), eq(reviewRequests.id, requestId))).get();
  if (!row) throw new ServiceError("That review is not in your company.");
  return row;
}

export function saveReviewTags(actor: Actor, requestId: string, tags: string) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot change this review.");
  const row = requireRow(actor, requestId);
  const cleaned = [...tagSet(tags)].join(", ");
  dbFor(actor.orgId).update(projects).set({ tags: cleaned, updatedAt: nowIso() }).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, row.projectId))).run();
}

export function markReview(actor: Actor, requestId: string, action: "copy" | "sent" | "skip" | "decline" | "ready", reason = "") {
  const field = actor.role === "field";
  if (field && action !== "copy" && action !== "ready") throw new ServiceError("Your role cannot change this review.");
  if (!field && !canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot change this review.");
  const row = requireRow(actor, requestId);
  if (field && !fieldReviewQueue(actor).some((item) => item.id === row.id)) throw new ServiceError("That review is not on your day.");
  if (row.status === "declined") throw new ServiceError("That review is closed.");
  const stamp = nowIso();
  const db = dbFor(actor.orgId);
  if (action === "skip") {
    const why = reason.trim().slice(0, 200);
    if (why.length < 2) throw new ServiceError("Add a reason.");
    db.update(reviewRequests).set({ status: "skipped", skipReason: why, updatedAt: stamp }).where(and(eq(reviewRequests.orgId, actor.orgId), eq(reviewRequests.id, row.id))).run();
    audit(db, actor, "review.skip", row.id, { reason: why });
    return;
  }
  if (action === "decline") {
    db.update(reviewRequests).set({ status: "declined", updatedAt: stamp }).where(and(eq(reviewRequests.orgId, actor.orgId), eq(reviewRequests.id, row.id))).run();
    audit(db, actor, "review.void", row.id, null);
    return;
  }
  if (action === "ready") {
    if (row.status !== "draft") return;
    const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
    const project = db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, row.projectId))).get();
    const contact = db.select().from(contacts).where(and(eq(contacts.orgId, actor.orgId), eq(contacts.id, row.contactId))).get();
    const link = org ? linkOf(org) : { platform: "", url: "" };
    const template = org?.reviewTemplate.trim() || REVIEW_TEMPLATE;
    db.update(reviewRequests)
      .set({
        status: link.url ? "ready" : "draft",
        platform: link.platform,
        url: link.url,
        message: fill(template, contact?.name || "Client", project?.name || "Job", link.url),
        updatedAt: stamp,
      })
      .where(and(eq(reviewRequests.orgId, actor.orgId), eq(reviewRequests.id, row.id)))
      .run();
    audit(db, actor, "review.ready", row.id, null);
    return;
  }
  if (action === "copy") {
    db.update(reviewRequests)
      .set({ status: row.status === "sent" || row.status === "skipped" ? row.status : "copied", copiedAt: stamp, updatedAt: stamp })
      .where(and(eq(reviewRequests.orgId, actor.orgId), eq(reviewRequests.id, row.id)))
      .run();
    audit(db, actor, "review.copy", row.id, null);
    return;
  }
  db.update(reviewRequests).set({ status: "sent", sentAt: row.sentAt || stamp, updatedAt: stamp }).where(and(eq(reviewRequests.orgId, actor.orgId), eq(reviewRequests.id, row.id))).run();
  audit(db, actor, "review.sent", row.id, null);
  const project = db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, row.projectId))).get();
  emit({
    orgId: actor.orgId,
    kind: "review_request_marked_sent",
    recordType: "review_request",
    recordId: row.id,
    recordLabel: project?.name || "Review",
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
      entityType: "review_request",
      entityId,
      payloadJson: payload ? JSON.stringify(payload) : null,
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

export function fieldReviewQueue(actor: Actor) {
  if (actor.role !== "field") return [];
  const db = dbFor(actor.orgId);
  const jobs = new Set(
    db
      .select()
      .from(punchItems)
      .where(and(eq(punchItems.orgId, actor.orgId), eq(punchItems.assigneeUserId, actor.userId)))
      .all()
      .map((row) => row.projectId),
  );
  const mine = new Set(
    db
      .select()
      .from(scheduleAssignees)
      .where(and(eq(scheduleAssignees.orgId, actor.orgId), eq(scheduleAssignees.userId, actor.userId)))
      .all()
      .map((row) => row.itemId),
  );
  for (const item of db.select().from(scheduleItems).where(eq(scheduleItems.orgId, actor.orgId)).all()) {
    if (mine.has(item.id)) jobs.add(item.projectId);
  }
  const names = new Map(db.select().from(projects).where(eq(projects.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  return db
    .select()
    .from(reviewRequests)
    .where(eq(reviewRequests.orgId, actor.orgId))
    .all()
    .filter((row) => jobs.has(row.projectId) && OPEN.has(row.status))
    .map((row) => ({ id: row.id, job: names.get(row.projectId) || "Job", url: row.url, message: row.message, status: row.status }));
}

export function portalReview(token: string): { url: string } | null {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, token)).get();
  if (!project) return null;
  const row = db.select().from(reviewRequests).where(and(eq(reviewRequests.orgId, project.orgId), eq(reviewRequests.projectId, project.id))).get();
  if (!row || !row.url) return null;
  if (row.status !== "ready" && row.status !== "copied" && row.status !== "sent") return null;
  return { url: row.url };
}
