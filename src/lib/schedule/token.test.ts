import { describe, expect, it } from "vitest";
import { feedTokenMatches, hashFeedToken, newFeedSecret } from "@/lib/schedule/token";

describe("calendar feed tokens", () => {
  it("stores a hash and treats a rotated secret as a new token", () => {
    const first = newFeedSecret();
    const second = newFeedSecret();
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(hashFeedToken(first.token));
    expect(first.tokenHash).toHaveLength(64);
    expect(first.tokenHash).not.toContain(first.token);
    expect(feedTokenMatches(first.token, first.tokenHash)).toBe(true);
    expect(feedTokenMatches(first.token, second.tokenHash)).toBe(false);
    expect(feedTokenMatches("nope", first.tokenHash)).toBe(false);
  });
});
