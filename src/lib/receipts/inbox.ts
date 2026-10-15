import { addCalendarDays } from "@/lib/time/calendar";

/** Same store and amount inside this many calendar days counts as a possible duplicate. */
export const DUPLICATE_WINDOW_DAYS = 3;

export const PAY_METHODS = ["company_card", "personal", "cash"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

export const RECEIPT_STATUSES = ["new", "coded", "posted", "rejected"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export type DuplicateRow = {
  id: string;
  vendorName: string;
  amountCents: number;
  purchasedOn: string | null;
  photoHash: string | null;
};

export function isPayMethod(value: string): value is PayMethod {
  return (PAY_METHODS as readonly string[]).includes(value);
}

export function payLabel(method: string): string {
  if (method === "company_card") return "Company card";
  if (method === "personal") return "Personal";
  if (method === "cash") return "Cash";
  return method;
}

export function statusLabel(status: string): string {
  if (status === "new") return "New";
  if (status === "coded") return "Coded";
  if (status === "posted") return "Posted";
  if (status === "rejected") return "Rejected";
  return status;
}

export function normalizeVendor(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function dayNumber(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const utc = Date.UTC(year, month - 1, date);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) return null;
  return Math.round(utc / 86_400_000);
}

export function withinDays(a: string | null, b: string | null, days: number): boolean {
  if (!a || !b) return false;
  const left = dayNumber(a);
  const right = dayNumber(b);
  if (left == null || right == null) return false;
  return Math.abs(left - right) <= days;
}

/** Another receipt with the same photo, or the same store and amount inside the window. Never a block. */
export function duplicateOf(rows: DuplicateRow[], id: string, windowDays = DUPLICATE_WINDOW_DAYS): string | null {
  const self = rows.find((row) => row.id === id);
  if (!self) return null;
  const vendor = normalizeVendor(self.vendorName);
  for (const other of rows) {
    if (other.id === self.id) continue;
    if (self.photoHash && other.photoHash && self.photoHash === other.photoHash) return other.id;
    if (!vendor || normalizeVendor(other.vendorName) !== vendor) continue;
    if (other.amountCents !== self.amountCents) continue;
    if (withinDays(self.purchasedOn, other.purchasedOn, windowDays)) return other.id;
  }
  return null;
}

export type SplitLine = { costCode: string; amountCents: number };

export function cleanSplits(lines: SplitLine[]): SplitLine[] {
  return lines
    .map((line) => ({ costCode: line.costCode.trim(), amountCents: line.amountCents }))
    .filter((line) => line.costCode || line.amountCents);
}

/** Splits are a coding error until they add up. Posting refuses the mismatch. */
export function splitSumError(amountCents: number, lines: SplitLine[]): string | null {
  const splits = cleanSplits(lines);
  if (splits.length === 0) return "Add a cost code.";
  for (const line of splits) {
    if (!line.costCode) return "Each split needs a cost code.";
    if (!Number.isSafeInteger(line.amountCents) || line.amountCents <= 0) return "Each split needs an amount.";
  }
  const sum = splits.reduce((total, line) => total + line.amountCents, 0);
  if (sum !== amountCents) return "Splits must add up to the receipt.";
  return null;
}

export function isUncodedStale(status: string, createdDay: string, today: string, days = 2): boolean {
  return status === "new" && createdDay < addCalendarDays(today, -days);
}

export type ReimbursementInput = {
  userId: string;
  name: string;
  payMethod: string;
  status: string;
  amountCents: number;
  reimbursedAt: string | null;
};

export type ReimbursementTotal = {
  userId: string;
  name: string;
  openCents: number;
  reimbursedCents: number;
  openCount: number;
};

export function reimbursementTotals(rows: ReimbursementInput[]): ReimbursementTotal[] {
  const grouped = new Map<string, ReimbursementTotal>();
  for (const row of rows) {
    if (row.payMethod !== "personal" || row.status !== "posted") continue;
    const current = grouped.get(row.userId) ?? {
      userId: row.userId,
      name: row.name,
      openCents: 0,
      reimbursedCents: 0,
      openCount: 0,
    };
    if (row.reimbursedAt) current.reimbursedCents += row.amountCents;
    else {
      current.openCents += row.amountCents;
      current.openCount += 1;
    }
    grouped.set(row.userId, current);
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}

/**
 * Photos are not sent to a model. A missing gateway key leaves the form blank.
 * A configured key still does not invent a store, date, or total from image bytes.
 */
export function suggestReceiptPrefill(): { vendor: string; purchasedOn: string; amount: string } | null {
  return null;
}
