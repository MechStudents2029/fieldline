import { and, eq } from "drizzle-orm";
import {
  assertMilestones,
  earnSlices,
  lineKey,
  priorSold,
  sliceDelta,
  type BasisKind,
  type JobFacts,
  type MilestoneKind,
  type PlanRate,
  type Slice,
} from "@/lib/commissions/math";
import type { AppDatabase } from "@/lib/db/client";
import {
  changeOrders,
  commissionLines,
  commissionPlanOverrides,
  commissionPlans,
  commissionSplits,
  costItems,
  invoices,
  memberships,
  payments,
  projects,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";

type Query = Pick<AppDatabase, "insert" | "select" | "update" | "delete">;
type Writer = Query & { transaction: AppDatabase["transaction"] };

type LineRow = typeof commissionLines.$inferSelect;

export type OwedTransition = { id: string; projectId: string; userId: string; earnedCents: number };

const OPEN = new Set(["draft", "owed"]);

function planRate(row: typeof commissionPlans.$inferSelect, overrides: { projectType: string; basis: string | null; rateBps: number }[]): PlanRate {
  const milestones = [
    { kind: "deposit" as const, shareBps: row.depositBps },
    { kind: "start" as const, shareBps: row.startBps },
    { kind: "completion" as const, shareBps: row.completionBps },
  ];
  assertMilestones(milestones);
  return {
    basis: row.basis === "gross_profit" ? "gross_profit" : "contract",
    rateBps: row.rateBps,
    milestones,
    overrides: overrides.map((item) => ({
      projectType: item.projectType,
      basis: item.basis === "gross_profit" || item.basis === "contract" ? item.basis : null,
      rateBps: item.rateBps,
    })),
  };
}

export function jobFacts(db: Query, orgId: string, projectId: string): { facts: JobFacts; latestPriceDeltaCents: number } | null {
  const project = db.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).get();
  if (!project) return null;
  const costs = db
    .select()
    .from(costItems)
    .where(and(eq(costItems.orgId, orgId), eq(costItems.projectId, projectId)))
    .all();
  const invoiceIds = new Set(
    db
      .select()
      .from(invoices)
      .where(and(eq(invoices.orgId, orgId), eq(invoices.projectId, projectId)))
      .all()
      .map((invoice) => invoice.id),
  );
  const collectedCents = db
    .select()
    .from(payments)
    .where(eq(payments.orgId, orgId))
    .all()
    .filter((payment) => payment.status === "succeeded" && invoiceIds.has(payment.invoiceId))
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  const approved = db
    .select()
    .from(changeOrders)
    .where(and(eq(changeOrders.orgId, orgId), eq(changeOrders.projectId, projectId)))
    .all()
    .filter((order) => order.status === "approved")
    .sort((a, b) => (b.approvedAt ?? "").localeCompare(a.approvedAt ?? "") || b.number - a.number);
  const started = project.status === "active" || project.status === "complete" || Boolean(project.startDate);
  return {
    facts: {
      soldCents: project.contractValueCents,
      jobCostCents: costs.length > 0 ? costs.reduce((sum, cost) => sum + cost.amountCents, 0) : null,
      collectedCents,
      started,
      complete: project.status === "complete",
      projectType: project.projectType,
    },
    latestPriceDeltaCents: approved[0]?.priceDeltaCents ?? 0,
  };
}

function plansFor(db: Query, orgId: string, userIds: string[]): Map<string, PlanRate> {
  const active = db
    .select()
    .from(commissionPlans)
    .where(eq(commissionPlans.orgId, orgId))
    .all()
    .filter((plan) => plan.status === "active");
  const overrides = db.select().from(commissionPlanOverrides).where(eq(commissionPlanOverrides.orgId, orgId)).all();
  const byPlan = new Map<string, typeof overrides>();
  for (const row of overrides) {
    const list = byPlan.get(row.planId) ?? [];
    list.push(row);
    byPlan.set(row.planId, list);
  }
  const userPlan = new Map(active.filter((plan) => plan.subject === "user" && plan.userId).map((plan) => [plan.userId as string, plan]));
  const rolePlan = new Map(active.filter((plan) => plan.subject === "role" && plan.role).map((plan) => [plan.role as string, plan]));
  const roles = new Map(
    db
      .select()
      .from(memberships)
      .where(eq(memberships.orgId, orgId))
      .all()
      .map((row) => [row.userId, row.role]),
  );
  const out = new Map<string, PlanRate>();
  for (const userId of userIds) {
    const row = userPlan.get(userId) ?? rolePlan.get(roles.get(userId) ?? "");
    if (!row) continue;
    out.set(userId, planRate(row, byPlan.get(row.id) ?? []));
  }
  return out;
}

