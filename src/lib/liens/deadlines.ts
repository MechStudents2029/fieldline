import { addWorkdays } from "@/lib/schedule/workdays";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

/**
 * Lien deadline math.
 * California: Civ. Code §§ 8204, 8414, 8460. A late preliminary notice still covers work.
 * Texas commercial (nonresidential) derivative claimant: Prop. Code §§ 53.056, 53.052, 53.158.
 * Florida, not in privity: Fla. Stat. §§ 713.06, 713.08, 713.22. A late Notice to Owner is a complete defense.
 * New York is omitted. The official Lien Law text was not in hand.
 */

export const DUE_DAYS = 14;
export const RISK_DAYS = 3;

export type LienRole = "prime" | "sub" | "supplier";
export type SpanKind = "none" | "calendar" | "business" | "month_day" | "anniversary";
export type FileAnchor = "last" | "completion";
export type EnforceFrom = "filed" | "file_deadline";
export type NoticeKind = "prelim" | "intent" | "filing";
export type DeadlineKind = NoticeKind | "enforcement";
export type LienStatus = "protected" | "due" | "at-risk" | "lapsed" | "missing" | "paid" | "later";

export type LienRuleSpec = {
  state: string;
  role: LienRole;
  prelimKind: "none" | "calendar" | "business" | "month_day";
  prelimDays: number;
  prelimMonths: number;
  prelimDay: number;
  noiKind: "none" | "calendar" | "business";
  noiDays: number;
  fileKind: "none" | "calendar" | "business" | "month_day";
  fileAnchor: FileAnchor;
  fileDays: number;
  fileMonths: number;
  fileDay: number;
  enforceKind: "none" | "calendar" | "business" | "anniversary";
  enforceFrom: EnforceFrom;
  enforceDays: number;
  prelimLapses: boolean;
  citation: string;
};

export type LienNoticeMark = { kind: NoticeKind; sentOn: string };

export type LienFacts = {
  today: string;
  rule: LienRuleSpec | null;
  first: string | null;
  last: string | null;
  completion: string | null;
  notices: LienNoticeMark[];
  openCents: number;
  mask?: number;
};

export type LienDeadline = {
  kind: DeadlineKind;
  label: string;
  date: string | null;
  daysLeft: number | null;
  status: LienStatus;
};

export type LienEvaluation = {
  status: LienStatus;
  deadlines: LienDeadline[];
  openCents: number;
};

export const LIEN_PILL_LABEL: Record<LienStatus, string> = {
  protected: "Protected",
  due: "Due",
  "at-risk": "At risk",
  lapsed: "Lapsed",
  missing: "Missing info",
  paid: "Paid",
  later: "",
};

export const SEEDED_LIEN_RULES: LienRuleSpec[] = [
  {
    state: "CA",
    role: "sub",
    prelimKind: "calendar",
    prelimDays: 20,
    prelimMonths: 0,
    prelimDay: 0,
    noiKind: "none",
    noiDays: 0,
    fileKind: "calendar",
    fileAnchor: "completion",
    fileDays: 90,
    fileMonths: 0,
    fileDay: 0,
    enforceKind: "calendar",
    enforceFrom: "filed",
    enforceDays: 90,
    prelimLapses: false,
    citation: "Civ. Code §§ 8204, 8414, 8460",
  },
  {
    state: "TX",
    role: "sub",
    prelimKind: "month_day",
    prelimDays: 0,
    prelimMonths: 3,
    prelimDay: 15,
    noiKind: "none",
    noiDays: 0,
    fileKind: "month_day",
    fileAnchor: "last",
    fileDays: 0,
    fileMonths: 4,
    fileDay: 15,
    enforceKind: "anniversary",
    enforceFrom: "file_deadline",
    enforceDays: 1,
    prelimLapses: false,
    citation: "Prop. Code §§ 53.056, 53.052, 53.158",
  },
  {
    state: "FL",
    role: "sub",
    prelimKind: "calendar",
    prelimDays: 45,
    prelimMonths: 0,
    prelimDay: 0,
    noiKind: "none",
    noiDays: 0,
    fileKind: "calendar",
    fileAnchor: "last",
    fileDays: 90,
    fileMonths: 0,
    fileDay: 0,
    enforceKind: "anniversary",
    enforceFrom: "filed",
    enforceDays: 1,
    prelimLapses: true,
    citation: "Fla. Stat. §§ 713.06, 713.08, 713.22",
  },
];

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function splitDay(day: string): { year: number; month: number; date: number } {
  const [year, month, date] = day.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 1, date: date ?? 1 };
}

