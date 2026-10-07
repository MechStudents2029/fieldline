import { describe, expect, it } from "vitest";
import { localDay } from "@/lib/time/calendar";
import {
  certificateNeedsAttention,
  certificateStatus,
  poIssueDecision,
  poIssueProblems,
  vendorRollup,
} from "@/lib/vendor/compliance";

describe("vendor compliance", () => {
  const today = "2026-10-07";

  it("keeps a certificate current through its expiration day and expires the next day", () => {
    expect(certificateStatus("2026-11-06", today)).toMatchObject({ state: "expiring", days: 30, label: "Expires in 30 days" });
    expect(certificateStatus("2026-11-07", today)).toMatchObject({ state: "current", days: 31 });
    expect(certificateStatus("2026-10-08", today)).toMatchObject({ state: "expiring", label: "Expires in 1 day" });
    expect(certificateStatus(today, today)).toMatchObject({ state: "expiring", days: 0, label: "Expires today" });
    expect(certificateStatus("2026-10-06", today)).toMatchObject({ state: "expired", label: "Expired" });
    expect(certificateStatus(null, today).label).toBe("Missing");
  });

  it("uses the company time zone at the local midnight boundary", () => {
    const expires = "2026-10-07";
    const stillYesterday = localDay(Date.parse("2026-10-07T03:30:00Z"), "America/New_York");
    const newYorkDay = localDay(Date.parse("2026-10-07T04:00:00Z"), "America/New_York");
    const losAngeles = localDay(Date.parse("2026-10-07T04:00:00Z"), "America/Los_Angeles");
    const nextDay = localDay(Date.parse("2026-10-08T04:00:00Z"), "America/New_York");
    expect(stillYesterday).toBe("2026-10-06");
    expect(newYorkDay).toBe("2026-10-07");
    expect(losAngeles).toBe("2026-10-06");
    expect(certificateStatus(expires, stillYesterday).state).toBe("expiring");
    expect(certificateStatus(expires, newYorkDay)).toMatchObject({ state: "expiring", days: 0 });
    expect(certificateStatus(expires, losAngeles).state).toBe("expiring");
    expect(certificateStatus(expires, nextDay).state).toBe("expired");
  });

  it("rolls a vendor up to the strongest problem and counts expiring or expired certificates", () => {
    const certs = [
      { type: "general_liability", expiresOn: "2026-10-25" },
      { type: "license", expiresOn: "2026-10-01" },
    ];
    expect(vendorRollup(["general_liability", "workers_comp"], certs, today).label).toBe("Missing");
    expect(vendorRollup(["general_liability"], certs, today).label).toBe("Expired");
    expect(vendorRollup([], [{ type: "general_liability", expiresOn: "2026-10-25" }], today).label).toBe("Expires in 18 days");
    expect(vendorRollup([], [{ type: "general_liability", expiresOn: "2027-10-07" }], today).label).toBe("Current");
    expect(certificateNeedsAttention(certs, today)).toBe(true);
    expect(certificateNeedsAttention([{ type: "workers_comp", expiresOn: null }], today)).toBe(false);
    expect(certificateNeedsAttention([{ type: "general_liability", expiresOn: "2026-11-07" }], today)).toBe(false);
  });

  it("blocks or warns only for expired or missing required certificates", () => {
    const certs = [{ type: "general_liability", expiresOn: "2026-10-25" }];
    const problems = poIssueProblems(["general_liability", "workers_comp"], certs, today);
    expect(problems).toEqual(["Workers comp missing"]);
    expect(poIssueDecision("warn", problems)).toEqual({ error: null, warning: "Workers comp missing" });
    expect(poIssueDecision("block", problems).error).toBe("Workers comp missing");
    expect(poIssueDecision("block", []).warning).toBeNull();
    const expired = poIssueProblems(["general_liability"], [{ type: "general_liability", expiresOn: "2026-10-06" }], today);
    expect(expired).toEqual(["General liability expired"]);
    expect(poIssueProblems(["general_liability"], certs, today)).toEqual([]);
  });
});
