import { addCalendarDays } from "@/lib/time/calendar";

export const CERT_TYPES = [
  { id: "general_liability", label: "General liability" },
  { id: "workers_comp", label: "Workers comp" },
  { id: "license", label: "License" },
  { id: "w9", label: "W-9" },
  { id: "other", label: "Other" },
] as const;

export type CertType = (typeof CERT_TYPES)[number]["id"];

export const DEFAULT_REQUIRED: CertType[] = ["general_liability", "workers_comp"];

const TYPE_IDS = new Set<string>(CERT_TYPES.map((row) => row.id));

export type CertSnapshot = { type: string; expiresOn: string | null };

export type CertState = "current" | "expiring" | "expired" | "missing";

export type CertStatus = { state: CertState; days: number | null; label: string };

export function certLabel(type: string): string {
  return CERT_TYPES.find((row) => row.id === type)?.label ?? "Certificate";
}

export function isCertType(value: string): value is CertType {
  return TYPE_IDS.has(value);
}

export function parseRequiredTypes(raw: string | null | undefined): CertType[] {
  const seen = new Set<CertType>();
  for (const part of (raw ?? "").split(",")) {
    const id = part.trim();
    if (isCertType(id)) seen.add(id);
  }
  return CERT_TYPES.map((row) => row.id).filter((id) => seen.has(id));
}

export function parseComplianceMode(value: string | null | undefined): "warn" | "block" {
  return value === "block" ? "block" : "warn";
}

/** Whole calendar days from today until the expiration day. Negative means past. */
export function daysUntil(today: string, expiresOn: string): number {
  const start = Date.parse(`${today}T00:00:00Z`);
  const end = Date.parse(`${expiresOn}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/** Valid through the expiration day in the company calendar. The next local day is expired. */
export function certificateStatus(expiresOn: string | null | undefined, today: string): CertStatus {
  if (!expiresOn || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return { state: "missing", days: null, label: "Missing" };
  const days = daysUntil(today, expiresOn);
  if (days < 0) return { state: "expired", days, label: "Expired" };
  if (days === 0) return { state: "expiring", days: 0, label: "Expires today" };
  if (days <= 30) return { state: "expiring", days, label: `Expires in ${days} ${days === 1 ? "day" : "days"}` };
  return { state: "current", days, label: "Current" };
}

export function vendorRollup(required: string[], certificates: CertSnapshot[], today: string): CertStatus {
  const byType = new Map(certificates.map((row) => [row.type, row]));
  if (required.some((type) => !byType.get(type)?.expiresOn)) return { state: "missing", days: null, label: "Missing" };
  let expired = false;
  let soonest: number | null = null;
  for (const row of certificates) {
    const status = certificateStatus(row.expiresOn, today);
    if (status.state === "expired") expired = true;
    if (status.state === "expiring" && status.days != null) soonest = soonest == null ? status.days : Math.min(soonest, status.days);
  }
  if (expired) return { state: "expired", days: null, label: "Expired" };
  if (soonest != null) return certificateStatus(addCalendarDays(today, soonest), today);
  return { state: "current", days: null, label: "Current" };
}

/** Today counts a vendor with a certificate that is expired or due within 30 days. */
export function certificateNeedsAttention(certificates: CertSnapshot[], today: string): boolean {
  return certificates.some((row) => {
    const status = certificateStatus(row.expiresOn, today);
    return status.state === "expired" || status.state === "expiring";
  });
}

export function soonestCertificateDays(certificates: CertSnapshot[], today: string): number | null {
  let soonest: number | null = null;
  for (const row of certificates) {
    if (!row.expiresOn) continue;
    const days = daysUntil(today, row.expiresOn);
    if (days > 30) continue;
    soonest = soonest == null ? days : Math.min(soonest, days);
  }
  return soonest;
}

/** Expired or missing required certificates. Expiring soon does not stop a purchase order. */
export function poIssueProblems(required: string[], certificates: CertSnapshot[], today: string): string[] {
  const byType = new Map(certificates.map((row) => [row.type, row]));
  const problems: string[] = [];
  for (const type of required) {
    const row = byType.get(type);
    const label = certLabel(type);
    if (!row?.expiresOn) {
      problems.push(`${label} missing`);
      continue;
    }
    if (row.expiresOn < today) problems.push(`${label} expired`);
  }
  return problems;
}

export function poIssueDecision(
  mode: "warn" | "block",
  problems: string[],
): { error: string | null; warning: string | null } {
  if (problems.length === 0) return { error: null, warning: null };
  const text = problems.join(", ");
  if (mode === "block") return { error: text, warning: null };
  return { error: null, warning: text };
}