/** Calendar months, clamped to the last real day. Jan 31 plus one month is Feb 28. */
export function addMonths(day: string, months: number): string {
  const { year, month, date } = splitDay(day);
  const total = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return isoDate(nextYear, nextMonth, Math.min(date, lastDayOfMonth(nextYear, nextMonth)));
}

/** Calendar years, clamped. Feb 29 plus one year is Feb 28. */
export function addYears(day: string, years: number): string {
  return addMonths(day, years * 12);
}

/** The given day of the Nth month after the month that contains `anchor`. */
export function monthDayAfter(anchor: string, monthsAfter: number, dayOfMonth: number): string {
  const { year, month } = splitDay(anchor);
  const total = year * 12 + (month - 1) + monthsAfter;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return isoDate(nextYear, nextMonth, Math.min(dayOfMonth, lastDayOfMonth(nextYear, nextMonth)));
}

/** This month's day-of-month when today is on or after it, otherwise last month's. */
export function recentMonthDay(today: string, dayOfMonth: number): string {
  const { year, month, date } = splitDay(today);
  if (date >= dayOfMonth) return isoDate(year, month, Math.min(dayOfMonth, lastDayOfMonth(year, month)));
  return monthDayAfter(isoDate(year, month, 1), -1, dayOfMonth);
}

export function daysBetween(from: string, to: string): number {
  const start = splitDay(from);
  const end = splitDay(to);
  const a = Date.UTC(start.year, start.month - 1, start.date);
  const b = Date.UTC(end.year, end.month - 1, end.date);
  return Math.round((b - a) / 86_400_000);
}

export function asDay(value: string | null | undefined, timeZone: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return localDay(parsed, timeZone);
}

export function stateFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const tokens = address.toUpperCase().match(/\b[A-Z]{2}\b/g);
  return tokens?.[tokens.length - 1] ?? null;
}

export function furnishSpan(dates: string[]): { first: string | null; last: string | null } {
  const clean = dates.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)).sort();
  if (clean.length === 0) return { first: null, last: null };
  return { first: clean[0] ?? null, last: clean[clean.length - 1] ?? null };
}

function shift(kind: "calendar" | "business" | "month_day" | "anniversary", anchor: string, days: number, months: number, dayOfMonth: number, mask: number): string {
  if (kind === "month_day") return monthDayAfter(anchor, months, dayOfMonth);
  if (kind === "anniversary") return addYears(anchor, days);
  if (kind === "business") return addWorkdays(anchor, days, mask);
  return addCalendarDays(anchor, days);
}

function sentOn(notices: LienNoticeMark[], kind: NoticeKind): string | null {
  return notices.find((row) => row.kind === kind)?.sentOn ?? null;
}

function rightsAlive(facts: LienFacts, rule: LienRuleSpec, prelimDate: string | null, filingDate: string | null, enforceDate: string | null): boolean {
  const prelimSent = sentOn(facts.notices, "prelim");
  if (rule.prelimLapses && prelimDate && facts.today > prelimDate && !(prelimSent && prelimSent <= prelimDate)) return false;
  const filingSent = sentOn(facts.notices, "filing");
  if (filingDate && filingSent && filingSent <= filingDate) {
    if (!enforceDate) return true;
    return facts.today <= enforceDate;
  }
  if (filingDate && facts.today > filingDate) return false;
  return true;
}

