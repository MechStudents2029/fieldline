/** Calendar-date cadence for service agreements. Dates are YYYY-MM-DD, so DST does not move a visit. */

export const HORIZON_DAYS = 90;
export const EXPIRING_DAYS = 30;

export const CADENCES = ["weekly", "weeks", "monthly", "quarterly", "semiannual", "annual", "custom", "as_needed"] as const;
export const TERM_KINDS = ["months", "until_cancelled", "date", "visits"] as const;
export const BILLINGS = ["per_visit", "monthly", "quarterly", "annual"] as const;
export const STORED_STATUSES = ["draft", "active", "pending_renewal", "renewed", "expired", "cancelled"] as const;

export type Cadence = (typeof CADENCES)[number];
export type TermKind = (typeof TERM_KINDS)[number];
export type Billing = (typeof BILLINGS)[number];
export type StoredStatus = (typeof STORED_STATUSES)[number];
export type DisplayStatus = StoredStatus | "expiring";

const MONTH_STEP: Partial<Record<Cadence, number>> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

const BILLING_STEP: Partial<Record<Billing, number>> = {
  monthly: 1,
  quarterly: 3,
  annual: 12,
};

export function isCadence(value: string): value is Cadence {
  return (CADENCES as readonly string[]).includes(value);
}

export function isTermKind(value: string): value is TermKind {
  return (TERM_KINDS as readonly string[]).includes(value);
}

export function isBilling(value: string): value is Billing {
  return (BILLINGS as readonly string[]).includes(value);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

function parts(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
}

function stamp(year: number, month: number, day: number) {
  const utc = new Date(Date.UTC(year, month - 1, day));
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number) {
  const { year, month, day } = parts(iso);
  return stamp(year, month, day + days);
}

/** Same day-of-month, clamped to the last day of the target month. */
export function addMonths(iso: string, months: number) {
  const { year, month, day } = parts(iso);
  const index = month - 1 + months;
  const targetYear = year + Math.floor(index / 12);
  const targetMonth = ((index % 12) + 12) % 12;
  const last = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return stamp(targetYear, targetMonth + 1, Math.min(day, last));
}

export function daysBetween(from: string, to: string) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function sellUnitCents(unitCostCents: number, markupBps: number) {
  return Math.round((unitCostCents * (10_000 + markupBps)) / 10_000);
}

export function lineAmountCents(unitPriceCents: number, qtyMilli: number) {
  return Math.round((unitPriceCents * qtyMilli) / 1000);
}

export type TermInput = {
  startOn: string;
  termKind: TermKind;
  termMonths?: number | null;
  endOn?: string | null;
  visitLimit?: number | null;
};

export function termEnd(input: TermInput): string | null {
  if (input.termKind === "until_cancelled" || input.termKind === "visits") return null;
  if (input.termKind === "date") return input.endOn && isIsoDate(input.endOn) ? input.endOn : null;
  const months = input.termMonths ?? 0;
  if (months < 1) return null;
  return addDays(addMonths(input.startOn, months), -1);
}

export type VisitSpec = TermInput & {
  cadence: Cadence;
  intervalWeeks?: number | null;
  customDates?: string[];
};

export function visitDates(spec: VisitSpec, horizon: string): string[] {
  if (!isIsoDate(spec.startOn) || !isIsoDate(horizon)) return [];
  if (spec.cadence === "as_needed") return [];
  const end = termEnd(spec);
  const limit = spec.termKind === "visits" ? Math.max(0, spec.visitLimit ?? 0) : 400;
  if (limit === 0) return [];
  if (spec.cadence === "custom") {
    return [...new Set((spec.customDates ?? []).filter((date) => isIsoDate(date)))]
      .filter((date) => date >= spec.startOn && (!end || date <= end) && date <= horizon)
      .sort()
      .slice(0, limit);
  }
  const step = MONTH_STEP[spec.cadence];
  const weeks = spec.cadence === "weekly" ? 1 : Math.max(1, spec.intervalWeeks ?? 1);
  const dates: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    const date = step ? addMonths(spec.startOn, index * step) : addDays(spec.startOn, index * 7 * weeks);
    if (end && date > end) break;
    if (date > horizon) break;
    dates.push(date);
  }
  return dates;
}

export function periodDates(startOn: string, billing: Billing, through: string, endOn: string | null): string[] {
  const step = BILLING_STEP[billing];
  if (!step || !isIsoDate(startOn) || !isIsoDate(through)) return [];
  const dates: string[] = [];
  for (let index = 0; index < 400; index += 1) {
    const date = addMonths(startOn, index * step);
    if (date > through) break;
    if (endOn && date > endOn) break;
    dates.push(date);
  }
  return dates;
}

export function visitsPerYear(cadence: Cadence, intervalWeeks: number) {
  if (cadence === "weekly") return 52;
  if (cadence === "weeks") return 52 / Math.max(1, intervalWeeks);
  if (cadence === "monthly") return 12;
  if (cadence === "quarterly") return 4;
  if (cadence === "semiannual") return 2;
  if (cadence === "annual") return 1;
  return 0;
}

export function monthlyNormalizedCents(input: {
  billing: Billing;
  fixedCents: number;
  visitCents: number;
  cadence: Cadence;
  intervalWeeks: number;
  customPerYear: number;
}) {
  if (input.billing === "monthly") return input.fixedCents;
  if (input.billing === "quarterly") return Math.round(input.fixedCents / 3);
  if (input.billing === "annual") return Math.round(input.fixedCents / 12);
  if (input.cadence === "as_needed") return 0;
  if (input.cadence === "custom") return Math.round((input.customPerYear * input.visitCents) / 12);
  return Math.round((visitsPerYear(input.cadence, input.intervalWeeks) * input.visitCents) / 12);
}

export function displayStatus(status: string, endOn: string | null, today: string): DisplayStatus {
  if (status === "active" && endOn && isIsoDate(endOn) && isIsoDate(today)) {
    const days = daysBetween(today, endOn);
    if (days < 0) return "expired";
    if (days <= EXPIRING_DAYS) return "expiring";
  }
  if ((STORED_STATUSES as readonly string[]).includes(status)) return status as StoredStatus;
  return "draft";
}

export function statusLabel(status: DisplayStatus) {
  if (status === "expiring") return "Expiring soon";
  if (status === "pending_renewal") return "Pending renewal";
  if (status === "draft") return "Draft";
  if (status === "active") return "Active";
  if (status === "renewed") return "Renewed";
  if (status === "expired") return "Expired";
  return "Cancelled";
}

/** Renewed divided by renewed plus expired, in basis points. Null when neither exists. */
export function renewalRateBps(counts: { renewed: number; expired: number }) {
  const denom = counts.renewed + counts.expired;
  if (denom <= 0) return null;
  return Math.round((counts.renewed * 10_000) / denom);
}
