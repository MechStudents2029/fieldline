export type CreditWorkflow = "draft" | "issued" | "acknowledged" | "disputed" | "void";

export type CreditView = CreditWorkflow | "partial" | "applied";

function cents(value: number, label: string) {
  if (!Number.isInteger(value)) throw new Error(`${label} must be whole cents.`);
}

/** Cents still open on a credit. Applied cannot pass the credit. */
export function remainingCreditCents(amountCents: number, appliedCents: number): number {
  cents(amountCents, "Amount");
  cents(appliedCents, "Applied");
  if (amountCents < 0 || appliedCents < 0 || appliedCents > amountCents) throw new Error("Applied is outside the credit.");
  return amountCents - appliedCents;
}

/** One slice of a credit against a bill. Zero is not an application. */
export function applySlice(remainingCents: number, requestedCents: number): number {
  cents(remainingCents, "Remaining");
  cents(requestedCents, "Requested");
  if (requestedCents === 0) return 0;
  if (requestedCents < 0) throw new Error("Apply a positive amount.");
  if (requestedCents > remainingCents) throw new Error("That is more than the credit left.");
  return requestedCents;
}

/** Cash that leaves after retainage-net and credits. Credits cannot exceed that net. */
export function netAfterCredit(billNetCents: number, appliedCents: number): number {
  cents(billNetCents, "Net");
  cents(appliedCents, "Applied");
  if (billNetCents < 0 || appliedCents < 0) throw new Error("Net must be whole cents.");
  if (appliedCents > billNetCents) throw new Error("Credits cannot cover more than the net.");
  return billNetCents - appliedCents;
}

export function settlePayment(input: {
  billNetCents: number;
  slices: { remainingCents: number; requestedCents: number }[];
}): { appliedCents: number; netPaidCents: number } {
  let applied = 0;
  for (const slice of input.slices) {
    applied += applySlice(slice.remainingCents, slice.requestedCents);
  }
  return { appliedCents: applied, netPaidCents: netAfterCredit(input.billNetCents, applied) };
}

/** Shortage against the order, in cents. Quantity is milli-units. */
export function shortCreditCents(orderedMilli: number, receivedMilli: number, unitCostCents: number): number {
  if (!Number.isInteger(orderedMilli) || !Number.isInteger(receivedMilli) || !Number.isInteger(unitCostCents)) {
    throw new Error("Quantity and unit cost must be whole numbers.");
  }
  const short = Math.max(0, orderedMilli - Math.max(0, receivedMilli));
  return Math.round((short * Math.max(0, unitCostCents)) / 1000);
}

/** Damaged quantity times unit cost. */
export function damagedCreditCents(qtyMilli: number, unitCostCents: number): number {
  if (!Number.isInteger(qtyMilli) || !Number.isInteger(unitCostCents)) throw new Error("Quantity and unit cost must be whole numbers.");
  return Math.round((Math.max(0, qtyMilli) * Math.max(0, unitCostCents)) / 1000);
}

export function creditView(status: string, amountCents: number, appliedCents: number): CreditView {
  if (status === "void" || status === "draft" || status === "issued" || status === "acknowledged" || status === "disputed") {
    if (status === "void" || status === "draft") return status;
    if (amountCents > 0 && appliedCents >= amountCents) return "applied";
    if (appliedCents > 0) return "partial";
    return status;
  }
  return "draft";
}

export function creditStatusLabel(view: CreditView): string {
  if (view === "partial") return "Partially applied";
  if (view === "applied") return "Applied";
  if (view === "draft") return "Draft";
  if (view === "issued") return "Issued";
  if (view === "acknowledged") return "Acknowledged";
  if (view === "disputed") return "Disputed";
  return "Void";
}

/** Net figures for a purchase order after issued credits. Open commitment in the budget is separate. */
export function poCreditFacts(input: {
  status: string;
  amountCents: number;
  billedCents: number;
  openCents: number;
  credits: { amountCents: number; appliedCents: number }[];
}): { committedCents: number; billedCents: number; openCents: number; creditCents: number } {
  const issued = input.status === "issued" || input.status === "closed";
  const creditCents = input.credits.reduce((sum, row) => sum + Math.max(0, row.amountCents), 0);
  const appliedCents = input.credits.reduce((sum, row) => sum + Math.max(0, row.appliedCents), 0);
  if (!issued || creditCents === 0) {
    return {
      committedCents: issued ? input.amountCents : 0,
      billedCents: input.billedCents,
      openCents: input.openCents,
      creditCents,
    };
  }
  const committedCents = Math.max(0, input.amountCents - creditCents);
  const billedCents = Math.max(0, input.billedCents - appliedCents);
  return {
    committedCents,
    billedCents,
    openCents: Math.max(0, committedCents - billedCents),
    creditCents,
  };
}
