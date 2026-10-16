export type BudgetSource = {
  id: string;
  name: string;
  costCode: string | null;
  priceCents: number;
};

export type SpecSnap = {
  budgetLineId: string | null;
  sourceName: string | null;
  sourceCents: number | null;
};

export function groupOf(costCode: string | null | undefined): string {
  const code = (costCode ?? "").trim();
  return code || "General";
}

export function budgetChanged(line: SpecSnap, live: { name: string; priceCents: number } | null): boolean {
  if (!line.budgetLineId) return false;
  if (!live) return true;
  return line.sourceName !== live.name || line.sourceCents !== live.priceCents;
}

export function pulledLine(row: BudgetSource, sortOrder: number) {
  return {
    budgetLineId: row.id,
    groupLabel: groupOf(row.costCode),
    costCode: (row.costCode ?? "").trim(),
    description: row.name,
    notes: "",
    sortOrder,
    sourceName: row.name,
    sourceCents: row.priceCents,
  };
}

export function refreshed(live: { name: string; priceCents: number; costCode: string | null }) {
  return {
    description: live.name,
    costCode: (live.costCode ?? "").trim(),
    groupLabel: groupOf(live.costCode),
    sourceName: live.name,
    sourceCents: live.priceCents,
  };
}

export function kept(live: { name: string; priceCents: number }) {
  return { sourceName: live.name, sourceCents: live.priceCents };
}

export function draftPastDue(status: string, dueOn: string | null, today: string): boolean {
  return status === "draft" && Boolean(dueOn) && dueOn < today;
}

export function latestByToken<T extends { shareToken: string; version: number }>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const prev = best.get(row.shareToken);
    if (!prev || row.version > prev.version) best.set(row.shareToken, row);
  }
  return [...best.values()];
}

export function publishedForToken<T extends { shareToken: string; version: number; status: string }>(rows: T[], shareToken: string): T | null {
  return rows
    .filter((row) => row.shareToken === shareToken && row.status === "published")
    .sort((a, b) => b.version - a.version)[0] ?? null;
}
