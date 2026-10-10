import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { dataDir, getDb, type AppDatabase } from "@/lib/db/client";
import {
  auditLogs,
  costItems,
  dailyLogEquipment,
  dailyLogs,
  documents,
  equipment,
  equipmentAssignments,
  memberships,
  projects,
  users,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canAddFieldNotes, canEditCrm, canSeeMoney, type Role } from "@/lib/permissions";
import { assertCostFree } from "@/lib/services/cost-plus";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { attachmentExtension, attachmentUploadError } from "@/lib/security";
import { calendarForOrg } from "@/lib/services/time";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

export const EQUIPMENT_STATUSES = ["available", "on_job", "with_person", "in_service", "lost", "retired"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

const STATUS_LABEL: Record<string, string> = {
  available: "Available",
  on_job: "On job",
  with_person: "With person",
  in_service: "In service",
  lost: "Lost",
  retired: "Retired",
};

const BLOCKED = new Set(["in_service", "lost", "retired"]);
const COST_CODE = "EQ-TOOLS";

export function equipmentStatusLabel(status: string) {
  return STATUS_LABEL[status] ?? status;
}

export function equipmentChargeCents(rateCents: number, rateUnit: string, hours: number, days: number) {
  if (!Number.isInteger(rateCents) || rateCents < 0) return 0;
  if (rateUnit === "hour") return Math.max(0, hours) * rateCents;
  if (rateUnit === "day") return Math.max(1, days) * rateCents;
  return 0;
}

function zoneOf(orgId: string) {
  return calendarForOrg(orgId).timeZone || "America/New_York";
}

function todayFor(orgId: string) {
  return localDay(Date.now(), zoneOf(orgId));
}

function daySpan(startIso: string, endDay: string, zone: string) {
  const start = localDay(Date.parse(startIso), zone);
  if (!start || endDay < start) return 1;
  let days = 1;
  let cursor = start;
  while (cursor < endDay && days < 3660) {
    cursor = addCalendarDays(cursor, 1);
    days += 1;
  }
  return days;
}

function clean(value: string, max: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function dayOrNull(value: string | null | undefined) {
  const day = (value ?? "").trim();
  if (!day) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ServiceError("Enter a date.");
  return day;
}

function assertCrew(actor: Actor) {
  if (!canAddFieldNotes(actor.role as Role)) throw new ServiceError("Your role cannot check equipment out.");
}

function assertOffice(actor: Actor) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot edit equipment.");
}

function money(actor: Actor) {
  return canSeeMoney(actor.role as Role);
}

function writeAudit(db: AppDatabase, orgId: string, actorId: string, action: string, entityId: string, payload: Record<string, unknown>) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "equipment",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function storePhoto(db: AppDatabase, orgId: string, filename: string, bytes: Buffer, createdBy: string) {
  const error = attachmentUploadError(filename, bytes);
  if (error) throw new ServiceError(error);
  const documentId = id("doc");
  const relative = path.join("uploads", orgId, `${documentId}.${attachmentExtension(bytes)}`);
  fs.mkdirSync(path.dirname(path.join(dataDir(), relative)), { recursive: true });
  fs.writeFileSync(path.join(dataDir(), relative), bytes);
  db.insert(documents)
    .values({
      id: documentId,
      orgId,
      projectId: null,
      leadId: null,
      contactId: null,
      type: "equipment",
      filename: path.basename(filename).slice(0, 80),
      storagePath: relative,
      metadataJson: null,
      deletedAt: null,
      createdAt: nowIso(),
      createdBy,
    })
    .run();
  return documentId;
}

type Item = typeof equipment.$inferSelect;

function loadItem(db: AppDatabase, orgId: string, equipmentId: string) {
  return db.select().from(equipment).where(and(eq(equipment.id, equipmentId), eq(equipment.orgId, orgId))).get();
}

function openAssignment(db: AppDatabase, orgId: string, equipmentId: string) {
  return db
    .select()
    .from(equipmentAssignments)
    .where(and(eq(equipmentAssignments.orgId, orgId), eq(equipmentAssignments.equipmentId, equipmentId), isNull(equipmentAssignments.checkedInAt)))
    .get();
}

function projectName(db: AppDatabase, orgId: string, projectId: string | null) {
  if (!projectId) return "";
  return db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get()?.name ?? "";
}

function personName(db: AppDatabase, userId: string | null) {
  if (!userId) return "";
  return db.select().from(users).where(eq(users.id, userId)).get()?.name ?? "";
}

function placeLabel(job: string, person: string) {
  if (job && person) return `${job} · ${person}`;
  return job || person || "Yard";
}

export function nextServiceDay(item: { serviceInterval: number | null; serviceUnit: string | null; lastServiceOn: string | null; hoursSinceService: number }, today: string) {
  if (!item.serviceInterval || item.serviceInterval < 1 || !item.serviceUnit) return null;
  if (item.serviceUnit === "day") {
    if (!item.lastServiceOn) return today;
    return addCalendarDays(item.lastServiceOn, item.serviceInterval);
  }
  if (item.hoursSinceService >= item.serviceInterval) return today;
  return null;
}

export function serviceDueSoon(item: { serviceInterval: number | null; serviceUnit: string | null; lastServiceOn: string | null; hoursSinceService: number }, today: string) {
  const next = nextServiceDay(item, today);
  if (!next) return false;
  return next <= addCalendarDays(today, 7);
}

function stranded(project: { status: string; closedAt: string | null; substantialAt: string | null } | undefined) {
  if (!project) return false;
  return project.status === "complete" || Boolean(project.closedAt) || Boolean(project.substantialAt);
}

export type EquipmentRow = {
  id: string;
  name: string;
  category: string;
  tag: string;
  status: string;
  statusLabel: string;
  location: string;
  projectId: string | null;
  expectedReturn: string | null;
  overdue: boolean;
  serviceDue: boolean;
  stranded: boolean;
};

export function equipmentQueue(orgId: string, today: string) {
  const db = getDb();
  const items = db.select().from(equipment).where(eq(equipment.orgId, orgId)).all();
  const open = db
    .select()
    .from(equipmentAssignments)
    .where(and(eq(equipmentAssignments.orgId, orgId), isNull(equipmentAssignments.checkedInAt)))
    .all();
  const byItem = new Map(open.map((row) => [row.equipmentId, row]));
  const jobs = db.select().from(projects).where(eq(projects.orgId, orgId)).all();
  const jobById = new Map(jobs.map((row) => [row.id, row]));
  let overdue = 0;
  let service = 0;
  let left = 0;
  for (const item of items) {
    if (serviceDueSoon(item, today)) service += 1;
    const assignment = byItem.get(item.id);
    if (!assignment) continue;
    if (assignment.expectedReturn && assignment.expectedReturn < today) overdue += 1;
    if (assignment.projectId && stranded(jobById.get(assignment.projectId))) left += 1;
  }
  return {
    overdue: { count: overdue, href: overdue ? "/equipment?due=overdue" : null },
    service: { count: service, href: service ? "/equipment?service=due" : null },
    stranded: { count: left, href: left ? "/equipment?where=closed" : null },
  };
}

export function equipmentOnJob(orgId: string, projectId: string) {
  const db = getDb();
  return db
    .select()
    .from(equipmentAssignments)
    .where(and(eq(equipmentAssignments.orgId, orgId), eq(equipmentAssignments.projectId, projectId), isNull(equipmentAssignments.checkedInAt)))
    .all().length;
}

function rowOf(db: AppDatabase, item: Item, today: string): EquipmentRow {
  const assignment = openAssignment(db, item.orgId, item.id);
  const job = projectName(db, item.orgId, item.projectId);
  const person = personName(db, item.userId);
  const project = item.projectId ? db.select().from(projects).where(and(eq(projects.id, item.projectId), eq(projects.orgId, item.orgId))).get() : undefined;
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    tag: item.tag,
    status: item.status,
    statusLabel: equipmentStatusLabel(item.status),
    location: item.locationKind === "yard" ? "Yard" : placeLabel(job, person),
    projectId: item.projectId,
    expectedReturn: assignment?.expectedReturn ?? null,
    overdue: Boolean(assignment?.expectedReturn && assignment.expectedReturn < today),
    serviceDue: serviceDueSoon(item, today),
    stranded: Boolean(assignment && item.projectId && stranded(project)),
  };
}

