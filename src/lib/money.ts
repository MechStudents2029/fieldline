/** All money is integer cents. Basis points are integer (3500 = 35.00%). */

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

export function dollarsToCents(value: number): number {
  return Math.round(value * 100);
}

export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
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
  const cost = Math.round((qtyMilli * unitCostCents) / 1000);
  const price = Math.round((cost * (10000 + markupBps)) / 10000);
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
