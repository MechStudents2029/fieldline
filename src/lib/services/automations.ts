import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  agreementVisits,
  auditLogs,
  automationNotices,
  automationRules,
  automationRuns,
  budgetLines,
  contacts,
  customFields,
  equipment,
  equipmentAssignments,
  incidents,
  inspectionGates,
  inspections,
  invoices,
  jobTemplates,
  memberships,
  organizations,
  projects,
  proposals,
  purchaseOrders,
  punchItems,
  safetyCheckItems,
  safetyChecks,
  safetyTopics,
  bookings,
  priceBookItems,
  reviewRequests,
  invoiceFollowUps,
  scheduleItems,
  serviceAgreements,
  stockItems,
  scheduleLinks,
  selections,
  taskAssignees,
  taskChecks,
  tasks,
  tmTickets,
  toolboxTalks,
  templateTaskLinks,
  templateTasks,
  templateTodoChecks,
  templateTodos,
  timeEntries,
  users,
  vendorCertificates,
  vendorCredits,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canEditCrm, canManageSettings } from "@/lib/permissions";
import { fieldConditionMet, setStoredField } from "@/lib/services/custom-fields";
import { resetConfirmedOnHold, systemRequestConfirmation } from "@/lib/services/confirmations";
import { addWorkdays, dateFromOffset, endFromDuration } from "@/lib/schedule/workdays";
import { ServiceError } from "@/lib/services/errors";
import { createOrdersFrom } from "@/lib/services/order-from";
import { ticketLabel } from "@/lib/tm/number";
import type { Actor } from "@/lib/services/read";
import { deliveryRows } from "@/lib/receiving/facts";
import { notifyDelivery } from "@/lib/receiving/notify";
import { bindCollectEmit } from "@/lib/services/collections";
import { bindReviewEmit, considerReview } from "@/lib/services/reviews";
import { workCalendarFor } from "@/lib/services/work-calendar";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

export const AUTOMATION_DEPTH_LIMIT = 3;

const INSURANCE = new Set(["general_liability", "workers_comp"]);

export type Trigger =
  | { kind: "job_status"; status: string }
  | { kind: "proposal_signed" }
  | { kind: "schedule_done" }
  | { kind: "schedule_declined" }
  | { kind: "unconfirmed_before"; days: number }
  | { kind: "inspection_result"; result: string }
  | { kind: "punch_verified" }
  | { kind: "invoice_overdue"; days: number }
  | { kind: "vendor_expiring"; days: number; cert: "insurance" | "license" }
  | { kind: "equipment_overdue" }
  | { kind: "incident_logged" }
  | { kind: "checklist_failed" }
  | { kind: "tm_verified" }
  | { kind: "selection_confirmed" }
  | { kind: "delivery_late" }
  | { kind: "delivery_received" }
  | { kind: "vendor_credit_issued" }
  | { kind: "stock_low" }
  | { kind: "clock_outside" }
  | { kind: "visit_due" }
  | { kind: "agreement_expiring" }
  | { kind: "unassigned_today" }
  | { kind: "booking_created" }
  | { kind: "review_request_created" }
  | { kind: "review_request_marked_sent" }
  | { kind: "invoice_followup_created" }
  | { kind: "invoice_followup_marked_sent" };

export type Condition =
  | { kind: "job_type"; value: string }
  | { kind: "template"; templateId: string }
  | { kind: "pm"; userId: string }
  | { kind: "cost_code"; value: string }
  | { kind: "item_name"; value: string }
  | { kind: "amount_over"; cents: number }
  | { kind: "amount_under"; cents: number }
  | { kind: "field"; fieldId: string; op: "eq" | "empty" | "gt"; value: string };

export type Action =
  | { kind: "apply_template"; templateId: string }
  | { kind: "todo"; title: string; who: string; dueDays: number }
  | { kind: "today"; title: string; who: string }
  | { kind: "set_status"; status: string }
  | { kind: "punch"; title: string }
  | { kind: "hold" }
  | { kind: "release" }
  | { kind: "request_confirmation" }
  | { kind: "schedule_talk"; topicId: string; withinWorkdays: number }
  | { kind: "set_field"; fieldId: string; value: string }
  | { kind: "create_draft_po" };

export type AutomationEvent = {
  orgId: string;
  kind: Trigger["kind"];
  recordType: string;
  recordId: string;
  recordLabel: string;
  projectId: string | null;
  status?: string;
  name?: string;
  amountCents?: number | null;
  days?: number;
  cert?: "insurance" | "license";
  scheduleItemId?: string | null;
  gateItemIds?: string[];
};

export type RuleDraft = {
  id?: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
};

type RuleRow = typeof automationRules.$inferSelect;

function clean(value: string, max: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function daysOf(value: unknown) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 365) return null;
  return days;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseTrigger(raw: string): Trigger | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const row = asRecord(value);
  if (!row || typeof row.kind !== "string") return null;
  if (row.kind === "job_status" && (row.status === "active" || row.status === "complete")) return { kind: "job_status", status: row.status };
  if (row.kind === "proposal_signed") return { kind: "proposal_signed" };
  if (row.kind === "schedule_done") return { kind: "schedule_done" };
  if (row.kind === "schedule_declined") return { kind: "schedule_declined" };
  if (row.kind === "unconfirmed_before") {
    const days = daysOf(row.days);
    if (days == null) return null;
    return { kind: "unconfirmed_before", days };
  }
  if (row.kind === "inspection_result" && (row.result === "passed" || row.result === "failed")) return { kind: "inspection_result", result: row.result };
  if (row.kind === "punch_verified") return { kind: "punch_verified" };
  if (row.kind === "invoice_overdue") {
    const days = daysOf(row.days);
    if (days == null) return null;
    return { kind: "invoice_overdue", days };
  }
  if (row.kind === "vendor_expiring" && (row.cert === "insurance" || row.cert === "license")) {
    const days = daysOf(row.days);
    if (days == null) return null;
    return { kind: "vendor_expiring", days, cert: row.cert };
  }
  if (row.kind === "equipment_overdue") return { kind: "equipment_overdue" };
  if (row.kind === "incident_logged") return { kind: "incident_logged" };
  if (row.kind === "checklist_failed") return { kind: "checklist_failed" };
  if (row.kind === "tm_verified") return { kind: "tm_verified" };
  if (row.kind === "selection_confirmed") return { kind: "selection_confirmed" };
  if (row.kind === "delivery_late") return { kind: "delivery_late" };
  if (row.kind === "delivery_received") return { kind: "delivery_received" };
  if (row.kind === "vendor_credit_issued") return { kind: "vendor_credit_issued" };
  if (row.kind === "stock_low") return { kind: "stock_low" };
  if (row.kind === "clock_outside") return { kind: "clock_outside" };
  if (row.kind === "visit_due") return { kind: "visit_due" };
  if (row.kind === "agreement_expiring") return { kind: "agreement_expiring" };
  if (row.kind === "unassigned_today") return { kind: "unassigned_today" };
  if (row.kind === "booking_created") return { kind: "booking_created" };
  if (row.kind === "review_request_created") return { kind: "review_request_created" };
  if (row.kind === "review_request_marked_sent") return { kind: "review_request_marked_sent" };
  if (row.kind === "invoice_followup_created") return { kind: "invoice_followup_created" };
  if (row.kind === "invoice_followup_marked_sent") return { kind: "invoice_followup_marked_sent" };
  return null;
}

export function parseConditions(raw: string): Condition[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out: Condition[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row || typeof row.kind !== "string") continue;
    if ((row.kind === "job_type" || row.kind === "cost_code" || row.kind === "item_name") && typeof row.value === "string" && row.value.trim()) {
      out.push({ kind: row.kind, value: row.value.trim() });
    } else if (row.kind === "template" && typeof row.templateId === "string") {
      out.push({ kind: "template", templateId: row.templateId });
    } else if (row.kind === "pm" && typeof row.userId === "string") {
      out.push({ kind: "pm", userId: row.userId });
    } else if ((row.kind === "amount_over" || row.kind === "amount_under") && Number.isInteger(row.cents)) {
      out.push({ kind: row.kind, cents: row.cents as number });
    } else if (row.kind === "field" && typeof row.fieldId === "string" && (row.op === "eq" || row.op === "empty" || row.op === "gt")) {
      out.push({ kind: "field", fieldId: row.fieldId, op: row.op, value: typeof row.value === "string" ? row.value : "" });
    }
  }
  return out;
}

