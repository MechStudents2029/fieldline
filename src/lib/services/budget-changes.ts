import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  auditLogs,
  budgetChangeLines,
  budgetChanges,
  budgetLines,
  changeEventCodes,
  changeEvents as changeEventRows,
  costItems,
  organizations,
  projects,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { costCodeKey } from "@/lib/margin/category";
import { MAX_MONEY_CENTS } from "@/lib/money";
import { canEditCrm, canManageSettings, canSeeMoney } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import { openCommitments } from "@/lib/services/purchase-orders";
import type { Actor } from "@/lib/services/read";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

export type BudgetChangeQuery = { filter?: string; projectId?: string };

export const BUDGET_CHANGE_TYPES = [
  { value: "transfer", label: "Transfer" },
  { value: "contingency", label: "Contingency drawdown" },
  { value: "allowance", label: "Allowance reconcile" },
  { value: "buyout", label: "Buy-out savings" },
] as const;

export const BUDGET_CHANGE_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "voided", label: "Void" },
] as const;

export const BUDGET_LINE_KINDS = [
  { value: "", label: "Budget" },
  { value: "contingency", label: "Contingency" },
  { value: "allowance", label: "Allowance" },
] as const;

const TYPES = new Set(BUDGET_CHANGE_TYPES.map((row) => row.value));
const TYPE_LABEL: Record<string, string> = Object.fromEntries(BUDGET_CHANGE_TYPES.map((row) => [row.value, row.label]));
const STATUS_LABEL: Record<string, string> = Object.fromEntries(BUDGET_CHANGE_STATUSES.map((row) => [row.value, row.label]));
const KINDS = new Set(BUDGET_LINE_KINDS.map((row) => row.value));

type ChangeRow = typeof budgetChanges.$inferSelect;
type LineRow = typeof budgetChangeLines.$inferSelect;
type BudgetRow = typeof budgetLines.$inferSelect;

export type BudgetChangeLineInput = { budgetLineId: string; amountCents: number };

export type BudgetChangeInput = {
  title: string;
  type: string;
  fromBudgetLineId: string;
  fromCents: number;
  lines: BudgetChangeLineInput[];
  note?: string;
  overrideNote?: string;
};

export type BudgetChangeListRow = {
  id: string;
  projectId: string;
  job: string;
  number: number;
  title: string;
  type: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  fromName: string;
  toName: string;
  amountCents: number;
  createdAt: string;
};

export type BudgetChangeDetail = BudgetChangeListRow & {
  fromBudgetLineId: string;
  note: string;
  overrideNote: string;
  voidReason: string;
  changeEventId: string | null;
  changeEventNumber: number | null;
  lines: { id: string; budgetLineId: string; name: string; costCode: string; amountCents: number }[];
  lineChoices: { id: string; name: string; costCode: string }[];
  canEdit: boolean;
  canApprove: boolean;
  canVoid: boolean;
  canOverride: boolean;
  showMoney: boolean;
};

export type ContingencyHold = { originalCents: number; revisedCents: number; low: boolean };

function see(actor: Actor) {
  if (actor.role === "field" || !canSeeMoney(actor.role)) throw new ServiceError("Your role cannot see this.");
}

function office(actor: Actor) {
  see(actor);
  if (!canEditCrm(actor.role)) throw new ServiceError("Your role cannot change this.");
}

function bound(value: string, max: number, label: string): string {
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().replace(/\s+/g, " ");
  if (text.length > max) throw new ServiceError(`${label} is too long.`);
  return text;
}

function money(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_MONEY_CENTS) throw new ServiceError(`Enter ${label}.`);
  return value;
}

function typeOf(value: string): string {
  const type = value.trim();
  if (!TYPES.has(type as (typeof BUDGET_CHANGE_TYPES)[number]["value"])) throw new ServiceError("Pick a type.");
  return type;
}

function zoneFor(orgId: string): string {
  return getDb().select().from(organizations).where(eq(organizations.id, orgId)).get()?.timeZone || "America/New_York";
}

function dayOf(value: string): string {
  return value.slice(0, 10);
}

