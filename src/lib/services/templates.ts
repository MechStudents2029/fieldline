import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  budgetLines,
  changeOrders,
  contacts,
  draws,
  jobTemplates,
  memberships,
  projects,
  punchItems,
  scheduleItems,
  scheduleLinks,
  selections,
  taskChecks,
  tasks,
  templateAttempts,
  templateChecks,
  templateDraws,
  templateLines,
  templateSelections,
  templateTaskLinks,
  templateTasks,
  templateTodoChecks,
  templateTodos,
  users,
} from "@/lib/db/schema";
import { id, nowIso, token } from "@/lib/ids";
import { canEditCrm, canSeeMoney, type Role } from "@/lib/permissions";
import { lineCents, percentsFromAmounts, rescalePercents } from "@/lib/templates/rescale";
import { dateFromOffset, endFromDuration, inclusiveWorkdays, workdayOffset } from "@/lib/schedule/workdays";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { applyTemplateTodos } from "@/lib/services/todos";
import { workdaysForOrg } from "@/lib/services/time";

export const TEMPLATE_PARTS = ["schedule", "estimate", "draws", "selections", "punch", "todos"] as const;
export type TemplatePart = (typeof TEMPLATE_PARTS)[number];

const LIMIT = 20;
const WINDOW_MS = 10 * 60 * 1000;

export type TemplateTaskDraft = {
  key: string;
  title: string;
  phase: string | null;
  startOffset: number;
  durationWorkdays: number;
  trade: string | null;
  predecessors: { key: string; lag: number }[];
};

export type TemplateTodoDraft = {
  title: string;
  notes: string;
  priority: string;
  tags: string;
  remindDays: number | null;
  scheduleKey: string | null;
  deadlineEdge: string | null;
  deadlineOffset: number | null;
  checks: { title: string }[];
};

export type TemplateDraft = {
  name: string;
  jobType: string;
  tasks: TemplateTaskDraft[];
  lines: { name: string; costCode: string | null; qtyMilli: number; unit: string; unitCostCents: number; unitPriceCents: number }[];
  draws: { title: string; bps: number }[];
  selections: { title: string; area: string | null; allowanceCents: number }[];
  checks: { title: string; kind: string }[];
  todos?: TemplateTodoDraft[];
};

export type PartCounts = {
  schedule: number;
  estimate: number | null;
  draws: number | null;
  selections: number | null;
  punch: number;
  todos: number;
};

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function assertOffice(actor: Actor) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot change templates.");
}

function money(actor: Actor) {
  return canSeeMoney(actor.role as Role);
}

function cleanName(value: string, label: string, max = 80): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > max) throw new ServiceError(`Add a ${label}.`);
  return name;
}

function guardRate(db: AppDatabase, actor: Actor) {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const recent = db
    .select()
    .from(templateAttempts)
    .where(and(eq(templateAttempts.orgId, actor.orgId), eq(templateAttempts.userId, actor.userId)))
    .all()
    .filter((row) => row.createdAt >= since);
  if (recent.length >= LIMIT) throw new ServiceError("Wait a few minutes");
  db.insert(templateAttempts)
    .values({ id: id("tatt"), orgId: actor.orgId, userId: actor.userId, createdAt: nowIso() })
    .run();
}

function audit(db: AppDatabase, actor: Actor, action: string, entityId: string, payload: Record<string, unknown>) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action,
      entityType: "template",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function countsFor(schedule: number, estimate: number, drawCount: number, selectionCount: number, punch: number, todos: number, showMoney: boolean): PartCounts {
  return {
    schedule,
    estimate: showMoney ? estimate : null,
    draws: showMoney ? drawCount : null,
    selections: showMoney ? selectionCount : null,
    punch,
    todos,
  };
}