export function parseActions(raw: string): Action[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out: Action[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row || typeof row.kind !== "string") continue;
    if (row.kind === "apply_template" && typeof row.templateId === "string") out.push({ kind: "apply_template", templateId: row.templateId });
    else if (row.kind === "todo" && typeof row.title === "string") out.push({ kind: "todo", title: row.title, who: typeof row.who === "string" ? row.who : "", dueDays: daysOf(row.dueDays) ?? 0 });
    else if (row.kind === "today" && typeof row.title === "string") out.push({ kind: "today", title: row.title, who: typeof row.who === "string" ? row.who : "" });
    else if (row.kind === "set_status" && (row.status === "active" || row.status === "complete")) out.push({ kind: "set_status", status: row.status });
    else if (row.kind === "punch") out.push({ kind: "punch", title: typeof row.title === "string" ? row.title : "" });
    else if (row.kind === "hold") out.push({ kind: "hold" });
    else if (row.kind === "request_confirmation") out.push({ kind: "request_confirmation" });
    else if (row.kind === "release") out.push({ kind: "release" });
    else if (row.kind === "schedule_talk" && typeof row.topicId === "string") {
      const withinWorkdays = daysOf(row.withinWorkdays);
      if (withinWorkdays != null) out.push({ kind: "schedule_talk", topicId: row.topicId, withinWorkdays });
    } else if (row.kind === "set_field" && typeof row.fieldId === "string") {
      out.push({ kind: "set_field", fieldId: row.fieldId, value: typeof row.value === "string" ? row.value : "" });
    } else if (row.kind === "create_draft_po") out.push({ kind: "create_draft_po" });
  }
  return out;
}

export function triggerLabel(trigger: Trigger): string {
  if (trigger.kind === "job_status") return trigger.status === "active" ? "Job active" : "Job complete";
  if (trigger.kind === "proposal_signed") return "Proposal signed";
  if (trigger.kind === "schedule_done") return "Schedule done";
  if (trigger.kind === "schedule_declined") return "Schedule item declined";
  if (trigger.kind === "unconfirmed_before") return `Unconfirmed ${trigger.days}d before start`;
  if (trigger.kind === "inspection_result") return trigger.result === "failed" ? "Inspection failed" : "Inspection passed";
  if (trigger.kind === "punch_verified") return "Punch verified";
  if (trigger.kind === "invoice_overdue") return `Invoice overdue ${trigger.days}d`;
  if (trigger.kind === "vendor_expiring") return trigger.cert === "license" ? `License expiring ${trigger.days}d` : `Insurance expiring ${trigger.days}d`;
  if (trigger.kind === "incident_logged") return "Incident logged";
  if (trigger.kind === "checklist_failed") return "Checklist item failed";
  if (trigger.kind === "tm_verified") return "T&M ticket verified";
  if (trigger.kind === "selection_confirmed") return "Selection confirmed";
  if (trigger.kind === "delivery_late") return "Delivery late";
  if (trigger.kind === "delivery_received") return "Delivery received";
  if (trigger.kind === "vendor_credit_issued") return "Vendor credit issued";
  if (trigger.kind === "stock_low") return "Low stock";
  if (trigger.kind === "clock_outside") return "Clock punch outside job site";
  if (trigger.kind === "visit_due") return "Visit due";
  if (trigger.kind === "agreement_expiring") return "Agreement expiring";
  if (trigger.kind === "unassigned_today") return "Unassigned visit today";
  if (trigger.kind === "booking_created") return "Online booking created";
  if (trigger.kind === "review_request_created") return "Review request created";
  if (trigger.kind === "review_request_marked_sent") return "Review marked sent";
  if (trigger.kind === "invoice_followup_created") return "Invoice follow-up created";
  if (trigger.kind === "invoice_followup_marked_sent") return "Invoice follow-up marked sent";
  return "Equipment overdue";
}

function triggerMatches(trigger: Trigger, event: AutomationEvent) {
  if (trigger.kind !== event.kind) return false;
  if (trigger.kind === "job_status") return event.status === trigger.status;
  if (trigger.kind === "inspection_result") return event.status === trigger.result;
  if (trigger.kind === "invoice_overdue") return (event.days ?? -1) >= trigger.days;
  if (trigger.kind === "unconfirmed_before") {
    const days = event.days ?? -1;
    return days >= 0 && days <= trigger.days;
  }
  if (trigger.kind === "vendor_expiring") {
    const days = event.days ?? 9999;
    return event.cert === trigger.cert && days >= 0 && days <= trigger.days;
  }
  return true;
}

function todayFor(orgId: string) {
  const org = getDb().select({ timeZone: organizations.timeZone }).from(organizations).where(eq(organizations.id, orgId)).get();
  return localDay(Date.now(), org?.timeZone || "America/New_York");
}

function daySpan(start: string, end: string) {
  const a = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function projectOf(orgId: string, projectId: string | null) {
  if (!projectId) return null;
  return getDb().select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).get() ?? null;
}

function conditionsMatch(conditions: Condition[], event: AutomationEvent) {
  if (conditions.length === 0) return true;
  const project = projectOf(event.orgId, event.projectId);
  for (const condition of conditions) {
    if (condition.kind === "item_name") {
      if (!(event.name ?? "").toLowerCase().includes(condition.value.toLowerCase())) return false;
      continue;
    }
    if (condition.kind === "amount_over" || condition.kind === "amount_under") {
      const amount = event.amountCents ?? project?.contractValueCents ?? null;
      if (amount == null) return false;
      if (condition.kind === "amount_over" && !(amount > condition.cents)) return false;
      if (condition.kind === "amount_under" && !(amount < condition.cents)) return false;
      continue;
    }
    if (!project) return false;
    if (condition.kind === "pm" && project.pmUserId !== condition.userId) return false;
    if (condition.kind === "template") {
      const template = getDb().select().from(jobTemplates).where(and(eq(jobTemplates.orgId, event.orgId), eq(jobTemplates.id, condition.templateId))).get();
      const named = template ? project.templateName === template.name || project.templateId === template.id : false;
      if (!named) return false;
    }
    if (condition.kind === "job_type") {
      const template = project.templateId
        ? getDb().select().from(jobTemplates).where(and(eq(jobTemplates.orgId, event.orgId), eq(jobTemplates.id, project.templateId))).get()
        : null;
      const hay = `${project.name} ${project.templateName ?? ""} ${template?.jobType ?? ""}`.toLowerCase();
      if (!hay.includes(condition.value.toLowerCase())) return false;
    }
    if (condition.kind === "cost_code") {
      const lines = getDb().select().from(budgetLines).where(and(eq(budgetLines.orgId, event.orgId), eq(budgetLines.projectId, project.id))).all();
      if (!lines.some((line) => (line.costCode ?? "").toLowerCase().includes(condition.value.toLowerCase()))) return false;
    }
    if (condition.kind === "field" && !fieldConditionMet(event.orgId, condition.fieldId, { projectId: event.projectId, recordId: event.recordId }, condition.op, condition.value)) return false;
  }
  return true;
}

function audit(orgId: string, ruleName: string, entityType: string, entityId: string, payload: unknown) {
  getDb()
    .insert(auditLogs)
    .values({
      id: id("aud"),
      orgId,
      actorId: null,
      action: `Automation: ${ruleName}`,
      entityType,
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function userForWho(orgId: string, projectId: string | null, who: string) {
  if (who.startsWith("user:")) {
    const userId = who.slice(5);
    const member = getDb().select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId))).get();
    return member?.userId ?? null;
  }
  if (who === "role:pm") return projectOf(orgId, projectId)?.pmUserId ?? null;
  if (who.startsWith("role:")) {
    const role = who.slice(5);
    const roles = role === "office" ? ["owner", "admin", "estimator"] : [role];
    const member = getDb().select().from(memberships).where(and(eq(memberships.orgId, orgId), inArray(memberships.role, roles))).get();
    return member?.userId ?? null;
  }
  return null;
}

function gateIds(event: AutomationEvent) {
  const ids = new Set<string>();
  if (event.scheduleItemId) ids.add(event.scheduleItemId);
  for (const itemId of event.gateItemIds ?? []) ids.add(itemId);
  if (event.kind === "inspection_result") {
    const gates = getDb().select().from(inspectionGates).where(and(eq(inspectionGates.orgId, event.orgId), eq(inspectionGates.inspectionId, event.recordId))).all();
    for (const gate of gates) ids.add(gate.scheduleItemId);
  }
  return [...ids];
}

function itemNames(orgId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return getDb()
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, orgId), inArray(scheduleItems.id, ids)))
    .all()
    .map((row) => row.title);
}

function hrefFor(event: AutomationEvent) {
  if (event.kind === "tm_verified") return `/tm/${event.recordId}`;
  if (event.kind === "selection_confirmed" && event.projectId) return `/projects/${event.projectId}/selections`;
  if (event.kind === "delivery_late" || event.kind === "delivery_received") return `/purchase-orders/${event.recordId}`;
  if (event.kind === "vendor_credit_issued") return `/vendor-credits/${event.recordId}`;
  if (event.kind === "stock_low") return `/inventory/${event.recordId}`;
  if (event.kind === "clock_outside") return "/time";
  if (event.kind === "visit_due") {
    const visit = getDb().select().from(agreementVisits).where(and(eq(agreementVisits.orgId, event.orgId), eq(agreementVisits.id, event.recordId))).get();
    return visit ? `/agreements/${visit.agreementId}` : "/agreements";
  }
  if (event.kind === "agreement_expiring") return `/agreements/${event.recordId}`;
  if (event.kind === "unassigned_today") return "/dispatch";
  if (event.kind === "booking_created") return "/dispatch";
  if (event.kind === "review_request_created" || event.kind === "review_request_marked_sent") return `/reviews/${event.recordId}`;
  if (event.kind === "invoice_followup_created" || event.kind === "invoice_followup_marked_sent") return `/collections/${event.recordId}`;
  if (event.kind === "equipment_overdue") return "/equipment";
  if ((event.kind === "incident_logged" || event.kind === "checklist_failed") && event.projectId) return `/projects/${event.projectId}/safety`;
  if (event.kind === "vendor_expiring") return "/contacts";
  if (event.kind === "invoice_overdue") return event.projectId ? `/projects/${event.projectId}` : "/invoices";
  if (event.projectId && event.kind === "inspection_result") return `/projects/${event.projectId}/permits?inspection=${event.recordId}`;
  if (event.projectId) return `/projects/${event.projectId}`;
  return "/";
}

