import { and, eq } from "drizzle-orm";
import { jobFacts, syncJob, syncOrg, type OwedTransition } from "@/lib/commissions/apply";
import {
  SEATS,
  assertMilestones,
  assertSplits,
  earnSlices,
  percentToBps,
  priorSold,
  sliceDelta,
  type BasisKind,
  type MilestoneKind,
  type Seat,
  type SplitMode,
} from "@/lib/commissions/math";
import { getDb } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  commissionLines,
  commissionPlanOverrides,
  commissionPlans,
  commissionSplits,
  memberships,
  notifications,
  projects,
  users,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { formatMoney, parseMoneyToCents } from "@/lib/money";
import { canManageMoney, canManageSettings, canSeeMoney, type Role } from "@/lib/permissions";
import { emitAutomation } from "@/lib/services/automations";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";

const MILESTONE_LABEL: Record<string, string> = { deposit: "Deposit", start: "Start", completion: "Completion" };
const SEAT_LABEL: Record<string, string> = { setter: "Setter", consultant: "Consultant", manager: "Manager", other: "Other" };
const STATUS_LABEL: Record<string, string> = { draft: "Draft", owed: "Owed", paid: "Paid", void: "Void" };

function dbFor(orgId: string) {
  return officeDb(orgId) ?? getDb();
}

function settings(actor: Actor) {
  if (!canManageSettings(actor.role as Role)) throw new ServiceError("Only an owner or admin can change commissions.");
}

function moneyOffice(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Your role can view this, not change it.");
}

function audit(orgId: string, actorId: string | null, action: string, entityId: string, payload: Record<string, unknown>) {
  getDb()
    .insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "commission",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function noteOwed(orgId: string, projectId: string, transitions: OwedTransition[]) {
  if (transitions.length === 0) return;
  const db = getDb();
  const project = db.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).get();
  const name = project?.name || "Job";
  const owners = db
    .select()
    .from(memberships)
    .where(eq(memberships.orgId, orgId))
    .all()
    .filter((row) => row.role === "owner" || row.role === "admin");
  const stamp = nowIso();
  const existing = db
    .select()
    .from(notifications)
    .where(and(eq(notifications.orgId, orgId), eq(notifications.kind, "commission"), eq(notifications.projectId, projectId)))
    .all();
  for (const owner of owners) {
    if (existing.some((row) => row.userId === owner.userId && !row.readAt)) continue;
    db.insert(notifications)
      .values({
        id: id("note"),
        orgId,
        userId: owner.userId,
        kind: "commission",
        commentId: null,
        entityType: "commission_line",
        entityId: transitions[0]?.id ?? projectId,
        projectId,
        actorId: null,
        actorName: "Fieldline",
        snippet: `${name} · owed`,
        readAt: null,
        createdAt: stamp,
      })
      .run();
  }
  for (const line of transitions) {
    emitAutomation({
      orgId,
      kind: "commission_owed",
      recordType: "commission_line",
      recordId: line.id,
      recordLabel: name,
      projectId,
      amountCents: line.earnedCents,
    });
  }
}

export function syncJobCommissions(orgId: string, projectId: string) {
  const result = syncJob(getDb(), orgId, projectId);
  noteOwed(orgId, projectId, result.owedTransitions);
  return result;
}

function syncCompany(orgId: string) {
  const transitions = syncOrg(getDb(), orgId);
  const byJob = new Map<string, OwedTransition[]>();
  for (const row of transitions) {
    const list = byJob.get(row.projectId) ?? [];
    list.push(row);
    byJob.set(row.projectId, list);
  }
  for (const [projectId, rows] of byJob) noteOwed(orgId, projectId, rows);
}

export function commissionAttention(orgId: string) {
  syncCompany(orgId);
  const rows = getDb()
    .select()
    .from(commissionLines)
    .where(and(eq(commissionLines.orgId, orgId), eq(commissionLines.status, "owed")))
    .all();
  const cents = rows.reduce((sum, row) => sum + row.earnedCents, 0);
  return { count: rows.length, cents, href: rows.length > 0 ? "/commissions?status=owed" : null };
}

