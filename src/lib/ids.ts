import { randomBytes, randomUUID } from "node:crypto";

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function token(bytes = 18): string {
  return randomBytes(bytes).toString("base64url");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}
