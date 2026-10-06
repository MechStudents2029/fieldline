import { lineAmounts, MAX_MARKUP_BPS, formatWhole } from "@/lib/money";

/** Extended price and cost for one choice, and how it sits against an allowance. */
export type ChoiceAmounts = {
  extendedPriceCents: number;
  extendedCostCents: number;
  /** Extended price minus the allowance price. Positive is an overage. */
  differenceCents: number;
  overageCents: number;
  creditCents: number;
};

export type ChangeOrderPrefill = {
  priceCents: number;
  unitCostCents: number;
  markupBps: number;
  qty: number;
};

export function extendCents(unitCents: number, qtyMilli: number): number {
  if (!Number.isSafeInteger(unitCents) || !Number.isSafeInteger(qtyMilli)) {
    throw new Error("Selection amounts must be integers.");
  }
  if (unitCents < 0 || qtyMilli < 0) throw new Error("Selection amounts cannot be negative.");
  const product = unitCents * qtyMilli;
  if (!Number.isSafeInteger(product)) throw new Error("Selection amount is too large.");
  return Math.round(product / 1000);
}

/**
 * Allowance amounts are already the line total. Choice price and cost are per unit.
 * An unlinked selection has no allowance, so the difference is the full extended price.
 */
export function choiceAmounts(input: {
  qtyMilli: number;
  unitPriceCents: number;
  unitCostCents: number;
  allowancePriceCents: number | null;
  allowanceCostCents?: number | null;
}): ChoiceAmounts {
  const extendedPriceCents = extendCents(input.unitPriceCents, input.qtyMilli);
  const extendedCostCents = extendCents(input.unitCostCents, input.qtyMilli);
  const allowance = input.allowancePriceCents ?? 0;
  const differenceCents = input.allowancePriceCents == null ? extendedPriceCents : extendedPriceCents - allowance;
  return {
    extendedPriceCents,
    extendedCostCents,
    differenceCents,
    overageCents: Math.max(differenceCents, 0),
    creditCents: Math.max(-differenceCents, 0),
  };
}

/** Cost posted to the allowance's cost code. Unlinked choices wait for a change order. */
export function commitmentCents(linked: boolean, extendedCostCents: number): number | null {
  if (!linked) return null;
  return extendedCostCents;
}

export type CostPosting = { id: string; costCode: string; amountCents: number };

export function withSelectionCost(costs: CostPosting[], posting: CostPosting): CostPosting[] {
  return [...costs.filter((row) => row.id !== posting.id), posting];
}

export function withoutSelectionCost(costs: CostPosting[], id: string): CostPosting[] {
  return costs.filter((row) => row.id !== id);
}

/** Markup that makes a quantity of 1 hit `priceCents` exactly, or a zero-markup price line. */
export function markupForTarget(costCents: number, priceCents: number): { unitCostCents: number; markupBps: number } {
  if (priceCents <= 0) return { unitCostCents: 0, markupBps: 0 };
  if (costCents <= 0 || costCents >= priceCents) return { unitCostCents: priceCents, markupBps: 0 };
  let bps = Math.round(((priceCents - costCents) * 10000) / costCents);
  if (bps < 0 || bps > MAX_MARKUP_BPS) return { unitCostCents: priceCents, markupBps: 0 };
  for (let step = 0; step < 8; step += 1) {
    if (lineAmounts(1000, costCents, bps).price === priceCents) return { unitCostCents: costCents, markupBps: bps };
    const got = lineAmounts(1000, costCents, bps).price;
    if (got < priceCents) bps += 1;
    else bps -= 1;
    if (bps < 0 || bps > MAX_MARKUP_BPS) break;
  }
  if (bps >= 0 && bps <= MAX_MARKUP_BPS && lineAmounts(1000, costCents, bps).price === priceCents) {
    return { unitCostCents: costCents, markupBps: bps };
  }
  return { unitCostCents: priceCents, markupBps: 0 };
}

/**
 * Linked overage becomes a one-line draft. A credit does not.
 * Unlinked choices draft the full choice price. Quantity is 1 so the line price is the difference.
 */
export function changeOrderPrefill(input: {
  linked: boolean;
  extendedPriceCents: number;
  extendedCostCents: number;
  allowancePriceCents: number | null;
  allowanceCostCents: number | null;
}): ChangeOrderPrefill | null {
  if (!input.linked) {
    if (input.extendedPriceCents <= 0) return null;
    const priced = markupForTarget(input.extendedCostCents, input.extendedPriceCents);
    return { priceCents: input.extendedPriceCents, qty: 1, ...priced };
  }
  const allowancePrice = input.allowancePriceCents ?? 0;
  const difference = input.extendedPriceCents - allowancePrice;
  if (difference <= 0) return null;
  const costDiff = input.extendedCostCents - (input.allowanceCostCents ?? 0);
  const priced = markupForTarget(Math.max(costDiff, 0), difference);
  return { priceCents: difference, qty: 1, ...priced };
}

/** `+$600`, `−$400`, or `included`. */
export function formatSelectionDelta(cents: number): string {
  if (cents === 0) return "included";
  const body = formatWhole(Math.abs(cents));
  return cents > 0 ? `+${body}` : `−${body}`;
}

export function publicSnapshot(input: {
  selectionId: string;
  title: string;
  qtyMilli: number;
  allowancePriceCents: number | null;
  choice: { id: string; name: string; priceCents: number; differenceCents: number };
}) {
  return {
    selectionId: input.selectionId,
    title: input.title,
    qtyMilli: input.qtyMilli,
    allowancePriceCents: input.allowancePriceCents,
    choice: input.choice,
  };
}
