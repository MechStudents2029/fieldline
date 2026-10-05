import { costCodeKey } from "@/lib/margin/category";

export type CodedCents = { costCode: string | null; amountCents: number };

export function sumByCode(lines: CodedCents[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    const code = costCodeKey(line.costCode);
    totals.set(code, (totals.get(code) ?? 0) + line.amountCents);
  }
  return totals;
}

/** Remainder of an issued purchase order after approved bills, per cost code. Never negative. */
export function openCommitmentByCode(poLines: CodedCents[], relievingLines: CodedCents[]): { costCode: string; amountCents: number }[] {
  const committed = sumByCode(poLines);
  const relieving = sumByCode(relievingLines);
  return [...committed.entries()]
    .map(([costCode, amount]) => ({ costCode, amountCents: Math.max(0, amount - (relieving.get(costCode) ?? 0)) }))
    .filter((row) => row.amountCents > 0)
    .sort((a, b) => a.costCode.localeCompare(b.costCode));
}

/** How far a bill's lines, plus bills already approved on the order, sit past the order. */
export function overageByCode(
  poLines: CodedCents[],
  priorLines: CodedCents[],
  incoming: CodedCents[],
): { code: string; overCents: number }[] {
  const cap = sumByCode(poLines);
  const used = sumByCode([...priorLines, ...incoming]);
  return [...used.entries()]
    .map(([code, amount]) => ({ code, overCents: amount - (cap.get(code) ?? 0) }))
    .filter((row) => row.overCents > 0)
    .sort((a, b) => a.code.localeCompare(b.code));
}
