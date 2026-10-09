export const WAIVER_TYPES = ["conditional_progress", "unconditional_progress", "conditional_final", "unconditional_final"] as const;
export type WaiverType = (typeof WAIVER_TYPES)[number];

export const WAIVER_TYPE_LABEL: Record<WaiverType, string> = {
  conditional_progress: "Conditional progress",
  unconditional_progress: "Unconditional progress",
  conditional_final: "Conditional final",
  unconditional_final: "Unconditional final",
};

export const WAIVER_MODES = ["off", "warn", "block"] as const;
export type WaiverMode = (typeof WAIVER_MODES)[number];

export const DEFAULT_WAIVER_BODIES: Record<WaiverType, string> = {
  conditional_progress:
    "Conditional progress waiver. {vendor} waives lien rights for {job} through {through} for {amount} on bill {bill}, only after that amount is paid. {company}.",
  unconditional_progress: "Unconditional progress waiver. {vendor} waives lien rights for {job} through {through} for {amount} on bill {bill}. {company}.",
  conditional_final:
    "Conditional final waiver. {vendor} waives lien rights for {job} through {through} for {amount} on bill {bill}, only after that amount is paid. {company}.",
  unconditional_final: "Unconditional final waiver. {vendor} waives lien rights for {job} through {through} for {amount} on bill {bill}. {company}.",
};

const TYPE_SET = new Set<string>(WAIVER_TYPES);

export function isWaiverType(value: string): value is WaiverType {
  return TYPE_SET.has(value);
}

export function parseWaiverMode(value: string | null | undefined): WaiverMode {
  if (value === "off" || value === "block") return value;
  return "warn";
}

export function waiverTypeLabel(type: string): string {
  return isWaiverType(type) ? WAIVER_TYPE_LABEL[type] : "Waiver";
}

export function waiverStatusLabel(status: string): string {
  if (status === "requested") return "Requested";
  if (status === "signed") return "Signed";
  if (status === "void") return "Void";
  return status;
}

export type WaiverFill = {
  vendor: string;
  job: string;
  amount: string;
  through: string;
  bill: string;
  company: string;
};

export function renderWaiver(template: string, fields: WaiverFill): string {
  return template
    .replaceAll("{vendor}", fields.vendor)
    .replaceAll("{job}", fields.job)
    .replaceAll("{amount}", fields.amount)
    .replaceAll("{through}", fields.through)
    .replaceAll("{bill}", fields.bill)
    .replaceAll("{company}", fields.company);
}

/** A final waiver is due when the job is closed or this is the vendor's last open bill on it. */
export function waiverIsFinal(jobClosed: boolean, otherApprovedBills: number): boolean {
  return jobClosed || otherApprovedBills === 0;
}

export function requiredWaiverType(stage: "before" | "after", final: boolean): WaiverType {
  if (stage === "before") return final ? "conditional_final" : "conditional_progress";
  return final ? "unconditional_final" : "unconditional_progress";
}

export function jobClosedForWaiver(status: string, closedAt: string | null | undefined): boolean {
  return Boolean(closedAt) || status === "complete";
}

export const PAY_GATE_MESSAGE = "Lien waiver is not signed.";

export function assessPayGate(mode: WaiverMode, signed: boolean): { error: string | null; warning: string | null } {
  if (mode === "off" || signed) return { error: null, warning: null };
  if (mode === "block") return { error: PAY_GATE_MESSAGE, warning: null };
  return { error: null, warning: PAY_GATE_MESSAGE };
}

export type WaiverSnap = { type: string; status: string };

/** List column. A signed waiver wins, then a request, otherwise missing. */
export function displayWaiverState(rows: WaiverSnap[]): "missing" | "requested" | "signed" {
  const live = rows.filter((row) => row.status !== "void");
  if (live.some((row) => row.status === "signed")) return "signed";
  if (live.some((row) => row.status === "requested")) return "requested";
  return "missing";
}

export function displayWaiverLabel(state: "missing" | "requested" | "signed"): string {
  if (state === "signed") return "Signed";
  if (state === "requested") return "Requested";
  return "Missing";
}

/** Today counts a bill that is paid, or due within 7 days, when the waiver for that stage is unsigned. */
export function waiverMissingForToday(input: { status: string; dueDate: string | null; today: string; requiredSigned: boolean }): boolean {
  if (input.requiredSigned) return false;
  if (input.status === "paid") return true;
  if (input.status !== "approved" || !input.dueDate) return false;
  const limit = input.today;
  const due = input.dueDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !/^\d{4}-\d{2}-\d{2}$/.test(limit)) return false;
  const horizon = Date.parse(`${limit}T00:00:00Z`) + 7 * 86_400_000;
  const dueMs = Date.parse(`${due}T00:00:00Z`);
  return Number.isFinite(dueMs) && dueMs <= horizon;
}
