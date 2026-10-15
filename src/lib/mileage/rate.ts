import { addCalendarDays } from "@/lib/time/calendar";

export const MILEAGE_STATUSES = ["draft", "submitted", "approved", "reimbursed", "rejected"] as const;
export type MileageStatus = (typeof MILEAGE_STATUSES)[number];

const MILES_CAP = 100_000_000;
const READING_CAP = 100_000_000_000;
const RATE_CAP = 100_000;

export function isMileageStatus(value: string): value is MileageStatus {
  return (MILEAGE_STATUSES as readonly string[]).includes(value);
}

export function mileageStatusLabel(status: string): string {
  if (status === "draft") return "Draft";
  if (status === "submitted") return "Submitted";
  if (status === "approved") return "Approved";
  if (status === "reimbursed") return "Reimbursed";
  if (status === "rejected") return "Rejected";
  return status;
}

/** Odometer or miles text, up to 3 decimals, as thousandths. Blank is null. */
export function parseReadingToMilli(raw: string): number | null {
  const text = raw.trim().replace(/,/g, "");
  if (!text) return null;
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const milli = Number(whole) * 1000 + Number((frac + "000").slice(0, 3));
  if (!Number.isSafeInteger(milli) || milli < 0 || milli > READING_CAP) return null;
  return milli;
}

/** Trip length. Zero and blank are rejected. */
export function parseMilesToMilli(raw: string): number | null {
  const milli = parseReadingToMilli(raw);
  if (milli == null || milli <= 0 || milli > MILES_CAP) return null;
  return milli;
}

/** Company or IRS rate as tenths of a cent per mile. 72.5 → 725, 76 → 760. */
export function parseRateToDeciCents(raw: string): number | null {
  const text = raw.trim().replace(/,/g, "");
  if (!text || !/^\d+(\.\d)?$/.test(text)) return null;
  const [whole, frac = "0"] = text.split(".");
  const deci = Number(whole) * 10 + Number(frac);
  if (!Number.isSafeInteger(deci) || deci <= 0 || deci > RATE_CAP) return null;
  return deci;
}

export function milesFromOdometer(startMilli: number, endMilli: number): { milesMilli: number } | { error: string } {
  if (endMilli <= startMilli) return { error: "End reading is below the start." };
  const milesMilli = endMilli - startMilli;
  if (milesMilli > MILES_CAP) return { error: "That trip is too long." };
  return { milesMilli };
}

/** Integer cents, half up. milesMilli × rateDeciCents / 10_000. */
export function mileageCents(milesMilli: number, rateDeciCents: number): number {
  if (!Number.isInteger(milesMilli) || !Number.isInteger(rateDeciCents)) return 0;
  if (milesMilli <= 0 || rateDeciCents <= 0) return 0;
  const product = milesMilli * rateDeciCents;
  const cents = Math.floor(product / 10_000);
  const rem = product % 10_000;
  return rem >= 5_000 ? cents + 1 : cents;
}

export type RatePeriod = {
  id: string;
  startsOn: string;
  endsOn: string;
  rateDeciCents: number;
  irsDeciCents: number;
};

export function rateForDate(periods: RatePeriod[], day: string): RatePeriod | null {
  const hits = periods.filter((row) => row.startsOn <= day && day <= row.endsOn);
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.startsOn.localeCompare(a.startsOn) || a.id.localeCompare(b.id));
  return hits[0] ?? null;
}

export function periodsOverlap(periods: { startsOn: string; endsOn: string }[]): boolean {
  const sorted = [...periods].sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.endsOn.localeCompare(b.endsOn));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!prev || !cur) continue;
    if (cur.startsOn <= prev.endsOn) return true;
  }
  return false;
}

export function isWaitingTrip(status: string, submittedDay: string | null, today: string, days = 2): boolean {
  if (status !== "submitted" || !submittedDay) return false;
  return submittedDay < addCalendarDays(today, -days);
}

export function formatMiles(milesMilli: number): string {
  const sign = milesMilli < 0 ? "-" : "";
  const abs = Math.abs(milesMilli);
  const whole = Math.floor(abs / 1000);
  const frac = abs % 1000;
  if (frac === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(frac).padStart(3, "0").replace(/0+$/, "")}`;
}

export function formatRate(rateDeciCents: number): string {
  const whole = Math.trunc(rateDeciCents / 10);
  const frac = Math.abs(rateDeciCents % 10);
  return frac === 0 ? String(whole) : `${whole}.${frac}`;
}

export function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, date] = value.split("-").map(Number);
  if (!year || !month || !date) return false;
  const utc = new Date(Date.UTC(year, month - 1, date));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === date;
}
