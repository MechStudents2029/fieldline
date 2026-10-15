import { formatMoney } from "@/lib/money";

/**
 * Late fees are integer cents. Monthly percent is basis points of the unpaid balance.
 * A fee posts once the invoice is more than graceDays past due. Grace 7 posts on day 8.
 * One fee per invoice per calendar month. A second run in that month does not add another.
 * Payments reduce applied fees oldest first, then the invoice principal.
 */

export const AR_BUCKETS = ["Current", "1–30", "31–60", "61–90", "90+"] as const;
export type ArBucket = (typeof AR_BUCKETS)[number];
export const LATE_FEE_LINE = "Late fee";

export type LatePolicy = {
  enabled: boolean;
  flatCents: number;
  monthlyBps: number;
  graceDays: number;
  minimumCents: number;
  capCents: number;
  excludeRetainage: boolean;
  excludeDraws: boolean;
  excludeAgreements: boolean;
  mode: "review" | "apply";
};

export type FeeInvoice = {
  status: string;
  dueDate: string;
  totalCents: number;
  amountPaidCents: number;
  retainageCents: number;
  type: string;
  draw: boolean;
  agreement: boolean;
};

export function daysPastDue(due: string, today: string): number {
  const start = Date.parse(`${due.slice(0, 10)}T12:00:00Z`);
  const end = Date.parse(`${today.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

export function unpaidCents(totalCents: number, amountPaidCents: number): number {
  return Math.max(0, totalCents - amountPaidCents);
}

/** Open invoices only. Paid, void, draft, disputed, and hold accrue nothing. */
export function feeEligible(policy: LatePolicy, invoice: FeeInvoice, today: string): boolean {
  if (!policy.enabled) return false;
  if (invoice.status !== "open") return false;
  if (policy.excludeRetainage && (invoice.retainageCents > 0 || invoice.type === "retainage")) return false;
  if (policy.excludeDraws && (invoice.draw || invoice.type === "draw")) return false;
  if (policy.excludeAgreements && (invoice.agreement || invoice.type === "service")) return false;
  if (daysPastDue(invoice.dueDate, today) <= policy.graceDays) return false;
  const base = unpaidCents(invoice.totalCents, invoice.amountPaidCents);
  if (base < 1 || base < policy.minimumCents) return false;
  return true;
}

/** Flat plus the monthly percent. Cap is the most pending and applied fees an invoice can hold. 0 cap means no cap. */
export function feeAmount(policy: Pick<LatePolicy, "flatCents" | "monthlyBps" | "capCents">, balanceCents: number, chargedCents: number): number {
  if (balanceCents < 1) return 0;
  const percent = Math.round((balanceCents * policy.monthlyBps) / 10_000);
  let fee = Math.max(0, policy.flatCents) + Math.max(0, percent);
  if (policy.capCents > 0) fee = Math.min(fee, Math.max(0, policy.capCents - Math.max(0, chargedCents)));
  return fee < 1 ? 0 : fee;
}

export function feePeriod(today: string): string {
  return today.slice(0, 7);
}

export function arBucket(due: string, today: string): ArBucket {
  const late = daysPastDue(due, today);
  if (late <= 0) return "Current";
  if (late <= 30) return "1–30";
  if (late <= 60) return "31–60";
  if (late <= 90) return "61–90";
  return "90+";
}

export function lateFeePolicyLine(policy: LatePolicy): string | null {
  if (!policy.enabled) return null;
  const bits: string[] = [];
  if (policy.flatCents > 0) bits.push(formatMoney(policy.flatCents));
  if (policy.monthlyBps > 0) bits.push(`${(policy.monthlyBps / 100).toFixed(2)}%`);
  if (bits.length === 0) return null;
  return `${bits.join(" + ")} after ${policy.graceDays} days`;
}

export type FeeSlice = { id: string; amountCents: number; appliedAt: string };

/** Oldest applied fee first, then principal. */
export function allocatePayment(principalCents: number, fees: FeeSlice[], paidCents: number) {
  const ordered = [...fees].sort((a, b) => a.appliedAt.localeCompare(b.appliedAt) || a.id.localeCompare(b.id));
  let left = Math.max(0, paidCents);
  const rows = ordered.map((fee) => {
    const paid = Math.min(Math.max(0, fee.amountCents), left);
    left -= paid;
    return { id: fee.id, paidCents: paid, openCents: Math.max(0, fee.amountCents) - paid };
  });
  const principal = Math.max(0, principalCents);
  const principalPaidCents = Math.min(principal, left);
  return {
    fees: rows,
    principalPaidCents,
    principalOpenCents: principal - principalPaidCents,
  };
}