function loadBundle(db: AppDatabase, orgId: string, templateId: string) {
  const template = db
    .select()
    .from(jobTemplates)
    .where(and(eq(jobTemplates.orgId, orgId), eq(jobTemplates.id, templateId)))
    .get();
  if (!template) return null;
  const tasks = db
    .select()
    .from(templateTasks)
    .where(and(eq(templateTasks.orgId, orgId), eq(templateTasks.templateId, templateId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const links = db
    .select()
    .from(templateTaskLinks)
    .where(and(eq(templateTaskLinks.orgId, orgId), eq(templateTaskLinks.templateId, templateId)))
    .all();
  const lines = db
    .select()
    .from(templateLines)
    .where(and(eq(templateLines.orgId, orgId), eq(templateLines.templateId, templateId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const drawRows = db
    .select()
    .from(templateDraws)
    .where(and(eq(templateDraws.orgId, orgId), eq(templateDraws.templateId, templateId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const selectionRows = db
    .select()
    .from(templateSelections)
    .where(and(eq(templateSelections.orgId, orgId), eq(templateSelections.templateId, templateId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const checks = db
    .select()
    .from(templateChecks)
    .where(and(eq(templateChecks.orgId, orgId), eq(templateChecks.templateId, templateId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const todos = db
    .select()
    .from(templateTodos)
    .where(and(eq(templateTodos.orgId, orgId), eq(templateTodos.templateId, templateId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const todoChecks = db
    .select()
    .from(templateTodoChecks)
    .where(and(eq(templateTodoChecks.orgId, orgId), eq(templateTodoChecks.templateId, templateId)))
    .all();
  return { template, tasks, links, lines, drawRows, selectionRows, checks, todos, todoChecks };
}

export function listTemplates(actor: Actor) {
  const db = dbFor(actor);
  const showMoney = money(actor);
  const rows = db.select().from(jobTemplates).where(eq(jobTemplates.orgId, actor.orgId)).all().sort((a, b) => a.name.localeCompare(b.name));
  return rows.map((row) => {
    const bundle = loadBundle(db, actor.orgId, row.id);
    return {
      id: row.id,
      name: row.name,
      jobType: row.jobType,
      version: row.version,
      counts: countsFor(
        bundle?.tasks.length ?? 0,
        bundle?.lines.length ?? 0,
        bundle?.drawRows.length ?? 0,
        bundle?.selectionRows.length ?? 0,
        bundle?.checks.length ?? 0,
        bundle?.todos.length ?? 0,
        showMoney,
      ),
      trades: [...new Set((bundle?.tasks ?? []).map((task) => task.trade).filter((trade): trade is string => Boolean(trade)))].sort(),
    };
  });
}

export function templateDetail(actor: Actor, templateId: string) {
  const db = dbFor(actor);
  const bundle = loadBundle(db, actor.orgId, templateId);
  if (!bundle) throw new ServiceError("That template is not in your company.");
  const showMoney = money(actor);
  return {
    id: bundle.template.id,
    name: bundle.template.name,
    jobType: bundle.template.jobType,
    version: bundle.template.version,
    counts: countsFor(bundle.tasks.length, bundle.lines.length, bundle.drawRows.length, bundle.selectionRows.length, bundle.checks.length, bundle.todos.length, showMoney),
    tasks: bundle.tasks.map((task) => ({
      key: task.itemKey,
      title: task.title,
      phase: task.phase,
      startOffset: task.startOffset,
      durationWorkdays: task.durationWorkdays,
      trade: task.trade,
      predecessors: bundle.links.filter((link) => link.itemKey === task.itemKey).map((link) => ({ key: link.predecessorKey, lag: link.lagWorkdays })),
    })),
    lines: showMoney
      ? bundle.lines.map((line) => ({
          name: line.name,
          costCode: line.costCode,
          qtyMilli: line.qtyMilli,
          unit: line.unit,
          unitCostCents: line.unitCostCents,
          unitPriceCents: line.unitPriceCents,
        }))
      : [],
    draws: showMoney ? bundle.drawRows.map((draw) => ({ title: draw.title, bps: draw.bps })) : [],
    selections: showMoney
      ? bundle.selectionRows.map((row) => ({ title: row.title, area: row.area, allowanceCents: row.allowanceCents }))
      : bundle.selectionRows.map((row) => ({ title: row.title, area: row.area, allowanceCents: null })),
    checks: bundle.checks.map((row) => ({ title: row.title, kind: row.kind })),
    todos: bundle.todos.map((todo) => ({
      title: todo.title,
      notes: todo.notes,
      priority: todo.priority,
      tags: todo.tags,
      remindDays: todo.remindDays,
      scheduleKey: todo.scheduleKey,
      deadlineEdge: todo.deadlineEdge,
      deadlineOffset: todo.deadlineOffset,
      checks: bundle.todoChecks
        .filter((row) => row.todoId === todo.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((row) => ({ title: row.title })),
    })),
    trades: [...new Set(bundle.tasks.map((task) => task.trade).filter((trade): trade is string => Boolean(trade)))].sort(),
  };
}

function writeDraft(tx: AppDatabase, actor: Actor, templateId: string, draft: TemplateDraft) {
  draft.tasks.forEach((task, index) => {
    tx.insert(templateTasks)
      .values({
        id: id("ttsk"),
        orgId: actor.orgId,
        templateId,
        itemKey: task.key,
        title: cleanName(task.title, "schedule title"),
        phase: task.phase,
        startOffset: task.startOffset,
        durationWorkdays: Math.max(1, task.durationWorkdays),
        trade: task.trade,
        sortOrder: index,
      })
      .run();
    for (const link of task.predecessors) {
      tx.insert(templateTaskLinks)
        .values({
          id: id("tlnk"),
          orgId: actor.orgId,
          templateId,
          itemKey: task.key,
          predecessorKey: link.key,
          lagWorkdays: Math.max(0, link.lag),
        })
        .run();
    }
  });
  draft.lines.forEach((line, index) => {
    tx.insert(templateLines)
      .values({
        id: id("tlin"),
        orgId: actor.orgId,
        templateId,
        name: cleanName(line.name, "line"),
        costCode: line.costCode,
        qtyMilli: line.qtyMilli,
        unit: line.unit || "ea",
        unitCostCents: line.unitCostCents,
        unitPriceCents: line.unitPriceCents,
        sortOrder: index,
      })
      .run();
  });
  draft.draws.forEach((draw, index) => {
    tx.insert(templateDraws)
      .values({
        id: id("tdrw"),
        orgId: actor.orgId,
        templateId,
        title: cleanName(draw.title, "draw"),
        bps: draw.bps,
        sortOrder: index,
      })
      .run();
  });
  draft.selections.forEach((row, index) => {
    tx.insert(templateSelections)
      .values({
        id: id("tsel"),
        orgId: actor.orgId,
        templateId,
        title: cleanName(row.title, "selection"),
        area: row.area,
        allowanceCents: row.allowanceCents,
        sortOrder: index,
      })
      .run();
  });
  draft.checks.forEach((row, index) => {
    tx.insert(templateChecks)
      .values({
        id: id("tchk"),
        orgId: actor.orgId,
        templateId,
        title: cleanName(row.title, "check"),
        kind: row.kind === "closeout" ? "closeout" : "punch",
        sortOrder: index,
      })
      .run();
  });
  (draft.todos ?? []).forEach((todo, index) => {
    const todoId = id("ttodo");
    tx.insert(templateTodos)
      .values({
        id: todoId,
        orgId: actor.orgId,
        templateId,
        title: cleanName(todo.title, "to-do"),
        notes: (todo.notes || "").slice(0, 2000),
        priority: todo.priority === "low" || todo.priority === "high" ? todo.priority : "normal",
        tags: (todo.tags || "").slice(0, 120),
        remindDays: todo.remindDays,
        scheduleKey: todo.scheduleKey,
        deadlineEdge: todo.deadlineEdge === "start" || todo.deadlineEdge === "finish" ? todo.deadlineEdge : null,
        deadlineOffset: todo.deadlineOffset,
        sortOrder: index,
      })
      .run();
    todo.checks.forEach((check, checkIndex) => {
      tx.insert(templateTodoChecks)
        .values({
          id: id("ttchk"),
          orgId: actor.orgId,
          templateId,
          todoId,
          title: cleanName(check.title, "checklist item"),
          sortOrder: checkIndex,
        })
        .run();
    });
  });
}

function clearDraft(tx: AppDatabase, orgId: string, templateId: string) {
  tx.delete(templateTaskLinks).where(and(eq(templateTaskLinks.orgId, orgId), eq(templateTaskLinks.templateId, templateId))).run();
  tx.delete(templateTasks).where(and(eq(templateTasks.orgId, orgId), eq(templateTasks.templateId, templateId))).run();
  tx.delete(templateLines).where(and(eq(templateLines.orgId, orgId), eq(templateLines.templateId, templateId))).run();
  tx.delete(templateDraws).where(and(eq(templateDraws.orgId, orgId), eq(templateDraws.templateId, templateId))).run();
  tx.delete(templateSelections).where(and(eq(templateSelections.orgId, orgId), eq(templateSelections.templateId, templateId))).run();
  tx.delete(templateChecks).where(and(eq(templateChecks.orgId, orgId), eq(templateChecks.templateId, templateId))).run();
  tx.delete(templateTodoChecks).where(and(eq(templateTodoChecks.orgId, orgId), eq(templateTodoChecks.templateId, templateId))).run();
  tx.delete(templateTodos).where(and(eq(templateTodos.orgId, orgId), eq(templateTodos.templateId, templateId))).run();
}

export function createTemplate(actor: Actor, draft: TemplateDraft) {
  assertOffice(actor);
  const db = dbFor(actor);
  guardRate(db, actor);
  const name = cleanName(draft.name, "template name");
  const jobType = cleanName(draft.jobType, "job type", 40);
  const templateId = id("tpl");
  const now = nowIso();
  db.transaction((tx) => {
    const writer = tx as unknown as AppDatabase;
    writer
      .insert(jobTemplates)
      .values({ id: templateId, orgId: actor.orgId, name, jobType, version: 1, createdAt: now, updatedAt: now, createdBy: actor.userId })
      .run();
    writeDraft(writer, actor, templateId, draft);
    audit(writer, actor, "template.create", templateId, { name, version: 1 });
  });
  return templateId;
}

export function replaceTemplate(actor: Actor, templateId: string, draft: TemplateDraft) {
  assertOffice(actor);
  const db = dbFor(actor);
  guardRate(db, actor);
  const existing = db.select().from(jobTemplates).where(and(eq(jobTemplates.orgId, actor.orgId), eq(jobTemplates.id, templateId))).get();
  if (!existing) throw new ServiceError("That template is not in your company.");
  const name = cleanName(draft.name, "template name");
  const jobType = cleanName(draft.jobType, "job type", 40);
  const version = existing.version + 1;
  db.transaction((tx) => {
    const writer = tx as unknown as AppDatabase;
    clearDraft(writer, actor.orgId, templateId);
    writer
      .update(jobTemplates)
      .set({ name, jobType, version, updatedAt: nowIso() })
      .where(and(eq(jobTemplates.orgId, actor.orgId), eq(jobTemplates.id, templateId)))
      .run();
    writeDraft(writer, actor, templateId, draft);
    audit(writer, actor, "template.update", templateId, { name, version });
  });
  return version;
}

export function renameTemplate(actor: Actor, templateId: string, name: string, jobType: string) {
  const detail = templateDetail(actor, templateId);
  return replaceTemplate(actor, templateId, {
    name,
    jobType,
    tasks: detail.tasks.map((task) => ({
      key: task.key,
      title: task.title,
      phase: task.phase,
      startOffset: task.startOffset,
      durationWorkdays: task.durationWorkdays,
      trade: task.trade,
      predecessors: task.predecessors,
    })),
    lines: detail.lines.map((line) => ({
      name: line.name,
      costCode: line.costCode,
      qtyMilli: line.qtyMilli,
      unit: line.unit,
      unitCostCents: line.unitCostCents,
      unitPriceCents: line.unitPriceCents,
    })),
    draws: detail.draws,
    selections: detail.selections.map((row) => ({ title: row.title, area: row.area, allowanceCents: row.allowanceCents ?? 0 })),
    checks: detail.checks,
    todos: detail.todos,
  });
}

function tradePlaceholder(title: string, vendorCompany: string | null): string {
  const blob = `${title} ${vendorCompany ?? ""}`.toLowerCase();
  if (/plumb|valve|pipe/.test(blob)) return "Plumbing";
  if (/tile|shower/.test(blob)) return "Tile";
  if (/electric|gfci/.test(blob)) return "Electrical";
  if (/cabinet|mill/.test(blob)) return "Cabinets";
  if (/counter|slab|stone/.test(blob)) return "Stone";
  if (/demo/.test(blob)) return "Demo";
  if (/appliance/.test(blob)) return "Appliance";
  return "Crew";
}

export function jobPartCounts(actor: Actor, projectId: string): PartCounts | null {
  const db = dbFor(actor);
  const project = db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, projectId))).get();
  if (!project) return null;
  const schedule = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, projectId))).all().length;
  const estimate = db
    .select()
    .from(budgetLines)
    .where(and(eq(budgetLines.orgId, actor.orgId), eq(budgetLines.projectId, projectId)))
    .all()
    .filter((line) => !line.changeOrderId).length;
  const drawCount = db.select().from(draws).where(and(eq(draws.orgId, actor.orgId), eq(draws.projectId, projectId))).all().filter((draw) => !draw.changeOrderId).length;
  const selectionCount = db.select().from(selections).where(and(eq(selections.orgId, actor.orgId), eq(selections.projectId, projectId))).all().length;
  const punch = db.select().from(punchItems).where(and(eq(punchItems.orgId, actor.orgId), eq(punchItems.projectId, projectId))).all().length;
  const todoCount = db.select().from(tasks).where(and(eq(tasks.orgId, actor.orgId), eq(tasks.relatedId, projectId))).all().filter((row) => row.relatedType === "project").length;
  return countsFor(schedule, estimate, drawCount, selectionCount, punch, todoCount, money(actor));
}

export function saveJobAsTemplate(actor: Actor, projectId: string, input: { name: string; jobType: string; parts: TemplatePart[] }) {
  assertOffice(actor);
  const db = dbFor(actor);
  const project = db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, projectId))).get();
  if (!project) throw new ServiceError("That job is not in your company.");
  const parts = new Set(input.parts);
  if (parts.size === 0) throw new ServiceError("Pick at least one part.");
  const mask = workdaysForOrg(actor.orgId);
  const draft: TemplateDraft = { name: input.name, jobType: input.jobType, tasks: [], lines: [], draws: [], selections: [], checks: [], todos: [] };
  let scheduleKeys = new Map<string, string>();
  if (parts.has("schedule")) {
    const items = db
      .select()
      .from(scheduleItems)
      .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, projectId)))
      .all()
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
    const anchor = items[0]?.startDate ?? project.startDate ?? "2026-01-05";
    const keys = new Map(items.map((item, index) => [item.id, `k${index}`]));
    scheduleKeys = keys;
    const vendors = db.select().from(contacts).where(eq(contacts.orgId, actor.orgId)).all();
    const vendorName = new Map(vendors.map((row) => [row.id, row.company || null]));
    const links = db.select().from(scheduleLinks).where(and(eq(scheduleLinks.orgId, actor.orgId), eq(scheduleLinks.projectId, projectId))).all();
    draft.tasks = items.map((item) => ({
      key: keys.get(item.id) ?? item.id,
      title: item.title,
      phase: null,
      startOffset: workdayOffset(anchor, item.startDate, mask),
      durationWorkdays: Math.max(1, inclusiveWorkdays(item.startDate, item.endDate, mask)),
      trade: tradePlaceholder(item.title, item.vendorContactId ? vendorName.get(item.vendorContactId) ?? null : null),
      predecessors: links
        .filter((link) => link.itemId === item.id && keys.has(link.predecessorId))
        .map((link) => ({ key: keys.get(link.predecessorId) ?? "", lag: link.lagWorkdays })),
    }));
  }
  if (parts.has("estimate")) {
    draft.lines = db
      .select()
      .from(budgetLines)
      .where(and(eq(budgetLines.orgId, actor.orgId), eq(budgetLines.projectId, projectId)))
      .all()
      .filter((line) => !line.changeOrderId)
      .map((line) => ({
        name: line.name,
        costCode: line.costCode,
        qtyMilli: 1000,
        unit: "ea",
        unitCostCents: line.budgetCostCents,
        unitPriceCents: line.budgetPriceCents,
      }));
  }
  if (parts.has("draws")) {
    const rows = db
      .select()
      .from(draws)
      .where(and(eq(draws.orgId, actor.orgId), eq(draws.projectId, projectId)))
      .all()
      .filter((draw) => !draw.changeOrderId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const bps = rows.every((draw) => draw.basis === "percent" && draw.bps > 0) ? rows.map((draw) => draw.bps) : percentsFromAmounts(rows.map((draw) => draw.amountCents));
    draft.draws = rows.map((draw, index) => ({ title: draw.title, bps: bps[index] ?? 0 }));
  }
  if (parts.has("selections")) {
    const rows = db.select().from(selections).where(and(eq(selections.orgId, actor.orgId), eq(selections.projectId, projectId))).all();
    const budgets = db.select().from(budgetLines).where(and(eq(budgetLines.orgId, actor.orgId), eq(budgetLines.projectId, projectId))).all();
    draft.selections = rows.map((row) => ({
      title: row.title,
      area: row.area,
      allowanceCents: budgets.find((line) => line.id === row.allowanceBudgetLineId)?.budgetPriceCents ?? 0,
    }));
  }
  if (parts.has("punch")) {
    draft.checks = db
      .select()
      .from(punchItems)
      .where(and(eq(punchItems.orgId, actor.orgId), eq(punchItems.projectId, projectId)))
      .all()
      .map((row) => ({ title: row.title, kind: "punch" }));
  }
  if (parts.has("todos")) {
    const rows = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.orgId, actor.orgId), eq(tasks.relatedId, projectId)))
      .all()
      .filter((row) => row.relatedType === "project");
    const checks = db.select().from(taskChecks).where(eq(taskChecks.orgId, actor.orgId)).all();
    draft.todos = rows.map((row) => ({
      title: row.title,
      notes: row.notes || "",
      priority: row.priority || "normal",
      tags: row.tags || "",
      remindDays: row.remindDays,
      scheduleKey: row.scheduleItemId ? scheduleKeys.get(row.scheduleItemId) ?? null : null,
      deadlineEdge: row.scheduleItemId && scheduleKeys.has(row.scheduleItemId) ? row.deadlineEdge : null,
      deadlineOffset: row.scheduleItemId && scheduleKeys.has(row.scheduleItemId) ? row.deadlineOffset : null,
      checks: checks
        .filter((check) => check.taskId === row.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((check) => ({ title: check.title })),
    }));
  }
  const total =
    draft.tasks.length + draft.lines.length + draft.draws.length + draft.selections.length + draft.checks.length + (draft.todos?.length ?? 0);
  if (total === 0) throw new ServiceError("That template has nothing to copy.");
  return createTemplate(actor, draft);
}

function selectedParts(parts: TemplatePart[]) {
  const chosen = new Set(parts.filter((part) => (TEMPLATE_PARTS as readonly string[]).includes(part)));
  if (chosen.size === 0) throw new ServiceError("Pick at least one part.");
  return chosen;
}

function vendorMap(db: AppDatabase, orgId: string, trades: Record<string, string | null>) {
  const contactsInOrg = db.select().from(contacts).where(eq(contacts.orgId, orgId)).all().filter((row) => !row.deletedAt);
  const allowed = new Set(contactsInOrg.filter((row) => row.type === "vendor" || row.type === "sub").map((row) => row.id));
  const mapped = new Map<string, string | null>();
  for (const [trade, contactId] of Object.entries(trades)) {
    if (!contactId) {
      mapped.set(trade, null);
      continue;
    }
    if (!allowed.has(contactId)) throw new ServiceError("That vendor is not in your company.");
    mapped.set(trade, contactId);
  }
  return mapped;
}

type ApplyResult = { added: number; schedule: number; estimate: number; draws: number; selections: number; punch: number; todos: number };

function applyParts(
  tx: AppDatabase,
  actor: Actor,
  projectId: string,
  templateId: string,
  parts: Set<TemplatePart>,
  anchor: string,
  trades: Record<string, string | null>,
  contractCents: number,
): ApplyResult {
  const bundle = loadBundle(tx, actor.orgId, templateId);
  if (!bundle) throw new ServiceError("That template is not in your company.");
  const mask = workdaysForOrg(actor.orgId);
  const vendors = vendorMap(tx, actor.orgId, trades);
  const now = nowIso();
  let schedule = 0;
  let estimate = 0;
  let drawCount = 0;
  let selectionCount = 0;
  let punch = 0;
  let todoCount = 0;
  const taskIds = new Map<string, string>();
  if (parts.has("schedule")) {
    for (const task of bundle.tasks) {
      const itemId = id("sch");
      taskIds.set(task.itemKey, itemId);
      const start = dateFromOffset(anchor, task.startOffset, mask);
      const end = endFromDuration(start, task.durationWorkdays, mask);
      tx.insert(scheduleItems)
        .values({
          id: itemId,
          orgId: actor.orgId,
          projectId,
          title: task.title,
          startDate: start,
          endDate: end,
          startTime: null,
          status: "planned",
          note: null,
          vendorContactId: task.trade ? vendors.get(task.trade) ?? null : null,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.userId,
        })
        .run();
      schedule += 1;
    }
    for (const link of bundle.links) {
      const itemId = taskIds.get(link.itemKey);
      const predecessorId = taskIds.get(link.predecessorKey);
      if (!itemId || !predecessorId) continue;
      tx.insert(scheduleLinks)
        .values({
          id: id("slnk"),
          orgId: actor.orgId,
          projectId,
          itemId,
          predecessorId,
          lagWorkdays: link.lagWorkdays,
        })
        .run();
    }
  }
  if (parts.has("estimate")) {
    for (const line of bundle.lines) {
      tx.insert(budgetLines)
        .values({
          id: id("bud"),
          orgId: actor.orgId,
          projectId,
          changeOrderId: null,
          name: line.name,
          costCode: line.costCode,
          budgetCostCents: lineCents(line.qtyMilli, line.unitCostCents),
          budgetPriceCents: lineCents(line.qtyMilli, line.unitPriceCents),
          sourceLineId: null,
          createdAt: now,
        })
        .run();
      estimate += 1;
    }
  }
  if (parts.has("draws")) {
    const existing = tx.select().from(draws).where(and(eq(draws.orgId, actor.orgId), eq(draws.projectId, projectId))).all();
    if (existing.length > 0 && bundle.drawRows.length > 0) {
      const others =
        (parts.has("schedule") ? bundle.tasks.length : 0) +
        (parts.has("estimate") ? bundle.lines.length : 0) +
        (parts.has("selections") ? bundle.selectionRows.length : 0) +
        (parts.has("punch") ? bundle.checks.length : 0) +
        (parts.has("todos") ? bundle.todos.length : 0);
      if (others === 0) throw new ServiceError("Draws are already on this job.");
    } else {
    const amounts = rescalePercents(contractCents, bundle.drawRows.map((draw) => draw.bps));
    bundle.drawRows.forEach((draw, index) => {
      tx.insert(draws)
        .values({
          id: id("drw"),
          orgId: actor.orgId,
          projectId,
          title: draw.title,
          basis: "percent",
          bps: draw.bps,
          amountCents: amounts[index] ?? 0,
          scheduleItemId: null,
          dueOn: null,
          sortOrder: index,
          invoiceId: null,
          changeOrderId: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      drawCount += 1;
    });
    }
  }
  if (parts.has("selections")) {
    for (const row of bundle.selectionRows) {
      const budgetId = id("bud");
      tx.insert(budgetLines)
        .values({
          id: budgetId,
          orgId: actor.orgId,
          projectId,
          changeOrderId: null,
          name: `${row.title} allowance`,
          costCode: null,
          budgetCostCents: row.allowanceCents,
          budgetPriceCents: row.allowanceCents,
          sourceLineId: null,
          createdAt: now,
        })
        .run();
      tx.insert(selections)
        .values({
          id: id("sel"),
          orgId: actor.orgId,
          projectId,
          title: row.title,
          area: row.area,
          dueDate: null,
          status: "open",
          allowanceBudgetLineId: budgetId,
          qtyMilli: 1000,
          chosenChoiceId: null,
          costItemId: null,
          changeOrderId: null,
          createdBy: actor.userId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      selectionCount += 1;
    }
  }
  if (parts.has("punch")) {
    for (const row of bundle.checks) {
      tx.insert(punchItems)
        .values({
          id: id("punch"),
          orgId: actor.orgId,
          projectId,
          title: row.title,
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
          createdBy: actor.userId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      punch += 1;
    }
  }
  if (parts.has("todos")) todoCount = applyTemplateTodos(tx, actor, projectId, templateId, taskIds, anchor);
  const added = schedule + estimate + drawCount + selectionCount + punch + todoCount;
  if (added === 0) throw new ServiceError("That template has nothing to copy.");
  return { added, schedule, estimate, draws: drawCount, selections: selectionCount, punch, todos: todoCount };
}

function contractFor(bundle: NonNullable<ReturnType<typeof loadBundle>>, parts: Set<TemplatePart>) {
  let total = 0;
  if (parts.has("estimate")) total += bundle.lines.reduce((sum, line) => sum + lineCents(line.qtyMilli, line.unitPriceCents), 0);
  if (parts.has("selections")) total += bundle.selectionRows.reduce((sum, row) => sum + row.allowanceCents, 0);
  return total;
}

export function createJobFromTemplate(
  actor: Actor,
  input: {
    templateId: string;
    name: string;
    contactId: string;
    address?: string | null;
    startDate: string;
    pmUserId: string;
    parts: TemplatePart[];
    trades: Record<string, string | null>;
  },
) {
  assertOffice(actor);
  const db = dbFor(actor);
  guardRate(db, actor);
  const parts = selectedParts(input.parts);
  const bundle = loadBundle(db, actor.orgId, input.templateId);
  if (!bundle) throw new ServiceError("That template is not in your company.");
  const contact = db.select().from(contacts).where(and(eq(contacts.orgId, actor.orgId), eq(contacts.id, input.contactId))).get();
  if (!contact || contact.deletedAt || contact.type !== "client") throw new ServiceError("Pick a client in your company.");
  const member = db
    .select({ id: users.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, input.pmUserId)))
    .get();
  if (!member) throw new ServiceError("Pick a PM in your company.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) throw new ServiceError("Enter a start date.");
  const contract = contractFor(bundle, parts);
  const would =
    (parts.has("schedule") ? bundle.tasks.length : 0) +
    (parts.has("estimate") ? bundle.lines.length : 0) +
    (parts.has("draws") ? bundle.drawRows.length : 0) +
    (parts.has("selections") ? bundle.selectionRows.length : 0) +
    (parts.has("punch") ? bundle.checks.length : 0) +
    (parts.has("todos") ? bundle.todos.length : 0);
  if (would === 0) throw new ServiceError("That template has nothing to copy.");
  const projectId = id("proj");
  const now = nowIso();
  let created = 0;
  db.transaction((tx) => {
    const writer = tx as unknown as AppDatabase;
    writer
      .insert(projects)
      .values({
        id: projectId,
        orgId: actor.orgId,
        leadId: null,
        proposalId: null,
        contactId: contact.id,
        name: cleanName(input.name, "job name"),
        status: "active",
        address: input.address?.trim() || null,
        contractValueCents: contract,
        originalContractCents: contract,
        startDate: input.startDate,
        endDate: null,
        portalToken: token(),
        billingMode: "draws",
        retainageBps: 0,
        templateId: bundle.template.id,
        templateVersion: bundle.template.version,
        templateName: bundle.template.name,
        pmUserId: input.pmUserId,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    const result = applyParts(writer, actor, projectId, input.templateId, parts, input.startDate, input.trades, contract);
    created = result.added;
    const last = writer
      .select()
      .from(scheduleItems)
      .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, projectId)))
      .all()
      .map((row) => row.endDate)
      .sort()
      .at(-1);
    if (last) {
      writer.update(projects).set({ endDate: last }).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, projectId))).run();
    }
    audit(writer, actor, "template.apply", bundle.template.id, {
      projectId,
      version: bundle.template.version,
      created,
      parts: [...parts],
    });
  });
  return { projectId, created };
}

function billingTarget(db: AppDatabase, orgId: string, project: { contractValueCents: number; originalContractCents: number; id: string }) {
  const approved = db
    .select()
    .from(changeOrders)
    .where(and(eq(changeOrders.orgId, orgId), eq(changeOrders.projectId, project.id)))
    .all()
    .filter((order) => order.status === "approved")
    .reduce((sum, order) => sum + order.priceDeltaCents, 0);
  const fromOriginal = project.originalContractCents + approved;
  return fromOriginal > 0 ? fromOriginal : project.contractValueCents;
}

export function previewTemplateImport(actor: Actor, projectId: string, templateId: string, parts: TemplatePart[]) {
  const db = dbFor(actor);
  const project = db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, projectId))).get();
  if (!project) throw new ServiceError("That job is not in your company.");
  const bundle = loadBundle(db, actor.orgId, templateId);
  if (!bundle) throw new ServiceError("That template is not in your company.");
  const chosen = selectedParts(parts);
  const before = {
    schedule: db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, projectId))).all().length,
    estimate: db.select().from(budgetLines).where(and(eq(budgetLines.orgId, actor.orgId), eq(budgetLines.projectId, projectId))).all().filter((line) => !line.changeOrderId).length,
    draws: db.select().from(draws).where(and(eq(draws.orgId, actor.orgId), eq(draws.projectId, projectId))).all().length,
    selections: db.select().from(selections).where(and(eq(selections.orgId, actor.orgId), eq(selections.projectId, projectId))).all().length,
    punch: db.select().from(punchItems).where(and(eq(punchItems.orgId, actor.orgId), eq(punchItems.projectId, projectId))).all().length,
    todos: db.select().from(tasks).where(and(eq(tasks.orgId, actor.orgId), eq(tasks.relatedId, projectId))).all().filter((row) => row.relatedType === "project").length,
  };
  const added = {
    schedule: chosen.has("schedule") ? bundle.tasks.length : 0,
    estimate: chosen.has("estimate") ? bundle.lines.length : 0,
    draws: chosen.has("draws") ? (before.draws > 0 ? 0 : bundle.drawRows.length) : 0,
    selections: chosen.has("selections") ? bundle.selectionRows.length : 0,
    punch: chosen.has("punch") ? bundle.checks.length : 0,
    todos: chosen.has("todos") ? bundle.todos.length : 0,
  };
  const showMoney = money(actor);
  const hide = (value: number) => (showMoney ? value : null);
  return {
    schedule: { before: before.schedule, after: before.schedule + added.schedule },
    estimate: { before: hide(before.estimate), after: hide(before.estimate + added.estimate) },
    draws: { before: hide(before.draws), after: hide(before.draws + added.draws) },
    selections: { before: hide(before.selections), after: hide(before.selections + added.selections) },
    punch: { before: before.punch, after: before.punch + added.punch },
    todos: { before: before.todos, after: before.todos + added.todos },
    added: added.schedule + added.estimate + added.draws + added.selections + added.punch + added.todos,
  };
}

export function importTemplate(
  actor: Actor,
  input: { projectId: string; templateId: string; parts: TemplatePart[]; anchor: string; trades: Record<string, string | null> },
) {
  assertOffice(actor);
  const db = dbFor(actor);
  guardRate(db, actor);
  const project = db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, input.projectId))).get();
  if (!project) throw new ServiceError("That job is not in your company.");
  const bundle = loadBundle(db, actor.orgId, input.templateId);
  if (!bundle) throw new ServiceError("That template is not in your company.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.anchor)) throw new ServiceError("Enter a start date.");
  const parts = selectedParts(input.parts);
  const beforeItems = db
    .select({ id: scheduleItems.id, startDate: scheduleItems.startDate, endDate: scheduleItems.endDate })
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, project.id)))
    .all();
  let created = 0;
  db.transaction((tx) => {
    const writer = tx as unknown as AppDatabase;
    const result = applyParts(writer, actor, project.id, input.templateId, parts, input.anchor, input.trades, billingTarget(writer, actor.orgId, project));
    created = result.added;
    const after = writer.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, project.id))).all();
    for (const row of beforeItems) {
      const current = after.find((item) => item.id === row.id);
      if (!current || current.startDate !== row.startDate || current.endDate !== row.endDate) throw new ServiceError("Import can only add items.");
    }
    audit(writer, actor, "template.import", bundle.template.id, { projectId: project.id, version: bundle.template.version, created, parts: [...parts] });
  });
  return { created };
}

export function templateChoices(actor: Actor) {
  const db = dbFor(actor);
  const people = db
    .select({ id: users.id, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, actor.orgId))
    .all()
    .filter((row) => row.role !== "viewer")
    .sort((a, b) => a.name.localeCompare(b.name));
  const clients = db
    .select()
    .from(contacts)
    .where(eq(contacts.orgId, actor.orgId))
    .all()
    .filter((row) => !row.deletedAt && row.type === "client")
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const vendors = db
    .select()
    .from(contacts)
    .where(eq(contacts.orgId, actor.orgId))
    .all()
    .filter((row) => !row.deletedAt && (row.type === "vendor" || row.type === "sub"))
    .map((row) => ({ id: row.id, name: row.company || row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { people, clients, vendors, templates: listTemplates(actor) };
}