function applyTemplate(orgId: string, projectId: string, templateId: string, ruleName: string, dry: boolean) {
  const db = getDb();
  const template = db.select().from(jobTemplates).where(and(eq(jobTemplates.orgId, orgId), eq(jobTemplates.id, templateId))).get();
  if (!template) {
    if (dry) return "Template not found";
    throw new ServiceError("Template not found.");
  }
  const line = `Apply ${template.name}`;
  if (dry) return line;
  const project = projectOf(orgId, projectId);
  if (!project) throw new ServiceError("That job is not in your company.");
  const calendar = workCalendarFor(orgId, projectId);
  const anchor = project.startDate || todayFor(orgId);
  const now = nowIso();
  const existing = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.projectId, projectId))).all();
  const byTitle = new Map(existing.map((row) => [row.title, row.id]));
  const templateTasksRows = db.select().from(templateTasks).where(and(eq(templateTasks.orgId, orgId), eq(templateTasks.templateId, templateId))).all().sort((a, b) => a.sortOrder - b.sortOrder);
  const byKey = new Map<string, string>();
  let added = 0;
  for (const task of templateTasksRows) {
    const found = byTitle.get(task.title);
    if (found) {
      byKey.set(task.itemKey, found);
      continue;
    }
    const start = dateFromOffset(anchor, task.startOffset, calendar);
    const end = endFromDuration(start, task.durationWorkdays, calendar);
    const itemId = id("sch");
    db.insert(scheduleItems)
      .values({
        id: itemId,
        orgId,
        projectId,
        title: task.title,
        startDate: start,
        endDate: end,
        startTime: null,
        status: "planned",
        note: "",
        vendorContactId: null,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
      })
      .run();
    byTitle.set(task.title, itemId);
    byKey.set(task.itemKey, itemId);
    added += 1;
  }
  const links = db.select().from(templateTaskLinks).where(and(eq(templateTaskLinks.orgId, orgId), eq(templateTaskLinks.templateId, templateId))).all();
  for (const link of links) {
    const itemId = byKey.get(link.itemKey);
    const predecessorId = byKey.get(link.predecessorKey);
    if (!itemId || !predecessorId || itemId === predecessorId) continue;
    const edge = db
      .select()
      .from(scheduleLinks)
      .where(and(eq(scheduleLinks.orgId, orgId), eq(scheduleLinks.itemId, itemId), eq(scheduleLinks.predecessorId, predecessorId)))
      .get();
    if (edge) continue;
    db.insert(scheduleLinks)
      .values({ id: id("slnk"), orgId, projectId, itemId, predecessorId, lagWorkdays: link.lagWorkdays })
      .run();
  }
  const todoTitles = new Set(
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.orgId, orgId), eq(tasks.relatedType, "project"), eq(tasks.relatedId, projectId)))
      .all()
      .map((row) => row.title),
  );
  const todos = db.select().from(templateTodos).where(and(eq(templateTodos.orgId, orgId), eq(templateTodos.templateId, templateId))).all();
  for (const todo of todos) {
    if (todoTitles.has(todo.title)) continue;
    const taskId = id("task");
    db.insert(tasks)
      .values({
        id: taskId,
        orgId,
        title: todo.title,
        assigneeUserId: null,
        dueAt: null,
        relatedType: "project",
        relatedId: projectId,
        status: "open",
        notes: todo.notes,
        priority: todo.priority,
        tags: todo.tags,
        scheduleItemId: null,
        deadlineEdge: null,
        deadlineOffset: null,
        deadlineUnlinked: 0,
        remindDays: todo.remindDays,
        remindedFor: null,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
      })
      .run();
    const checks = db.select().from(templateTodoChecks).where(and(eq(templateTodoChecks.orgId, orgId), eq(templateTodoChecks.todoId, todo.id))).all();
    for (const check of checks) {
      db.insert(taskChecks)
        .values({
          id: id("tchk"),
          orgId,
          taskId,
          title: check.title,
          sortOrder: check.sortOrder,
          status: "open",
          assigneeUserId: null,
          assigneeContactId: null,
          dueAt: null,
          completedAt: null,
          completedBy: null,
        })
        .run();
    }
    added += 1;
  }
  if (!project.templateId) {
    db.update(projects)
      .set({ templateId: template.id, templateName: template.name, templateVersion: template.version, updatedAt: now })
      .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId)))
      .run();
  }
  audit(orgId, ruleName, "project", projectId, { templateId, added });
  return added === 0 ? `${template.name} already applied` : line;
}

