import { describe, expect, it } from "vitest";
import { hashVendorToken, newVendorSecret, vendorTokenMatches } from "@/lib/vendor/token";

describe("vendor portal tokens", () => {
  it("stores a hash and treats a regenerated secret as a different link", () => {
    const first = newVendorSecret();
    const second = newVendorSecret();
    expect(first.tokenHash).toBe(hashVendorToken(first.token));
    expect(first.tokenHash).toHaveLength(64);
    expect(first.tokenHash).not.toContain(first.token);
    expect(first.token).not.toBe(second.token);
    expect(vendorTokenMatches(first.token, first.tokenHash)).toBe(true);
    expect(vendorTokenMatches(first.token, second.tokenHash)).toBe(false);
    expect(vendorTokenMatches("nope", first.tokenHash)).toBe(false);
    expect(vendorTokenMatches(second.token, first.tokenHash)).toBe(false);
  });
});
