import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function hashFeedToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newFeedSecret(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashFeedToken(token) };
}

export function feedTokenMatches(token: string, tokenHash: string): boolean {
  const actual = Buffer.from(hashFeedToken(token), "hex");
  const expected = Buffer.from(tokenHash, "hex");
  if (actual.length !== expected.length || expected.length === 0) return false;
  return timingSafeEqual(actual, expected);
}
