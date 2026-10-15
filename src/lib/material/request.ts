import { withinDays } from "@/lib/receipts/inbox";
import { addCalendarDays } from "@/lib/time/calendar";

export const MATERIAL_STATUSES = ["draft", "submitted", "approved", "fulfilled", "ordered", "rejected"] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

export const MATERIAL_URGENCIES = ["normal", "urgent"] as const;
export type MaterialUrgency = (typeof MATERIAL_URGENCIES)[number];

/** Same job and SKU inside this many calendar days is a possible duplicate. Never a block. */
export const MATERIAL_DUPLICATE_DAYS = 3;

const QTY_CAP = 100_000_000;

export function isMaterialStatus(value: string): value is MaterialStatus {
  return (MATERIAL_STATUSES as readonly string[]).includes(value);
}

export function isUrgency(value: string): value is MaterialUrgency {
  return (MATERIAL_URGENCIES as readonly string[]).includes(value);
}

export function materialStatusLabel(status: string): string {
  if (status === "draft") return "Draft";
  if (status === "submitted") return "Submitted";
  if (status === "approved") return "Approved";
  if (status === "fulfilled") return "Fulfilled";
  if (status === "ordered") return "Ordered";
  if (status === "rejected") return "Rejected";
  return status;
}

export function urgencyLabel(urgency: string): string {
  if (urgency === "urgent") return "Urgent";
  if (urgency === "normal") return "Normal";
  return urgency;
}

/** Quantity text as thousandths. "2" → 2000. Blank and zero are rejected. */
export function parseQtyToMilli(raw: string): number | null {
  const text = raw.trim().replace(/,/g, "");
  if (!text || !/^\d+(\.\d{1,3})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const milli = Number(whole) * 1000 + Number((frac + "000").slice(0, 3));
  if (!Number.isSafeInteger(milli) || milli <= 0 || milli > QTY_CAP) return null;
  return milli;
}

export function formatQty(qtyMilli: number): string {
  const abs = Math.abs(qtyMilli);
  const whole = Math.floor(abs / 1000);
  const frac = abs % 1000;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(3, "0").replace(/0+$/, "")}`;
}

export function isMaterialAttention(status: string, urgency: string, submittedDay: string | null, today: string, days = 2): boolean {
  if (status !== "submitted" || !submittedDay) return false;
  if (urgency === "urgent") return true;
  return submittedDay < addCalendarDays(today, -days);
}

export type MaterialDupRow = {
  id: string;
  projectId: string;
  stockItemIds: string[];
  createdOn: string;
};

export function duplicateRequest(rows: MaterialDupRow[], requestId: string, windowDays = MATERIAL_DUPLICATE_DAYS): string | null {
  const self = rows.find((row) => row.id === requestId);
  if (!self) return null;
  const skus = new Set(self.stockItemIds.filter(Boolean));
  if (skus.size === 0) return null;
  for (const other of rows) {
    if (other.id === self.id || other.projectId !== self.projectId) continue;
    if (!other.stockItemIds.some((sku) => skus.has(sku))) continue;
    if (withinDays(self.createdOn, other.createdOn, windowDays)) return other.id;
  }
  return null;
}
