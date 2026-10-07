import { addCalendarDays } from "@/lib/time/calendar";

/** Extended price in cents. Quantity is milli-units. */
export function extendCents(qtyMilli: number, unitPriceCents: number): number {
  if (!Number.isSafeInteger(qtyMilli) || !Number.isSafeInteger(unitPriceCents)) throw new Error("Line cost is too large.");
  const product = qtyMilli * unitPriceCents;
  if (!Number.isSafeInteger(product)) throw new Error("Line cost is too large.");
  return Math.round(product / 1000);
}

export function varianceCents(amountCents: number, budgetCents: number | null): number | null {
  if (budgetCents == null) return null;
  return amountCents - budgetCents;
}

export type LowQuote = {
  vendorId: string;
  unitPriceCents: number | null;
  noBid: boolean;
  live: boolean;
};

/** Vendors tied for the lowest live unit price on one line. No-bids are skipped. */
export function lowVendorIds(quotes: LowQuote[]): string[] {
  const priced = quotes.filter((quote) => quote.live && !quote.noBid && quote.unitPriceCents != null);
  if (priced.length === 0) return [];
  const min = Math.min(...priced.map((quote) => quote.unitPriceCents as number));
  return priced.filter((quote) => quote.unitPriceCents === min).map((quote) => quote.vendorId);
}

export function requestStatusLabel(status: string, submitted: number, invited: number): string {
  if (status === "draft") return "Draft";
  if (status === "awarded") return "Awarded";
  if (status === "closed") return "Closed";
  if (invited > 0 && submitted > 0) return `${submitted} of ${invited} in`;
  return "Out";
}

/** Inclusive of the due date in the company calendar. Awarded and closed stay locked. */
export function vendorCanRevise(requestStatus: string, dueOn: string, today: string, inviteStatus: string): boolean {
  if (requestStatus !== "out") return false;
  if (dueOn < today) return false;
  return inviteStatus === "invited" || inviteStatus === "submitted" || inviteStatus === "needs_revision";
}

/** Due today through three company-local days ahead. */
export function dueWithinThreeDays(dueOn: string, today: string): boolean {
  return dueOn >= today && dueOn <= addCalendarDays(today, 3);
}