function runAction(rule: { id: string; name: string }, action: Action, event: AutomationEvent, depth: number, dry: boolean): string {
  const ruleName = rule.name;
  const db = getDb();
  if (action.kind === "apply_template") {
    if (!event.projectId) {
      if (dry) return "No job";
      throw new ServiceError("No job.");
    }
    return applyTemplate(event.orgId, event.projectId, action.templateId, ruleName, dry);
  }
  if (action.kind === "todo") {
    const line = `To-do: ${action.title}`;
    if (dry) return line;
    if (!event.projectId) throw new ServiceError("No job.");
    const now = nowIso();
    const assignee = userForWho(event.orgId, event.projectId, action.who);
    const taskId = id("task");
    db.insert(tasks)
      .values({
        id: taskId,
        orgId: event.orgId,
        title: action.title,
        assigneeUserId: assignee,
        dueAt: addCalendarDays(todayFor(event.orgId), action.dueDays),
        relatedType: "project",
        relatedId: event.projectId,
        status: "open",
        notes: "",
        priority: "normal",
        tags: "",
        scheduleItemId: null,
        deadlineEdge: null,
        deadlineOffset: null,
        deadlineUnlinked: 0,
        remindDays: null,
        remindedFor: null,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
      })
      .run();
    if (assignee) {
      db.insert(taskAssignees).values({ id: id("tasg"), orgId: event.orgId, taskId, userId: assignee, contactId: null }).run();
    }
    audit(event.orgId, ruleName, "task", taskId, { title: action.title });
    return line;
  }
  if (action.kind === "today") {
    const line = `Today: ${action.title}`;
    if (dry) return line;
    const recordKey = `${event.recordType}:${event.recordId}`;
    const userId = action.who.startsWith("role:") && action.who !== "role:pm" ? "" : userForWho(event.orgId, event.projectId, action.who) ?? "";
    const role = action.who.startsWith("role:") && action.who !== "role:pm" ? action.who.slice(5) : "";
    if (!userId && !role) return "No one to notify";
    const noticeId = id("anot");
    const duplicate = db
      .select()
      .from(automationNotices)
      .where(
        and(
          eq(automationNotices.orgId, event.orgId),
          eq(automationNotices.ruleId, rule.id),
          eq(automationNotices.recordKey, recordKey),
          eq(automationNotices.userId, userId),
          eq(automationNotices.role, role),
        ),
      )
      .get();
    if (duplicate) return "Already on Today";
    db.insert(automationNotices)
      .values({
        id: noticeId,
        orgId: event.orgId,
        ruleId: rule.id,
        userId,
        role,
        title: action.title,
        href: hrefFor(event),
        recordKey,
        createdAt: nowIso(),
      })
      .run();
    audit(event.orgId, ruleName, "automation_notice", noticeId, { title: action.title });
    return line;
  }
  if (action.kind === "set_status") {
    const line = `Status ${action.status === "active" ? "Active" : "Complete"}`;
    if (dry) return line;
    const project = projectOf(event.orgId, event.projectId);
    if (!project) throw new ServiceError("That job is not in your company.");
    if (project.status === action.status) return "Status unchanged";
    const now = nowIso();
    db.update(projects).set({ status: action.status, updatedAt: now }).where(and(eq(projects.orgId, event.orgId), eq(projects.id, project.id))).run();
    audit(event.orgId, ruleName, "project", project.id, { status: action.status });
    emitAutomation(
      {
        orgId: event.orgId,
        kind: "job_status",
        recordType: "project",
        recordId: project.id,
        recordLabel: project.name,
        projectId: project.id,
        status: action.status,
        name: project.name,
        amountCents: project.contractValueCents,
      },
      depth + 1,
    );
    if (action.status === "complete") {
      try {
        considerReview(event.orgId, project.id, "complete");
      } catch {
        // Status already saved.
      }
    }
    return line;
  }
  if (action.kind === "punch") {
    const title = action.title || event.name || "Failed inspection";
    const line = `Punch: ${title}`;
    if (dry) return line;
    if (event.kind !== "inspection_result" || event.status !== "failed" || !event.projectId) throw new ServiceError("Not a failed inspection.");
    const now = nowIso();
    const punchId = id("punch");
    db.insert(punchItems)
      .values({
        id: punchId,
        orgId: event.orgId,
        projectId: event.projectId,
        title,
        location: null,
        costCode: null,
        assigneeUserId: null,
        assigneeContactId: null,
        dueDate: null,
        status: "open",
        shared: 0,
        beforeDocumentId: null,
        afterDocumentId: null,
        doneAt: null,
        verifiedAt: null,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    audit(event.orgId, ruleName, "punch_item", punchId, { title });
    return line;
  }
  if (action.kind === "set_field") {
    return setStoredField(event.orgId, action.fieldId, { projectId: event.projectId, recordId: event.recordId }, action.value, dry);
  }
  if (action.kind === "schedule_talk") {
    const line = `Toolbox talk in ${action.withinWorkdays} workdays`;
    if (dry) return line;
    if (!event.projectId) throw new ServiceError("No job.");
    const topic = db.select().from(safetyTopics).where(and(eq(safetyTopics.orgId, event.orgId), eq(safetyTopics.id, action.topicId))).get();
    if (!topic) throw new ServiceError("That topic is not in your company.");
    const project = projectOf(event.orgId, event.projectId);
    if (!project) throw new ServiceError("That job is not in your company.");
    const owner = db.select().from(memberships).where(and(eq(memberships.orgId, event.orgId), eq(memberships.role, "owner"))).get();
    const leader = project.pmUserId || owner?.userId;
    if (!leader) throw new ServiceError("No leader.");
    const now = nowIso();
    const talkId = id("talk");
    db.insert(toolboxTalks)
      .values({
        id: talkId,
        orgId: event.orgId,
        projectId: project.id,
        topicId: topic.id,
        scheduledOn: addWorkdays(todayFor(event.orgId), action.withinWorkdays, workCalendarFor(event.orgId)),
        leaderUserId: leader,
        completedAt: null,
        voidedAt: null,
        notes: "",
        clientEventId: null,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
      })
      .run();
    audit(event.orgId, ruleName, "toolbox_talk", talkId, { topicId: topic.id, withinWorkdays: action.withinWorkdays });
    return line;
  }
  if (action.kind === "create_draft_po") {
    const line = "Create draft PO";
    if (dry) return line;
    if (event.kind !== "selection_confirmed") throw new ServiceError("Not a confirmed selection.");
    const result = createOrdersFrom(
      { userId: "automation", orgId: event.orgId, role: "owner", name: ruleName, email: "", orgName: "", authUserId: null },
      { sourceKind: "selection", sourceIds: [event.recordId], kind: "purchase" },
    );
    const first = result.orders[0];
    if (!first || first.added === 0) return first ? `Already on ${first.number}` : "Already ordered";
    return first.number;
  }
  if (action.kind === "request_confirmation") {
    const itemId = event.scheduleItemId || (event.recordType === "schedule_item" ? event.recordId : "");
    const line = "Request confirmation";
    if (dry) return line;
    if (!itemId) return "No schedule item";
    return systemRequestConfirmation(event.orgId, itemId);
  }
  const ids = gateIds(event);
  const names = itemNames(event.orgId, ids);
  const line = `${action.kind === "hold" ? "Hold" : "Release"}${names.length ? ` ${names.join(", ")}` : ""}`;
  if (dry) return line.trim();
  if (ids.length === 0) return "No schedule item";
  if (action.kind === "hold") resetConfirmedOnHold(event.orgId, ids);
  db.update(scheduleItems)
    .set({ held: action.kind === "hold" ? 1 : 0, updatedAt: nowIso() })
    .where(and(eq(scheduleItems.orgId, event.orgId), inArray(scheduleItems.id, ids)))
    .run();
  for (const itemId of ids) audit(event.orgId, ruleName, "schedule_item", itemId, { held: action.kind === "hold" });
  return line.trim();
}

function writeRun(rule: RuleRow, event: AutomationEvent, result: string, lines: string[], error: string | null) {
  const db = getDb();
  const now = nowIso();
  const runId = id("arun");
  db.insert(automationRuns)
    .values({
      id: runId,
      orgId: event.orgId,
      ruleId: rule.id,
      key: `${rule.id}:${event.recordType}:${event.recordId}`,
      recordType: event.recordType,
      recordId: event.recordId,
      recordLabel: event.recordLabel,
      actionsJson: JSON.stringify(lines),
      result,
      error,
      createdAt: now,
    })
    .run();
  db.update(automationRules)
    .set({ lastRunAt: now, runCount: rule.runCount + 1, updatedAt: now })
    .where(and(eq(automationRules.orgId, rule.orgId), eq(automationRules.id, rule.id)))
    .run();
  rule.runCount += 1;
  rule.lastRunAt = now;
  return runId;
}

function runEvent(event: AutomationEvent, depth: number, dryRuleId?: string) {
  const lines: string[] = [];
  if (!event.orgId || !event.recordId) return lines;
  const db = getDb();
  const rules = db
    .select()
    .from(automationRules)
    .where(eq(automationRules.orgId, event.orgId))
    .all()
    .filter((rule) => rule.enabled === 1 || rule.id === dryRuleId);
  for (const rule of rules) {
    if (dryRuleId && rule.id !== dryRuleId) continue;
    const trigger = parseTrigger(rule.triggerJson);
    if (!trigger) continue;
    if (!triggerMatches(trigger, event)) {
      if (dryRuleId) lines.push("Trigger does not match");
      continue;
    }
    if (!conditionsMatch(parseConditions(rule.conditionsJson), event)) {
      if (dryRuleId) lines.push("Conditions do not match");
      continue;
    }
    const key = `${rule.id}:${event.recordType}:${event.recordId}`;
    if (!dryRuleId) {
      const existing = db.select().from(automationRuns).where(and(eq(automationRuns.orgId, event.orgId), eq(automationRuns.key, key))).get();
      if (existing) continue;
    }
    if (depth >= AUTOMATION_DEPTH_LIMIT) {
      if (dryRuleId) lines.push("Depth limit");
      else writeRun(rule, event, "depth", [], null);
      continue;
    }
    const actions = parseActions(rule.actionsJson);
    if (dryRuleId) {
      for (const action of actions) lines.push(runAction(rule, action, event, depth, true));
      continue;
    }
    const runId = writeRun(rule, event, "ok", [], null);
    const done: string[] = [];
    let error: string | null = null;
    for (const action of actions) {
      try {
        done.push(runAction(rule, action, event, depth, false));
      } catch (err) {
        error = err instanceof Error ? err.message : "Action failed";
        done.push(error);
      }
    }
    db.update(automationRuns)
      .set({ actionsJson: JSON.stringify(done), result: error ? "failed" : "ok", error })
      .where(and(eq(automationRuns.orgId, event.orgId), eq(automationRuns.id, runId)))
      .run();
  }
  return lines;
}

/** A failed automation is logged and does not block the caller's save. */
export function emitAutomation(event: AutomationEvent, depth = 0) {
  try {
    runEvent(event, depth);
  } catch {
    return;
  }
}

export function scanAutomationClock(orgId: string) {
  const before = getDb().select().from(automationRuns).where(eq(automationRuns.orgId, orgId)).all().length;
  const today = todayFor(orgId);
  const db = getDb();
  const openInvoices = db.select().from(invoices).where(eq(invoices.orgId, orgId)).all();
  for (const invoice of openInvoices) {
    if (invoice.status === "paid" || invoice.status === "void") continue;
    const days = daySpan(invoice.dueDate, today);
    if (days < 1) continue;
    emitAutomation({
      orgId,
      kind: "invoice_overdue",
      recordType: "invoice",
      recordId: invoice.id,
      recordLabel: invoice.number,
      projectId: invoice.projectId,
      days,
      amountCents: invoice.totalCents,
      name: invoice.number,
    });
  }
  const certs = db.select().from(vendorCertificates).where(eq(vendorCertificates.orgId, orgId)).all();
  for (const cert of certs) {
    const days = daySpan(today, cert.expiresOn);
    const certKind = INSURANCE.has(cert.type) ? "insurance" : cert.type === "license" ? "license" : null;
    if (!certKind || days < 0) continue;
    const contact = db.select().from(contacts).where(and(eq(contacts.orgId, orgId), eq(contacts.id, cert.contactId))).get();
    emitAutomation({
      orgId,
      kind: "vendor_expiring",
      recordType: "vendor_certificate",
      recordId: cert.id,
      recordLabel: contact?.name ?? "Vendor",
      projectId: null,
      days,
      cert: certKind,
      name: contact?.name ?? "",
    });
  }
  const openGear = db
    .select()
    .from(equipmentAssignments)
    .where(eq(equipmentAssignments.orgId, orgId))
    .all()
    .filter((row) => !row.checkedInAt && row.expectedReturn && row.expectedReturn < today);
  for (const row of openGear) {
    const item = db.select().from(equipment).where(and(eq(equipment.orgId, orgId), eq(equipment.id, row.equipmentId))).get();
    emitAutomation({
      orgId,
      kind: "equipment_overdue",
      recordType: "equipment_assignment",
      recordId: row.id,
      recordLabel: item?.name ?? "Equipment",
      projectId: row.projectId,
      name: item?.name ?? "",
      days: row.expectedReturn ? daySpan(row.expectedReturn, today) : 0,
    });
  }
  const items = db.select().from(scheduleItems).where(eq(scheduleItems.orgId, orgId)).all();
  for (const item of items) {
    if (!item.vendorContactId || item.confirmStatus === "confirmed") continue;
    const days = daySpan(today, item.startDate);
    if (days < 0) continue;
    emitAutomation({
      orgId,
      kind: "unconfirmed_before",
      recordType: "schedule_item",
      recordId: item.id,
      recordLabel: item.title,
      projectId: item.projectId,
      name: item.title,
      days,
      scheduleItemId: item.id,
    });
  }
  const seenLate = new Set<string>();
  for (const row of deliveryRows(orgId, false)) {
    if (row.bucket !== "late" || seenLate.has(row.poId)) continue;
    seenLate.add(row.poId);
    emitAutomation({
      orgId,
      kind: "delivery_late",
      recordType: "purchase_order",
      recordId: row.poId,
      recordLabel: row.number,
      projectId: row.projectId,
      name: row.number,
    });
    notifyDelivery(orgId, {
      entityType: "purchase_order",
      entityId: row.poId,
      projectId: row.projectId,
      snippet: `${row.number} is late`,
      actorName: "Fieldline",
    });
  }
  const openVisits = db.select().from(agreementVisits).where(eq(agreementVisits.orgId, orgId)).all();
  const agreementNames = new Map(db.select().from(serviceAgreements).where(eq(serviceAgreements.orgId, orgId)).all().map((row) => [row.id, row.name]));
  for (const visit of openVisits) {
    if (visit.status !== "scheduled" || visit.assigneeUserId || visit.dueOn !== today) continue;
    emitAutomation({
      orgId,
      kind: "unassigned_today",
      recordType: "agreement_visit",
      recordId: visit.id,
      recordLabel: agreementNames.get(visit.agreementId) || "Visit",
      projectId: visit.projectId,
      name: agreementNames.get(visit.agreementId) || "Visit",
    });
  }
  const after = getDb().select().from(automationRuns).where(eq(automationRuns.orgId, orgId)).all().length;
  return { ran: after - before };
}

function assertManager(actor: Actor) {
  if (!canManageSettings(actor.role)) throw new ServiceError("Only an owner or admin can change automations.");
}

export function listRules(actor: Actor) {
  assertManager(actor);
  return getDb()
    .select()
    .from(automationRules)
    .where(eq(automationRules.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((rule) => ({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled === 1,
      trigger: triggerLabel(parseTrigger(rule.triggerJson) ?? { kind: "equipment_overdue" }),
      lastRunAt: rule.lastRunAt,
      runCount: rule.runCount,
    }));
}

export function ruleView(actor: Actor, ruleId: string): RuleDraft & { id: string } {
  assertManager(actor);
  const rule = getDb().select().from(automationRules).where(and(eq(automationRules.orgId, actor.orgId), eq(automationRules.id, ruleId))).get();
  if (!rule) throw new ServiceError("That rule is not in your company.");
  const trigger = parseTrigger(rule.triggerJson);
  if (!trigger) throw new ServiceError("That rule is not in your company.");
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled === 1,
    trigger,
    conditions: parseConditions(rule.conditionsJson),
    actions: parseActions(rule.actionsJson),
  };
}

export function runsFor(actor: Actor, ruleId: string) {
  assertManager(actor);
  const rule = getDb().select().from(automationRules).where(and(eq(automationRules.orgId, actor.orgId), eq(automationRules.id, ruleId))).get();
  if (!rule) throw new ServiceError("That rule is not in your company.");
  const runs = getDb()
    .select()
    .from(automationRuns)
    .where(and(eq(automationRuns.orgId, actor.orgId), eq(automationRuns.ruleId, ruleId)))
    .all()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    name: rule.name,
    runs: runs.map((run) => ({
      id: run.id,
      at: run.createdAt,
      record: run.recordLabel,
      actions: parseStringList(run.actionsJson),
      result: run.result,
    })),
  };
}

function parseStringList(raw: string) {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function formOptions(orgId: string) {
  const db = getDb();
  return {
    templates: db.select().from(jobTemplates).where(eq(jobTemplates.orgId, orgId)).all().map((row) => ({ id: row.id, name: row.name })),
    topics: db.select().from(safetyTopics).where(eq(safetyTopics.orgId, orgId)).all().sort((a, b) => a.sortOrder - b.sortOrder).map((row) => ({ id: row.id, name: row.title })),
    fields: db
      .select()
      .from(customFields)
      .where(eq(customFields.orgId, orgId))
      .all()
      .filter((row) => !row.archivedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
      .map((row) => ({ id: row.id, label: row.label, recordType: row.recordType, fieldType: row.fieldType })),
    people: db
      .select({ id: users.id, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgId))
      .all()
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function previewRecordLabel(trigger: Trigger) {
  if (trigger.kind === "job_status" || trigger.kind === "proposal_signed") return "Job";
  if (trigger.kind === "schedule_done" || trigger.kind === "schedule_declined" || trigger.kind === "unconfirmed_before") return "Schedule item";
  if (trigger.kind === "inspection_result") return "Inspection";
  if (trigger.kind === "punch_verified") return "Punch item";
  if (trigger.kind === "invoice_overdue") return "Invoice";
  if (trigger.kind === "vendor_expiring") return "Certificate";
  if (trigger.kind === "equipment_overdue") return "Equipment";
  if (trigger.kind === "incident_logged") return "Incident";
  if (trigger.kind === "checklist_failed") return "Checklist item";
  if (trigger.kind === "tm_verified") return "T&M ticket";
  if (trigger.kind === "selection_confirmed") return "Selection";
  if (trigger.kind === "delivery_late" || trigger.kind === "delivery_received") return "Purchase order";
  if (trigger.kind === "vendor_credit_issued") return "Vendor credit";
  if (trigger.kind === "stock_low") return "Stock item";
  if (trigger.kind === "clock_outside") return "Time entry";
  if (trigger.kind === "visit_due") return "Visit";
  if (trigger.kind === "agreement_expiring") return "Agreement";
  if (trigger.kind === "unassigned_today") return "Visit";
  if (trigger.kind === "booking_created") return "Booking";
  if (trigger.kind === "review_request_created" || trigger.kind === "review_request_marked_sent") return "Review";
  if (trigger.kind === "invoice_followup_created" || trigger.kind === "invoice_followup_marked_sent") return "Invoice";
  return "Checklist item";
}

export function previewChoices(orgId: string, trigger: Trigger) {
  const db = getDb();
  if (trigger.kind === "job_status" || trigger.kind === "proposal_signed") {
    return db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => ({ id: row.id, label: row.name }));
  }
  if (trigger.kind === "schedule_done" || trigger.kind === "schedule_declined" || trigger.kind === "unconfirmed_before" || trigger.kind === "inspection_result") {
    if (trigger.kind === "inspection_result") {
      return db
        .select()
        .from(inspections)
        .where(eq(inspections.orgId, orgId))
        .all()
        .map((row) => ({ id: row.id, label: row.name }));
    }
    return db.select().from(scheduleItems).where(eq(scheduleItems.orgId, orgId)).all().slice(0, 40).map((row) => ({ id: row.id, label: row.title }));
  }
  if (trigger.kind === "punch_verified") {
    return db.select().from(punchItems).where(eq(punchItems.orgId, orgId)).all().map((row) => ({ id: row.id, label: row.title }));
  }
  if (trigger.kind === "invoice_overdue") {
    return db.select().from(invoices).where(eq(invoices.orgId, orgId)).all().map((row) => ({ id: row.id, label: row.number }));
  }
  if (trigger.kind === "vendor_expiring") {
    return db.select().from(vendorCertificates).where(eq(vendorCertificates.orgId, orgId)).all().map((row) => ({ id: row.id, label: row.type }));
  }
  if (trigger.kind === "incident_logged") {
    return db.select().from(incidents).where(eq(incidents.orgId, orgId)).all().map((row) => ({ id: row.id, label: row.description }));
  }
  if (trigger.kind === "checklist_failed") {
    return db
      .select({ id: safetyCheckItems.id, title: safetyCheckItems.title })
      .from(safetyCheckItems)
      .where(eq(safetyCheckItems.orgId, orgId))
      .all()
      .map((row) => ({ id: row.id, label: row.title }));
  }
  if (trigger.kind === "tm_verified") {
    return db
      .select()
      .from(tmTickets)
      .where(eq(tmTickets.orgId, orgId))
      .all()
      .map((row) => ({ id: row.id, label: ticketLabel(row.number) }));
  }
  if (trigger.kind === "selection_confirmed") {
    return db.select().from(selections).where(eq(selections.orgId, orgId)).all().map((row) => ({ id: row.id, label: row.title }));
  }
  if (trigger.kind === "delivery_late" || trigger.kind === "delivery_received") {
    return db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.orgId, orgId))
      .all()
      .filter((row) => row.status === "issued" || row.status === "closed")
      .map((row) => ({ id: row.id, label: row.number }));
  }
  if (trigger.kind === "vendor_credit_issued") {
    return db.select().from(vendorCredits).where(eq(vendorCredits.orgId, orgId)).all().map((row) => ({ id: row.id, label: row.number }));
  }
  if (trigger.kind === "stock_low") {
    const books = new Map(db.select().from(priceBookItems).where(eq(priceBookItems.orgId, orgId)).all().map((row) => [row.id, row.name]));
    return db
      .select()
      .from(stockItems)
      .where(eq(stockItems.orgId, orgId))
      .all()
      .map((row) => ({ id: row.id, label: books.get(row.priceBookItemId) || "Stock" }));
  }
  if (trigger.kind === "visit_due") {
    const names = new Map(db.select().from(serviceAgreements).where(eq(serviceAgreements.orgId, orgId)).all().map((row) => [row.id, row.name]));
    return db
      .select()
      .from(agreementVisits)
      .where(eq(agreementVisits.orgId, orgId))
      .all()
      .map((row) => ({ id: row.id, label: `${names.get(row.agreementId) || "Visit"} ${row.dueOn}` }));
  }
  if (trigger.kind === "agreement_expiring") {
    return db.select().from(serviceAgreements).where(eq(serviceAgreements.orgId, orgId)).all().map((row) => ({ id: row.id, label: row.name }));
  }
  if (trigger.kind === "unassigned_today") {
    const names = new Map(db.select().from(serviceAgreements).where(eq(serviceAgreements.orgId, orgId)).all().map((row) => [row.id, row.name]));
    return db
      .select()
      .from(agreementVisits)
      .where(eq(agreementVisits.orgId, orgId))
      .all()
      .filter((row) => row.status === "scheduled" && !row.assigneeUserId)
      .map((row) => ({ id: row.id, label: names.get(row.agreementId) || "Visit" }));
  }
  if (trigger.kind === "booking_created") {
    const names = new Map(db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(eq(contacts.orgId, orgId)).all().map((row) => [row.id, row.name]));
    return db.select().from(bookings).where(eq(bookings.orgId, orgId)).all().map((row) => ({ id: row.id, label: names.get(row.contactId) || "Booking" }));
  }
  if (trigger.kind === "review_request_created" || trigger.kind === "review_request_marked_sent") {
    const names = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row.name]));
    return db.select().from(reviewRequests).where(eq(reviewRequests.orgId, orgId)).all().map((row) => ({ id: row.id, label: names.get(row.projectId) || "Review" }));
  }
  if (trigger.kind === "invoice_followup_created" || trigger.kind === "invoice_followup_marked_sent") {
    const numbers = new Map(db.select().from(invoices).where(eq(invoices.orgId, orgId)).all().map((row) => [row.id, row.number]));
    return db.select().from(invoiceFollowUps).where(eq(invoiceFollowUps.orgId, orgId)).all().map((row) => ({ id: row.id, label: numbers.get(row.invoiceId) || "Invoice" }));
  }
  if (trigger.kind === "clock_outside") {
    const names = new Map(db.select({ id: users.id, name: users.name }).from(users).all().map((row) => [row.id, row.name]));
    return db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.orgId, orgId))
      .all()
      .filter((row) => row.geoInVerdict === "outside" || row.geoOutVerdict === "outside")
      .map((row) => ({ id: row.id, label: names.get(row.userId) || "Time" }));
  }
  return db.select().from(equipment).where(eq(equipment.orgId, orgId)).all().map((row) => ({ id: row.id, label: row.name }));
}

