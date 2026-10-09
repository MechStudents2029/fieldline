import { costCodeKey } from "@/lib/margin/category";
import { overageByCode } from "@/lib/margin/commitment";
import { formatMoney } from "@/lib/money";
import { netPayableCents, retainedCents } from "@/lib/bills/retainage";

export type PoLineInput = {
  id?: string;
  costCode: string;
  description: string | null;
  amountCents: number;
};

export type PoLineFigure = PoLineInput & {
  billedCents: number;
  remainingCents: number;
};

function codeKey(code: string | null | undefined) {
  const key = costCodeKey(code);
  return key === "Uncoded" ? key : key.toUpperCase();
}

/** Apply approved and paid bill lines onto purchase-order lines, in order. Remainder never goes below zero. */
export function lineFigures(lines: PoLineInput[], billed: { costCode: string; amountCents: number }[]): PoLineFigure[] {
  const pool = new Map<string, number>();
  for (const row of billed) {
    const key = codeKey(row.costCode);
    pool.set(key, (pool.get(key) ?? 0) + Math.max(0, row.amountCents));
  }
  return lines.map((line) => {
    const key = codeKey(line.costCode);
    const left = pool.get(key) ?? 0;
    const billedCents = Math.min(Math.max(0, line.amountCents), left);
    pool.set(key, left - billedCents);
    return { ...line, billedCents, remainingCents: Math.max(0, line.amountCents) - billedCents };
  });
}

/** A new bill starts at each line's remaining amount. Retainage is the purchase order's percent of that total. */
export function billFromPo(lines: PoLineFigure[], retainageBps: number) {
  const picked = lines
    .filter((line) => line.remainingCents > 0)
    .map((line) => ({
      costCode: line.costCode,
      description: line.description?.trim() || "",
      amountCents: line.remainingCents,
    }));
  const amountCents = picked.reduce((sum, line) => sum + line.amountCents, 0);
  const hold = retainedCents(amountCents, retainageBps);
  return {
    lines: picked,
    amountCents,
    retainageCents: hold,
    netCents: netPayableCents(amountCents, hold, "standard"),
  };
}

export function poOverageMessage(number: string, overs: { code: string; overCents: number }[]): string | null {
  if (overs.length === 0) return null;
  const detail = overs.map((row) => `${formatMoney(row.overCents)} over on ${row.code}`).join(", ");
  return `This bill is past ${number}: ${detail}.`;
}

export function overRemainingMessage(
  number: string,
  poLines: { costCode: string; amountCents: number }[],
  billed: { costCode: string; amountCents: number }[],
  incoming: { costCode: string; amountCents: number }[],
): string | null {
  return poOverageMessage(number, overageByCode(poLines, billed, incoming));
}
