/** Warn when a cost code has used 80% of its budget. Over 100% can suggest a draft change order. */
export const CATEGORY_WATCH_BPS = 8000;

const COVERING = new Set(["draft", "sent", "approved"]);

export type CostCodeSpend = {
  code: string;
  budgetCents: number;
  actualCents: number;
  /** Issued purchase-order remainder on this code. Omit it and the code is treated as uncommitted. */
  committedOpenCents?: number;
};

export type CoveringLine = {
  status: string;
  costCode: string | null;
  costCents: number;
};

export type CategoryLevel = "ok" | "watch" | "over";

export type CategoryAssessment = CostCodeSpend & {
  committedOpenCents: number;
  /** Actual plus open commitment. The 80% watch and the overrun use this, not the floored projection. */
  exposureCents: number;
  /** Greatest of the budget and exposure. This is the column on the job cost table. */
  projectedCents: number;
  costToCompleteCents: number;
  /** Budget minus projected. Zero while the projection is still the budget. */
  varianceCents: number;
  level: CategoryLevel;
  percentOfBudget: number | null;
  overageCents: number;
  coveredCents: number;
  covered: boolean;
  suggestDraft: boolean;
  draftCostCents: number;
};

export function costCodeKey(code: string | null | undefined): string {
  const trimmed = code?.trim();
  return trimmed ? trimmed : "Uncoded";
}

export function rollupCostCodes(
  budget: { costCode: string | null; budgetCostCents: number }[],
  costs: { costCode: string | null; amountCents: number }[],
  commitments: { costCode: string | null; amountCents: number }[] = [],
): CostCodeSpend[] {
  const codes = new Set<string>();
  for (const line of budget) codes.add(costCodeKey(line.costCode));
  for (const cost of costs) codes.add(costCodeKey(cost.costCode));
  for (const row of commitments) codes.add(costCodeKey(row.costCode));
  return [...codes].map((code) => ({
    code,
    budgetCents: budget.filter((line) => costCodeKey(line.costCode) === code).reduce((sum, line) => sum + line.budgetCostCents, 0),
    actualCents: costs.filter((cost) => costCodeKey(cost.costCode) === code).reduce((sum, cost) => sum + cost.amountCents, 0),
    committedOpenCents: commitments
      .filter((row) => costCodeKey(row.costCode) === code)
      .reduce((sum, row) => sum + row.amountCents, 0),
  }));
}

function levelFor(budgetCents: number, actualCents: number): CategoryLevel {
  if (budgetCents <= 0) return "ok";
  if (actualCents > budgetCents) return "over";
  if (actualCents * 10000 >= budgetCents * CATEGORY_WATCH_BPS) return "watch";
  return "ok";
}

/**
 * Watch and overrun compare exposure (actual + open commitment) with the budget.
 * Projected is max(budget, exposure), which is what the job table shows.
 * Do not use projected for the 80% line: it is never below the budget, so that
 * ratio would read 100% even when the job has only spent 80% and promised nothing.
 * A draft or sent change order that already covers the overage does not suggest another one.
 */
export function assessCategories(rows: CostCodeSpend[], covers: CoveringLine[] = []): CategoryAssessment[] {
  return rows
    .map((row) => {
      const committedOpenCents = Math.max(0, row.committedOpenCents ?? 0);
      const exposureCents = row.actualCents + committedOpenCents;
      const projectedCents = Math.max(row.budgetCents, exposureCents);
      const level = levelFor(row.budgetCents, exposureCents);
      const overageCents = row.budgetCents > 0 ? Math.max(0, exposureCents - row.budgetCents) : 0;
      const coveredCents = covers
        .filter((line) => COVERING.has(line.status) && costCodeKey(line.costCode) === row.code)
        .reduce((sum, line) => sum + Math.max(0, line.costCents), 0);
      const draftCostCents = Math.max(0, overageCents - coveredCents);
      const covered = level === "over" && draftCostCents === 0;
      return {
        ...row,
        committedOpenCents,
        exposureCents,
        projectedCents,
        costToCompleteCents: projectedCents - row.actualCents,
        varianceCents: row.budgetCents - projectedCents,
        level,
        percentOfBudget: row.budgetCents > 0 ? Math.round((exposureCents * 100) / row.budgetCents) : null,
        overageCents,
        coveredCents,
        covered,
        suggestDraft: level === "over" && draftCostCents > 0,
        draftCostCents,
      };
    })
    .sort((a, b) => rank(a.level) - rank(b.level) || b.overageCents - a.overageCents || a.code.localeCompare(b.code));
}

function rank(level: CategoryLevel) {
  if (level === "over") return 0;
  if (level === "watch") return 1;
  return 2;
}

export function overBudgetPercent(row: Pick<CategoryAssessment, "budgetCents" | "overageCents">): number | null {
  if (row.budgetCents <= 0 || row.overageCents <= 0) return null;
  return Math.round((row.overageCents * 100) / row.budgetCents);
}