export function listEquipment(actor: Actor, filter: { status?: string; category?: string; due?: string; service?: string; where?: string; q?: string }) {
  const db = getDb();
  const today = todayFor(actor.orgId);
  const items = db
    .select()
    .from(equipment)
    .where(eq(equipment.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const needle = (filter.q ?? "").trim().toLowerCase();
  return items
    .map((item) => rowOf(db, item, today))
    .filter((row) => {
      if (filter.status && row.status !== filter.status) return false;
      if (filter.category && row.category !== filter.category) return false;
      if (filter.due === "overdue" && !row.overdue) return false;
      if (filter.service === "due" && !row.serviceDue) return false;
      if (filter.where === "closed" && !row.stranded) return false;
      if (needle && !`${row.name} ${row.tag} ${row.category} ${row.location}`.toLowerCase().includes(needle)) return false;
      return true;
    });
}

export type AssignmentView = {
  id: string;
  who: string;
  when: string;
  returned: string | null;
  from: string;
  to: string;
  open: boolean;
  costCents: number | null;
  costState: string;
};

export type EquipmentDetail = EquipmentRow & {
  makeModel: string;
  serial: string;
  purchasedOn: string | null;
  costCents: number | null;
  rateCents: number | null;
  rateUnit: string | null;
  notes: string;
  documentId: string | null;
  serviceInterval: number | null;
  serviceUnit: string | null;
  lastServiceOn: string | null;
  nextService: string | null;
  hoursSinceService: number;
  lastSeen: string;
  lastSeenAddress: string;
  lastSeenAt: string | null;
  canEdit: boolean;
  canMove: boolean;
  showMoney: boolean;
  suggestedCents: number | null;
  history: AssignmentView[];
  openAssignmentId: string | null;
};

export function equipmentDetail(actor: Actor, equipmentId: string): EquipmentDetail | null {
  const db = getDb();
  const item = loadItem(db, actor.orgId, equipmentId);
  if (!item) return null;
  const today = todayFor(actor.orgId);
  const base = rowOf(db, item, today);
  const names = new Map(
    db
      .select({ id: users.id, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, actor.orgId))
      .all()
      .map((row) => [row.id, row.name]),
  );
  const history = db
    .select()
    .from(equipmentAssignments)
    .where(and(eq(equipmentAssignments.orgId, actor.orgId), eq(equipmentAssignments.equipmentId, item.id)))
    .all()
    .sort((a, b) => b.checkedOutAt.localeCompare(a.checkedOutAt))
    .map((row) => ({
      id: row.id,
      who: names.get(row.createdBy ?? "") || "",
      when: row.checkedOutAt,
      returned: row.checkedInAt,
      from: row.fromLabel,
      to: row.toLabel,
      open: !row.checkedInAt,
      costCents: money(actor) ? row.costCents : null,
      costState: row.costState,
    }));
  const open = history.find((row) => row.open);
  const seen = item.lastSeenProjectId
    ? db.select().from(projects).where(and(eq(projects.id, item.lastSeenProjectId), eq(projects.orgId, actor.orgId))).get()
    : undefined;
  const assignment = openAssignment(db, actor.orgId, item.id);
  const suggested = assignment && item.projectId && item.rateCents && item.rateUnit && assignment.costState !== "posted" && assignment.costState !== "reversed"
    ? equipmentChargeCents(item.rateCents, item.rateUnit, 1, daySpan(assignment.checkedOutAt, today, zoneOf(actor.orgId)))
    : null;
  return {
    ...base,
    makeModel: item.makeModel,
    serial: item.serial,
    purchasedOn: item.purchasedOn,
    costCents: money(actor) ? item.costCents : null,
    rateCents: money(actor) ? item.rateCents : null,
    rateUnit: money(actor) ? item.rateUnit : null,
    notes: item.notes,
    documentId: item.documentId,
    serviceInterval: item.serviceInterval,
    serviceUnit: item.serviceUnit,
    lastServiceOn: item.lastServiceOn,
    nextService: nextServiceDay(item, today),
    hoursSinceService: item.hoursSinceService,
    lastSeen: seen ? seen.name : "",
    lastSeenAddress: seen?.address ?? "",
    lastSeenAt: item.lastSeenAt,
    canEdit: canEditCrm(actor.role as Role),
    canMove: canAddFieldNotes(actor.role as Role),
    showMoney: money(actor),
    suggestedCents: money(actor) ? suggested : null,
    history,
    openAssignmentId: open?.id ?? null,
  } as EquipmentDetail;
}

export type EquipmentInput = {
  name: string;
  category: string;
  makeModel: string;
  serial: string;
  tag: string;
  purchasedOn: string | null;
  costCents: number | null;
  rateCents: number | null;
  rateUnit: string | null;
  status: string;
  serviceInterval: number | null;
  serviceUnit: string | null;
  lastServiceOn: string | null;
  notes: string;
  photo?: { filename: string; bytes: Buffer } | null;
};

export function saveEquipment(actor: Actor, input: EquipmentInput, equipmentId?: string) {
  assertOffice(actor);
  const db = getDb();
  const name = clean(input.name, 80);
  if (name.length < 2) throw new ServiceError("Name the equipment.");
  const category = clean(input.category, 40);
  if (!category) throw new ServiceError("Add a category.");
  if (!EQUIPMENT_STATUSES.includes(input.status as EquipmentStatus)) throw new ServiceError("Pick a status.");
  const tag = clean(input.tag, 20);
  if (tag) {
    const clash = db
      .select()
      .from(equipment)
      .where(and(eq(equipment.orgId, actor.orgId), eq(equipment.tag, tag)))
      .all()
      .find((row) => row.id !== equipmentId);
    if (clash) throw new ServiceError("That tag is already in use.");
  }
  const rateUnit = input.rateUnit === "hour" || input.rateUnit === "day" ? input.rateUnit : null;
  const serviceUnit = input.serviceUnit === "hour" || input.serviceUnit === "day" ? input.serviceUnit : null;
  if (input.rateCents != null && (!Number.isInteger(input.rateCents) || input.rateCents < 0)) throw new ServiceError("Rate is a dollar amount.");
  if (input.costCents != null && (!Number.isInteger(input.costCents) || input.costCents < 0)) throw new ServiceError("Cost is a dollar amount.");
  if (input.serviceInterval != null && (!Number.isInteger(input.serviceInterval) || input.serviceInterval < 1 || input.serviceInterval > 3650)) {
    throw new ServiceError("Service interval is 1 to 3650.");
  }
  const existing = equipmentId ? loadItem(db, actor.orgId, equipmentId) : undefined;
  if (equipmentId && !existing) throw new ServiceError("That equipment is not in the register.");
  if (existing && BLOCKED.has(input.status) && openAssignment(db, actor.orgId, existing.id)) throw new ServiceError("Check it in first.");
  const now = nowIso();
  const photoId = input.photo && input.photo.bytes.length ? storePhoto(db, actor.orgId, input.photo.filename, input.photo.bytes, actor.userId) : existing?.documentId ?? null;
  const values = {
    name,
    category,
    makeModel: clean(input.makeModel, 80),
    serial: clean(input.serial, 40),
    tag,
    purchasedOn: dayOrNull(input.purchasedOn),
    costCents: money(actor) ? input.costCents : existing?.costCents ?? null,
    rateCents: money(actor) ? (rateUnit ? input.rateCents : null) : existing?.rateCents ?? null,
    rateUnit: money(actor) ? (input.rateCents ? rateUnit : null) : existing?.rateUnit ?? null,
    status: existing && (existing.status === "on_job" || existing.status === "with_person") && !BLOCKED.has(input.status) ? existing.status : input.status,
    notes: clean(input.notes, 500),
    documentId: photoId,
    serviceInterval: serviceUnit ? input.serviceInterval : null,
    serviceUnit: input.serviceInterval ? serviceUnit : null,
    lastServiceOn: dayOrNull(input.lastServiceOn),
    updatedAt: now,
  };
  const itemId = existing?.id ?? id("eq");
  if (existing) {
    const location = BLOCKED.has(input.status)
      ? { locationKind: existing.locationKind, projectId: existing.projectId, userId: existing.userId }
      : {};
    db.update(equipment).set({ ...values, ...location, status: BLOCKED.has(input.status) ? input.status : values.status }).where(and(eq(equipment.id, existing.id), eq(equipment.orgId, actor.orgId))).run();
  } else {
    db.insert(equipment)
      .values({
        id: itemId,
        orgId: actor.orgId,
        ...values,
        status: BLOCKED.has(input.status) ? input.status : "available",
        locationKind: "yard",
        projectId: null,
        userId: null,
        hoursSinceService: 0,
        lastSeenProjectId: null,
        lastSeenAt: null,
        createdAt: now,
        createdBy: actor.userId,
      })
      .run();
  }
  if (input.status === "available" && existing && !openAssignment(db, actor.orgId, itemId)) {
    db.update(equipment)
      .set({ status: "available", locationKind: "yard", projectId: null, userId: null })
      .where(and(eq(equipment.id, itemId), eq(equipment.orgId, actor.orgId)))
      .run();
  }
  writeAudit(db, actor.orgId, actor.userId, existing ? "equipment.save" : "equipment.add", itemId, { name });
  return { id: itemId };
}

function member(db: AppDatabase, orgId: string, userId: string) {
  return db.select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId))).get();
}