function eventFromRecord(orgId: string, trigger: Trigger, recordId: string): AutomationEvent | null {
  const db = getDb();
  if (trigger.kind === "job_status") {
    const project = projectOf(orgId, recordId);
    if (!project) return null;
    return {
      orgId,
      kind: "job_status",
      recordType: "project",
      recordId: project.id,
      recordLabel: project.name,
      projectId: project.id,
      status: project.status,
      name: project.name,
      amountCents: project.contractValueCents,
    };
  }
  if (trigger.kind === "proposal_signed") {
    const proposal = db.select().from(proposals).where(and(eq(proposals.orgId, orgId), eq(proposals.id, recordId))).get();
    const project = proposal?.projectId ? projectOf(orgId, proposal.projectId) : projectOf(orgId, recordId);
    if (!project && !proposal) return null;
    return {
      orgId,
      kind: "proposal_signed",
      recordType: "proposal",
      recordId: proposal?.id ?? recordId,
      recordLabel: project?.name ?? "Proposal",
      projectId: project?.id ?? null,
      name: project?.name,
      amountCents: project?.contractValueCents ?? null,
    };
  }
  if (trigger.kind === "schedule_done") {
    const item = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.id, recordId))).get();
    if (!item) return null;
    return { orgId, kind: "schedule_done", recordType: "schedule_item", recordId: item.id, recordLabel: item.title, projectId: item.projectId, name: item.title, scheduleItemId: item.id };
  }
  if (trigger.kind === "schedule_declined" || trigger.kind === "unconfirmed_before") {
    const item = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.id, recordId))).get();
    if (!item) return null;
    const days = daySpan(todayFor(orgId), item.startDate);
    return {
      orgId,
      kind: trigger.kind,
      recordType: "schedule_item",
      recordId: item.id,
      recordLabel: item.title,
      projectId: item.projectId,
      name: item.title,
      days,
      scheduleItemId: item.id,
      status: item.confirmStatus ?? "",
    };
  }
  if (trigger.kind === "inspection_result") {
    const inspection = db.select().from(inspections).where(and(eq(inspections.orgId, orgId), eq(inspections.id, recordId))).get();
    if (!inspection) return null;
    const gates = db.select().from(inspectionGates).where(and(eq(inspectionGates.orgId, orgId), eq(inspectionGates.inspectionId, inspection.id))).all();
    return {
      orgId,
      kind: "inspection_result",
      recordType: "inspection",
      recordId: inspection.id,
      recordLabel: inspection.name,
      projectId: inspection.projectId,
      status: inspection.result,
      name: inspection.name,
      scheduleItemId: inspection.scheduleItemId,
      gateItemIds: gates.map((gate) => gate.scheduleItemId),
    };
  }
  if (trigger.kind === "punch_verified") {
    const item = db.select().from(punchItems).where(and(eq(punchItems.orgId, orgId), eq(punchItems.id, recordId))).get();
    if (!item) return null;
    return { orgId, kind: "punch_verified", recordType: "punch_item", recordId: item.id, recordLabel: item.title, projectId: item.projectId, name: item.title };
  }
  if (trigger.kind === "invoice_overdue") {
    const invoice = db.select().from(invoices).where(and(eq(invoices.orgId, orgId), eq(invoices.id, recordId))).get();
    if (!invoice) return null;
    return {
      orgId,
      kind: "invoice_overdue",
      recordType: "invoice",
      recordId: invoice.id,
      recordLabel: invoice.number,
      projectId: invoice.projectId,
      days: daySpan(invoice.dueDate, todayFor(orgId)),
      amountCents: invoice.totalCents,
      name: invoice.number,
      status: invoice.status,
    };
  }
  if (trigger.kind === "vendor_expiring") {
    const cert = db.select().from(vendorCertificates).where(and(eq(vendorCertificates.orgId, orgId), eq(vendorCertificates.id, recordId))).get();
    if (!cert) return null;
    const contact = db.select().from(contacts).where(and(eq(contacts.orgId, orgId), eq(contacts.id, cert.contactId))).get();
    const certKind = INSURANCE.has(cert.type) ? "insurance" : cert.type === "license" ? "license" : undefined;
    return {
      orgId,
      kind: "vendor_expiring",
      recordType: "vendor_certificate",
      recordId: cert.id,
      recordLabel: contact?.name ?? "Vendor",
      projectId: null,
      days: daySpan(todayFor(orgId), cert.expiresOn),
      cert: certKind,
      name: contact?.name ?? "",
    };
  }
  if (trigger.kind === "incident_logged") {
    const incident = db.select().from(incidents).where(and(eq(incidents.orgId, orgId), eq(incidents.id, recordId))).get();
    if (!incident) return null;
    return {
      orgId,
      kind: "incident_logged",
      recordType: "incident",
      recordId: incident.id,
      recordLabel: incident.description.slice(0, 80),
      projectId: incident.projectId,
      name: incident.description,
    };
  }
  if (trigger.kind === "checklist_failed") {
    const item = db.select().from(safetyCheckItems).where(and(eq(safetyCheckItems.orgId, orgId), eq(safetyCheckItems.id, recordId))).get();
    if (!item) return null;
    const check = db.select().from(safetyChecks).where(and(eq(safetyChecks.orgId, orgId), eq(safetyChecks.id, item.checkId))).get();
    return {
      orgId,
      kind: "checklist_failed",
      recordType: "safety_check_item",
      recordId: item.id,
      recordLabel: item.title,
      projectId: check?.projectId ?? null,
      name: item.title,
      status: item.result,
    };
  }
  if (trigger.kind === "tm_verified") {
    const ticket = db.select().from(tmTickets).where(and(eq(tmTickets.orgId, orgId), eq(tmTickets.id, recordId))).get();
    if (!ticket) return null;
    return {
      orgId,
      kind: "tm_verified",
      recordType: "tm_ticket",
      recordId: ticket.id,
      recordLabel: ticketLabel(ticket.number),
      projectId: ticket.projectId,
      name: ticketLabel(ticket.number),
    };
  }
  if (trigger.kind === "selection_confirmed") {
    const selection = db.select().from(selections).where(and(eq(selections.orgId, orgId), eq(selections.id, recordId))).get();
    if (!selection) return null;
    return {
      orgId,
      kind: "selection_confirmed",
      recordType: "selection",
      recordId: selection.id,
      recordLabel: selection.title,
      projectId: selection.projectId,
      name: selection.title,
    };
  }
  if (trigger.kind === "vendor_credit_issued") {
    const credit = db.select().from(vendorCredits).where(and(eq(vendorCredits.orgId, orgId), eq(vendorCredits.id, recordId))).get();
    if (!credit) return null;
    return {
      orgId,
      kind: "vendor_credit_issued",
      recordType: "vendor_credit",
      recordId: credit.id,
      recordLabel: credit.number,
      projectId: credit.projectId,
      name: credit.number,
      amountCents: credit.amountCents,
    };
  }
  if (trigger.kind === "delivery_late" || trigger.kind === "delivery_received") {
    const order = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.id, recordId))).get();
    if (!order) return null;
    return {
      orgId,
      kind: trigger.kind,
      recordType: "purchase_order",
      recordId: order.id,
      recordLabel: order.number,
      projectId: order.projectId,
      name: order.number,
    };
  }
  if (trigger.kind === "visit_due") {
    const visit = db.select().from(agreementVisits).where(and(eq(agreementVisits.orgId, orgId), eq(agreementVisits.id, recordId))).get();
    if (!visit) return null;
    const row = db.select().from(serviceAgreements).where(and(eq(serviceAgreements.orgId, orgId), eq(serviceAgreements.id, visit.agreementId))).get();
    return {
      orgId,
      kind: "visit_due",
      recordType: "agreement_visit",
      recordId: visit.id,
      recordLabel: row?.name || "Visit",
      projectId: visit.projectId,
      name: row?.name || "Visit",
    };
  }
  if (trigger.kind === "unassigned_today") {
    const visit = db.select().from(agreementVisits).where(and(eq(agreementVisits.orgId, orgId), eq(agreementVisits.id, recordId))).get();
    if (!visit) return null;
    const row = db.select().from(serviceAgreements).where(and(eq(serviceAgreements.orgId, orgId), eq(serviceAgreements.id, visit.agreementId))).get();
    return {
      orgId,
      kind: "unassigned_today",
      recordType: "agreement_visit",
      recordId: visit.id,
      recordLabel: row?.name || "Visit",
      projectId: visit.projectId,
      name: row?.name || "Visit",
    };
  }
  if (trigger.kind === "agreement_expiring") {
    const row = db.select().from(serviceAgreements).where(and(eq(serviceAgreements.orgId, orgId), eq(serviceAgreements.id, recordId))).get();
    if (!row) return null;
    return {
      orgId,
      kind: "agreement_expiring",
      recordType: "service_agreement",
      recordId: row.id,
      recordLabel: row.name,
      projectId: row.projectId,
      name: row.name,
      days: row.endOn ? daySpan(todayFor(orgId), row.endOn) : 0,
    };
  }
  if (trigger.kind === "clock_outside") {
    const entry = db.select().from(timeEntries).where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.id, recordId))).get();
    if (!entry) return null;
    const job = entry.projectId ? db.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, entry.projectId))).get() : null;
    return {
      orgId,
      kind: "clock_outside",
      recordType: "time_entry",
      recordId: entry.id,
      recordLabel: job?.name || "Time",
      projectId: entry.projectId || null,
      name: job?.name || "Time",
    };
  }
  if (trigger.kind === "stock_low") {
    const item = db.select().from(stockItems).where(and(eq(stockItems.orgId, orgId), eq(stockItems.id, recordId))).get();
    if (!item) return null;
    const book = db.select().from(priceBookItems).where(and(eq(priceBookItems.id, item.priceBookItemId), eq(priceBookItems.orgId, orgId))).get();
    return {
      orgId,
      kind: "stock_low",
      recordType: "stock_item",
      recordId: item.id,
      recordLabel: book?.name || "Stock",
      projectId: null,
      name: book?.name || "Stock",
    };
  }
  if (trigger.kind === "booking_created") {
    const row = db.select().from(bookings).where(and(eq(bookings.orgId, orgId), eq(bookings.id, recordId))).get();
    if (!row) return null;
    const contact = db.select().from(contacts).where(and(eq(contacts.orgId, orgId), eq(contacts.id, row.contactId))).get();
    const service = db.select().from(priceBookItems).where(and(eq(priceBookItems.orgId, orgId), eq(priceBookItems.id, row.itemId))).get();
    return {
      orgId,
      kind: "booking_created",
      recordType: "booking",
      recordId: row.id,
      recordLabel: service?.name || "Booking",
      projectId: null,
      name: contact?.name || "Booking",
    };
  }
  if (trigger.kind === "review_request_created" || trigger.kind === "review_request_marked_sent") {
    const row = db.select().from(reviewRequests).where(and(eq(reviewRequests.orgId, orgId), eq(reviewRequests.id, recordId))).get();
    if (!row) return null;
    const project = db.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, row.projectId))).get();
    return {
      orgId,
      kind: trigger.kind,
      recordType: "review_request",
      recordId: row.id,
      recordLabel: project?.name || "Review",
      projectId: row.projectId,
      name: project?.name || "Review",
    };
  }
  if (trigger.kind === "invoice_followup_created" || trigger.kind === "invoice_followup_marked_sent") {
    const row = db.select().from(invoiceFollowUps).where(and(eq(invoiceFollowUps.orgId, orgId), eq(invoiceFollowUps.id, recordId))).get();
    if (!row) return null;
    const invoice = db.select().from(invoices).where(and(eq(invoices.orgId, orgId), eq(invoices.id, row.invoiceId))).get();
    return {
      orgId,
      kind: trigger.kind,
      recordType: "invoice_followup",
      recordId: row.id,
      recordLabel: invoice?.number || "Invoice",
      projectId: row.projectId,
      name: invoice?.number || "Invoice",
      amountCents: invoice ? invoice.totalCents - invoice.amountPaidCents : null,
    };
  }
  const item = db.select().from(equipment).where(and(eq(equipment.orgId, orgId), eq(equipment.id, recordId))).get();
  if (!item) return null;
  const open = db
    .select()
    .from(equipmentAssignments)
    .where(and(eq(equipmentAssignments.orgId, orgId), eq(equipmentAssignments.equipmentId, item.id)))
    .all()
    .find((row) => !row.checkedInAt);
  const today = todayFor(orgId);
  return {
    orgId,
    kind: "equipment_overdue",
    recordType: "equipment_assignment",
    recordId: open?.id ?? item.id,
    recordLabel: item.name,
    projectId: item.projectId,
    name: item.name,
    days: open?.expectedReturn ? daySpan(open.expectedReturn, today) : -1,
  };
}

