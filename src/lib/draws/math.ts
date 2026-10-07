/** Draw and schedule-of-values math. Integer cents. The last draw or line absorbs the remainder. */

export type DrawBasis = "percent" | "fixed";

export type DrawPhase = "not_ready" | "ready" | "invoiced" | "paid";

export type DrawSpec = {
  basis: DrawBasis;
  bps: number;
  amountCents: number;
};

export function allocatePercents(totalCents: number, parts: number[]): number[] {
  let allocated = 0;
  return parts.map((bps, index) => {
    const amount = index === parts.length - 1 ? totalCents - allocated : Math.round((totalCents * bps) / 10000);
    allocated += amount;
    return amount;
  });
}

/** Percent rows that sum to 100% use last-line remainder. Any other mix is exact and reports what is left. */
export function resolvedDrawAmounts(contractCents: number, lines: DrawSpec[]): { amounts: number[]; remainderCents: number } {
  if (lines.length === 0) return { amounts: [], remainderCents: contractCents };
  const allPercent = lines.every((line) => line.basis === "percent");
  const bpsSum = lines.reduce((sum, line) => sum + line.bps, 0);
  if (allPercent && bpsSum === 10000) {
    return { amounts: allocatePercents(contractCents, lines.map((line) => line.bps)), remainderCents: 0 };
  }
  const amounts = lines.map((line) => (line.basis === "fixed" ? line.amountCents : Math.round((contractCents * line.bps) / 10000)));
  return { amounts, remainderCents: contractCents - amounts.reduce((sum, amount) => sum + amount, 0) };
}

export function parseDefaultDraws(json: string | null | undefined): { title: string; bps: number }[] | null {
  if (!json) return null;
  try {
    const rows = JSON.parse(json) as { title?: unknown; bps?: unknown }[];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows.map((row) => ({
      title: String(row.title || "Draw").trim().slice(0, 80) || "Draw",
      bps: Math.round(Number(row.bps) || 0),
    }));
  } catch {
    return null;
  }
}

export function drawPhase(input: {
  invoiceStatus: string | null;
  scheduleStatus: string | null;
  scheduleEnd: string | null;
  dueOn: string | null;
  today: string;
}): DrawPhase {
  if (input.invoiceStatus === "paid") return "paid";
  if (input.invoiceStatus === "open" || input.invoiceStatus === "draft") return "invoiced";
  const schedulePassed = input.scheduleEnd != null && input.scheduleEnd <= input.today;
  const datePassed = input.scheduleEnd == null && input.dueOn != null && input.dueOn <= input.today;
  if (input.scheduleStatus === "done" || schedulePassed || datePassed) return "ready";
  return "not_ready";
}

export function drawPhaseLabel(phase: DrawPhase): string {
  if (phase === "ready") return "Ready to bill";
  if (phase === "invoiced") return "Invoiced";
  if (phase === "paid") return "Paid";
  return "Not ready";
}

export function earnedDrawCents(draws: { amountCents: number; phase: DrawPhase }[]): number {
  return draws.filter((draw) => draw.phase !== "not_ready").reduce((sum, draw) => sum + draw.amountCents, 0);
}

export type SovLineIn = {
  key: string;
  name: string;
  scheduledCents: number;
  previousCents: number;
};

export type SovEntryIn = {
  key: string;
  thisCents: number | null;
  percentBps: number | null;
};

export type SovLineOut = SovLineIn & {
  thisCents: number;
  toDateCents: number;
  percentBps: number;
  balanceCents: number;
  retainageCents: number;
  netCents: number;
};

/** Retainage is rounded per line. The last line that has work this period absorbs the cent remainder. */
export function retainageByLine(thisCents: number[], bps: number): number[] {
  const target = Math.round((thisCents.reduce((sum, cents) => sum + cents, 0) * bps) / 10000);
  const result = thisCents.map(() => 0);
  const indexes = thisCents.flatMap((cents, index) => (cents > 0 ? [index] : []));
  let allocated = 0;
  indexes.forEach((line, order) => {
    if (order === indexes.length - 1) {
      result[line] = target - allocated;
      return;
    }
    const part = Math.round((thisCents[line] * bps) / 10000);
    result[line] = part;
    allocated += part;
  });
  return result;
}

export function buildProgress(
  lines: SovLineIn[],
  entries: SovEntryIn[],
  retainageBps: number,
): { lines: SovLineOut[]; thisPeriodCents: number; retainageCents: number; dueCents: number } {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const drafted = lines.map((line) => {
    const entry = byKey.get(line.key);
    let thisCents = 0;
    let percentBps = 0;
    if (entry && entry.thisCents != null) {
      thisCents = entry.thisCents;
      const toDate = line.previousCents + thisCents;
      percentBps = line.scheduledCents > 0 ? Math.round((toDate * 10000) / line.scheduledCents) : 0;
    } else if (entry && entry.percentBps != null) {
      percentBps = entry.percentBps;
      const toDate = Math.round((line.scheduledCents * percentBps) / 10000);
      thisCents = toDate - line.previousCents;
    }
    const toDateCents = line.previousCents + thisCents;
    if (thisCents < 0) throw new Error("This period cannot be negative.");
    if (toDateCents > line.scheduledCents) throw new Error("That line is over 100%.");
    return { ...line, thisCents, toDateCents, percentBps, balanceCents: line.scheduledCents - toDateCents };
  });
  const holds = retainageByLine(
    drafted.map((line) => line.thisCents),
    retainageBps,
  );
  const rows = drafted.map((line, index) => ({
    ...line,
    retainageCents: holds[index] ?? 0,
    netCents: line.thisCents - (holds[index] ?? 0),
  }));
  const thisPeriodCents = rows.reduce((sum, line) => sum + line.thisCents, 0);
  const retainageCents = rows.reduce((sum, line) => sum + line.retainageCents, 0);
  return { lines: rows, thisPeriodCents, retainageCents, dueCents: thisPeriodCents - retainageCents };
}

export function previousFromApps(
  keys: string[],
  apps: { voided: boolean; lines: { key: string; thisCents: number }[] }[],
): Map<string, number> {
  const previous = new Map(keys.map((key) => [key, 0]));
  for (const app of apps) {
    if (app.voided) continue;
    for (const line of app.lines) previous.set(line.key, (previous.get(line.key) ?? 0) + line.thisCents);
  }
  return previous;
}

export function billingGap(contractCents: number, billedCents: number, earnedCents: number) {
  const billedBps = contractCents > 0 ? Math.round((billedCents * 10000) / contractCents) : 0;
  const completeBps = contractCents > 0 ? Math.round((earnedCents * 10000) / contractCents) : 0;
  const gapCents = earnedCents - billedCents;
  const state = gapCents > 0 ? "under" : gapCents < 0 ? "over" : "even";
  return { billedBps, completeBps, gapCents, state: state as "under" | "over" | "even" };
}

export function gapLabel(state: "under" | "over" | "even"): string {
  if (state === "under") return "Underbilled";
  if (state === "over") return "Overbilled";
  return "Even";
}
