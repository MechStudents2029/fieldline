import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  costItems,
  inspectionGates,
  inspections,
  jobFiles,
  organizations,
  permits,
  projects,
  recordFiles,
  scheduleAssignees,
  scheduleItems,
  tasks,
  vendorPortals,
} from "@/lib/db/schema";
import { emitAutomation } from "@/lib/services/automations";
import { id, nowIso } from "@/lib/ids";
import { canEditCrm, canSeeMoney, type Role } from "@/lib/permissions";
import {
  gateDecision,
  gateMode,
  inNextWorkdays,
  inspectionResultLabel,
  inspectionStillOpen,
  isInspectionResult,
  isPermitStatus,
  isPermitType,
  latestByRoot,
  permitExpiring,
  permitStatusLabel,
  permitTypeLabel,
  type GateMode,
} from "@/lib/permits/rules";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { workCalendarFor } from "@/lib/services/work-calendar";
import { hashVendorToken, vendorTokenMatches } from "@/lib/vendor/token";

function assertOffice(actor: Actor) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot edit permits.");
}

function cleanText(value: string, max: number, label: string, required = false): string {
  const text = value.trim().replace(/\s+/g, " ");
  if (!text && required) throw new ServiceError(`Add a ${label}.`);
  if (text.length > max) throw new ServiceError(`Keep the ${label} under ${max} characters.`);
  return text;
}

function cleanDay(value: string | null | undefined): string | null {
  const day = (value ?? "").trim();
  if (!day) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ServiceError("Enter a date.");
  return day;
}

function projectIn(orgId: string, projectId: string) {
  return getDb().select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
}

function moneyVisible(actor: Actor): boolean {
  return canSeeMoney(actor.role as Role);
}

export type PermitFile = { id: string; name: string };

export type InspectionRow = {
  id: string;
  name: string;
  attempt: number;
  result: string;
  resultLabel: string;
  requestedOn: string | null;
  scheduledOn: string | null;
  resultOn: string | null;
  inspector: string | null;
  notes: string;
  scheduleItemId: string | null;
  scheduleTitle: string | null;
  gates: { id: string; title: string }[];
  files: PermitFile[];
  todos: { id: string; title: string }[];
};

export type PermitRow = {
  id: string;
  permitType: string;
  typeLabel: string;
  number: string;
  jurisdiction: string;
  status: string;
  statusLabel: string;
  appliedOn: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  feeCents: number | null;
  costCode: string | null;
  posted: boolean;
  showPassed: boolean;
  files: PermitFile[];
  inspections: InspectionRow[];
};

function filesFor(orgId: string, targetType: string, targetId: string): PermitFile[] {
  const db = getDb();
  const refs = db
    .select()
    .from(recordFiles)
    .where(and(eq(recordFiles.orgId, orgId), eq(recordFiles.targetType, targetType), eq(recordFiles.targetId, targetId)))
    .all();
  return refs.flatMap((ref) => {
    const file = db.select().from(jobFiles).where(and(eq(jobFiles.id, ref.jobFileId), eq(jobFiles.orgId, orgId))).get();
    return file && !file.deletedAt ? [{ id: file.id, name: file.name }] : [];
  });
}