export function previewRule(actor: Actor, ruleId: string, recordId: string) {
  assertManager(actor);
  const rule = getDb().select().from(automationRules).where(and(eq(automationRules.orgId, actor.orgId), eq(automationRules.id, ruleId))).get();
  if (!rule) throw new ServiceError("That rule is not in your company.");
  const trigger = parseTrigger(rule.triggerJson);
  if (!trigger) return { match: false, lines: ["Trigger does not match"] };
  const event = eventFromRecord(actor.orgId, trigger, recordId);
  if (!event) return { match: false, lines: ["Record not found"] };
  if (trigger.kind === "invoice_overdue" && (event.status === "paid" || event.status === "void")) {
    return { match: false, lines: ["Trigger does not match"] };
  }
  if (trigger.kind === "equipment_overdue" && (event.days ?? -1) < 1) {
    return { match: false, lines: ["Trigger does not match"] };
  }
  const lines = runEvent(event, 0, rule.id);
  const blocked = lines.some((line) => line === "Trigger does not match" || line === "Conditions do not match" || line === "Depth limit" || line === "Record not found");
  return { match: lines.length > 0 && !blocked, lines };
}

export function noticesFor(actor: Actor) {
  const rows = getDb().select().from(automationNotices).where(eq(automationNotices.orgId, actor.orgId)).all();
  return rows
    .filter((row) => {
      if (row.userId && row.userId === actor.userId) return true;
      if (row.role === "office") return canEditCrm(actor.role);
      if (row.role && row.role === actor.role) return true;
      return false;
    })
    .map((row) => ({ id: row.id, title: row.title, href: row.href }));
}

