/** Warn when a cost code has used 80% of its budget. Over 100% can suggest a draft change order. */
export const CATEGORY_WATCH_BPS = 8000;

const COVERING = new Set(["draft", "sent", "approved"]);

export type CostCodeSpend = {
  code: string;
  budgetCents: number;
  actualCents: number;
};

export type CoveringLine = {
  status: string;
  costCode: string | null;
  costCents: number;
};

export type CategoryLevel = "ok" | "watch" | "over";

export type CategoryAssessment = CostCodeSpend & {
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
): CostCodeSpend[] {
  const codes = new Set<string>();
  for (const line of budget) codes.add(costCodeKey(line.costCode));
  for (const cost of costs) codes.add(costCodeKey(cost.costCode));
  return [...codes].map((code) => ({
    code,
    budgetCents: budget.filter((line) => costCodeKey(line.costCode) === code).reduce((sum, line) => sum + line.budgetCostCents, 0),
    actualCents: costs.filter((cost) => costCodeKey(cost.costCode) === code).reduce((sum, cost) => sum + cost.amountCents, 0),
  }));
}

function levelFor(budgetCents: number, actualCents: number): CategoryLevel {
  if (budgetCents <= 0) return "ok";
  if (actualCents > budgetCents) return "over";
  if (actualCents * 10000 >= budgetCents * CATEGORY_WATCH_BPS) return "watch";
  return "ok";
}

/** Pending and approved change-order cost that is not already inside the budget. */
export function assessCategories(rows: CostCodeSpend[], covers: CoveringLine[] = []): CategoryAssessment[] {
  return rows
    .map((row) => {
      const level = levelFor(row.budgetCents, row.actualCents);
      const overageCents = row.budgetCents > 0 ? Math.max(0, row.actualCents - row.budgetCents) : 0;
      const coveredCents = covers
        .filter((line) => COVERING.has(line.status) && costCodeKey(line.costCode) === row.code)
        .reduce((sum, line) => sum + Math.max(0, line.costCents), 0);
      const draftCostCents = Math.max(0, overageCents - coveredCents);
      const covered = level === "over" && draftCostCents === 0;
      return {
        ...row,
        level,
        percentOfBudget: row.budgetCents > 0 ? Math.round((row.actualCents * 100) / row.budgetCents) : null,
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
