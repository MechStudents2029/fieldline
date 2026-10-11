import { MAX_MARKUP_BPS, MAX_MONEY_CENTS, taxCents } from "@/lib/money";

export const TICKET_STATUSES = ["draft", "ready", "verified", "billed", "void"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketEvent = "company" | "client" | "bill" | "void" | "restore";

export function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value);
}

export function ticketPill(status: TicketStatus): string {
  if (status === "draft") return "Draft";
  if (status === "ready") return "Ready for review";
  if (status === "verified") return "Field verified";
  if (status === "billed") return "Billed";
  return "Void";
}

export function linesLocked(status: TicketStatus): boolean {
  return status === "verified" || status === "billed" || status === "void";
}

/** Company signature sends a draft to review. The customer signature verifies and locks the lines. */
export function nextTicketStatus(status: TicketStatus, event: TicketEvent): TicketStatus | null {
  if (event === "company" && status === "draft") return "ready";
  if (event === "client" && (status === "draft" || status === "ready")) return "verified";
  if (event === "bill" && status === "verified") return "billed";
  if (event === "void" && (status === "draft" || status === "ready" || status === "verified")) return "void";
  if (event === "restore" && status === "billed") return "verified";
  return null;
}

export type ChargeLine = {
  qtyMilli: number;
  unitCostCents: number;
  unitPriceCents: number;
};

export function lineCharge(line: ChargeLine) {
  if (!Number.isSafeInteger(line.qtyMilli) || line.qtyMilli < 0) throw new Error("Quantity must be a non-negative integer.");
  if (!Number.isSafeInteger(line.unitCostCents) || line.unitCostCents < 0 || line.unitCostCents > MAX_MONEY_CENTS) {
    throw new Error("Unit cost is out of range.");
  }
  if (!Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents < 0 || line.unitPriceCents > MAX_MONEY_CENTS) {
    throw new Error("Unit price is out of range.");
  }
  const costProduct = line.qtyMilli * line.unitCostCents;
  const priceProduct = line.qtyMilli * line.unitPriceCents;
  if (!Number.isSafeInteger(costProduct) || !Number.isSafeInteger(priceProduct)) throw new Error("Line amount is too large.");
  const costCents = Math.round(costProduct / 1000);
  const priceCents = Math.round(priceProduct / 1000);
  if (costCents > MAX_MONEY_CENTS * 6 || priceCents > MAX_MONEY_CENTS * 6) throw new Error("Line amount is too large.");
  return { costCents, priceCents, markupCents: priceCents - costCents };
}

/** Tax uses the same rounding as a cost-plus invoice. */
export function ticketTotals(lines: ChargeLine[], taxBps: number) {
  if (!Number.isSafeInteger(taxBps) || taxBps < 0 || taxBps > 10000) throw new Error("Tax is out of range.");
  let costCents = 0;
  let priceCents = 0;
  for (const line of lines) {
    const charge = lineCharge(line);
    costCents += charge.costCents;
    priceCents += charge.priceCents;
  }
  const markupCents = priceCents - costCents;
  const tax = taxCents(priceCents, taxBps);
  const marginBps = priceCents > 0 ? Math.round((markupCents * 10000) / priceCents) : 0;
  return { costCents, priceCents, markupCents, taxCents: tax, totalCents: priceCents + tax, marginBps };
}

/** Unit price from cost and markup. Half cents round away from zero, same as cost-plus. */
export function unitPriceFromMarkup(unitCostCents: number, markupBps: number): number {
  if (!Number.isSafeInteger(unitCostCents) || unitCostCents < 0 || unitCostCents > MAX_MONEY_CENTS) {
    throw new Error("Unit cost is out of range.");
  }
  if (!Number.isSafeInteger(markupBps) || markupBps < 0 || markupBps > MAX_MARKUP_BPS) throw new Error("Markup is out of range.");
  const price = Math.round((unitCostCents * (10000 + markupBps)) / 10000);
  if (price > MAX_MONEY_CENTS) throw new Error("Unit price is out of range.");
  return price;
}