function formText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function formSlots(formData: FormData, prefix: string) {
  const indexes = new Set<number>();
  for (const key of formData.keys()) {
    const match = new RegExp(`^${prefix}(\\d+)kind$`).exec(key);
    if (match) indexes.add(Number(match[1]));
  }
  return [...indexes].sort((a, b) => a - b).map(String);
}

export function ruleFromForm(formData: FormData): RuleDraft {
  const name = clean(formText(formData, "name"), 80);
  if (!name) throw new ServiceError("Name the rule.");
  const kind = formText(formData, "trigger");
  const days = daysOf(formText(formData, "days"));
  let trigger: Trigger | null = null;
  if (kind === "job_status") {
    const status = formText(formData, "status");
    if (status === "active" || status === "complete") trigger = { kind: "job_status", status };
  } else if (kind === "proposal_signed") trigger = { kind: "proposal_signed" };
  else if (kind === "schedule_done") trigger = { kind: "schedule_done" };
  else if (kind === "schedule_declined") trigger = { kind: "schedule_declined" };
  else if (kind === "unconfirmed_before" && days != null) trigger = { kind: "unconfirmed_before", days };
  else if (kind === "inspection_result") {
    const result = formText(formData, "result");
    if (result === "passed" || result === "failed") trigger = { kind: "inspection_result", result };
  } else if (kind === "punch_verified") trigger = { kind: "punch_verified" };
  else if (kind === "invoice_overdue" && days != null) trigger = { kind: "invoice_overdue", days };
  else if (kind === "vendor_expiring" && days != null) {
    const cert = formText(formData, "cert");
    if (cert === "insurance" || cert === "license") trigger = { kind: "vendor_expiring", days, cert };
  } else if (kind === "equipment_overdue") trigger = { kind: "equipment_overdue" };
  else if (kind === "incident_logged") trigger = { kind: "incident_logged" };
  else if (kind === "checklist_failed") trigger = { kind: "checklist_failed" };
  else if (kind === "tm_verified") trigger = { kind: "tm_verified" };
  else if (kind === "selection_confirmed") trigger = { kind: "selection_confirmed" };
  else if (kind === "delivery_late") trigger = { kind: "delivery_late" };
  else if (kind === "delivery_received") trigger = { kind: "delivery_received" };
  else if (kind === "vendor_credit_issued") trigger = { kind: "vendor_credit_issued" };
  else if (kind === "stock_low") trigger = { kind: "stock_low" };
  else if (kind === "clock_outside") trigger = { kind: "clock_outside" };
  else if (kind === "visit_due") trigger = { kind: "visit_due" };
  else if (kind === "agreement_expiring") trigger = { kind: "agreement_expiring" };
  else if (kind === "unassigned_today") trigger = { kind: "unassigned_today" };
  else if (kind === "booking_created") trigger = { kind: "booking_created" };
  else if (kind === "review_request_created") trigger = { kind: "review_request_created" };
  else if (kind === "review_request_marked_sent") trigger = { kind: "review_request_marked_sent" };
  else if (kind === "invoice_followup_created") trigger = { kind: "invoice_followup_created" };
  else if (kind === "invoice_followup_marked_sent") trigger = { kind: "invoice_followup_marked_sent" };
  if (!trigger) throw new ServiceError("Pick a trigger.");
  const conditions: Condition[] = [];
  const conditionSlots = formSlots(formData, "c");
  for (const slot of conditionSlots) {
    const conditionKind = formText(formData, `c${slot}kind`);
    const value = clean(formText(formData, `c${slot}value`), 80);
    if (conditionKind === "field") {
      const fieldId = formText(formData, `c${slot}field`);
      const op = formText(formData, `c${slot}op`);
      if (!fieldId) throw new ServiceError("Pick a field.");
      if (op !== "eq" && op !== "empty" && op !== "gt") throw new ServiceError("Pick how to test the field.");
      conditions.push({ kind: "field", fieldId, op, value: op === "empty" ? "" : value });
      continue;
    }
    if (!conditionKind || !value) continue;
    if (conditionKind === "job_type" || conditionKind === "cost_code" || conditionKind === "item_name") conditions.push({ kind: conditionKind, value });
    else if (conditionKind === "template") conditions.push({ kind: "template", templateId: value });
    else if (conditionKind === "pm") conditions.push({ kind: "pm", userId: value });
    else if (conditionKind === "amount_over" || conditionKind === "amount_under") {
      const dollars = Number(value);
      if (!Number.isFinite(dollars)) throw new ServiceError("Enter an amount.");
      conditions.push({ kind: conditionKind, cents: Math.round(dollars * 100) });
    }
  }
  const actions: Action[] = [];
  for (const slot of formSlots(formData, "a")) {
    const actionKind = formText(formData, `a${slot}kind`);
    if (!actionKind) continue;
    const title = clean(formText(formData, `a${slot}title`), 120);
    const who = formText(formData, `a${slot}who`);
    const dueDays = daysOf(formText(formData, `a${slot}days`)) ?? 0;
    if (actionKind === "apply_template") {
      const templateId = formText(formData, `a${slot}template`);
      if (!templateId) throw new ServiceError("Pick a template.");
      actions.push({ kind: "apply_template", templateId });
    } else if (actionKind === "todo") {
      if (!title) throw new ServiceError("Name the to-do.");
      actions.push({ kind: "todo", title, who, dueDays });
    } else if (actionKind === "today") {
      if (!title) throw new ServiceError("Name the Today row.");
      actions.push({ kind: "today", title, who });
    } else if (actionKind === "set_status") {
      const status = formText(formData, `a${slot}status`);
      if (status !== "active" && status !== "complete") throw new ServiceError("Pick a status.");
      actions.push({ kind: "set_status", status });
    } else if (actionKind === "punch") actions.push({ kind: "punch", title });
    else if (actionKind === "hold") actions.push({ kind: "hold" });
    else if (actionKind === "request_confirmation") actions.push({ kind: "request_confirmation" });
    else if (actionKind === "release") actions.push({ kind: "release" });
    else if (actionKind === "schedule_talk") {
      const topicId = formText(formData, `a${slot}topic`);
      const withinWorkdays = daysOf(formText(formData, `a${slot}days`));
      if (!topicId) throw new ServiceError("Pick a topic.");
      if (withinWorkdays == null) throw new ServiceError("Enter workdays.");
      actions.push({ kind: "schedule_talk", topicId, withinWorkdays });
    } else if (actionKind === "create_draft_po") actions.push({ kind: "create_draft_po" });
    else if (actionKind === "set_field") {
      const fieldId = formText(formData, `a${slot}field`);
      if (!fieldId) throw new ServiceError("Pick a field.");
      actions.push({ kind: "set_field", fieldId, value: formText(formData, `a${slot}value`) });
    }
  }
  if (actions.length === 0) throw new ServiceError("Add an action.");
  const ruleId = formText(formData, "id");
  return { id: ruleId || undefined, name, enabled: formText(formData, "enabled") !== "0", trigger, conditions, actions };
}

