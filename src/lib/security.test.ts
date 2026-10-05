import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cronAuthorized,
  demoAssetPath,
  demoWebhookAllowed,
  fileResponseHeaders,
  fileVisible,
  acceptAllowed,
  appOrigin,
  parseSignup,
  photoUploadError,
  readSessionPayload,
  receiptUploadError,
  resetAcceptRateLimit,
  resetSignupRateLimit,
  resolveInside,
  signupAllowed,
  svgDocumentIsSafe,
} from "@/lib/security";

describe("cron and webhook gates", () => {
  it("requires a secret in production and accepts the local demo", () => {
    expect(cronAuthorized(null, {}).ok).toBe(true);
    expect(cronAuthorized(null, { NODE_ENV: "production" }).ok).toBe(false);
    expect(cronAuthorized(null, { VERCEL: "1" }).ok).toBe(false);
    expect(cronAuthorized("Bearer wrong", { CRON_SECRET: "s3cret" }).ok).toBe(false);
    expect(cronAuthorized("Bearer s3cret", { CRON_SECRET: "s3cret", NODE_ENV: "production" }).ok).toBe(true);
  });

  it("refuses the unsigned Stripe demo header on a public deploy", () => {
    expect(demoWebhookAllowed({})).toBe(true);
    expect(demoWebhookAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(demoWebhookAllowed({ VERCEL: "1" })).toBe(false);
    expect(demoWebhookAllowed({ VERCEL: "1", FIELDLINE_ALLOW_DEMO_WEBHOOK: "1" })).toBe(true);
  });
});

describe("sessions, files, and uploads", () => {
  it("accepts only string ids in the session payload", () => {
    expect(readSessionPayload({ userId: "user_maya", orgId: "org_rivera", exp: 1 })).toEqual({
      userId: "user_maya",
      orgId: "org_rivera",
      exp: 1,
    });
    expect(readSessionPayload({ userId: 1, orgId: "org_rivera", exp: 1 })).toBeNull();
    expect(readSessionPayload({ userId: "user_maya", orgId: "../org", exp: 1 })).toBeNull();
  });

  it("keeps uploads inside the data directory and demo assets on this host", () => {
    const root = path.join("/tmp", "fieldline");
    expect(resolveInside(root, "uploads/org_rivera/note.txt")).toBe(path.join(root, "uploads/org_rivera/note.txt"));
    expect(resolveInside(root, "../etc/passwd")).toBeNull();
    expect(resolveInside(root, "/etc/passwd")).toBeNull();
    expect(demoAssetPath("/demo/photos/vasquez-floor.svg")).toBe("/demo/photos/vasquez-floor.svg");
    expect(demoAssetPath("/demo/../.env")).toBeNull();
    expect(demoAssetPath("//evil.example/demo")).toBeNull();
  });

  it("does not advertise another company's file, and does not serve active SVG", () => {
    expect(fileVisible({ sessionOrgId: "org_northline", documentOrgId: "org_rivera", portalMatch: false })).toBe(false);
    expect(fileVisible({ sessionOrgId: null, documentOrgId: "org_rivera", portalMatch: false })).toBe(false);
    expect(fileVisible({ sessionOrgId: "org_rivera", documentOrgId: "org_rivera", portalMatch: false })).toBe(true);
    expect(fileVisible({ sessionOrgId: null, documentOrgId: "org_rivera", portalMatch: true })).toBe(true);

    const safe = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>Job photo</text></svg>`,
    );
    expect(svgDocumentIsSafe(safe.toString())).toBe(true);
    expect(fileResponseHeaders("note.svg", safe).get("Content-Type")).toBe("image/svg+xml");

    const evil = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`);
    expect(svgDocumentIsSafe(evil.toString())).toBe(false);
    const headers = fileResponseHeaders("evil.svg", evil);
    expect(headers.get("Content-Type")).toBe("application/octet-stream");
    expect(headers.get("Content-Disposition")).toMatch(/^attachment/);
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("checks a new company and slows repeat signups", () => {
    expect(
      parseSignup({
        ownerName: "Avery Cole",
        email: " Avery@Cole.Example ",
        password: "fieldline-test",
        companyName: "Cole Kitchens",
        trade: "remodel",
        state: "ca",
        starter: true,
      }),
    ).toMatchObject({ ok: true, value: { email: "avery@cole.example", state: "CA", trade: "remodel", timeZone: "America/New_York", weekStartsOn: 1 } });
    expect(
      parseSignup({
        ownerName: "Avery Cole",
        email: "a@b.co",
        password: "fieldline-test",
        companyName: "Cole Kitchens",
        trade: "remodel",
        state: "CA",
        starter: false,
        timeZone: "America/Los_Angeles",
        weekStartsOn: "0",
      }),
    ).toMatchObject({ ok: true, value: { timeZone: "America/Los_Angeles", weekStartsOn: 0 } });
    expect(
      parseSignup({
        ownerName: "Avery Cole",
        email: "a@b.co",
        password: "fieldline-test",
        companyName: "Cole Kitchens",
        trade: "remodel",
        state: "CA",
        starter: false,
        timeZone: "Not/AZone",
      }),
    ).toMatchObject({ error: "Pick a time zone." });
    expect(parseSignup({ ownerName: "A", email: "a@b.co", password: "short", companyName: "Co", trade: "remodel", state: "CA", starter: false }).ok).toBe(false);
    expect(parseSignup({ ownerName: "Avery Cole", email: "not-an-email", password: "fieldline-test", companyName: "Cole Kitchens", trade: "remodel", state: "CA", starter: false })).toMatchObject({ ok: false });
    expect(parseSignup({ ownerName: "Avery Cole", email: "a@b.co", password: "fieldline-test", companyName: "Cole Kitchens", trade: "spaceship", state: "CA", starter: false })).toMatchObject({ error: "Pick a trade." });
    expect(parseSignup({ ownerName: "Avery Cole", email: "a@b.co", password: "fieldline-test", companyName: "Cole Kitchens", trade: "deck", state: "ZZ", starter: false })).toMatchObject({ error: "Pick a U.S. state." });
    resetSignupRateLimit();
    const now = 1_700_000_000_000;
    for (let attempt = 0; attempt < 5; attempt += 1) expect(signupAllowed("203.0.113.4", now)).toBe(true);
    expect(signupAllowed("203.0.113.4", now)).toBe(false);
    expect(signupAllowed("203.0.113.4", now + 15 * 60 * 1000)).toBe(true);
    expect(signupAllowed("203.0.113.5", now)).toBe(true);
    resetAcceptRateLimit();
    for (let attempt = 0; attempt < 5; attempt += 1) expect(acceptAllowed("198.51.100.9", now)).toBe(true);
    expect(acceptAllowed("198.51.100.9", now)).toBe(false);
    expect(acceptAllowed("198.51.100.9", now + 15 * 60 * 1000)).toBe(true);
    expect(appOrigin({ APP_URL: "https://jobs.example/ignored", HOST: "evil.test" })).toBe("https://jobs.example");
    expect(appOrigin({ NODE_ENV: "production", HOST: "evil.test" })).toBeNull();
    expect(appOrigin({})).toBe("http://127.0.0.1:3847");
  });

  it("rejects markup and oversized receipt uploads", () => {
    expect(receiptUploadError("evil.svg", "<svg></svg>")).toMatch(/txt or .csv/);
    expect(receiptUploadError("note.txt", "x".repeat(1_000_001))).toMatch(/1 MB/);
    expect(receiptUploadError("note.txt", "Vendor: Casa Tile\nTotal $10.00")).toBeNull();
  });

  it("serves a real photo inline and rejects a renamed markup file", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(photoUploadError("sink.jpg", jpeg)).toBeNull();
    const headers = fileResponseHeaders("sink.jpg", jpeg);
    expect(headers.get("Content-Type")).toBe("image/jpeg");
    expect(headers.get("Content-Disposition")).toMatch(/^inline/);
    expect(photoUploadError("note.svg", jpeg)).toMatch(/JPEG/);
    expect(photoUploadError("photo.jpg", Buffer.from("<svg></svg>"))).toMatch(/JPEG/);
    expect(fileResponseHeaders("photo.jpg", Buffer.from("not-an-image")).get("Content-Type")).toBe("application/octet-stream");
  });
});
