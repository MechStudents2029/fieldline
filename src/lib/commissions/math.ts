/** Commission math. Money is integer cents. Rates and milestone shares are basis points. */

export const MILESTONES = ["deposit", "start", "completion"] as const;
export type MilestoneKind = (typeof MILESTONES)[number];
export const SEATS = ["setter", "consultant", "manager", "other"] as const;
export type Seat = (typeof SEATS)[number];
export type BasisKind = "contract" | "gross_profit";
export type SplitMode = "percent" | "fixed";

export type MilestoneRule = { kind: MilestoneKind; shareBps: number };

export type PlanRate = {
  basis: BasisKind;
  rateBps: number;
  overrides: { projectType: string; basis: BasisKind | null; rateBps: number }[];
  milestones: MilestoneRule[];
};

export type SplitShare = {
  userId: string;
  mode: SplitMode;
  shareBps: number;
  shareCents: number;
};

export type JobFacts = {
  soldCents: number;
  jobCostCents: number | null;
  collectedCents: number;
  started: boolean;
  complete: boolean;
  projectType: string | null;
};

export type Slice = {
  userId: string;
  milestone: MilestoneKind;
  basisCents: number;
  rateBps: number;
  earnedCents: number;
  fallback: boolean;
};

const MAX_BPS = 10_000;

export function percentToBps(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,3}(\.\d)?$/.test(trimmed)) return null;
  const bps = Math.round(Number(trimmed) * 100);
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_BPS) return null;
  return bps;
}

export function assertMilestones(rules: MilestoneRule[]) {
  if (rules.length !== MILESTONES.length) throw new Error("Deposit, start, and completion are required.");
  const seen = new Set<string>();
  let sum = 0;
  for (const rule of rules) {
    if (!MILESTONES.includes(rule.kind)) throw new Error("Unknown milestone.");
    if (seen.has(rule.kind)) throw new Error("Each milestone is listed once.");
    if (!Number.isInteger(rule.shareBps) || rule.shareBps < 0 || rule.shareBps > MAX_BPS) throw new Error("Milestone share is out of range.");
    seen.add(rule.kind);
    sum += rule.shareBps;
  }
  if (sum !== MAX_BPS) throw new Error("Milestone shares must add to 100%.");
}

export function assertSplits(splits: SplitShare[]) {
  if (splits.length === 0) return;
  if (new Set(splits.map((split) => split.userId)).size !== splits.length) throw new Error("A person is on this job twice.");
  const mode = splits[0]?.mode;
  if (!mode || splits.some((split) => split.mode !== mode)) throw new Error("Use one split type on the job.");
  if (mode === "percent") {
    let sum = 0;
    for (const split of splits) {
      if (!Number.isInteger(split.shareBps) || split.shareBps < 0 || split.shareBps > MAX_BPS) throw new Error("Share is out of range.");
      sum += split.shareBps;
    }
    if (sum > MAX_BPS) throw new Error("Splits pass 100%.");
    return;
  }
  for (const split of splits) {
    if (!Number.isInteger(split.shareCents) || split.shareCents < 0) throw new Error("Share is out of range.");
  }
}

export function resolveRate(plan: PlanRate, projectType: string | null): { basis: BasisKind; rateBps: number } {
  const type = projectType?.trim() || "";
  const hit = type ? plan.overrides.find((row) => row.projectType === type) : undefined;
  if (!hit) return { basis: plan.basis, rateBps: plan.rateBps };
  return { basis: hit.basis ?? plan.basis, rateBps: hit.rateBps };
}

/** Gross profit uses job cost when a cost has been posted. Otherwise the basis is the contract. */
export function basisAmount(basis: BasisKind, soldCents: number, jobCostCents: number | null): { cents: number; fallback: boolean } {
  const sold = Math.max(0, Math.trunc(soldCents));
  if (basis === "contract") return { cents: sold, fallback: false };
  if (jobCostCents == null) return { cents: sold, fallback: true };
  return { cents: Math.max(0, sold - Math.trunc(jobCostCents)), fallback: false };
}

function ratioBps(soldCents: number, collectedCents: number): number {
  const sold = Math.max(0, Math.trunc(soldCents));
  const collected = Math.max(0, Math.trunc(collectedCents));
  if (sold === 0 || collected === 0) return 0;
  if (collected >= sold) return MAX_BPS;
  return Math.round((collected * MAX_BPS) / sold);
}