export function saveAutomation(actor: Actor, draft: RuleDraft) {
  assertManager(actor);
  const db = getDb();
  const now = nowIso();
  const values = {
    name: draft.name,
    enabled: draft.enabled ? 1 : 0,
    triggerKind: draft.trigger.kind,
    triggerJson: JSON.stringify(draft.trigger),
    conditionsJson: JSON.stringify(draft.conditions),
    actionsJson: JSON.stringify(draft.actions),
    updatedAt: now,
  };
  if (draft.id) {
    const existing = db.select().from(automationRules).where(and(eq(automationRules.orgId, actor.orgId), eq(automationRules.id, draft.id))).get();
    if (!existing) throw new ServiceError("That rule is not in your company.");
    db.update(automationRules).set(values).where(and(eq(automationRules.orgId, actor.orgId), eq(automationRules.id, existing.id))).run();
    return existing.id;
  }
  const ruleId = id("rule");
  db.insert(automationRules)
    .values({
      id: ruleId,
      orgId: actor.orgId,
      ...values,
      lastRunAt: null,
      runCount: 0,
      createdAt: now,
      createdBy: actor.userId,
    })
    .run();
  return ruleId;
}

export function toggleAutomation(actor: Actor, ruleId: string, enabled: boolean) {
  assertManager(actor);
  const db = getDb();
  const existing = db.select().from(automationRules).where(and(eq(automationRules.orgId, actor.orgId), eq(automationRules.id, ruleId))).get();
  if (!existing) throw new ServiceError("That rule is not in your company.");
  db.update(automationRules)
    .set({ enabled: enabled ? 1 : 0, updatedAt: nowIso() })
    .where(and(eq(automationRules.orgId, actor.orgId), eq(automationRules.id, ruleId)))
    .run();
}

bindReviewEmit(emitAutomation);
bindCollectEmit(emitAutomation);
