import { lineAmounts, marginBps, MAX_MARKUP_BPS } from "@/lib/money";

export type Billing = "included" | "optional" | "allowance" | "excluded";

export type PricedLine = {
  id: string;
  billing: Billing;
  qtyMilli: number;
  unitCostCents: number;
  markupBps: number;
};

/** Included work and allowances are the contract. Optional and excluded are not. */
export function countsTowardTotal(billing: Billing): boolean {
  return billing === "included" || billing === "allowance";
}

/** Margin M and markup m: m = M / (1 − M). Basis points, rounded to the nearest point. */
export function markupBpsForMargin(marginBpsTarget: number): number {
  if (!Number.isSafeInteger(marginBpsTarget) || marginBpsTarget < 0 || marginBpsTarget >= 10000) {
    throw new Error("Margin must be from 0% up to 95%.");
  }
  if (marginBpsTarget === 0) return 0;
  const markup = Math.round((marginBpsTarget * 10000) / (10000 - marginBpsTarget));
  return Math.max(0, Math.min(MAX_MARKUP_BPS, markup));
}

export function sumCounting(lines: PricedLine[]): { costCents: number; priceCents: number; marginBps: number | null } {
  let costCents = 0;
  let priceCents = 0;
  for (const line of lines) {
    if (!countsTowardTotal(line.billing)) continue;
    const amounts = lineAmounts(line.qtyMilli, line.unitCostCents, line.markupBps);
    costCents += amounts.cost;
    priceCents += amounts.price;
  }
  return { costCents, priceCents, marginBps: marginBps(priceCents, costCents) };
}

export function groupSubtotals(lines: PricedLine[]) {
  return sumCounting(lines);
}

/**
 * Set one markup on every counting line so the group lands on the target margin.
 * The largest counting line absorbs cent rounding, one basis point at a time.
 * Optional and excluded lines keep their markup.
 */
export function repriceToMargin(lines: PricedLine[], targetMarginBps: number): { id: string; markupBps: number }[] {
  if (!Number.isSafeInteger(targetMarginBps) || targetMarginBps < 0 || targetMarginBps > 9000) {
    throw new Error("Margin must be from 0% up to 90%.");
  }
  const uniform = markupBpsForMargin(targetMarginBps);
  const next = new Map(lines.map((line) => [line.id, countsTowardTotal(line.billing) ? uniform : line.markupBps]));
  const counting = lines.filter((line) => countsTowardTotal(line.billing) && lineAmounts(line.qtyMilli, line.unitCostCents, line.markupBps).cost > 0);
  const largest = [...counting].sort((a, b) => {
    const costA = lineAmounts(a.qtyMilli, a.unitCostCents, a.markupBps).cost;
    const costB = lineAmounts(b.qtyMilli, b.unitCostCents, b.markupBps).cost;
    return costB - costA;
  })[0];
  if (!largest) return lines.map((line) => ({ id: line.id, markupBps: next.get(line.id) ?? line.markupBps }));

  const marginOf = () => {
    const priced = lines.map((line) => ({ ...line, markupBps: next.get(line.id) ?? line.markupBps }));
    return sumCounting(priced).marginBps;
  };

  for (let step = 0; step < 80; step += 1) {
    const current = marginOf();
    if (current == null || Math.abs(current - targetMarginBps) <= 50) break;
    const direction = current < targetMarginBps ? 1 : -1;
    const bumped = (next.get(largest.id) ?? uniform) + direction;
    if (bumped < 0 || bumped > MAX_MARKUP_BPS) break;
    next.set(largest.id, bumped);
  }

  return lines.map((line) => ({ id: line.id, markupBps: next.get(line.id) ?? line.markupBps }));
}
