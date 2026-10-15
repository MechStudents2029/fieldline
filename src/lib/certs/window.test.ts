import { describe, expect, it } from "vitest";
import { certBucket, csvCertNumber, displayStatus, inCertAttention, maskCertNumber } from "@/lib/certs/window";

describe("credential windows", () => {
  const today = "2026-10-15";

  it("buckets expiry at 7, 30, and 90 days", () => {
    expect(certBucket("2026-09-15", false, today)).toBe("expired");
    expect(certBucket("2026-10-20", false, today)).toBe("7");
    expect(certBucket("2026-11-04", false, today)).toBe("30");
    expect(certBucket("2026-12-15", false, today)).toBe("90");
    expect(certBucket("2027-11-15", false, today)).toBe("current");
    expect(certBucket(null, true, today)).toBe("none");
    expect(displayStatus("active", "expired")).toBe("expired");
    expect(displayStatus("revoked", "expired")).toBe("revoked");
    expect(inCertAttention("30", "active")).toBe(true);
    expect(inCertAttention("current", "active")).toBe(false);
    expect(inCertAttention("expired", "revoked")).toBe(false);
  });

  it("keeps the card number off every CSV except owner and admin", () => {
    expect(csvCertNumber("owner", "OSHA-30-2201")).toBe("OSHA-30-2201");
    expect(csvCertNumber("admin", "OSHA-30-2201")).toBe("OSHA-30-2201");
    expect(csvCertNumber("estimator", "OSHA-30-2201")).toBe("");
    expect(csvCertNumber("field", "OSHA-10-4419")).toBe("");
    expect(csvCertNumber("viewer", "FL-1884")).toBe("");
    expect(maskCertNumber("OSHA-30-2201")).toBe("2201");
  });
});