export type CommissionListRow = {
  id: string;
  person: string;
  userId: string;
  job: string;
  projectId: string;
  seat: string;
  milestone: string;
  basisCents: number;
  rateBps: number;
  earnedCents: number;
  deltaCents: number;
  fallback: boolean;
  status: string;
  statusLabel: string;
};

function visibleUser(actor: Actor): string | null {
  if (canSeeMoney(actor.role as Role)) return null;
  return actor.userId;
}

export function listCommissions(actor: Actor, filter: { status?: string; userId?: string; projectId?: string } = {}): CommissionListRow[] {
  const db = dbFor(actor.orgId);
  if (!db) return [];
  syncCompany(actor.orgId);
  const own = visibleUser(actor);
  const people = new Map(db.select().from(users).all().map((user) => [user.id, user.name]));
  const jobs = new Map(
    db
      .select()
      .from(projects)
      .where(eq(projects.orgId, actor.orgId))
      .all()
      .map((project) => [project.id, project.name]),
  );
  const seats = new Map(
    db
      .select()
      .from(commissionSplits)
      .where(eq(commissionSplits.orgId, actor.orgId))
      .all()
      .map((split) => [`${split.projectId}:${split.userId}`, SEAT_LABEL[split.seat] ?? split.seat]),
  );
  const status = filter.status ?? "";
  const userId = own ?? (filter.userId ?? "");
  return db
    .select()
    .from(commissionLines)
    .where(eq(commissionLines.orgId, actor.orgId))
    .all()
    .filter((row) => (own ? row.userId === own : true))
    .filter((row) => (userId ? row.userId === userId : true))
    .filter((row) => (filter.projectId ? row.projectId === filter.projectId : true))
    .filter((row) => {
      if (status === "all") return true;
      if (!status) return row.status !== "void";
      return row.status === status;
    })
    .map((row) => ({
      id: row.id,
      person: people.get(row.userId) ?? "Person",
      userId: row.userId,
      job: jobs.get(row.projectId) ?? "Job",
      projectId: row.projectId,
      seat: seats.get(`${row.projectId}:${row.userId}`) ?? "",
      milestone: MILESTONE_LABEL[row.milestone] ?? row.milestone,
      basisCents: row.basisCents,
      rateBps: row.rateBps,
      earnedCents: row.earnedCents,
      deltaCents: row.deltaCents,
      fallback: row.fallback === 1,
      status: row.status,
      statusLabel: STATUS_LABEL[row.status] ?? row.status,
    }))
    .sort((a, b) => a.person.localeCompare(b.person) || a.job.localeCompare(b.job) || a.milestone.localeCompare(b.milestone));
}

export function commissionCsv(actor: Actor, filter: { status?: string; userId?: string; projectId?: string } = {}): string | null {
  if (!dbFor(actor.orgId)) return null;
  const lines = ["Person,Job,Seat,Milestone,Basis,Rate,Earned,Delta,Status"];
  for (const row of listCommissions(actor, filter)) {
    const cells = [
      row.person,
      row.job,
      row.seat,
      row.milestone,
      formatMoney(row.basisCents),
      `${(row.rateBps / 100).toFixed(row.rateBps % 100 === 0 ? 0 : 1)}%`,
      formatMoney(row.earnedCents),
      formatMoney(row.deltaCents),
      row.statusLabel,
    ];
    lines.push(cells.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","));
  }
  return lines.join("\n");
}

export function commissionDetail(actor: Actor, lineId: string) {
  const row = listCommissions(actor, { status: "all" }).find((item) => item.id === lineId);
  if (!row) return null;
  return { ...row, canEdit: canManageSettings(actor.role as Role) && row.userId !== "" };
}

