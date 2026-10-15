import { addCalendarDays } from "@/lib/time/calendar";

export const CERT_WINDOWS = [7, 30, 90] as const;

export type CertBucket = "expired" | "7" | "30" | "90" | "current" | "none";
export type CertDisplay = "active" | "expired" | "revoked";

export function certBucket(expiresOn: string | null, doesNotExpire: boolean, today: string): CertBucket {
  if (doesNotExpire || !expiresOn) return "none";
  if (expiresOn < today) return "expired";
  if (expiresOn <= addCalendarDays(today, 7)) return "7";
  if (expiresOn <= addCalendarDays(today, 30)) return "30";
  if (expiresOn <= addCalendarDays(today, 90)) return "90";
  return "current";
}

export function displayStatus(stored: string, bucket: CertBucket): CertDisplay {
  if (stored === "revoked") return "revoked";
  if (bucket === "expired") return "expired";
  return "active";
}

export function statusLabel(status: CertDisplay): string {
  if (status === "expired") return "Expired";
  if (status === "revoked") return "Revoked";
  return "Active";
}

export function inCertAttention(bucket: CertBucket, stored: string): boolean {
  if (stored === "revoked") return false;
  return bucket === "expired" || bucket === "7" || bucket === "30" || bucket === "90";
}

/** Full number on an owner or admin CSV. Every other role gets a blank cell. */
export function csvCertNumber(role: string, number: string | null): string {
  if (role !== "owner" && role !== "admin") return "";
  return number ?? "";
}

export function maskCertNumber(number: string | null): string {
  const text = (number ?? "").trim();
  if (!text) return "";
  if (text.length <= 4) return text;
  return text.slice(-4);
}