export function permitBoard(actor: Actor, projectId: string): { projectName: string; canEdit: boolean; showFee: boolean; permits: PermitRow[]; schedule: { id: string; title: string }[]; files: PermitFile[] } | null {
  const db = getDb();
  const project = projectIn(actor.orgId, projectId);
  if (!project) return null;
  const showFee = moneyVisible(actor);
  const permitRows = db
    .select()
    .from(permits)
    .where(and(eq(permits.orgId, actor.orgId), eq(permits.projectId, projectId)))
    .all()
    .sort((a, b) => a.permitType.localeCompare(b.permitType) || a.number.localeCompare(b.number));
  const inspectionRows = db
    .select()
    .from(inspections)
    .where(and(eq(inspections.orgId, actor.orgId), eq(inspections.projectId, projectId)))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name) || a.attempt - b.attempt);
  const gates = db.select().from(inspectionGates).where(eq(inspectionGates.orgId, actor.orgId)).all();
  const items = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, projectId)))
    .all();
  const titles = new Map(items.map((item) => [item.id, item.title]));
  const todoRows = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.orgId, actor.orgId), eq(tasks.relatedType, "project"), eq(tasks.relatedId, projectId)))
    .all();
  const views: PermitRow[] = permitRows.map((permit) => ({
    id: permit.id,
    permitType: permit.permitType,
    typeLabel: permitTypeLabel(permit.permitType),
    number: permit.number,
    jurisdiction: permit.jurisdiction,
    status: permit.status,
    statusLabel: permitStatusLabel(permit.status),
    appliedOn: permit.appliedOn,
    issuedOn: permit.issuedOn,
    expiresOn: permit.expiresOn,
    feeCents: showFee ? permit.feeCents : null,
    costCode: showFee ? permit.costCode : null,
    posted: Boolean(permit.costItemId),
    showPassed: permit.showPassed === 1,
    files: filesFor(actor.orgId, "permit", permit.id),
    inspections: inspectionRows
      .filter((row) => row.permitId === permit.id)
      .map((row) => ({
        id: row.id,
        name: row.name,
        attempt: row.attempt,
        result: row.result,
        resultLabel: inspectionResultLabel(row.result),
        requestedOn: row.requestedOn,
        scheduledOn: row.scheduledOn,
        resultOn: row.resultOn,
        inspector: row.inspector,
        notes: row.notes,
        scheduleItemId: row.scheduleItemId,
        scheduleTitle: row.scheduleItemId ? titles.get(row.scheduleItemId) ?? null : null,
        gates: gates
          .filter((gate) => gate.inspectionId === row.id)
          .map((gate) => ({ id: gate.scheduleItemId, title: titles.get(gate.scheduleItemId) ?? "Item" })),
        files: filesFor(actor.orgId, "inspection", row.id),
        todos: todoRows.filter((task) => task.tags.split(",").includes(`inspection:${row.id}`)).map((task) => ({ id: task.id, title: task.title })),
      })),
  }));
  return {
    projectName: project.name,
    canEdit: canEditCrm(actor.role as Role),
    showFee,
    permits: views,
    schedule: items.map((item) => ({ id: item.id, title: item.title })).sort((a, b) => a.title.localeCompare(b.title)),
    files: db
      .select()
      .from(jobFiles)
      .where(and(eq(jobFiles.orgId, actor.orgId), eq(jobFiles.projectId, projectId), eq(jobFiles.isCurrent, 1)))
      .all()
      .filter((row) => !row.deletedAt)
      .map((row) => ({ id: row.id, name: row.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function savePermit(
  actor: Actor,
  projectId: string,
  input: {
    permitType: string;
    number: string;
    jurisdiction: string;
    status: string;
    appliedOn: string | null;
    issuedOn: string | null;
    expiresOn: string | null;
    feeCents: number | null;
    costCode: string | null;
    showPassed: boolean;
  },
  permitId?: string,
) {
  assertOffice(actor);
  const db = getDb();
  const project = projectIn(actor.orgId, projectId);
  if (!project) throw new ServiceError("That job is not in your company.");
  if (!isPermitType(input.permitType)) throw new ServiceError("Pick a permit type.");
  if (!isPermitStatus(input.status)) throw new ServiceError("Pick a permit status.");
  const number = cleanText(input.number, 40, "number");
  const jurisdiction = cleanText(input.jurisdiction, 80, "jurisdiction");
  const fee = input.feeCents;
  if (fee != null && (!Number.isInteger(fee) || fee < 0 || fee > 100_000_00)) throw new ServiceError("Fee is 0 to 100000 dollars.");
  const costCode = input.costCode?.trim() || null;
  if (costCode && costCode.length > 40) throw new ServiceError("Pick a cost code.");
  const now = nowIso();
  const existing = permitId
    ? db.select().from(permits).where(and(eq(permits.id, permitId), eq(permits.orgId, actor.orgId), eq(permits.projectId, projectId))).get()
    : undefined;
  if (permitId && !existing) throw new ServiceError("That permit is not on this job.");
  const idValue = existing?.id ?? id("perm");
  let costItemId = existing?.costItemId ?? null;
  const storedFee = existing?.costItemId ? existing.feeCents : fee;
  const storedCode = existing?.costItemId ? existing.costCode : costCode;
  if (!costItemId && storedFee && storedFee > 0 && storedCode && moneyVisible(actor)) {
    costItemId = id("cost");
    db.insert(costItems)
      .values({
        id: costItemId,
        orgId: actor.orgId,
        projectId,
        budgetLineId: null,
        costCode: storedCode,
        amountCents: storedFee,
        vendorName: jurisdiction || null,
        memo: number ? `Permit ${number}` : `${permitTypeLabel(input.permitType)} permit`,
        source: "permit",
        aiExtracted: 0,
        documentId: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
  }
  const values = {
    permitType: input.permitType,
    number,
    jurisdiction,
    status: input.status,
    appliedOn: cleanDay(input.appliedOn),
    issuedOn: cleanDay(input.issuedOn),
    expiresOn: cleanDay(input.expiresOn),
    feeCents: moneyVisible(actor) ? storedFee : existing?.feeCents ?? null,
    costCode: moneyVisible(actor) ? storedCode : existing?.costCode ?? null,
    costItemId,
    showPassed: input.showPassed ? 1 : 0,
    updatedAt: now,
  };
  if (existing) {
    db.update(permits).set(values).where(and(eq(permits.id, existing.id), eq(permits.orgId, actor.orgId))).run();
  } else {
    db.insert(permits)
      .values({ id: idValue, orgId: actor.orgId, projectId, ...values, createdAt: now, createdBy: actor.userId })
      .run();
  }
  return { id: idValue };
}

function replaceGates(orgId: string, inspectionId: string, projectId: string, itemIds: string[]) {
  const db = getDb();
  const allowed = new Set(
    db
      .select()
      .from(scheduleItems)
      .where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.projectId, projectId)))
      .all()
      .map((row) => row.id),
  );
  db.delete(inspectionGates).where(and(eq(inspectionGates.orgId, orgId), eq(inspectionGates.inspectionId, inspectionId))).run();
  for (const itemId of [...new Set(itemIds)].filter((itemId) => allowed.has(itemId))) {
    db.insert(inspectionGates).values({ id: id("gate"), orgId, inspectionId, scheduleItemId: itemId }).run();
  }
}

export function saveInspection(
  actor: Actor,
  projectId: string,
  input: {
    permitId: string;
    name: string;
    scheduleItemId: string | null;
    requestedOn: string | null;
    scheduledOn: string | null;
    inspector: string | null;
    result: string;
    notes: string;
    gateItemIds: string[];
  },
  inspectionId?: string,
) {
  assertOffice(actor);
  const db = getDb();
  if (!projectIn(actor.orgId, projectId)) throw new ServiceError("That job is not in your company.");
  const permit = db.select().from(permits).where(and(eq(permits.id, input.permitId), eq(permits.orgId, actor.orgId), eq(permits.projectId, projectId))).get();
  if (!permit) throw new ServiceError("That permit is not on this job.");
  if (!isInspectionResult(input.result)) throw new ServiceError("Pick a result.");
  const name = cleanText(input.name, 80, "name", true);
  const notes = input.notes.trim();
  if (notes.length > 2000) throw new ServiceError("Keep the notes under 2000 characters.");
  const inspector = cleanText(input.inspector ?? "", 80, "inspector") || null;
  const now = nowIso();
  const existing = inspectionId
    ? db.select().from(inspections).where(and(eq(inspections.id, inspectionId), eq(inspections.orgId, actor.orgId), eq(inspections.projectId, projectId))).get()
    : undefined;
  if (inspectionId && !existing) throw new ServiceError("That inspection is not on this job.");
  const scheduleItemId = input.scheduleItemId?.trim() || null;
  if (scheduleItemId) {
    const item = db.select().from(scheduleItems).where(and(eq(scheduleItems.id, scheduleItemId), eq(scheduleItems.orgId, actor.orgId), eq(scheduleItems.projectId, projectId))).get();
    if (!item) throw new ServiceError("That schedule item is not on this job.");
  }
  const idValue = existing?.id ?? id("insp");
  const resultOn = input.result === "pending" ? null : existing?.result === input.result ? existing.resultOn : now.slice(0, 10);
  const values = {
    permitId: permit.id,
    name,
    scheduleItemId,
    requestedOn: cleanDay(input.requestedOn),
    scheduledOn: cleanDay(input.scheduledOn),
    inspector,
    result: input.result,
    resultOn,
    notes,
    updatedAt: now,
  };
  if (existing) {
    db.update(inspections).set(values).where(and(eq(inspections.id, existing.id), eq(inspections.orgId, actor.orgId))).run();
  } else {
    db.insert(inspections)
      .values({
        id: idValue,
        orgId: actor.orgId,
        projectId,
        rootId: idValue,
        attempt: 1,
        ...values,
        createdAt: now,
        createdBy: actor.userId,
      })
      .run();
  }
  replaceGates(actor.orgId, idValue, projectId, input.gateItemIds);
  if (input.result === "passed" || input.result === "failed") {
    emitAutomation({
      orgId: actor.orgId,
      kind: "inspection_result",
      recordType: "inspection",
      recordId: idValue,
      recordLabel: name,
      projectId,
      status: input.result,
      name,
      scheduleItemId,
      gateItemIds: input.gateItemIds,
    });
  }
  return { id: idValue };
}

export function requestReinspection(actor: Actor, inspectionId: string) {
  assertOffice(actor);
  const db = getDb();
  const current = db.select().from(inspections).where(and(eq(inspections.id, inspectionId), eq(inspections.orgId, actor.orgId))).get();
  if (!current) throw new ServiceError("That inspection is not on this job.");
  if (current.result !== "failed" && current.result !== "partial") throw new ServiceError("Re-inspect after a failed or partial result.");
  const chain = db
    .select()
    .from(inspections)
    .where(and(eq(inspections.orgId, actor.orgId), eq(inspections.rootId, current.rootId)))
    .all();
  const latest = chain.reduce((best, row) => (row.attempt > best.attempt ? row : best), current);
  if (latest.result === "pending") throw new ServiceError("A re-inspection is already open.");
  const nextId = id("insp");
  const now = nowIso();
  const gates = db.select().from(inspectionGates).where(and(eq(inspectionGates.orgId, actor.orgId), eq(inspectionGates.inspectionId, latest.id))).all();
  db.insert(inspections)
    .values({
      id: nextId,
      orgId: actor.orgId,
      projectId: current.projectId,
      permitId: current.permitId,
      rootId: current.rootId,
      attempt: latest.attempt + 1,
      name: current.name,
      scheduleItemId: current.scheduleItemId,
      requestedOn: now.slice(0, 10),
      scheduledOn: null,
      inspector: null,
      result: "pending",
      resultOn: null,
      notes: "",
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  for (const gate of gates) {
    db.insert(inspectionGates).values({ id: id("gate"), orgId: actor.orgId, inspectionId: nextId, scheduleItemId: gate.scheduleItemId }).run();
  }
  return { id: nextId, attempt: latest.attempt + 1 };
}

export function inspectionTodos(actor: Actor, inspectionId: string) {
  assertOffice(actor);
  const db = getDb();
  const row = db.select().from(inspections).where(and(eq(inspections.id, inspectionId), eq(inspections.orgId, actor.orgId))).get();
  if (!row) throw new ServiceError("That inspection is not on this job.");
  if (row.result !== "failed" && row.result !== "partial") throw new ServiceError("Add to-dos after a failed or partial result.");
  const lines = row.notes
    .split(/\n+/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (lines.length === 0) throw new ServiceError("Add correction notes first.");
  const tag = `inspection:${row.id}`;
  const existing = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.orgId, actor.orgId), eq(tasks.relatedId, row.projectId)))
    .all()
    .filter((task) => task.tags.split(",").includes(tag));
  if (existing.length > 0) return { ids: existing.map((task) => task.id) };
  const now = nowIso();
  const ids: string[] = [];
  for (const line of lines) {
    const taskId = id("task");
    ids.push(taskId);
    db.insert(tasks)
      .values({
        id: taskId,
        orgId: actor.orgId,
        title: line.slice(0, 120),
        assigneeUserId: null,
        dueAt: null,
        relatedType: "project",
        relatedId: row.projectId,
        status: "open",
        notes: row.name,
        priority: "normal",
        tags: tag,
        scheduleItemId: row.scheduleItemId,
        deadlineEdge: null,
        deadlineOffset: null,
        deadlineUnlinked: 0,
        remindDays: null,
        remindedFor: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
      })
      .run();
  }
  return { ids };
}

export function attachRecordFile(actor: Actor, targetType: "permit" | "inspection", targetId: string, jobFileId: string) {
  assertOffice(actor);
  const db = getDb();
  const file = db.select().from(jobFiles).where(and(eq(jobFiles.id, jobFileId), eq(jobFiles.orgId, actor.orgId))).get();
  if (!file || file.deletedAt) throw new ServiceError("That file is not on this job.");
  const target =
    targetType === "permit"
      ? db.select().from(permits).where(and(eq(permits.id, targetId), eq(permits.orgId, actor.orgId), eq(permits.projectId, file.projectId))).get()
      : db.select().from(inspections).where(and(eq(inspections.id, targetId), eq(inspections.orgId, actor.orgId), eq(inspections.projectId, file.projectId))).get();
  if (!target) throw new ServiceError("That record is not on this job.");
  const existing = db
    .select()
    .from(recordFiles)
    .where(and(eq(recordFiles.orgId, actor.orgId), eq(recordFiles.targetType, targetType), eq(recordFiles.targetId, targetId), eq(recordFiles.jobFileId, jobFileId)))
    .get();
  if (existing) return { id: existing.id };
  const refId = id("rfile");
  db.insert(recordFiles).values({ id: refId, orgId: actor.orgId, targetType, targetId, jobFileId, createdAt: nowIso() }).run();
  return { id: refId };
}

export function setInspectionGateMode(actor: Actor, mode: string) {
  if (actor.role !== "owner" && actor.role !== "admin") throw new ServiceError("Your role cannot change this setting.");
  const next = gateMode(mode);
  if (mode !== next) throw new ServiceError("Pick Off, Warn, or Block.");
  getDb().update(organizations).set({ inspectionGate: next, updatedAt: nowIso() }).where(eq(organizations.id, actor.orgId)).run();
}

type GateHit = { name: string; scheduledOn: string | null };

function activeGate(orgId: string, itemId: string): GateHit | null {
  const db = getDb();
  const gates = db.select().from(inspectionGates).where(and(eq(inspectionGates.orgId, orgId), eq(inspectionGates.scheduleItemId, itemId))).all();
  if (gates.length === 0) return null;
  const rows = db.select().from(inspections).where(eq(inspections.orgId, orgId)).all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const latest = new Map(latestByRoot(rows).map((row) => [row.rootId, row]));
  let hit: GateHit | null = null;
  for (const gate of gates) {
    const row = byId.get(gate.inspectionId);
    if (!row) continue;
    const current = latest.get(row.rootId);
    if (!current || current.id !== row.id || !inspectionStillOpen(current.result)) continue;
    if (!hit || (current.scheduledOn && (!hit.scheduledOn || current.scheduledOn < hit.scheduledOn))) {
      hit = { name: current.name, scheduledOn: current.scheduledOn };
    }
  }
  return hit;
}

export function scheduleGateStatus(actor: Actor, itemId: string, next: { startDate: string; status: string }): { action: "allow" | "warn" | "block"; reason: string | null } {
  const db = getDb();
  const item = db.select().from(scheduleItems).where(and(eq(scheduleItems.id, itemId), eq(scheduleItems.orgId, actor.orgId))).get();
  if (!item) return { action: "allow", reason: null };
  const org = db.select({ inspectionGate: organizations.inspectionGate }).from(organizations).where(eq(organizations.id, actor.orgId)).get();
  const open = activeGate(actor.orgId, itemId);
  return gateDecision({
    mode: gateMode(org?.inspectionGate),
    name: open?.name ?? null,
    scheduledOn: open?.scheduledOn ?? null,
    previous: { startDate: item.startDate, status: item.status },
    next,
  });
}

export function enforceScheduleGate(actor: Actor, itemId: string, next: { startDate: string; status: string }, confirm: boolean) {
  const decision = scheduleGateStatus(actor, itemId, next);
  if (decision.action === "allow") return decision;
  if (decision.action === "block" || !confirm) throw new ServiceError(decision.reason ?? "This inspection has not passed.");
  return decision;
}

export function inspectionQueue(orgId: string, today: string): {
  upcoming: { count: number; href: string | null };
  failed: { count: number; href: string | null };
  expiring: { count: number; href: string | null };
} {
  const db = getDb();
  const calendar = workCalendarFor(orgId);
  const rows = db.select().from(inspections).where(eq(inspections.orgId, orgId)).all();
  const latest = latestByRoot(rows);
  const upcomingRows = latest.filter((row) => row.scheduledOn && inNextWorkdays(today, row.scheduledOn, calendar, 3) && row.result !== "cancelled");
  const failedRows = latest.filter((row) => row.result === "failed" || row.result === "partial");
  const permitRows = db.select().from(permits).where(eq(permits.orgId, orgId)).all();
  const expiringRows = permitRows.filter((row) => permitExpiring(today, row.expiresOn, row.status));
  const href = (ids: string[]) => (ids[0] ? `/projects/${ids[0]}/permits` : null);
  return {
    upcoming: { count: upcomingRows.length, href: href(upcomingRows.map((row) => row.projectId)) },
    failed: { count: failedRows.length, href: href(failedRows.map((row) => row.projectId)) },
    expiring: { count: expiringRows.length, href: href(expiringRows.map((row) => row.projectId)) },
  };
}

export function closeoutPermitFacts(orgId: string, projectId: string): { permitsOpen: number; inspectionsOpen: number } {
  const db = getDb();
  const permitRows = db.select().from(permits).where(and(eq(permits.orgId, orgId), eq(permits.projectId, projectId))).all();
  const inspectionRows = db.select().from(inspections).where(and(eq(inspections.orgId, orgId), eq(inspections.projectId, projectId))).all();
  return {
    permitsOpen: permitRows.filter((row) => row.status !== "closed").length,
    inspectionsOpen: latestByRoot(inspectionRows).filter((row) => row.result !== "passed" && row.result !== "cancelled").length,
  };
}

export function portalPassedInspections(token: string): { name: string; date: string }[] {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, token)).get();
  if (!project) return [];
  const shown = new Set(
    db
      .select()
      .from(permits)
      .where(and(eq(permits.orgId, project.orgId), eq(permits.projectId, project.id), eq(permits.showPassed, 1)))
      .all()
      .map((row) => row.id),
  );
  return db
    .select()
    .from(inspections)
    .where(and(eq(inspections.orgId, project.orgId), eq(inspections.projectId, project.id), eq(inspections.result, "passed")))
    .all()
    .filter((row) => shown.has(row.permitId) && (row.resultOn || row.scheduledOn))
    .map((row) => ({ name: row.name, date: row.resultOn || row.scheduledOn || "" }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

export function vendorInspectionRows(token: string): { name: string; date: string; result: string }[] {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 200) return [];
  const db = getDb();
  const portal = db.select().from(vendorPortals).where(eq(vendorPortals.tokenHash, hashVendorToken(trimmed))).get();
  if (!portal || !vendorTokenMatches(trimmed, portal.tokenHash)) return [];
  const items = db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, portal.orgId), eq(scheduleItems.vendorContactId, portal.contactId)))
    .all();
  const itemIds = new Set(items.map((item) => item.id));
  if (itemIds.size === 0) return [];
  const gates = db
    .select()
    .from(inspectionGates)
    .where(eq(inspectionGates.orgId, portal.orgId))
    .all()
    .filter((gate) => itemIds.has(gate.scheduleItemId));
  const rows = db.select().from(inspections).where(eq(inspections.orgId, portal.orgId)).all();
  const hits = new Map<string, { name: string; date: string; result: string }>();
  for (const gate of gates) {
    const row = rows.find((item) => item.id === gate.inspectionId);
    if (!row) continue;
    const active = latestByRoot(rows.filter((item) => item.rootId === row.rootId))[0];
    if (!active || active.result === "cancelled" || !gates.some((item) => item.inspectionId === active.id)) continue;
    hits.set(active.id, { name: active.name, date: active.scheduledOn || active.requestedOn || "", result: inspectionResultLabel(active.result) });
  }
  return [...hits.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

export function feedInspectionEvents(orgId: string, userId: string): { uid: string; title: string; startDate: string; endDate: string }[] {
  const db = getDb();
  const assigned = new Set(
    db
      .select()
      .from(scheduleAssignees)
      .where(and(eq(scheduleAssignees.orgId, orgId), eq(scheduleAssignees.userId, userId)))
      .all()
      .map((row) => row.itemId),
  );
  if (assigned.size === 0) return [];
  const rows = db.select().from(inspections).where(eq(inspections.orgId, orgId)).all();
  const latest = latestByRoot(rows).filter((row) => row.scheduledOn && row.result !== "cancelled");
  const gates = db.select().from(inspectionGates).where(eq(inspectionGates.orgId, orgId)).all();
  const names = new Map(db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, orgId)).all().map((row) => [row.id, row.name]));
  return latest.flatMap((row) => {
    const linked = (row.scheduleItemId && assigned.has(row.scheduleItemId)) || gates.some((gate) => gate.inspectionId === row.id && assigned.has(gate.scheduleItemId));
    if (!linked || !row.scheduledOn) return [];
    return [{ uid: row.id, title: `${names.get(row.projectId) ?? "Job"}: Inspection ${row.name}`, startDate: row.scheduledOn, endDate: row.scheduledOn }];
  });
}