export function markCommission(actor: Actor, lineId: string, action: "paid" | "void") {
  settings(actor);
  const db = getDb();
  const row = db.select().from(commissionLines).where(and(eq(commissionLines.id, lineId), eq(commissionLines.orgId, actor.orgId))).get();
  if (!row) throw new ServiceError("Commission line not found.");
  const stamp = nowIso();
  if (action === "paid") {
    if (row.status !== "owed") throw new ServiceError("Only an owed line can be marked paid.");
    db.update(commissionLines)
      .set({ status: "paid", paidAt: stamp, paidBy: actor.userId, updatedAt: stamp })
      .where(and(eq(commissionLines.id, row.id), eq(commissionLines.orgId, actor.orgId)))
      .run();
    audit(actor.orgId, actor.userId, "commission.paid", row.id, { projectId: row.projectId, earnedCents: row.earnedCents });
    const project = db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, row.projectId))).get();
    emitAutomation({
      orgId: actor.orgId,
      kind: "commission_marked_paid",
      recordType: "commission_line",
      recordId: row.id,
      recordLabel: project?.name || "Job",
      projectId: row.projectId,
      amountCents: row.earnedCents,
    });
    return;
  }
  if (row.status === "void") throw new ServiceError("This line is already void.");
  db.update(commissionLines)
    .set({ status: "void", updatedAt: stamp })
    .where(and(eq(commissionLines.id, row.id), eq(commissionLines.orgId, actor.orgId)))
    .run();
  audit(actor.orgId, actor.userId, "commission.void", row.id, { projectId: row.projectId });
}

export type PlanBoardRow = {
  id: string;
  name: string;
  who: string;
  subject: string;
  basis: string;
  basisLabel: string;
  rateBps: number;
  deposit: number;
  start: number;
  completion: number;
  archived: boolean;
  overrides: { id: string; projectType: string; rateBps: number; basis: string | null }[];
};

