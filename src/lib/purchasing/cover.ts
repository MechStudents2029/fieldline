export const PO_STALE_DAYS = 3;
const DAY_MS = 86_400_000;

export function lineAmountCents(qtyMilli: number, unitCostCents: number) {
  return Math.round((qtyMilli * unitCostCents) / 1000);
}

export function poKindLabel(kind: string) {
  return kind === "work" ? "Work order" : "Purchase order";
}

export type CoverRow = {
  sourceKind: string;
  sourceId: string;
  status: string;
  projectId: string;
  costCode: string;
  amountCents: number;
};

export function coveredSourceIds(rows: CoverRow[], sourceKind: string, statuses: Set<string>) {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.sourceKind !== sourceKind || !row.sourceId || !statuses.has(row.status)) continue;
    ids.add(row.sourceId);
  }
  return ids;
}

export function committedByCode(rows: CoverRow[], projectId: string) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.projectId !== projectId) continue;
    if (row.status !== "draft" && row.status !== "issued") continue;
    totals.set(row.costCode, (totals.get(row.costCode) ?? 0) + row.amountCents);
  }
  return totals;
}

export function budgetRemainder(budgetCostCents: number, committedCents: number) {
  return Math.max(0, budgetCostCents - committedCents);
}

export function selectionSourceId(selectionId: string, choiceId: string) {
  return `${selectionId}:${choiceId}`;
}

export function isStale(confirmedAt: string, now: number, days = PO_STALE_DAYS) {
  const at = Date.parse(confirmedAt);
  if (!Number.isFinite(at)) return false;
  return now - at > days * DAY_MS;
}