export function jobInspectionMarks(actor: Actor, projectId: string): { id: string; name: string; date: string | null; resultLabel: string; attempt: number }[] {
  const db = getDb();
  if (!projectIn(actor.orgId, projectId)) return [];
  return db
    .select()
    .from(inspections)
    .where(and(eq(inspections.orgId, actor.orgId), eq(inspections.projectId, projectId)))
    .all()
    .sort((a, b) => (a.scheduledOn ?? "").localeCompare(b.scheduledOn ?? "") || a.attempt - b.attempt)
    .map((row) => ({ id: row.id, name: row.name, date: row.scheduledOn, resultLabel: inspectionResultLabel(row.result), attempt: row.attempt }));
}

export function scheduleGateLabels(orgId: string): Map<string, string> {
  const db = getDb();
  const rows = db.select().from(inspections).where(eq(inspections.orgId, orgId)).all();
  const latest = new Map(latestByRoot(rows).filter((row) => inspectionStillOpen(row.result)).map((row) => [row.id, row.name]));
  const labels = new Map<string, string>();
  for (const gate of db.select().from(inspectionGates).where(eq(inspectionGates.orgId, orgId)).all()) {
    const name = latest.get(gate.inspectionId);
    if (name && !labels.has(gate.scheduleItemId)) labels.set(gate.scheduleItemId, name);
  }
  return labels;
}

export function scheduleMilestones(orgId: string): { id: string; projectId: string; name: string; date: string; itemIds: string[] }[] {
  const db = getDb();
  const rows = latestByRoot(db.select().from(inspections).where(eq(inspections.orgId, orgId)).all()).filter((row) => row.scheduledOn && row.result !== "cancelled");
  const gates = db.select().from(inspectionGates).where(eq(inspectionGates.orgId, orgId)).all();
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    date: row.scheduledOn as string,
    itemIds: [row.scheduleItemId, ...gates.filter((gate) => gate.inspectionId === row.id).map((gate) => gate.scheduleItemId)].filter((itemId): itemId is string => Boolean(itemId)),
  }));
}

export function gateModeFor(orgId: string): GateMode {
  const org = getDb().select({ inspectionGate: organizations.inspectionGate }).from(organizations).where(eq(organizations.id, orgId)).get();
  return gateMode(org?.inspectionGate);
}