function postCost(db: AppDatabase, actor: Actor, item: Item, assignmentId: string, projectId: string, cents: number) {
  const row = db.select().from(equipmentAssignments).where(and(eq(equipmentAssignments.id, assignmentId), eq(equipmentAssignments.orgId, actor.orgId))).get();
  if (!row) throw new ServiceError("That assignment is not on the register.");
  if (row.costState === "posted" || row.costState === "reversed") throw new ServiceError("That cost was already posted.");
  if (!Number.isInteger(cents) || cents < 0) throw new ServiceError("Cost is a dollar amount.");
  if (cents === 0) {
    db.update(equipmentAssignments).set({ costState: "posted", costCents: 0 }).where(and(eq(equipmentAssignments.id, row.id), eq(equipmentAssignments.orgId, actor.orgId))).run();
    return null;
  }
  const costId = id("cost");
  const now = nowIso();
  const unit = item.rateUnit === "hour" ? "h" : "d";
  db.insert(costItems)
    .values({
      id: costId,
      orgId: actor.orgId,
      projectId,
      budgetLineId: null,
      costCode: COST_CODE,
      amountCents: cents,
      vendorName: null,
      memo: `Equipment · ${item.name} · ${unit}`,
      source: "equipment",
      aiExtracted: 0,
      documentId: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  db.update(equipmentAssignments)
    .set({ costState: "posted", costCents: cents, costItemId: costId })
    .where(and(eq(equipmentAssignments.id, row.id), eq(equipmentAssignments.orgId, actor.orgId)))
    .run();
  writeAudit(db, actor.orgId, actor.userId, "equipment.cost", item.id, { assignmentId, costId, cents });
  return costId;
}

function closeAssignment(db: AppDatabase, actor: Actor, item: Item, hours: number | null, costCents: number | null) {
  const assignment = openAssignment(db, actor.orgId, item.id);
  if (!assignment) throw new ServiceError("It is not checked out.");
  const now = nowIso();
  const today = todayFor(actor.orgId);
  const used = hours ?? 0;
  if (item.rateUnit === "hour" && (hours == null || !Number.isInteger(hours) || hours < 0 || hours > 1000)) throw new ServiceError("Enter the hours.");
  let posted: number | null = null;
  if (assignment.projectId && item.rateCents && item.rateUnit && assignment.costState !== "posted" && assignment.costState !== "reversed") {
    const days = daySpan(assignment.checkedOutAt, today, zoneOf(actor.orgId));
    const suggested = equipmentChargeCents(item.rateCents, item.rateUnit, used, days);
    const cents = costCents == null ? suggested : costCents;
    posted = cents;
    postCost(db, actor, item, assignment.id, assignment.projectId, cents);
  }
  db.update(equipmentAssignments)
    .set({ checkedInAt: now, hours: item.rateUnit === "hour" ? used : hours })
    .where(and(eq(equipmentAssignments.id, assignment.id), eq(equipmentAssignments.orgId, actor.orgId)))
    .run();
  const addHours = item.rateUnit === "hour" ? used : item.serviceUnit === "hour" ? used : 0;
  db.update(equipment)
    .set({
      status: "available",
      locationKind: "yard",
      projectId: null,
      userId: null,
      hoursSinceService: item.hoursSinceService + addHours,
      updatedAt: now,
    })
    .where(and(eq(equipment.id, item.id), eq(equipment.orgId, actor.orgId)))
    .run();
  writeAudit(db, actor.orgId, actor.userId, "equipment.in", item.id, { assignmentId: assignment.id, posted });
  return { id: assignment.id };
}

export function checkIn(actor: Actor, input: { equipmentId: string; hours: number | null; costCents: number | null }) {
  assertCrew(actor);
  const db = getDb();
  const item = loadItem(db, actor.orgId, input.equipmentId);
  if (!item) throw new ServiceError("That equipment is not in the register.");
  const cents = money(actor) ? input.costCents : null;
  return closeAssignment(db, actor, item, input.hours, cents);
}

export function checkOut(
  actor: Actor,
  input: { equipmentId: string; projectId: string | null; userId: string | null; expectedReturn: string | null; transfer: boolean; hours: number | null; costCents: number | null },
) {
  assertCrew(actor);
  const db = getDb();
  const item = loadItem(db, actor.orgId, input.equipmentId);
  if (!item) throw new ServiceError("That equipment is not in the register.");
  if (BLOCKED.has(item.status)) throw new ServiceError(item.status === "in_service" ? "In service. Checkout is blocked." : "That item cannot be checked out.");
  const open = openAssignment(db, actor.orgId, item.id);
  if (open && !input.transfer) throw new ServiceError("This is already out. Transfer it.");
  const from = open ? open.toLabel : item.locationKind === "yard" ? "Yard" : placeLabel(projectName(db, actor.orgId, item.projectId), personName(db, item.userId));
  if (open && input.transfer) closeAssignment(db, actor, item, input.hours, money(actor) ? input.costCents : null);
  const fresh = loadItem(db, actor.orgId, item.id);
  if (!fresh) throw new ServiceError("That equipment is not in the register.");
  const projectId = input.projectId || null;
  const userId = input.userId || null;
  if (!projectId && !userId) throw new ServiceError("Assign a job or a person.");
  if (projectId && !db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get()) throw new ServiceError("That job is not in your company.");
  if (userId && !member(db, actor.orgId, userId)) throw new ServiceError("That person is not on the crew.");
  const job = projectName(db, actor.orgId, projectId);
  const person = personName(db, userId);
  const now = nowIso();
  const assignmentId = id("asn");
  db.insert(equipmentAssignments)
    .values({
      id: assignmentId,
      orgId: actor.orgId,
      equipmentId: fresh.id,
      projectId,
      userId,
      expectedReturn: dayOrNull(input.expectedReturn),
      checkedOutAt: now,
      checkedInAt: null,
      fromLabel: from,
      toLabel: placeLabel(job, person),
      hours: null,
      costCents: null,
      costItemId: null,
      costState: "",
      createdAt: now,
      createdBy: actor.userId,
    })
    .run();
  db.update(equipment)
    .set({
      status: projectId ? "on_job" : "with_person",
      locationKind: projectId ? "job" : "person",
      projectId,
      userId,
      updatedAt: now,
    })
    .where(and(eq(equipment.id, fresh.id), eq(equipment.orgId, actor.orgId)))
    .run();
  writeAudit(db, actor.orgId, actor.userId, input.transfer ? "equipment.transfer" : "equipment.out", fresh.id, { assignmentId, projectId, userId });
  return { id: assignmentId };
}

export function reverseEquipmentCost(actor: Actor, assignmentId: string) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot change equipment cost.");
  const db = getDb();
  const row = db.select().from(equipmentAssignments).where(and(eq(equipmentAssignments.id, assignmentId), eq(equipmentAssignments.orgId, actor.orgId))).get();
  if (!row || !row.costItemId || row.costState !== "posted") throw new ServiceError("There is no cost to reverse.");
  assertCostFree(db, actor.orgId, "equipment", row.costItemId);
  db.delete(costItems).where(and(eq(costItems.id, row.costItemId), eq(costItems.orgId, actor.orgId))).run();
  db.update(equipmentAssignments)
    .set({ costState: "reversed", costItemId: null, costCents: null })
    .where(and(eq(equipmentAssignments.id, row.id), eq(equipmentAssignments.orgId, actor.orgId)))
    .run();
  writeAudit(db, actor.orgId, actor.userId, "equipment.reverse", row.equipmentId, { assignmentId });
  return { id: row.id };
}

export function tagLogEquipment(actor: Actor, logId: string, equipmentIds: string[]) {
  assertCrew(actor);
  const db = getDb();
  const log = db.select().from(dailyLogs).where(and(eq(dailyLogs.id, logId), eq(dailyLogs.orgId, actor.orgId))).get();
  if (!log) throw new ServiceError("That log is not on this job.");
  const known = new Set(db.select().from(equipment).where(eq(equipment.orgId, actor.orgId)).all().map((row) => row.id));
  const unique = [...new Set(equipmentIds.map((value) => value.trim()).filter(Boolean))];
  for (const equipmentId of unique) {
    if (!known.has(equipmentId)) throw new ServiceError("That equipment is not in the register.");
  }
  db.delete(dailyLogEquipment).where(and(eq(dailyLogEquipment.orgId, actor.orgId), eq(dailyLogEquipment.logId, log.id))).run();
  const now = nowIso();
  for (const equipmentId of unique) {
    db.insert(dailyLogEquipment).values({ id: id("leq"), orgId: actor.orgId, logId: log.id, equipmentId, createdAt: now }).run();
    db.update(equipment)
      .set({ lastSeenProjectId: log.projectId, lastSeenAt: now, updatedAt: now })
      .where(and(eq(equipment.id, equipmentId), eq(equipment.orgId, actor.orgId)))
      .run();
  }
  return { count: unique.length };
}

export function logEquipmentIds(orgId: string, logId: string) {
  return getDb()
    .select()
    .from(dailyLogEquipment)
    .where(and(eq(dailyLogEquipment.orgId, orgId), eq(dailyLogEquipment.logId, logId)))
    .all()
    .map((row) => row.equipmentId);
}

export function jobEquipment(actor: Actor, projectId: string) {
  const db = getDb();
  const today = todayFor(actor.orgId);
  const onJob = db
    .select()
    .from(equipment)
    .where(and(eq(equipment.orgId, actor.orgId), eq(equipment.projectId, projectId)))
    .all()
    .map((item) => rowOf(db, item, today));
  const available = db
    .select()
    .from(equipment)
    .where(and(eq(equipment.orgId, actor.orgId), eq(equipment.status, "available")))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => ({ id: item.id, name: item.name }));
  return { onJob, available, canMove: canAddFieldNotes(actor.role as Role), showMoney: money(actor) };
}