export function commissionSettings(actor: Actor): { plans: PlanBoardRow[]; people: { id: string; name: string; role: string }[] } | null {
  if (!canManageSettings(actor.role as Role)) return null;
  const db = dbFor(actor.orgId);
  if (!db) return null;
  const people = db
    .select({ id: users.id, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, actor.orgId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const names = new Map(people.map((person) => [person.id, person.name]));
  const overrides = db.select().from(commissionPlanOverrides).where(eq(commissionPlanOverrides.orgId, actor.orgId)).all();
  const plans = db
    .select()
    .from(commissionPlans)
    .where(eq(commissionPlans.orgId, actor.orgId))
    .all()
    .map((plan) => ({
      id: plan.id,
      name: plan.name,
      who: plan.subject === "user" ? names.get(plan.userId ?? "") || "Person" : plan.role || "Role",
      subject: plan.subject,
      basis: plan.basis,
      basisLabel: plan.basis === "gross_profit" ? "Gross profit" : "Contract",
      rateBps: plan.rateBps,
      deposit: plan.depositBps / 100,
      start: plan.startBps / 100,
      completion: plan.completionBps / 100,
      archived: plan.status === "archived",
      overrides: overrides
        .filter((row) => row.planId === plan.id)
        .map((row) => ({ id: row.id, projectType: row.projectType, rateBps: row.rateBps, basis: row.basis })),
    }))
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
  return { plans, people };
}

function cleanBasis(raw: string): BasisKind {
  if (raw === "gross_profit") return "gross_profit";
  if (raw === "contract") return "contract";
  throw new ServiceError("Choose contract value or gross profit.");
}

export function saveCommissionPlan(
  actor: Actor,
  input: { name: string; subject: string; basis: string; rate: string; deposit: string; start: string; completion: string },
) {
  settings(actor);
  const name = input.name.trim().slice(0, 40);
  if (name.length < 2) throw new ServiceError("Name the plan.");
  const rateBps = percentToBps(input.rate);
  const depositBps = percentToBps(input.deposit);
  const startBps = percentToBps(input.start);
  const completionBps = percentToBps(input.completion);
  if (rateBps == null || depositBps == null || startBps == null || completionBps == null) throw new ServiceError("Enter the rate and milestone percents.");
  try {
    assertMilestones([
      { kind: "deposit", shareBps: depositBps },
      { kind: "start", shareBps: startBps },
      { kind: "completion", shareBps: completionBps },
    ]);
  } catch (error) {
    throw new ServiceError(error instanceof Error ? error.message : "Check the milestones.");
  }
  const basis = cleanBasis(input.basis);
  const db = getDb();
  const people = db.select().from(memberships).where(eq(memberships.orgId, actor.orgId)).all();
  let userId: string | null = null;
  let role: string | null = null;
  if (input.subject.startsWith("user:")) {
    userId = input.subject.slice(5);
    if (!people.some((person) => person.userId === userId)) throw new ServiceError("That person is not in this company.");
  } else if (input.subject.startsWith("role:")) {
    role = input.subject.slice(5);
    if (!people.some((person) => person.role === role)) throw new ServiceError("That role is not in this company.");
  } else throw new ServiceError("Choose a person or a role.");
  const active = db
    .select()
    .from(commissionPlans)
    .where(eq(commissionPlans.orgId, actor.orgId))
    .all()
    .filter((plan) => plan.status === "active");
  if (userId && active.some((plan) => plan.userId === userId)) throw new ServiceError("That person already has a plan.");
  if (role && active.some((plan) => plan.subject === "role" && plan.role === role)) throw new ServiceError("That role already has a plan.");
  const stamp = nowIso();
  const planId = id("cplan");
  db.insert(commissionPlans)
    .values({
      id: planId,
      orgId: actor.orgId,
      name,
      subject: userId ? "user" : "role",
      userId,
      role,
      basis,
      rateBps,
      depositBps,
      startBps,
      completionBps,
      status: "active",
      createdAt: stamp,
      updatedAt: stamp,
    })
    .run();
  audit(actor.orgId, actor.userId, "commission.plan", planId, { name, basis, rateBps });
  syncCompany(actor.orgId);
  return planId;
}

export function setPlanStatus(actor: Actor, planId: string, archived: boolean) {
  settings(actor);
  const db = getDb();
  const plan = db.select().from(commissionPlans).where(and(eq(commissionPlans.id, planId), eq(commissionPlans.orgId, actor.orgId))).get();
  if (!plan) throw new ServiceError("Plan not found.");
  db.update(commissionPlans)
    .set({ status: archived ? "archived" : "active", updatedAt: nowIso() })
    .where(and(eq(commissionPlans.id, plan.id), eq(commissionPlans.orgId, actor.orgId)))
    .run();
  audit(actor.orgId, actor.userId, archived ? "commission.archive" : "commission.restore", plan.id, { name: plan.name });
  syncCompany(actor.orgId);
}

export function savePlanOverride(actor: Actor, planId: string, projectType: string, rate: string) {
  settings(actor);
  const type = projectType.trim().slice(0, 40);
  if (type.length < 2) throw new ServiceError("Name the project type.");
  const rateBps = percentToBps(rate);
  if (rateBps == null) throw new ServiceError("Enter the override rate.");
  const db = getDb();
  const plan = db.select().from(commissionPlans).where(and(eq(commissionPlans.id, planId), eq(commissionPlans.orgId, actor.orgId))).get();
  if (!plan) throw new ServiceError("Plan not found.");
  const existing = db
    .select()
    .from(commissionPlanOverrides)
    .where(and(eq(commissionPlanOverrides.orgId, actor.orgId), eq(commissionPlanOverrides.planId, plan.id)))
    .all()
    .find((row) => row.projectType === type);
  const stamp = nowIso();
  if (existing) {
    db.update(commissionPlanOverrides)
      .set({ rateBps, updatedAt: stamp })
      .where(and(eq(commissionPlanOverrides.id, existing.id), eq(commissionPlanOverrides.orgId, actor.orgId)))
      .run();
  } else {
    db.insert(commissionPlanOverrides)
      .values({
        id: id("cpov"),
        orgId: actor.orgId,
        planId: plan.id,
        projectType: type,
        basis: null,
        rateBps,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .run();
  }
  audit(actor.orgId, actor.userId, "commission.override", plan.id, { projectType: type, rateBps });
  syncCompany(actor.orgId);
}

export type JobCommission = {
  projectId: string;
  name: string;
  projectType: string;
  soldCents: number;
  collectedCents: number;
  jobCostCents: number | null;
  remainderLabel: string;
  deltaCents: number;
  fallback: boolean;
  capped: boolean;
  mode: SplitMode;
  canEdit: boolean;
  seeMoney: boolean;
  people: { id: string; name: string }[];
  splits: { userId: string; seat: Seat; share: string }[];
  lines: CommissionListRow[];
};

export function jobCommission(actor: Actor, projectId: string): JobCommission | null {
  const db = dbFor(actor.orgId);
  if (!db) return null;
  const project = db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, projectId))).get();
  if (!project) return null;
  const seeMoney = canSeeMoney(actor.role as Role);
  if (!seeMoney) {
    const mine = db
      .select()
      .from(commissionSplits)
      .where(and(eq(commissionSplits.orgId, actor.orgId), eq(commissionSplits.projectId, projectId), eq(commissionSplits.userId, actor.userId)))
      .get();
    if (!mine) return null;
  }
  syncJobCommissions(actor.orgId, projectId);
  const loaded = jobFacts(getDb(), actor.orgId, projectId);
  if (!loaded) return null;
  const splits = getDb()
    .select()
    .from(commissionSplits)
    .where(and(eq(commissionSplits.orgId, actor.orgId), eq(commissionSplits.projectId, projectId)))
    .all();
  const people = db
    .select({ id: users.id, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, actor.orgId))
    .all();
  const active = getDb()
    .select()
    .from(commissionPlans)
    .where(eq(commissionPlans.orgId, actor.orgId))
    .all()
    .filter((plan) => plan.status === "active");
  const overrides = getDb().select().from(commissionPlanOverrides).where(eq(commissionPlanOverrides.orgId, actor.orgId)).all();
  const plans = new Map();
  for (const person of people) {
    const row = active.find((plan) => plan.subject === "user" && plan.userId === person.id) ?? active.find((plan) => plan.subject === "role" && plan.role === person.role);
    if (!row) continue;
    plans.set(person.id, {
      basis: row.basis === "gross_profit" ? "gross_profit" : "contract",
      rateBps: row.rateBps,
      milestones: [
        { kind: "deposit" as const, shareBps: row.depositBps },
        { kind: "start" as const, shareBps: row.startBps },
        { kind: "completion" as const, shareBps: row.completionBps },
      ],
      overrides: overrides
        .filter((item) => item.planId === row.id)
        .map((item) => ({
          projectType: item.projectType,
          basis: item.basis === "gross_profit" || item.basis === "contract" ? (item.basis as BasisKind) : null,
          rateBps: item.rateBps,
        })),
    });
  }
  const shares = splits.map((split) => ({
    userId: split.userId,
    mode: split.mode === "fixed" ? ("fixed" as const) : ("percent" as const),
    shareBps: split.shareBps,
    shareCents: split.shareCents,
  }));
  let remainderLabel = "Unassigned 100%";
  let deltaCents = 0;
  let fallback = false;
  let capped = false;
  if (shares.length > 0) {
    const current = earnSlices(plans, shares, loaded.facts);
    const prior = earnSlices(plans, shares, { ...loaded.facts, soldCents: priorSold(loaded.facts.soldCents, loaded.latestPriceDeltaCents) });
    deltaCents = [...sliceDelta(current.slices, prior.slices).values()].reduce((sum, value) => sum + value, 0);
    fallback = current.slices.some((slice) => slice.fallback);
    capped = current.capped;
    if (current.remainderBps != null) remainderLabel = `Unassigned ${current.remainderBps / 100}%`;
    else if (current.remainderCents != null) remainderLabel = `Unassigned ${formatMoney(current.remainderCents)}`;
    else remainderLabel = "Unassigned";
  }
  const mode: SplitMode = splits[0]?.mode === "fixed" ? "fixed" : "percent";
  const lines = listCommissions(actor, { projectId, status: "all" }).filter((row) => row.status !== "void" || canSeeMoney(actor.role as Role));
  return {
    projectId,
    name: project.name,
    projectType: project.projectType ?? "",
    soldCents: loaded.facts.soldCents,
    collectedCents: loaded.facts.collectedCents,
    jobCostCents: loaded.facts.jobCostCents,
    remainderLabel,
    deltaCents,
    fallback,
    capped,
    mode,
    canEdit: canManageMoney(actor.role as Role),
    seeMoney,
    people: people.map((person) => ({ id: person.id, name: person.name })).sort((a, b) => a.name.localeCompare(b.name)),
    splits: splits.map((split) => ({
      userId: split.userId,
      seat: (SEATS as readonly string[]).includes(split.seat) ? (split.seat as Seat) : "other",
      share: mode === "fixed" ? (split.shareCents / 100).toFixed(split.shareCents % 100 === 0 ? 0 : 2) : String(split.shareBps / 100),
    })),
    lines: ownLines(actor, lines).filter((row) => row.status !== "void"),
  };
}

function ownLines(actor: Actor, lines: CommissionListRow[]) {
  if (canSeeMoney(actor.role as Role)) return lines;
  return lines.filter((row) => row.userId === actor.userId);
}

export function saveJobSplits(
  actor: Actor,
  projectId: string,
  input: { projectType: string; mode: string; rows: { userId: string; seat: string; share: string }[] },
) {
  moneyOffice(actor);
  const db = getDb();
  const project = db.select().from(projects).where(and(eq(projects.orgId, actor.orgId), eq(projects.id, projectId))).get();
  if (!project) throw new ServiceError("Job not found.");
  const mode: SplitMode = input.mode === "fixed" ? "fixed" : input.mode === "percent" ? "percent" : (() => { throw new ServiceError("Choose percent or fixed."); })();
  const people = new Set(db.select().from(memberships).where(eq(memberships.orgId, actor.orgId)).all().map((row) => row.userId));
  const cleaned = input.rows
    .map((row) => ({ userId: row.userId.trim(), seat: row.seat.trim(), share: row.share.trim() }))
    .filter((row) => row.userId || row.share);
  const shares = cleaned.map((row) => {
    if (!people.has(row.userId)) throw new ServiceError("That person is not in this company.");
    if (!(SEATS as readonly string[]).includes(row.seat)) throw new ServiceError("Choose a seat.");
    if (mode === "percent") {
      const shareBps = percentToBps(row.share);
      if (shareBps == null) throw new ServiceError("Enter the percent.");
      return { userId: row.userId, mode, shareBps, shareCents: 0, seat: row.seat as Seat };
    }
    const shareCents = parseMoneyToCents(row.share);
    if (shareCents == null) throw new ServiceError("Enter the share in dollars.");
    return { userId: row.userId, mode, shareBps: 0, shareCents, seat: row.seat as Seat };
  });
  try {
    assertSplits(shares);
  } catch (error) {
    throw new ServiceError(error instanceof Error ? error.message : "Check the splits.");
  }
  const projectType = input.projectType.trim().slice(0, 40);
  const stamp = nowIso();
  db.transaction((tx) => {
    tx.update(projects)
      .set({ projectType: projectType || null, updatedAt: stamp })
      .where(and(eq(projects.id, project.id), eq(projects.orgId, actor.orgId)))
      .run();
    tx.delete(commissionSplits)
      .where(and(eq(commissionSplits.orgId, actor.orgId), eq(commissionSplits.projectId, project.id)))
      .run();
    for (const share of shares) {
      tx.insert(commissionSplits)
        .values({
          id: id("csplit"),
          orgId: actor.orgId,
          projectId: project.id,
          userId: share.userId,
          seat: share.seat,
          mode: share.mode,
          shareBps: share.shareBps,
          shareCents: share.shareCents,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .run();
    }
  });
  audit(actor.orgId, actor.userId, "commission.splits", project.id, { count: shares.length, mode, projectType });
  syncJobCommissions(actor.orgId, project.id);
}

export function milestoneName(kind: string): string {
  return MILESTONE_LABEL[kind] ?? kind;
}

export type { MilestoneKind };
