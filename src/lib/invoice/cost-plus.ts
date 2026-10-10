import { MAX_MARKUP_BPS, taxCents } from "@/lib/money";

export type CostPlusPresent = "grouped" | "itemized";
export type MarkupDisplay = "baked" | "separate";

export type PricedCost = {
  costCode: string;
  label: string;
  name?: string;
  costCents: number;
  markupBps: number;
  markupCents: number;
  priceCents: number;
};

/** Markup on a cost, rounded to the cent. Half cents round away from zero. */
export function markupOnCost(costCents: number, markupBps: number): number {
  if (!Number.isSafeInteger(costCents) || costCents < 0) throw new Error("Cost must be a non-negative integer.");
  if (!Number.isSafeInteger(markupBps) || markupBps < 0 || markupBps > MAX_MARKUP_BPS) throw new Error("Markup is out of range.");
  const product = costCents * markupBps;
  if (!Number.isSafeInteger(product)) throw new Error("Markup is too large.");
  return Math.round(product / 10000);
}

export function priceCost(costCents: number, markupBps: number) {
  const markupCents = markupOnCost(costCents, markupBps);
  return { costCents, markupBps, markupCents, priceCents: costCents + markupCents };
}

/** A cost-code row wins over the job default. */
export function markupForCode(defaultBps: number, overrides: { costCode: string; markupBps: number }[], costCode: string): number {
  const hit = overrides.find((row) => row.costCode === costCode);
  return hit ? hit.markupBps : defaultBps;
}

/** Hours times a bill rate, in cents. Same half-up rounding as labor cost. */
export function billableLaborCents(minutes: number, hourlyBillCents: number): number {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new Error("Minutes must be a non-negative integer.");
  if (!Number.isSafeInteger(hourlyBillCents) || hourlyBillCents < 0) throw new Error("Bill rate must be a non-negative integer.");
  const product = minutes * hourlyBillCents;
  if (!Number.isSafeInteger(product)) throw new Error("Labor amount is too large.");
  return Math.round(product / 60);
}

export function costPlusTotals(rows: { costCents: number; markupBps: number }[], taxBps: number) {
  if (!Number.isSafeInteger(taxBps) || taxBps < 0 || taxBps > 10000) throw new Error("Tax is out of range.");
  let costCents = 0;
  let markupCents = 0;
  for (const row of rows) {
    const priced = priceCost(row.costCents, row.markupBps);
    costCents += priced.costCents;
    markupCents += priced.markupCents;
  }
  const priceCents = costCents + markupCents;
  const tax = taxCents(priceCents, taxBps);
  return { costCents, markupCents, priceCents, taxCents: tax, totalCents: priceCents + tax };
}

export function presentCostLines(
  rows: PricedCost[],
  presentAs: CostPlusPresent,
  markupDisplay: MarkupDisplay,
): { description: string; amountCents: number }[] {
  const grouped = new Map<string, { description: string; costCents: number; markupCents: number; priceCents: number }>();
  const source =
    presentAs === "itemized"
      ? rows.map((row) => ({
          description: row.label,
          costCents: row.costCents,
          markupCents: row.markupCents,
          priceCents: row.priceCents,
        }))
      : (() => {
          for (const row of rows) {
            const current = grouped.get(row.costCode) ?? {
              description: row.name || row.costCode,
              costCents: 0,
              markupCents: 0,
              priceCents: 0,
            };
            current.costCents += row.costCents;
            current.markupCents += row.markupCents;
            current.priceCents += row.priceCents;
            grouped.set(row.costCode, current);
          }
          return [...grouped.values()];
        })();
  const lines = source
    .filter((row) => (markupDisplay === "baked" ? row.priceCents : row.costCents) !== 0)
    .map((row) => ({
      description: row.description,
      amountCents: markupDisplay === "baked" ? row.priceCents : row.costCents,
    }));
  if (markupDisplay === "separate") {
    const markup = source.reduce((sum, row) => sum + row.markupCents, 0);
    if (markup !== 0) lines.push({ description: "Markup", amountCents: markup });
  }
  return lines;
}