function gateOpen(kind: MilestoneKind, facts: JobFacts): boolean {
  if (kind === "deposit") return true;
  if (kind === "start") return facts.started || facts.complete;
  return facts.complete || (facts.soldCents > 0 && facts.collectedCents >= facts.soldCents);
}

/** How many basis points of the commission each milestone has earned. Locked milestones stay at 0. */
export function milestoneTakes(rules: MilestoneRule[], facts: JobFacts): Record<MilestoneKind, number> {
  const share = new Map(rules.map((rule) => [rule.kind, rule.shareBps]));
  const budget = ratioBps(facts.soldCents, facts.collectedCents);
  const takes = { deposit: 0, start: 0, completion: 0 };
  let cursor = 0;
  for (const kind of MILESTONES) {
    const width = share.get(kind) ?? 0;
    if (width > 0 && gateOpen(kind, facts)) {
      takes[kind] = Math.max(0, Math.min(width, budget - cursor));
    }
    cursor += width;
  }
  return takes;
}

export function lineKey(projectId: string, userId: string, milestone: MilestoneKind): string {
  return `${projectId}:${userId}:${milestone}`;
}

export function earnSlices(plans: Map<string, PlanRate>, splits: SplitShare[], facts: JobFacts): {
  slices: Slice[];
  remainderBps: number | null;
  remainderCents: number | null;
  capped: boolean;
} {
  assertSplits(splits);
  if (splits.length === 0) return { slices: [], remainderBps: MAX_BPS, remainderCents: null, capped: false };
  const mode = splits[0]?.mode ?? "percent";
  const slices: Slice[] = [];
  let capped = false;
  let sharedBasis: number | null = null;
  let sameBasis = true;
  for (const split of splits) {
    const plan = plans.get(split.userId);
    if (!plan) continue;
    assertMilestones(plan.milestones);
    const rate = resolveRate(plan, facts.projectType);
    const basis = basisAmount(rate.basis, facts.soldCents, facts.jobCostCents);
    if (sharedBasis == null) sharedBasis = basis.cents;
    else if (sharedBasis !== basis.cents) sameBasis = false;
    let personBasis = 0;
    if (mode === "percent") personBasis = Math.round((basis.cents * split.shareBps) / MAX_BPS);
    else if (split.shareCents > basis.cents) {
      personBasis = basis.cents;
      capped = true;
    } else personBasis = split.shareCents;
    const target = Math.round((personBasis * rate.rateBps) / MAX_BPS);
    const takes = milestoneTakes(plan.milestones, facts);
    for (const kind of MILESTONES) {
      const width = plan.milestones.find((rule) => rule.kind === kind)?.shareBps ?? 0;
      if (width <= 0) continue;
      slices.push({
        userId: split.userId,
        milestone: kind,
        basisCents: personBasis,
        rateBps: rate.rateBps,
        earnedCents: Math.round((target * takes[kind]) / MAX_BPS),
        fallback: basis.fallback,
      });
    }
  }
  if (mode === "percent") {
    const assigned = splits.reduce((sum, split) => sum + split.shareBps, 0);
    return { slices, remainderBps: MAX_BPS - assigned, remainderCents: null, capped };
  }
  if (!sameBasis || sharedBasis == null) return { slices, remainderBps: null, remainderCents: null, capped };
  const assigned = splits.reduce((sum, split) => sum + Math.min(split.shareCents, sharedBasis), 0);
  return { slices, remainderBps: null, remainderCents: Math.max(0, sharedBasis - assigned), capped };
}

export function sliceDelta(current: Slice[], prior: Slice[]): Map<string, number> {
  const before = new Map(prior.map((slice) => [`${slice.userId}:${slice.milestone}`, slice.earnedCents]));
  const delta = new Map<string, number>();
  for (const slice of current) {
    const key = `${slice.userId}:${slice.milestone}`;
    delta.set(key, slice.earnedCents - (before.get(key) ?? 0));
  }
  return delta;
}

export function priorSold(soldCents: number, latestPriceDeltaCents: number): number {
  return Math.max(0, Math.trunc(soldCents) - Math.trunc(latestPriceDeltaCents));
}
