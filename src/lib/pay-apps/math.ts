import { retainedCents } from "@/lib/bills/retainage";

export type LineInput = {
  scheduledCents: number;
  previousWorkCents: number;
  previousHeldCents: number;
  thisPeriodCents: number;
  storedCents: number;
  releasedCents: number;
  retainageBps: number;
};

export type LineFigure = {
  scheduledCents: number;
  previousCents: number;
  thisPeriodCents: number;
  storedCents: number;
  completedCents: number;
  percentBps: number;
  balanceCents: number;
  retainageCents: number;
  releasedCents: number;
  heldCents: number;
};

function whole(value: number) {
  if (!Number.isInteger(value)) throw new Error("Amounts are whole cents.");
  return value;
}

/** Previous is approved work. This period, stored materials, and a release stay inside the scheduled value. */
export function figureLine(input: LineInput): LineFigure {
  const scheduledCents = whole(input.scheduledCents);
  const previousCents = whole(input.previousWorkCents);
  const thisPeriodCents = whole(input.thisPeriodCents);
  const storedCents = whole(input.storedCents);
  const releasedCents = whole(input.releasedCents);
  const previousHeldCents = whole(input.previousHeldCents);
  if (scheduledCents < 0 || previousCents < 0 || thisPeriodCents < 0 || storedCents < 0 || releasedCents < 0 || previousHeldCents < 0) {
    throw new Error("Amounts cannot be negative.");
  }
  const completedCents = previousCents + thisPeriodCents + storedCents;
  if (completedCents > scheduledCents) throw new Error("A line cannot pass 100%.");
  if (releasedCents > previousHeldCents) throw new Error("Release cannot exceed what is held.");
  const retainageCents = retainedCents(thisPeriodCents + storedCents, input.retainageBps);
  const heldCents = previousHeldCents + retainageCents - releasedCents;
  const percentBps = scheduledCents <= 0 ? 0 : Math.round((completedCents * 10_000) / scheduledCents);
  return {
    scheduledCents,
    previousCents,
    thisPeriodCents,
    storedCents,
    completedCents,
    percentBps,
    balanceCents: scheduledCents - completedCents,
    retainageCents,
    releasedCents,
    heldCents,
  };
}

export function applicationTotals(lines: LineFigure[]) {
  const grossCents = lines.reduce((sum, line) => sum + line.thisPeriodCents + line.storedCents, 0);
  const retainageCents = lines.reduce((sum, line) => sum + line.retainageCents, 0);
  const releasedCents = lines.reduce((sum, line) => sum + line.releasedCents, 0);
  const heldCents = lines.reduce((sum, line) => sum + line.heldCents, 0);
  return {
    grossCents,
    retainageCents,
    releasedCents,
    heldCents,
    netCents: grossCents - retainageCents + releasedCents,
    finalRelease: releasedCents > 0 && heldCents === 0,
  };
}
