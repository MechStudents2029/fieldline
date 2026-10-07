/** WIP figures in integer cents. Percents are basis points. Rounding is half away from zero via Math.round. */

export type CodeSpend = {
  revisedBudgetCents: number;
  committedOpenCents: number;
  actualCents: number;
};

export function projectedCostCents(input: CodeSpend): number {
  const budget = Math.max(0, input.revisedBudgetCents);
  const actual = Math.max(0, input.actualCents);
  const open = Math.max(0, input.committedOpenCents);
  return Math.max(budget, actual + open, actual);
}

/** Cost-to-cost. 0 when projected cost is 0. Capped at 100%. */
export function percentCompleteBps(costToDateCents: number, projectedCents: number): number {
  if (projectedCents <= 0 || costToDateCents <= 0) return 0;
  if (costToDateCents >= projectedCents) return 10_000;
  return Math.round((costToDateCents * 10_000) / projectedCents);
}

/** Contract times percent complete. The 100% cap means earned never exceeds the contract. */
export function earnedRevenueCents(contractCents: number, costToDateCents: number, projectedCents: number): number {
  if (contractCents <= 0 || projectedCents <= 0 || costToDateCents <= 0) return 0;
  if (costToDateCents >= projectedCents) return contractCents;
  return Math.round((contractCents * costToDateCents) / projectedCents);
}

/** Billed minus earned. Positive is overbilled. Negative is underbilled. */
export function overUnderCents(billedCents: number, earnedCents: number): number {
  return billedCents - earnedCents;
}

export function grossProfitCents(contractCents: number, projectedCents: number): number {
  return contractCents - projectedCents;
}

export function grossProfitBps(contractCents: number, profitCents: number): number {
  if (contractCents <= 0) return 0;
  return Math.round((profitCents * 10_000) / contractCents);
}

export function costToCompleteCents(projectedCents: number, costToDateCents: number): number {
  return projectedCents - costToDateCents;
}

/**
 * Issued invoices only (open or paid). Draft and void are zero.
 * A pay application stores the gross amount on its lines (retainage included).
 * A net invoice adds retainage back. A retainage release with no application lines counts once.
 */
export function invoiceBilledCents(invoice: {
  status: string;
  type: string;
  totalCents: number;
  retainageCents: number;
  applicationCents: number | null;
}): number {
  if (invoice.status !== "open" && invoice.status !== "paid") return 0;
  if (invoice.applicationCents != null) return Math.max(0, invoice.applicationCents);
  if (invoice.type === "retainage") return Math.max(0, invoice.totalCents);
  return Math.max(0, invoice.totalCents) + Math.max(0, invoice.retainageCents);
}

export type JobFigures = {
  contractCents: number;
  projectedCents: number;
  costToDateCents: number;
  percentBps: number;
  earnedCents: number;
  billedCents: number;
  overUnderCents: number;
  profitCents: number;
  profitBps: number;
  costToCompleteCents: number;
};

export function jobFigures(input: {
  contractCents: number;
  costToDateCents: number;
  codeProjectedCents: number;
  overrideCents: number | null;
  billedCents: number;
}): JobFigures {
  const projected = input.overrideCents == null ? Math.max(0, input.codeProjectedCents) : Math.max(0, input.overrideCents);
  const cost = Math.max(0, input.costToDateCents);
  const contract = Math.max(0, input.contractCents);
  const billed = input.billedCents;
  const earned = earnedRevenueCents(contract, cost, projected);
  const profit = grossProfitCents(contract, projected);
  return {
    contractCents: contract,
    projectedCents: projected,
    costToDateCents: cost,
    percentBps: percentCompleteBps(cost, projected),
    earnedCents: earned,
    billedCents: billed,
    overUnderCents: overUnderCents(billed, earned),
    profitCents: profit,
    profitBps: grossProfitBps(contract, profit),
    costToCompleteCents: costToCompleteCents(projected, cost),
  };
}

/** Money columns are the sum of the rows. Percents are recomputed from those sums. */
export function sumFigures(rows: JobFigures[]): JobFigures {
  const contract = rows.reduce((sum, row) => sum + row.contractCents, 0);
  const projected = rows.reduce((sum, row) => sum + row.projectedCents, 0);
  const cost = rows.reduce((sum, row) => sum + row.costToDateCents, 0);
  const earned = rows.reduce((sum, row) => sum + row.earnedCents, 0);
  const billed = rows.reduce((sum, row) => sum + row.billedCents, 0);
  const over = rows.reduce((sum, row) => sum + row.overUnderCents, 0);
  const profit = rows.reduce((sum, row) => sum + row.profitCents, 0);
  const left = rows.reduce((sum, row) => sum + row.costToCompleteCents, 0);
  return {
    contractCents: contract,
    projectedCents: projected,
    costToDateCents: cost,
    percentBps: percentCompleteBps(cost, projected),
    earnedCents: earned,
    billedCents: billed,
    overUnderCents: over,
    profitCents: profit,
    profitBps: grossProfitBps(contract, profit),
    costToCompleteCents: left,
  };
}
