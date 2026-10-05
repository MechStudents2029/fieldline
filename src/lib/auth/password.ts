import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString("hex");
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const next = Buffer.from(hashPassword(password, salt), "hex");
  const prev = Buffer.from(hash, "hex");
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}
