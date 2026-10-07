import { allocatePercents } from "@/lib/draws/math";

/** Turn template percents into cents that add up to `totalCents`. The last row absorbs the remainder. */
export function rescalePercents(totalCents: number, bps: number[]): number[] {
  if (bps.length === 0) return [];
  if (!Number.isInteger(totalCents)) throw new Error("Total must be whole cents.");
  const sum = bps.reduce((total, part) => total + part, 0);
  if (sum === 10000) return allocatePercents(totalCents, bps);
  if (sum <= 0) {
    const amounts = bps.map(() => 0);
    amounts[amounts.length - 1] = totalCents;
    return amounts;
  }
  let allocated = 0;
  return bps.map((part, index) => {
    const amount = index === bps.length - 1 ? totalCents - allocated : Math.round((totalCents * part) / sum);
    allocated += amount;
    return amount;
  });
}

/** Fixed draw amounts become percents that add up to 100%. The last row absorbs the remainder. */
export function percentsFromAmounts(amounts: number[]): number[] {
  if (amounts.length === 0) return [];
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (total <= 0) return amounts.map(() => 0);
  let allocated = 0;
  return amounts.map((amount, index) => {
    if (index === amounts.length - 1) return 10000 - allocated;
    const bps = Math.round((amount * 10000) / total);
    allocated += bps;
    return bps;
  });
}

export function lineCents(qtyMilli: number, unitCents: number): number {
  return Math.round((qtyMilli * unitCents) / 1000);
}