function audit(orgId: string, actorId: string | null, action: string, entityId: string, payload: unknown) {
  getDb()
    .insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "budget_change",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function linesFor(orgId: string, changeId?: string): LineRow[] {
  return getDb()
    .select()
    .from(budgetChangeLines)
    .where(eq(budgetChangeLines.orgId, orgId))
    .all()
    .filter((row) => !changeId || row.changeId === changeId);
}

function budgetsFor(orgId: string, projectId?: string): BudgetRow[] {
  return getDb()
    .select()
    .from(budgetLines)
    .where(eq(budgetLines.orgId, orgId))
    .all()
    .filter((row) => !projectId || row.projectId === projectId);
}

function loadChange(orgId: string, changeId: string): ChangeRow {
  const row = getDb().select().from(budgetChanges).where(and(eq(budgetChanges.id, changeId), eq(budgetChanges.orgId, orgId))).get();
  if (!row) throw new ServiceError("That change is not here.");
  return row;
}

function projectOf(orgId: string, projectId: string) {
  const project = getDb().select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
  if (!project) throw new ServiceError("That job is not here.");
  return project;
}

function nextNumber(orgId: string, projectId: string): number {
  const numbers = getDb()
    .select()
    .from(budgetChanges)
    .where(and(eq(budgetChanges.orgId, orgId), eq(budgetChanges.projectId, projectId)))
    .all()
    .map((row) => row.number);
  return (numbers.length ? Math.max(...numbers) : 0) + 1;
}

/** Approved allocations by project, then cost code. Drafts and voids are zero. */
export function approvedNetByCode(orgId: string): Map<string, Map<string, number>> {
  const changes = getDb().select().from(budgetChanges).where(eq(budgetChanges.orgId, orgId)).all().filter((row) => row.status === "approved");
  const allocations = linesFor(orgId);
  const budgets = budgetsFor(orgId);
  const codeOf = new Map(budgets.map((row) => [row.id, costCodeKey(row.costCode)]));
  const out = new Map<string, Map<string, number>>();
  function add(projectId: string, code: string, cents: number) {
    const map = out.get(projectId) ?? new Map<string, number>();
    map.set(code, (map.get(code) ?? 0) + cents);
    out.set(projectId, map);
  }
  for (const change of changes) {
    const source = codeOf.get(change.fromBudgetLineId);
    if (source) add(change.projectId, source, -change.fromCents);
    for (const line of allocations.filter((row) => row.changeId === change.id)) {
      const dest = codeOf.get(line.budgetLineId);
      if (dest) add(change.projectId, dest, line.amountCents);
    }
  }
  return out;
}

function approvedNetByLine(orgId: string, projectId: string): Map<string, number> {
  const changes = getDb()
    .select()
    .from(budgetChanges)
    .where(and(eq(budgetChanges.orgId, orgId), eq(budgetChanges.projectId, projectId)))
    .all()
    .filter((row) => row.status === "approved");
  const ids = new Set(changes.map((row) => row.id));
  const nets = new Map<string, number>();
  for (const change of changes) nets.set(change.fromBudgetLineId, (nets.get(change.fromBudgetLineId) ?? 0) - change.fromCents);
  for (const line of linesFor(orgId).filter((row) => ids.has(row.changeId))) {
    nets.set(line.budgetLineId, (nets.get(line.budgetLineId) ?? 0) + line.amountCents);
  }
  return nets;
}

export function contingencyFor(orgId: string, projectId: string): ContingencyHold {
  const lines = budgetsFor(orgId, projectId).filter((row) => row.kind === "contingency");
  const nets = approvedNetByLine(orgId, projectId);
  const originalCents = lines.reduce((sum, row) => sum + row.budgetCostCents, 0);
  const revisedCents = lines.reduce((sum, row) => sum + row.budgetCostCents + (nets.get(row.id) ?? 0), 0);
  return { originalCents, revisedCents, low: originalCents > 0 && revisedCents * 4 < originalCents };
}

function exposureByCode(orgId: string, projectId: string): Map<string, number> {
  const actual = new Map<string, number>();
  for (const item of getDb().select().from(costItems).where(and(eq(costItems.orgId, orgId), eq(costItems.projectId, projectId))).all()) {
    const code = costCodeKey(item.costCode);
    actual.set(code, (actual.get(code) ?? 0) + item.amountCents);
  }
  for (const row of openCommitments(orgId, [projectId])) {
    const code = costCodeKey(row.costCode);
    actual.set(code, (actual.get(code) ?? 0) + row.amountCents);
  }
  return actual;
}

function assertFloor(actor: Actor, projectId: string, fromLine: BudgetRow, fromCents: number, dests: { line: BudgetRow; amountCents: number }[], overrideNote: string) {
  const nets = approvedNetByLine(actor.orgId, projectId);
  const budgets = budgetsFor(actor.orgId, projectId);
  const delta = new Map<string, number>();
  delta.set(fromLine.id, (delta.get(fromLine.id) ?? 0) - fromCents);
  for (const dest of dests) delta.set(dest.line.id, (delta.get(dest.line.id) ?? 0) + dest.amountCents);
  for (const line of budgets) {
    const revised = line.budgetCostCents + (nets.get(line.id) ?? 0) + (delta.get(line.id) ?? 0);
    if (revised < 0) throw new ServiceError("That line would go below zero.");
  }
  const exposure = exposureByCode(actor.orgId, projectId);
  const byCode = new Map<string, number>();
  for (const line of budgets) {
    const code = costCodeKey(line.costCode);
    const revised = line.budgetCostCents + (nets.get(line.id) ?? 0) + (delta.get(line.id) ?? 0);
    byCode.set(code, (byCode.get(code) ?? 0) + revised);
  }
  const sourceCode = costCodeKey(fromLine.costCode);
  const floor = exposure.get(sourceCode) ?? 0;
  if ((byCode.get(sourceCode) ?? 0) < floor) {
    if (!overrideNote) throw new ServiceError("That line is below what is already committed.");
    if (!canManageSettings(actor.role)) throw new ServiceError("Your role cannot override this.");
  }
}

function normalize(actor: Actor, projectId: string, input: BudgetChangeInput) {
  const title = bound(input.title, 160, "Title");
  if (!title) throw new ServiceError("Add a title.");
  const type = typeOf(input.type);
  const fromCents = money(input.fromCents, "an amount");
  const fromLine = budgetsFor(actor.orgId, projectId).find((row) => row.id === input.fromBudgetLineId);
  if (!fromLine) throw new ServiceError("Pick a source line.");
  if (!input.lines.length) throw new ServiceError("Add a destination.");
  const seen = new Set<string>();
  const dests: { line: BudgetRow; amountCents: number }[] = [];
  for (const item of input.lines) {
    const amountCents = money(item.amountCents, "an amount");
    const line = budgetsFor(actor.orgId, projectId).find((row) => row.id === item.budgetLineId);
    if (!line) throw new ServiceError("Pick a destination line.");
    if (line.id === fromLine.id) throw new ServiceError("Pick a different line.");
    if (seen.has(line.id)) throw new ServiceError("That line is already on this change.");
    seen.add(line.id);
    dests.push({ line, amountCents });
  }
  const total = dests.reduce((sum, row) => sum + row.amountCents, 0);
  if (total !== fromCents) throw new ServiceError("Amounts must net to zero.");
  const overrideNote = bound(input.overrideNote ?? "", 400, "Note");
  assertFloor(actor, projectId, fromLine, fromCents, dests, overrideNote);
  return { title, type, fromLine, fromCents, dests, note: bound(input.note ?? "", 400, "Note"), overrideNote: overrideNote || null };
}

function rowOf(row: ChangeRow, job: string, budgets: BudgetRow[], lines: LineRow[]): BudgetChangeListRow {
  const name = new Map(budgets.map((line) => [line.id, line.name]));
  const dests = lines.filter((line) => line.changeId === row.id);
  return {
    id: row.id,
    projectId: row.projectId,
    job,
    number: row.number,
    title: row.title,
    type: row.type,
    typeLabel: TYPE_LABEL[row.type] || row.type,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status] || row.status,
    fromName: name.get(row.fromBudgetLineId) || "Line",
    toName: dests.map((line) => name.get(line.budgetLineId) || "Line").join(", "),
    amountCents: row.fromCents,
    createdAt: row.createdAt,
  };
}