function statusFor(date: string | null, sent: string | null, alive: boolean, today: string, paid: boolean, anchored: boolean): LienStatus {
  if (paid) return "paid";
  if (!anchored || !date) return "missing";
  if (sent && sent <= date) return "protected";
  const days = daysBetween(today, date);
  if (days < 0 && !alive) return "lapsed";
  if (days <= RISK_DAYS) return "at-risk";
  if (days <= DUE_DAYS) return "due";
  return "later";
}

function deadline(kind: DeadlineKind, label: string, date: string | null, sent: string | null, alive: boolean, facts: LienFacts, anchored: boolean): LienDeadline {
  const paid = facts.openCents <= 0;
  return {
    kind,
    label,
    date,
    daysLeft: date ? daysBetween(facts.today, date) : null,
    status: statusFor(date, sent, alive, facts.today, paid, anchored),
  };
}

export function evaluateLien(facts: LienFacts): LienEvaluation {
  const openCents = Math.max(0, facts.openCents);
  const rule = facts.rule;
  if (!rule) return { status: "missing", deadlines: [], openCents };
  const mask = facts.mask ?? 62;
  const filingAnchor = rule.fileAnchor === "completion" ? facts.completion || facts.last : facts.last || facts.completion;
  const filingDate = filingAnchor && rule.fileKind !== "none" ? shift(rule.fileKind, filingAnchor, rule.fileDays, rule.fileMonths, rule.fileDay, mask) : null;
  const prelimDate = facts.first && rule.prelimKind !== "none" ? shift(rule.prelimKind, facts.first, rule.prelimDays, rule.prelimMonths, rule.prelimDay, mask) : null;
  const intentDate =
    filingDate && rule.noiKind !== "none" ? shift(rule.noiKind === "business" ? "business" : "calendar", filingDate, -rule.noiDays, 0, 0, mask) : null;
  const filingSent = sentOn(facts.notices, "filing");
  const enforceAnchor = rule.enforceFrom === "filed" ? (filingSent && filingDate && filingSent <= filingDate ? filingSent : null) : filingDate;
  const enforceDate =
    enforceAnchor && rule.enforceKind !== "none"
      ? shift(rule.enforceKind === "anniversary" ? "anniversary" : rule.enforceKind === "business" ? "business" : "calendar", enforceAnchor, rule.enforceDays, 0, 0, mask)
      : null;
  const alive = rightsAlive(facts, rule, prelimDate, filingDate, enforceDate);
  const paidFacts = { ...facts, openCents };
  const deadlines: LienDeadline[] = [];
  if (rule.prelimKind !== "none") deadlines.push(deadline("prelim", "Preliminary", prelimDate, sentOn(facts.notices, "prelim"), alive, paidFacts, Boolean(facts.first)));
  if (rule.noiKind !== "none") deadlines.push(deadline("intent", "Intent", intentDate, sentOn(facts.notices, "intent"), alive, paidFacts, Boolean(filingDate)));
  if (rule.fileKind !== "none") deadlines.push(deadline("filing", "Filing", filingDate, filingSent, alive, paidFacts, Boolean(filingAnchor)));
  if (rule.enforceKind !== "none" && enforceDate) deadlines.push(deadline("enforcement", "Enforcement", enforceDate, null, alive, paidFacts, true));
  return { status: rollup(deadlines, openCents), deadlines, openCents };
}

function rollup(deadlines: LienDeadline[], openCents: number): LienStatus {
  if (openCents <= 0) return "paid";
  if (deadlines.some((row) => row.status === "missing")) return "missing";
  if (deadlines.some((row) => row.status === "at-risk")) return "at-risk";
  if (deadlines.some((row) => row.status === "due")) return "due";
  if (deadlines.some((row) => row.status === "lapsed")) return "lapsed";
  const notices = deadlines.filter((row) => row.kind === "prelim" || row.kind === "intent");
  if (notices.length === 0 || notices.every((row) => row.status === "protected")) return "protected";
  return "later";
}

export function attentionCount(deadlines: LienDeadline[]): number {
  return deadlines.filter((row) => row.status === "due" || row.status === "at-risk").length;
}
