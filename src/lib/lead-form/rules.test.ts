import { describe, expect, it } from "vitest";
import {
  IP_LIMIT,
  MAX_DESCRIPTION,
  MIN_FILL_MS,
  ORG_LIMIT,
  attributionLabel,
  defaultFields,
  embedSnippet,
  externalReferrer,
  fillTimeError,
  honeypotTripped,
  phonesMatch,
  rateLimitError,
  validatePublicAnswers,
} from "@/lib/lead-form/rules";

const types = ["Kitchen remodel", "Bath remodel", "Deck"];
const flags = defaultFields(true);

function answers(overrides: Record<string, string> = {}) {
  return validatePublicAnswers(
    {
      name: "Casey Ng",
      email: "casey.ng@example.com",
      phone: "",
      address: "18 Maple St",
      projectType: "Kitchen remodel",
      budget: "$25–50k",
      timeline: "1–3 months",
      description: "Kitchen, about 120 sq ft.",
      ...overrides,
    },
    flags,
    types,
  );
}

describe("lead form rules", () => {
  it("requires a name and one of email or phone", () => {
    expect(() => answers({ name: " " })).toThrow(/name/i);
    expect(() => answers({ name: "12" })).toThrow(/name/i);
    expect(() => answers({ email: "", phone: "" })).toThrow(/email or a phone/i);
    expect(answers({ email: "", phone: "(510) 555-0100" }).phone).toBe("(510) 555-0100");
    expect(() => answers({ email: "not-an-email" })).toThrow(/email/i);
    expect(() => answers({ phone: "555" })).toThrow(/phone/i);
  });

  it("caps text and only accepts listed choices", () => {
    expect(() => answers({ description: "a".repeat(MAX_DESCRIPTION + 1) })).toThrow(/too long/i);
    expect(() => answers({ address: "a".repeat(201) })).toThrow(/too long/i);
    expect(() => answers({ budget: "$1" })).toThrow(/budget/i);
    expect(() => answers({ timeline: "whenever" })).toThrow(/timeline/i);
    expect(() => answers({ projectType: "Pool" })).toThrow(/project type/i);
    expect(answers({ description: "" }).description).toBeNull();
  });

  it("drops fields the company turned off", () => {
    const quiet = defaultFields(false);
    const parsed = validatePublicAnswers(
      {
        name: "Casey Ng",
        email: "casey.ng@example.com",
        address: "18 Maple St",
        projectType: "Pool",
        budget: "nope",
        timeline: "nope",
        description: "secret",
      },
      quiet,
      types,
    );
    expect(parsed.address).toBeNull();
    expect(parsed.projectType).toBeNull();
    expect(parsed.budget).toBeNull();
    expect(parsed.description).toBeNull();
  });

  it("rejects a filled honeypot and a form sent too fast", () => {
    expect(honeypotTripped("")).toBe(false);
    expect(honeypotTripped("  ")).toBe(false);
    expect(honeypotTripped("https://spam.test")).toBe(true);
    const now = 1_700_000_000_000;
    expect(fillTimeError(now - 1_000, now)).toMatch(/Wait/);
    expect(fillTimeError(now - MIN_FILL_MS, now)).toBeNull();
    expect(fillTimeError(now - MIN_FILL_MS - 1, now)).toBeNull();
    expect(fillTimeError(now + 60_000, now)).toMatch(/again/);
    expect(fillTimeError(Number.NaN, now)).toMatch(/again/);
  });

  it("limits an address and a company", () => {
    expect(rateLimitError({ ipCount: IP_LIMIT - 1, orgCount: 0 })).toBeNull();
    expect(rateLimitError({ ipCount: IP_LIMIT, orgCount: 0 })).toMatch(/Too many/);
    expect(rateLimitError({ ipCount: 0, orgCount: ORG_LIMIT })).toMatch(/Too many/);
  });

  it("matches phones and keeps attribution short", () => {
    expect(phonesMatch("(510) 555-0166", "5105550166")).toBe(true);
    expect(phonesMatch("+1 510-555-0166", "510.555.0166")).toBe(true);
    expect(phonesMatch("555", "555")).toBe(false);
    expect(
      attributionLabel({
        source: "yard-sign",
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "spring",
        referrer: "https://example.com/remodel",
      }),
    ).toBe("source yard-sign · utm_source google · utm_medium cpc · utm_campaign spring · referrer https://example.com/remodel");
    expect(attributionLabel({})).toBeNull();
    expect(externalReferrer("https://example.com/contact")).toBe("https://example.com/contact");
    expect(externalReferrer("https://fieldline.test/f/secret")).toBeNull();
    expect(embedSnippet("https://fieldline.test/f/abc")).toContain('src="https://fieldline.test/f/abc"');
    expect(embedSnippet("https://fieldline.test/f/abc")).toContain("<a href=");
  });
});