function lowProjectIds(actor: Actor): Set<string> {
  const ids = new Set<string>();
  for (const project of getDb().select().from(projects).where(eq(projects.orgId, actor.orgId)).all()) {
    if (contingencyFor(actor.orgId, project.id).low) ids.add(project.id);
  }
  return ids;
}

function matches(row: ChangeRow, query: BudgetChangeQuery, today: string, low: Set<string>): boolean {
  if (query.projectId && row.projectId !== query.projectId) return false;
  const filter = (query.filter ?? "").trim();
  if (!filter) return true;
  if (filter === "age") return row.status === "draft" && dayOf(row.createdAt) < addCalendarDays(today, -3);
  if (filter === "low") return low.has(row.projectId);
  if (filter === "draft" || filter === "approved" || filter === "voided") return row.status === filter;
  if (TYPES.has(filter as (typeof BUDGET_CHANGE_TYPES)[number]["value"])) return row.type === filter;
  return true;
}

export function listBudgetChanges(actor: Actor, query: BudgetChangeQuery = {}): BudgetChangeListRow[] {
  see(actor);
  const projectId = (query.projectId ?? "").trim();
  if (projectId) projectOf(actor.orgId, projectId);
  const today = localDay(Date.now(), zoneFor(actor.orgId));
  const low = (query.filter ?? "").trim() === "low" ? lowProjectIds(actor) : new Set<string>();
  const jobs = new Map(getDb().select().from(projects).where(eq(projects.orgId, actor.orgId)).all().map((row) => [row.id, row.name]));
  const budgets = budgetsFor(actor.orgId);
  const lines = linesFor(actor.orgId);
  return getDb()
    .select()
    .from(budgetChanges)
    .where(eq(budgetChanges.orgId, actor.orgId))
    .all()
    .filter((row) => matches(row, query, today, low))
    .map((row) => rowOf(row, jobs.get(row.projectId) || "", budgets, lines))
    .sort((a, b) => a.job.localeCompare(b.job) || a.number - b.number);
}

