import { createHash, randomBytes } from "node:crypto";

/** 32-byte CSPRNG, base64url, no padding. This value is shown once and never stored. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function inviteTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