export function fieldEquipment(actor: Actor) {
  const db = getDb();
  const today = todayFor(actor.orgId);
  const mine = db
    .select()
    .from(equipment)
    .where(and(eq(equipment.orgId, actor.orgId), eq(equipment.userId, actor.userId)))
    .all()
    .map((item) => rowOf(db, item, today));
  const available = db
    .select()
    .from(equipment)
    .where(and(eq(equipment.orgId, actor.orgId), eq(equipment.status, "available")))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => ({ id: item.id, name: item.name }));
  const jobs = db
    .select()
    .from(projects)
    .where(eq(projects.orgId, actor.orgId))
    .all()
    .filter((row) => row.status === "active")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => ({ id: row.id, name: row.name }));
  return { mine, available, jobs };
}

export function equipmentChoices(actor: Actor) {
  const db = getDb();
  const people = db
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const jobs = db
    .select()
    .from(projects)
    .where(eq(projects.orgId, actor.orgId))
    .all()
    .filter((row) => row.status === "active")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => ({ id: row.id, name: row.name }));
  const categories = [...new Set(db.select().from(equipment).where(eq(equipment.orgId, actor.orgId)).all().map((row) => row.category))].sort();
  return { people, jobs, categories };
}

export function equipmentForLog(actor: Actor) {
  return getDb()
    .select()
    .from(equipment)
    .where(eq(equipment.orgId, actor.orgId))
    .all()
    .filter((row) => row.status !== "retired")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => ({ id: row.id, name: row.name, tag: row.tag }));
}

export function labelItems(actor: Actor) {
  return getDb()
    .select()
    .from(equipment)
    .where(eq(equipment.orgId, actor.orgId))
    .all()
    .filter((row) => row.status !== "retired")
    .sort((a, b) => a.tag.localeCompare(b.tag) || a.name.localeCompare(b.name))
    .map((row) => ({ id: row.id, name: row.name, tag: row.tag }));
}