export function budgetChangeDetail(actor: Actor, changeId: string): BudgetChangeDetail | null {
  see(actor);
  const row = getDb().select().from(budgetChanges).where(and(eq(budgetChanges.id, changeId), eq(budgetChanges.orgId, actor.orgId))).get();
  if (!row) return null;
  const project = getDb().select().from(projects).where(and(eq(projects.id, row.projectId), eq(projects.orgId, actor.orgId))).get();
  const budgets = budgetsFor(actor.orgId, row.projectId);
  const lines = linesFor(actor.orgId, row.id);
  const names = new Map(budgets.map((line) => [line.id, line]));
  const event = row.changeEventId
    ? getDb().select().from(changeEventRows).where(and(eq(changeEventRows.id, row.changeEventId), eq(changeEventRows.orgId, actor.orgId))).get()
    : undefined;
  const officeRole = canEditCrm(actor.role);
  const list = rowOf(row, project?.name || "", budgets, lines);
  return {
    ...list,
    fromBudgetLineId: row.fromBudgetLineId,
    note: row.note,
    overrideNote: row.overrideNote || "",
    voidReason: row.voidReason || "",
    changeEventId: row.changeEventId,
    changeEventNumber: event?.number ?? null,
    lines: lines.map((line) => ({
      id: line.id,
      budgetLineId: line.budgetLineId,
      name: names.get(line.budgetLineId)?.name || "Line",
      costCode: names.get(line.budgetLineId)?.costCode || "",
      amountCents: line.amountCents,
    })),
    lineChoices: budgets
      .filter((line) => line.id !== row.fromBudgetLineId && !lines.some((item) => item.budgetLineId === line.id))
      .map((line) => ({ id: line.id, name: line.name, costCode: line.costCode || "" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    canEdit: officeRole && row.status === "draft",
    canApprove: officeRole && row.status === "draft",
    canVoid: officeRole && row.status !== "voided",
    canOverride: canManageSettings(actor.role),
    showMoney: true,
  };
}

export function createBudgetChange(actor: Actor, projectId: string, input: BudgetChangeInput): string {
  office(actor);
  const project = projectOf(actor.orgId, projectId);
  const next = normalize(actor, project.id, input);
  const changeId = id("bc");
  const now = nowIso();
  const number = nextNumber(actor.orgId, project.id);
  getDb().transaction((tx) => {
    tx.insert(budgetChanges)
      .values({
        id: changeId,
        orgId: actor.orgId,
        projectId: project.id,
        number,
        title: next.title,
        type: next.type,
        status: "draft",
        fromBudgetLineId: next.fromLine.id,
        fromCents: next.fromCents,
        changeEventId: null,
        note: next.note,
        overrideNote: next.overrideNote,
        voidReason: null,
        voidedAt: null,
        voidedBy: null,
        approvedAt: null,
        approvedBy: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    for (const dest of next.dests) {
      tx.insert(budgetChangeLines)
        .values({ id: id("bcl"), orgId: actor.orgId, changeId, budgetLineId: dest.line.id, amountCents: dest.amountCents })
        .run();
    }
  });
  audit(actor.orgId, actor.userId, "budget_change.create", changeId, { number });
  return changeId;
}

export function addBudgetChangeLine(actor: Actor, changeId: string, budgetLineId: string, amountCents: number) {
  office(actor);
  const row = loadChange(actor.orgId, changeId);
  if (row.status !== "draft") throw new ServiceError("This change is locked.");
  const cents = money(amountCents, "an amount");
  const existing = linesFor(actor.orgId, row.id);
  const lines = [...existing.map((line) => ({ budgetLineId: line.budgetLineId, amountCents: line.amountCents })), { budgetLineId, amountCents: cents }];
  const next = normalize(actor, row.projectId, {
    title: row.title,
    type: row.type,
    fromBudgetLineId: row.fromBudgetLineId,
    fromCents: row.fromCents + cents,
    lines,
    note: row.note,
    overrideNote: row.overrideNote || "",
  });
  const now = nowIso();
  getDb().transaction((tx) => {
    const current = tx.select().from(budgetChanges).where(and(eq(budgetChanges.id, row.id), eq(budgetChanges.orgId, actor.orgId))).get();
    if (!current || current.status !== "draft") throw new ServiceError("This change is locked.");
    tx.insert(budgetChangeLines)
      .values({ id: id("bcl"), orgId: actor.orgId, changeId: row.id, budgetLineId: next.dests.at(-1)!.line.id, amountCents: cents })
      .run();
    tx.update(budgetChanges)
      .set({ fromCents: row.fromCents + cents, updatedAt: now })
      .where(and(eq(budgetChanges.id, row.id), eq(budgetChanges.orgId, actor.orgId)))
      .run();
  });
  audit(actor.orgId, actor.userId, "budget_change.line", row.id, { budgetLineId });
}

export function approveBudgetChange(actor: Actor, changeId: string) {
  office(actor);
  const row = loadChange(actor.orgId, changeId);
  if (row.status !== "draft") throw new ServiceError("This change is locked.");
  const existing = linesFor(actor.orgId, row.id);
  normalize(actor, row.projectId, {
    title: row.title,
    type: row.type,
    fromBudgetLineId: row.fromBudgetLineId,
    fromCents: row.fromCents,
    lines: existing.map((line) => ({ budgetLineId: line.budgetLineId, amountCents: line.amountCents })),
    note: row.note,
    overrideNote: row.overrideNote || "",
  });
  const now = nowIso();
  getDb().transaction((tx) => {
    const current = tx.select().from(budgetChanges).where(and(eq(budgetChanges.id, row.id), eq(budgetChanges.orgId, actor.orgId))).get();
    if (!current || current.status !== "draft") throw new ServiceError("This change is locked.");
    tx.update(budgetChanges)
      .set({ status: "approved", approvedAt: now, approvedBy: actor.userId, updatedAt: now })
      .where(and(eq(budgetChanges.id, row.id), eq(budgetChanges.orgId, actor.orgId)))
      .run();
    if (current.changeEventId) {
      tx.update(changeEventRows)
        .set({ status: "converted", budgetChangeId: current.id, updatedAt: now })
        .where(and(eq(changeEventRows.id, current.changeEventId), eq(changeEventRows.orgId, actor.orgId)))
        .run();
    }
  });
  audit(actor.orgId, actor.userId, "budget_change.approve", row.id, {});
}

export function voidBudgetChange(actor: Actor, changeId: string, reason: string) {
  office(actor);
  const row = loadChange(actor.orgId, changeId);
  if (row.status === "voided") throw new ServiceError("This change is locked.");
  const text = bound(reason, 400, "Reason");
  if (!text) throw new ServiceError("Add a reason.");
  const now = nowIso();
  getDb().transaction((tx) => {
    const current = tx.select().from(budgetChanges).where(and(eq(budgetChanges.id, row.id), eq(budgetChanges.orgId, actor.orgId))).get();
    if (!current || current.status === "voided") throw new ServiceError("This change is locked.");
    tx.update(budgetChanges)
      .set({ status: "voided", voidReason: text, voidedAt: now, voidedBy: actor.userId, changeEventId: null, updatedAt: now })
      .where(and(eq(budgetChanges.id, row.id), eq(budgetChanges.orgId, actor.orgId)))
      .run();
  });
  audit(actor.orgId, actor.userId, "budget_change.void", row.id, { reason: text });
}

export function setBudgetLineKind(actor: Actor, lineId: string, kind: string) {
  office(actor);
  const next = kind.trim();
  if (!KINDS.has(next as (typeof BUDGET_LINE_KINDS)[number]["value"])) throw new ServiceError("Pick a kind.");
  const line = getDb().select().from(budgetLines).where(and(eq(budgetLines.id, lineId), eq(budgetLines.orgId, actor.orgId))).get();
  if (!line) throw new ServiceError("That line is not here.");
  const before = line.budgetCostCents;
  getDb().update(budgetLines).set({ kind: next }).where(and(eq(budgetLines.id, line.id), eq(budgetLines.orgId, actor.orgId))).run();
  const after = getDb().select().from(budgetLines).where(eq(budgetLines.id, line.id)).get();
  if (!after || after.budgetCostCents !== before || after.budgetPriceCents !== line.budgetPriceCents) {
    throw new ServiceError("That line is not here.");
  }
  audit(actor.orgId, actor.userId, "budget_line.kind", line.id, { kind: next });
}

function liveFund(orgId: string, eventId: string, budgetChangeId: string | null): boolean {
  if (budgetChangeId) return true;
  return getDb()
    .select()
    .from(budgetChanges)
    .where(and(eq(budgetChanges.orgId, orgId), eq(budgetChanges.changeEventId, eventId)))
    .all()
    .some((row) => row.status !== "voided");
}

export function fundFromContingency(actor: Actor, eventId: string): string {
  office(actor);
  const event = getDb().select().from(changeEventRows).where(and(eq(changeEventRows.id, eventId), eq(changeEventRows.orgId, actor.orgId))).get();
  if (!event) throw new ServiceError("That event is not here.");
  if (event.status === "converted" || event.changeOrderId || liveFund(actor.orgId, event.id, event.budgetChangeId)) {
    throw new ServiceError("Already converted.");
  }
  if (event.status !== "ready") throw new ServiceError("Mark it ready first.");
  const eventCodes = getDb().select().from(changeEventCodes).where(and(eq(changeEventCodes.orgId, actor.orgId), eq(changeEventCodes.eventId, event.id))).all();
  const priced = eventCodes.filter((row) => row.romCostCents > 0);
  if (priced.length === 0) throw new ServiceError("Add a cost.");
  const budgets = budgetsFor(actor.orgId, event.projectId);
  const holds = budgets.filter((row) => row.kind === "contingency");
  if (holds.length === 0) throw new ServiceError("No contingency line.");
  const nets = approvedNetByLine(actor.orgId, event.projectId);
  const source = [...holds].sort((a, b) => b.budgetCostCents + (nets.get(b.id) ?? 0) - (a.budgetCostCents + (nets.get(a.id) ?? 0)))[0]!;
  const dests: BudgetChangeLineInput[] = [];
  for (const code of priced) {
    const line = budgets.find((row) => row.kind !== "contingency" && costCodeKey(row.costCode) === costCodeKey(code.costCode));
    if (!line) throw new ServiceError("No budget line for that code.");
    const prior = dests.find((row) => row.budgetLineId === line.id);
    if (prior) prior.amountCents += code.romCostCents;
    else dests.push({ budgetLineId: line.id, amountCents: code.romCostCents });
  }
  const fromCents = dests.reduce((sum, row) => sum + row.amountCents, 0);
  const next = normalize(actor, event.projectId, {
    title: event.title,
    type: "contingency",
    fromBudgetLineId: source.id,
    fromCents,
    lines: dests,
  });
  const changeId = id("bc");
  const now = nowIso();
  const number = nextNumber(actor.orgId, event.projectId);
  getDb().transaction((tx) => {
    const current = tx.select().from(changeEventRows).where(and(eq(changeEventRows.id, event.id), eq(changeEventRows.orgId, actor.orgId))).get();
    if (!current || current.status !== "ready" || current.changeOrderId || current.budgetChangeId) throw new ServiceError("Already converted.");
    const linked = tx
      .select()
      .from(budgetChanges)
      .where(and(eq(budgetChanges.orgId, actor.orgId), eq(budgetChanges.changeEventId, event.id)))
      .all()
      .some((row) => row.status !== "voided");
    if (linked) throw new ServiceError("Already converted.");
    tx.insert(budgetChanges)
      .values({
        id: changeId,
        orgId: actor.orgId,
        projectId: event.projectId,
        number,
        title: next.title,
        type: "contingency",
        status: "draft",
        fromBudgetLineId: next.fromLine.id,
        fromCents: next.fromCents,
        changeEventId: event.id,
        note: "",
        overrideNote: null,
        voidReason: null,
        voidedAt: null,
        voidedBy: null,
        approvedAt: null,
        approvedBy: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
    for (const dest of next.dests) {
      tx.insert(budgetChangeLines)
        .values({ id: id("bcl"), orgId: actor.orgId, changeId, budgetLineId: dest.line.id, amountCents: dest.amountCents })
        .run();
    }
  });
  audit(actor.orgId, actor.userId, "budget_change.fund", changeId, { eventId: event.id });
  return changeId;
}

export function budgetChangesCsv(actor: Actor, query: BudgetChangeQuery = {}): string {
  const rows = listBudgetChanges(actor, query);
  const header = "job,number,title,type,status,from,amount,to";
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const body = rows.map((row) =>
    [row.job, String(row.number), row.title, row.typeLabel, row.statusLabel, row.fromName, (row.amountCents / 100).toFixed(2), row.toName].map(cell).join(","),
  );
  return [header, ...body].join("\n");
}

export function budgetChangeAttention(actor: Actor): { age: { count: number; href: string | null }; low: { count: number; href: string | null } } {
  if (actor.role === "field" || !canSeeMoney(actor.role)) {
    return { age: { count: 0, href: null }, low: { count: 0, href: null } };
  }
  const ageCount = listBudgetChanges(actor, { filter: "age" }).length;
  const lowCount = lowProjectIds(actor).size;
  return {
    age: { count: ageCount, href: ageCount > 0 ? "/budget-changes?filter=age" : null },
    low: { count: lowCount, href: lowCount > 0 ? "/budget-changes?filter=low" : null },
  };
}

export function jobLineChoices(actor: Actor, projectId: string): { id: string; job: string; name: string; costCode: string }[] {
  see(actor);
  const project = projectOf(actor.orgId, projectId);
  return budgetsFor(actor.orgId, project.id)
    .map((line) => ({ id: line.id, job: project.name, name: line.name, costCode: line.costCode || "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function budgetChangeJobs(actor: Actor): { id: string; name: string }[] {
  see(actor);
  return getDb()
    .select()
    .from(projects)
    .where(eq(projects.orgId, actor.orgId))
    .all()
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
