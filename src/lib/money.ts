/** All money is integer cents. Basis points are integer (3500 = 35.00%). */

/** $10,000,000. A remodel job file should never store more than this on one line. */
export const MAX_MONEY_CENTS = 1_000_000_000;
export const MAX_QTY = 1_000_000;
/** 500% markup. */
export const MAX_MARKUP_BPS = 50_000;

export function formatMoney(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function formatBps(bps: number | null | undefined): string {
  if (bps == null || Number.isNaN(bps)) return "—";
  return `${(bps / 100).toFixed(1)}%`;
}

/** Whole dollars for lists. `$46,200`. */
export function formatWhole(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

/** Compact summaries. `$359k`. */
export function formatCompact(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return "—";
  const dollars = cents / 100;
  const sign = dollars < 0 ? "-" : "";
  const abs = Math.abs(dollars);
  if (abs >= 1000) {
    const scaled = abs / 1000;
    const digits = scaled >= 100 || Number.isInteger(scaled) ? 0 : 1;
    return `${sign}$${scaled.toFixed(digits)}k`;
  }
  return formatWhole(cents);
}

/** Integer percent for lists. `76%`. */
export function formatPercent(bps: number | null | undefined): string {
  if (bps == null || Number.isNaN(bps)) return "—";
  return `${Math.round(bps / 100)}%`;
}

export function dollarsToCents(value: number): number {
  return Math.round(value * 100);
}

export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^(?:\d+|\d*\.\d{1,2})$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  const cents = Math.round(n * 100);
  if (!Number.isSafeInteger(cents) || cents > MAX_MONEY_CENTS) return null;
  return cents;
}

/** Returns a message when a line edit would store a negative, non-integer, or absurd amount. */
export function lineInputError(input: { qty?: number; unitCostCents?: number; markupBps?: number }): string | null {
  if (input.qty != null && (!Number.isFinite(input.qty) || input.qty <= 0 || input.qty > MAX_QTY)) {
    return "Quantity must be greater than zero.";
  }
  if (
    input.unitCostCents != null &&
    (!Number.isSafeInteger(input.unitCostCents) || input.unitCostCents < 0 || input.unitCostCents > MAX_MONEY_CENTS)
  ) {
    return "Unit cost must be zero or a positive amount under $10,000,000.";
  }
  if (
    input.markupBps != null &&
    (!Number.isSafeInteger(input.markupBps) || input.markupBps < 0 || input.markupBps > MAX_MARKUP_BPS)
  ) {
    return "Markup must be between 0% and 500%.";
  }
  return null;
}

export function positiveMoneyError(cents: number): string | null {
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_MONEY_CENTS) {
    return "Enter an amount greater than zero and under $10,000,000.";
  }
  return null;
}

export function qtyToMilli(qty: number): number {
  return Math.round(qty * 1000);
}

export function milliToQty(milli: number): number {
  return milli / 1000;
}

export function formatQty(milli: number): string {
  const qty = milliToQty(milli);
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}

/** Cost is rounded to the cent, then markup is applied and rounded again. */
export function lineAmounts(qtyMilli: number, unitCostCents: number, markupBps: number) {
  if (!Number.isSafeInteger(qtyMilli) || !Number.isSafeInteger(unitCostCents) || !Number.isSafeInteger(markupBps)) {
    throw new Error("Line amounts must be integers.");
  }
  if (qtyMilli < 0 || unitCostCents < 0) throw new Error("Line amounts cannot be negative.");
  const product = qtyMilli * unitCostCents;
  if (!Number.isSafeInteger(product)) throw new Error("Line cost is too large.");
  const cost = Math.round(product / 1000);
  const price = Math.round((cost * (10000 + markupBps)) / 10000);
  if (!Number.isSafeInteger(cost) || !Number.isSafeInteger(price) || price > MAX_MONEY_CENTS * 6) {
    throw new Error("Line cost is too large.");
  }
  return { cost, price };
}

export function taxCents(subtotalCents: number, taxBps: number): number {
  return Math.round((subtotalCents * taxBps) / 10000);
}

export function marginBps(priceCents: number, costCents: number): number | null {
  if (priceCents <= 0) return null;
  return Math.round(((priceCents - costCents) / priceCents) * 10000);
}

export function scheduleAmounts(
  totalCents: number,
  parts: { type: string; label: string; bps: number }[],
) {
  let allocated = 0;
  return parts.map((part, index) => {
    const amount =
      index === parts.length - 1
        ? totalCents - allocated
        : Math.round((totalCents * part.bps) / 10000);
    allocated += amount;
    return { ...part, amountCents: amount };
  });
}

export function achFeeCents(amountCents: number): number {
  const raw = Math.round((amountCents * 80) / 10000);
  return Math.min(Math.max(raw, 0), 500);
}

export function cardFeeCents(amountCents: number): number {
  return Math.round((amountCents * 290) / 10000) + 30;
}
