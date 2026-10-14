/** Owner credit memo math. Integer cents. A memo never changes the contract. */

export const CLIENT_CREDIT_METHOD = "credit_memo";

export function cashDueCents(totalCents: number, amountPaidCents: number): number {
  whole(totalCents, "Invoice");
  whole(amountPaidCents, "Paid");
  if (totalCents < 0 || amountPaidCents < 0) throw new Error("Invoice balance must be whole cents.");
  return Math.max(0, totalCents - amountPaidCents);
}

/** Spendable balance. Draft and void memos have none. */
export function memoRemainingCents(amountCents: number, appliedCents: number, status: string): number {
  if (status === "void" || status === "draft") return 0;
  whole(amountCents, "Amount");
  whole(appliedCents, "Applied");
  if (amountCents < 0 || appliedCents < 0 || appliedCents > amountCents) throw new Error("Applied is outside the memo.");
  return amountCents - appliedCents;
}

export function memoStatusAfter(amountCents: number, appliedCents: number): "ready" | "partial" | "applied" {
  if (appliedCents <= 0) return "ready";
  if (appliedCents >= amountCents) return "applied";
  return "partial";
}

export function assertApplySlice(remainingCents: number, invoiceDueCents: number, requestedCents: number): void {
  whole(requestedCents, "Requested");
  if (requestedCents < 1) throw new Error("Apply a positive amount.");
  if (requestedCents > remainingCents) throw new Error("That is more than the memo left.");
  if (requestedCents > invoiceDueCents) throw new Error("That is more than the invoice balance.");
}

export function clientCreditStatusLabel(status: string): string {
  if (status === "draft") return "Draft";
  if (status === "ready") return "Ready";
  if (status === "partial") return "Partial";
  if (status === "applied") return "Applied";
  if (status === "void") return "Void";
  return status;
}

export function paymentMethodLabel(method: string): string {
  if (method === CLIENT_CREDIT_METHOD) return "Credit memo";
  if (method === "ach") return "ACH";
  if (method === "card") return "Card";
  if (method === "check") return "Check";
  return method;
}

function whole(value: number, label: string) {
  if (!Number.isInteger(value)) throw new Error(`${label} must be whole cents.`);
}
