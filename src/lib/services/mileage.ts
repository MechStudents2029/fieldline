import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { auditLogs, memberships, mileageRates, mileageTrips, organizations, projects, users } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import {
  formatMiles,
  formatRate,
  isMileageStatus,
  isWaitingTrip,
  mileageCents,
  mileageStatusLabel,
  milesFromOdometer,
  parseMilesToMilli,
  parseReadingToMilli,
  periodsOverlap,
  rateForDate,
  validDay,
  type MileageStatus,
  type RatePeriod,
} from "@/lib/mileage/rate";
import { canManageMoney, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { localDay } from "@/lib/time/calendar";

export type TripInput = {
  userId?: string;
  projectId?: string | null;
  tripOn: string;
  startRaw?: string;
  endRaw?: string;
  milesRaw?: string;
  fromText?: string;
  toText?: string;
  purpose: string;
  business: boolean;
};

export type MileageListRow = {
  id: string;
  userId: string;
  personName: string;
  projectId: string | null;
  projectName: string | null;
  tripOn: string;
  milesMilli: number;
  milesLabel: string;
  fromText: string | null;
  toText: string | null;
  purpose: string;
  business: boolean;
  status: MileageStatus;
  statusLabel: string;
  amountCents: number;
  rateDeciCents: number | null;
  irsDeciCents: number | null;
  rateLabel: string;
  reimbursedAt: string | null;
  reimbursedByName: string | null;
  rejectNote: string | null;
  snapshotted: boolean;
};

export type MileageFilters = {
  personId?: string | null;
  projectId?: string | null;
  from?: string | null;
  to?: string | null;
  status?: string | null;
};

type TripRow = typeof mileageTrips.$inferSelect;

function roleOf(actor: Actor): Role {
  return actor.role;
}

function assertLog(actor: Actor) {
  if (roleOf(actor) === "viewer") throw new ServiceError("Your role cannot log a trip.");
}

function assertOffice(actor: Actor) {
  if (!canManageMoney(roleOf(actor))) throw new ServiceError("Mileage is approved in the office.");
}

function orgToday(orgId: string) {
  const org = getDb().select().from(organizations).where(eq(organizations.id, orgId)).get();
  return localDay(Date.now(), org?.timeZone || "America/New_York");
}

function namesFor(orgId: string) {
  const db = getDb();
  const people = db
    .select({ userId: memberships.userId, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all();
  const jobs = db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, orgId)).all();
  return {
    people: new Map(people.map((row) => [row.userId, row.name])),
    jobs: new Map(jobs.map((row) => [row.id, row.name])),
  };
}

function loadPeriods(orgId: string): RatePeriod[] {
  return getDb()
    .select()
    .from(mileageRates)
    .where(eq(mileageRates.orgId, orgId))
    .all()
    .map((row) => ({
      id: row.id,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      rateDeciCents: row.rateDeciCents,
      irsDeciCents: row.irsDeciCents,
    }));
}

function loadTrips(orgId: string) {
  return getDb().select().from(mileageTrips).where(eq(mileageTrips.orgId, orgId)).all();
}

function visibleTrips(actor: Actor) {
  const rows = loadTrips(actor.orgId);
  if (roleOf(actor) === "field") return rows.filter((row) => row.userId === actor.userId);
  return rows;
}

function moneyFor(row: TripRow, periods: RatePeriod[]) {
  const closed = row.status === "approved" || row.status === "reimbursed";
  if (!row.business) return { amountCents: 0, rateDeciCents: null as number | null, irsDeciCents: null as number | null, snapshotted: false };
  if (closed && row.amountCents != null && row.rateDeciCents != null) {
    return { amountCents: row.amountCents, rateDeciCents: row.rateDeciCents, irsDeciCents: row.irsDeciCents, snapshotted: true };
  }
  const period = rateForDate(periods, row.tripOn);
  if (!period) return { amountCents: 0, rateDeciCents: null, irsDeciCents: null, snapshotted: false };
  return {
    amountCents: mileageCents(row.milesMilli, period.rateDeciCents),
    rateDeciCents: period.rateDeciCents,
    irsDeciCents: period.irsDeciCents,
    snapshotted: false,
  };
}

function toList(orgId: string, rows: TripRow[]): MileageListRow[] {
  const names = namesFor(orgId);
  const periods = loadPeriods(orgId);
  return rows
    .map((row) => {
      const status = (isMileageStatus(row.status) ? row.status : "draft") as MileageStatus;
      const money = moneyFor(row, periods);
      return {
        id: row.id,
        userId: row.userId,
        personName: names.people.get(row.userId) ?? "Crew",
        projectId: row.projectId,
        projectName: row.projectId ? (names.jobs.get(row.projectId) ?? null) : null,
        tripOn: row.tripOn,
        milesMilli: row.milesMilli,
        milesLabel: formatMiles(row.milesMilli),
        fromText: row.fromText,
        toText: row.toText,
        purpose: row.purpose,
        business: row.business === 1,
        status,
        statusLabel: mileageStatusLabel(status),
        amountCents: money.amountCents,
        rateDeciCents: money.rateDeciCents,
        irsDeciCents: money.irsDeciCents,
        rateLabel: money.rateDeciCents == null ? "" : formatRate(money.rateDeciCents),
        reimbursedAt: row.reimbursedAt,
        reimbursedByName: row.reimbursedBy ? (names.people.get(row.reimbursedBy) ?? null) : null,
        rejectNote: row.rejectNote,
        snapshotted: money.snapshotted,
      };
    })
    .sort((a, b) => b.tripOn.localeCompare(a.tripOn) || b.id.localeCompare(a.id));
}

function audit(actor: Actor, action: string, entityId: string, payload: Record<string, unknown>) {
  getDb()
    .insert(auditLogs)
    .values({
      id: id("audit"),
      orgId: actor.orgId,
      actorId: actor.userId,
      action,
      entityType: action === "mileage.rate" ? "mileage_rate" : "mileage_trip",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function cleanPlace(value: string | undefined, label: string) {
  const text = (value ?? "").trim();
  if (text.length > 120) throw new ServiceError(`Keep the ${label} under 120 characters.`);
  return text || null;
}

function cleanPurpose(value: string) {
  const text = value.trim();
  if (!text) throw new ServiceError("Enter a purpose.");
  if (text.length > 240) throw new ServiceError("Keep the purpose under 240 characters.");
  return text;
}

function resolveMiles(input: TripInput) {
  const startText = (input.startRaw ?? "").trim();
  const endText = (input.endRaw ?? "").trim();
  const milesText = (input.milesRaw ?? "").trim();
  const start = startText ? parseReadingToMilli(startText) : null;
  const end = endText ? parseReadingToMilli(endText) : null;
  if (startText && start == null) throw new ServiceError("Start reading is not a number.");
  if (endText && end == null) throw new ServiceError("End reading is not a number.");
  if ((start == null) !== (end == null)) throw new ServiceError("Enter both odometer readings.");
  if (start != null && end != null) {
    if (milesText) throw new ServiceError("Use odometer or miles, not both.");
    const miles = milesFromOdometer(start, end);
    if ("error" in miles) throw new ServiceError(miles.error);
    return { startMilli: start, endMilli: end, milesMilli: miles.milesMilli };
  }
  const milesMilli = parseMilesToMilli(milesText);
  if (milesMilli == null) throw new ServiceError("Enter miles or both odometer readings.");
  return { startMilli: null, endMilli: null, milesMilli };
}

function assertDay(value: string) {
  if (!validDay(value)) throw new ServiceError("Enter a date.");
  return value;
}

function assertProject(orgId: string, projectId: string | null | undefined) {
  const idValue = (projectId ?? "").trim();
  if (!idValue) return null;
  const row = getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, idValue), eq(projects.orgId, orgId)))
    .get();
  if (!row) throw new ServiceError("Job not found.");
  return row.id;
}

function assertPerson(actor: Actor, requested: string | undefined) {
  const names = namesFor(actor.orgId);
  const userId = canManageMoney(roleOf(actor)) ? (requested || "").trim() || actor.userId : actor.userId;
  if (!names.people.has(userId)) throw new ServiceError("Person not found.");
  return userId;
}

function requireTrip(actor: Actor, tripId: string) {
  const row = getDb()
    .select()
    .from(mileageTrips)
    .where(and(eq(mileageTrips.id, tripId), eq(mileageTrips.orgId, actor.orgId)))
    .get();
  if (!row) throw new ServiceError("Trip not found.");
  if (roleOf(actor) === "field" && row.userId !== actor.userId) throw new ServiceError("Trip not found.");
  return row;
}

function canEditRow(actor: Actor, row: TripRow) {
  if (row.status !== "draft" && row.status !== "submitted") return false;
  if (canManageMoney(roleOf(actor))) return true;
  return roleOf(actor) !== "viewer" && row.userId === actor.userId;
}

export function mileageJobs(orgId: string) {
  return getDb()
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function mileagePeople(actor: Actor) {
  const names = namesFor(actor.orgId);
  if (roleOf(actor) === "field") {
    return [{ id: actor.userId, name: names.people.get(actor.userId) ?? actor.name }];
  }
  return [...names.people.entries()]
    .map(([personId, name]) => ({ id: personId, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function listMileageRates(actor: Actor) {
  const rows = loadPeriods(actor.orgId).sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.id.localeCompare(b.id));
  return {
    periods: rows.map((row) => ({ ...row, rateLabel: formatRate(row.rateDeciCents), irsLabel: formatRate(row.irsDeciCents) })),
    canEdit: canManageMoney(roleOf(actor)),
  };
}

export function listMileageTrips(actor: Actor, filters: MileageFilters = {}): MileageListRow[] {
  let rows = visibleTrips(actor);
  const personId = (filters.personId ?? "").trim();
  if (personId && roleOf(actor) !== "field") rows = rows.filter((row) => row.userId === personId);
  const projectId = (filters.projectId ?? "").trim();
  if (projectId) rows = rows.filter((row) => row.projectId === projectId);
  const from = (filters.from ?? "").trim();
  const to = (filters.to ?? "").trim();
  if (from && validDay(from)) rows = rows.filter((row) => row.tripOn >= from);
  if (to && validDay(to)) rows = rows.filter((row) => row.tripOn <= to);
  const status = (filters.status ?? "").trim();
  if (status && isMileageStatus(status)) rows = rows.filter((row) => row.status === status);
  return toList(actor.orgId, rows);
}

export function mileageDetail(actor: Actor, tripId: string) {
  const row = requireTrip(actor, tripId);
  const listed = toList(actor.orgId, [row])[0];
  if (!listed) throw new ServiceError("Trip not found.");
  const office = canManageMoney(roleOf(actor));
  return {
    ...listed,
    startMilli: row.startMilli,
    endMilli: row.endMilli,
    startLabel: row.startMilli == null ? "" : formatMiles(row.startMilli),
    endLabel: row.endMilli == null ? "" : formatMiles(row.endMilli),
    submittedAt: row.submittedAt,
    approvedAt: row.approvedAt,
    rejectedAt: row.rejectedAt,
    reimbursedBy: row.reimbursedBy,
    canEdit: canEditRow(actor, row),
    canSubmit: canEditRow(actor, row) && row.status === "draft",
    canApprove: office && row.status === "submitted" && row.business === 1,
    canReject: office && row.status === "submitted",
    canReimburse: office && row.status === "approved" && row.business === 1 && !row.reimbursedAt,
  };
}

export function createMileageTrip(actor: Actor, input: TripInput & { submit?: boolean }) {
  assertLog(actor);
  const tripOn = assertDay(input.tripOn.trim());
  const purpose = cleanPurpose(input.purpose);
  const miles = resolveMiles(input);
  const userId = assertPerson(actor, input.userId);
  const projectId = assertProject(actor.orgId, input.projectId);
  const now = nowIso();
  const submit = Boolean(input.submit);
  const tripId = id("mt");
  getDb()
    .insert(mileageTrips)
    .values({
      id: tripId,
      orgId: actor.orgId,
      userId,
      projectId,
      tripOn,
      startMilli: miles.startMilli,
      endMilli: miles.endMilli,
      milesMilli: miles.milesMilli,
      fromText: cleanPlace(input.fromText, "from"),
      toText: cleanPlace(input.toText, "to"),
      purpose,
      business: input.business ? 1 : 0,
      status: submit ? "submitted" : "draft",
      rateDeciCents: null,
      irsDeciCents: null,
      amountCents: null,
      rejectNote: null,
      submittedAt: submit ? now : null,
      approvedAt: null,
      rejectedAt: null,
      reimbursedAt: null,
      reimbursedBy: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
    })
    .run();
  audit(actor, "mileage.create", tripId, { tripOn, milesMilli: miles.milesMilli, business: input.business ? 1 : 0, status: submit ? "submitted" : "draft" });
  if (submit) audit(actor, "mileage.submit", tripId, { tripOn });
  return { id: tripId };
}

export function editMileageTrip(actor: Actor, tripId: string, input: TripInput) {
  const row = requireTrip(actor, tripId);
  if (!canEditRow(actor, row)) throw new ServiceError("That trip can no longer be edited.");
  const tripOn = assertDay(input.tripOn.trim());
  const purpose = cleanPurpose(input.purpose);
  const miles = resolveMiles(input);
  const userId = canManageMoney(roleOf(actor)) ? assertPerson(actor, input.userId) : row.userId;
  const projectId = assertProject(actor.orgId, input.projectId);
  const now = nowIso();
  getDb()
    .update(mileageTrips)
    .set({
      userId,
      projectId,
      tripOn,
      startMilli: miles.startMilli,
      endMilli: miles.endMilli,
      milesMilli: miles.milesMilli,
      fromText: cleanPlace(input.fromText, "from"),
      toText: cleanPlace(input.toText, "to"),
      purpose,
      business: input.business ? 1 : 0,
      updatedAt: now,
    })
    .where(and(eq(mileageTrips.id, row.id), eq(mileageTrips.orgId, actor.orgId)))
    .run();
  audit(actor, "mileage.edit", row.id, { tripOn, milesMilli: miles.milesMilli, business: input.business ? 1 : 0 });
  return { id: row.id };
}

export function submitMileageTrip(actor: Actor, tripId: string) {
  const row = requireTrip(actor, tripId);
  if (!canEditRow(actor, row)) throw new ServiceError("That trip can no longer be edited.");
  if (row.status !== "draft") throw new ServiceError("That trip is already submitted.");
  const now = nowIso();
  getDb()
    .update(mileageTrips)
    .set({ status: "submitted", submittedAt: now, updatedAt: now })
    .where(and(eq(mileageTrips.id, row.id), eq(mileageTrips.orgId, actor.orgId)))
    .run();
  audit(actor, "mileage.submit", row.id, { tripOn: row.tripOn });
  return { id: row.id };
}

export function approveMileageTrip(actor: Actor, tripId: string) {
  assertOffice(actor);
  const row = requireTrip(actor, tripId);
  if (row.status !== "submitted") throw new ServiceError("That trip is not waiting.");
  if (row.business !== 1) throw new ServiceError("Personal miles are not reimbursed.");
  const period = rateForDate(loadPeriods(actor.orgId), row.tripOn);
  if (!period) throw new ServiceError("No rate covers that date.");
  const amountCents = mileageCents(row.milesMilli, period.rateDeciCents);
  const now = nowIso();
  getDb()
    .update(mileageTrips)
    .set({
      status: "approved",
      rateDeciCents: period.rateDeciCents,
      irsDeciCents: period.irsDeciCents,
      amountCents,
      approvedAt: now,
      updatedAt: now,
    })
    .where(and(eq(mileageTrips.id, row.id), eq(mileageTrips.orgId, actor.orgId)))
    .run();
  audit(actor, "mileage.approve", row.id, { amountCents, rateDeciCents: period.rateDeciCents, irsDeciCents: period.irsDeciCents, milesMilli: row.milesMilli });
  return { id: row.id, amountCents };
}

export function rejectMileageTrip(actor: Actor, tripId: string, note: string) {
  assertOffice(actor);
  const row = requireTrip(actor, tripId);
  if (row.status !== "submitted") throw new ServiceError("That trip is not waiting.");
  const rejectNote = note.trim();
  if (!rejectNote) throw new ServiceError("Add a note.");
  if (rejectNote.length > 500) throw new ServiceError("Keep the note under 500 characters.");
  const now = nowIso();
  getDb()
    .update(mileageTrips)
    .set({ status: "rejected", rejectNote, rejectedAt: now, updatedAt: now })
    .where(and(eq(mileageTrips.id, row.id), eq(mileageTrips.orgId, actor.orgId)))
    .run();
  audit(actor, "mileage.reject", row.id, { rejectNote });
  return { id: row.id };
}

export function markMileageReimbursed(actor: Actor, tripId: string) {
  assertOffice(actor);
  const row = requireTrip(actor, tripId);
  if (row.status !== "approved" || row.business !== 1 || row.reimbursedAt) {
    throw new ServiceError("That trip is not waiting on reimbursement.");
  }
  const now = nowIso();
  getDb()
    .update(mileageTrips)
    .set({ status: "reimbursed", reimbursedAt: now, reimbursedBy: actor.userId, updatedAt: now })
    .where(and(eq(mileageTrips.id, row.id), eq(mileageTrips.orgId, actor.orgId)))
    .run();
  audit(actor, "mileage.reimburse", row.id, { reimbursedAt: now, amountCents: row.amountCents });
  return { id: row.id, reimbursedAt: now };
}

export type RateInput = {
  id?: string;
  startsOn: string;
  endsOn: string;
  rateDeciCents: number;
  irsDeciCents: number;
};

export function saveMileageRates(actor: Actor, input: RateInput[]) {
  assertOffice(actor);
  if (input.length === 0) throw new ServiceError("Add a rate period.");
  const periods = input.map((row) => {
    const startsOn = row.startsOn.trim();
    const endsOn = row.endsOn.trim();
    if (!validDay(startsOn) || !validDay(endsOn)) throw new ServiceError("Enter a date.");
    if (endsOn < startsOn) throw new ServiceError("End is before the start.");
    if (!Number.isInteger(row.rateDeciCents) || row.rateDeciCents <= 0) throw new ServiceError("Enter a rate.");
    if (!Number.isInteger(row.irsDeciCents) || row.irsDeciCents <= 0) throw new ServiceError("Enter the IRS rate.");
    return { id: (row.id ?? "").trim() || id("mr"), startsOn, endsOn, rateDeciCents: row.rateDeciCents, irsDeciCents: row.irsDeciCents };
  });
  if (periodsOverlap(periods)) throw new ServiceError("Those dates overlap.");
  const now = nowIso();
  const db = getDb();
  db.delete(mileageRates).where(eq(mileageRates.orgId, actor.orgId)).run();
  db.insert(mileageRates)
    .values(
      periods.map((row) => ({
        id: row.id,
        orgId: actor.orgId,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        rateDeciCents: row.rateDeciCents,
        irsDeciCents: row.irsDeciCents,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run();
  audit(actor, "mileage.rate", actor.orgId, { periods: periods.map((row) => ({ startsOn: row.startsOn, endsOn: row.endsOn, rateDeciCents: row.rateDeciCents, irsDeciCents: row.irsDeciCents })) });
  return { count: periods.length };
}

export function mileageAttention(actor: Actor): { count: number; href: string | null } {
  const today = orgToday(actor.orgId);
  const org = getDb().select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  const timeZone = org?.timeZone || "America/New_York";
  const count = visibleTrips(actor).filter((row) => isWaitingTrip(row.status, row.submittedAt ? localDay(Date.parse(row.submittedAt), timeZone) : null, today)).length;
  return { count, href: count > 0 ? "/mileage?status=submitted" : null };
}

export type MileageOwedLine = MileageListRow;

export function mileageOwed(actor: Actor) {
  const lines = listMileageTrips(actor).filter((row) => row.business && (row.status === "approved" || row.status === "reimbursed"));
  const grouped = new Map<string, { userId: string; name: string; openCents: number; reimbursedCents: number }>();
  for (const row of lines) {
    const current = grouped.get(row.userId) ?? { userId: row.userId, name: row.personName, openCents: 0, reimbursedCents: 0 };
    if (row.status === "reimbursed") current.reimbursedCents += row.amountCents;
    else current.openCents += row.amountCents;
    grouped.set(row.userId, current);
  }
  const totals = [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
  return {
    lines,
    totals,
    openCents: totals.reduce((sum, row) => sum + row.openCents, 0),
    canMark: canManageMoney(roleOf(actor)),
  };
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

export function mileageCsv(actor: Actor) {
  const board = mileageOwed(actor);
  const header = ["Person", "Date", "Miles", "Rate", "Amount", "Job", "Purpose", "Status", "Reimbursed"];
  const body = board.lines.map((row) =>
    [row.personName, row.tripOn, row.milesLabel, row.rateLabel, (row.amountCents / 100).toFixed(2), row.projectName ?? "", row.purpose, row.statusLabel, row.reimbursedAt ? row.reimbursedAt.slice(0, 10) : ""]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...body].join("\n");
}