function desired(db: Query, orgId: string, projectId: string): { slices: Slice[]; deltas: Map<string, number> } | null {
  const loaded = jobFacts(db, orgId, projectId);
  if (!loaded) return null;
  const splits = db
    .select()
    .from(commissionSplits)
    .where(and(eq(commissionSplits.orgId, orgId), eq(commissionSplits.projectId, projectId)))
    .all();
  const plans = plansFor(
    db,
    orgId,
    splits.map((split) => split.userId),
  );
  const shares = splits.map((split) => ({
    userId: split.userId,
    mode: split.mode === "fixed" ? ("fixed" as const) : ("percent" as const),
    shareBps: split.shareBps,
    shareCents: split.shareCents,
  }));
  const current = earnSlices(plans, shares, loaded.facts);
  const priorFacts: JobFacts = { ...loaded.facts, soldCents: priorSold(loaded.facts.soldCents, loaded.latestPriceDeltaCents) };
  const prior = earnSlices(plans, shares, priorFacts);
  return { slices: current.slices, deltas: sliceDelta(current.slices, prior.slices) };
}

function writeSlice(tx: Query, orgId: string, projectId: string, slice: Slice, deltaCents: number, rows: LineRow[], soldCents: number, stamp: string, owed: OwedTransition[]) {
  const keys = [lineKey(projectId, slice.userId, slice.milestone), `${lineKey(projectId, slice.userId, slice.milestone)}:adj`, `${lineKey(projectId, slice.userId, slice.milestone)}:adj2`];
  let remaining = slice.earnedCents;
  for (let index = 0; index < keys.length; index += 1) {
    const sourceKey = keys[index] ?? "";
    const row = rows.find((item) => item.sourceKey === sourceKey);
    if (row?.status === "void") return;
    if (!row) {
      if (remaining === 0 && index > 0) return;
      const status = remaining === 0 ? "draft" : "owed";
      const lineId = id("com");
      tx.insert(commissionLines)
        .values({
          id: lineId,
          orgId,
          projectId,
          userId: slice.userId,
          milestone: slice.milestone,
          sourceKey,
          basisCents: slice.basisCents,
          rateBps: slice.rateBps,
          earnedCents: remaining,
          deltaCents,
          soldCents,
          fallback: slice.fallback ? 1 : 0,
          status,
          paidAt: null,
          paidBy: null,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .run();
      if (status === "owed") owed.push({ id: lineId, projectId, userId: slice.userId, earnedCents: remaining });
      return;
    }
    if (row.status === "paid") {
      remaining -= row.earnedCents;
      continue;
    }
    const status = remaining === 0 ? "draft" : "owed";
    const unchanged =
      row.earnedCents === remaining &&
      row.status === status &&
      row.basisCents === slice.basisCents &&
      row.rateBps === slice.rateBps &&
      row.deltaCents === deltaCents &&
      row.soldCents === soldCents &&
      row.fallback === (slice.fallback ? 1 : 0);
    if (!unchanged) {
      tx.update(commissionLines)
        .set({
          basisCents: slice.basisCents,
          rateBps: slice.rateBps,
          earnedCents: remaining,
          deltaCents,
          soldCents,
          fallback: slice.fallback ? 1 : 0,
          status,
          updatedAt: stamp,
        })
        .where(and(eq(commissionLines.id, row.id), eq(commissionLines.orgId, orgId)))
        .run();
      if (status === "owed" && row.status !== "owed") owed.push({ id: row.id, projectId, userId: slice.userId, earnedCents: remaining });
    }
    return;
  }
}

/** Recompute one job. The same facts do not add a second line or change a paid amount. */
export function syncJob(db: Writer, orgId: string, projectId: string): { owedTransitions: OwedTransition[] } {
  return db.transaction((tx) => {
    const rows = tx.select().from(commissionLines).where(and(eq(commissionLines.orgId, orgId), eq(commissionLines.projectId, projectId))).all();
    const next = desired(tx, orgId, projectId);
    const owed: OwedTransition[] = [];
    const stamp = nowIso();
    const sold = tx.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).get()?.contractValueCents ?? 0;
    const keep = new Set((next?.slices ?? []).map((slice) => `${slice.userId}:${slice.milestone}`));
    for (const row of rows) {
      if (!keep.has(`${row.userId}:${row.milestone}`) && OPEN.has(row.status)) {
        tx.update(commissionLines)
          .set({ status: "void", updatedAt: stamp })
          .where(and(eq(commissionLines.id, row.id), eq(commissionLines.orgId, orgId)))
          .run();
      }
    }
    for (const slice of next?.slices ?? []) {
      writeSlice(tx, orgId, projectId, slice, next?.deltas.get(`${slice.userId}:${slice.milestone}`) ?? 0, rows, sold, stamp, owed);
    }
    return { owedTransitions: owed };
  });
}

export function syncOrg(db: Writer, orgId: string): OwedTransition[] {
  const projectIds = [
    ...new Set(
      db
        .select()
        .from(commissionSplits)
        .where(eq(commissionSplits.orgId, orgId))
        .all()
        .map((split) => split.projectId),
    ),
  ];
  const owed: OwedTransition[] = [];
  for (const projectId of projectIds) owed.push(...syncJob(db, orgId, projectId).owedTransitions);
  return owed;
}

export function rateLabel(basis: BasisKind, fallback: boolean): string {
  if (basis === "gross_profit" && !fallback) return "Gross profit";
  if (fallback) return "Contract, no job cost";
  return "Contract";
}

export type { MilestoneKind };
