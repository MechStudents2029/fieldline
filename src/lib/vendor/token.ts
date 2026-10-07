import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Seeded Harbor Plumbing portal. Stored only as a hash. A new link replaces it. */
export const DEMO_HARBOR_PORTAL_TOKEN = "demo_vendor_harbor_m3p8qx7k";

export function hashVendorToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newVendorSecret(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashVendorToken(token) };
}

export function vendorTokenMatches(token: string, tokenHash: string): boolean {
  const actual = Buffer.from(hashVendorToken(token), "hex");
  const expected = Buffer.from(tokenHash, "hex");
  if (actual.length !== expected.length || expected.length === 0) return false;
  return timingSafeEqual(actual, expected);
}
