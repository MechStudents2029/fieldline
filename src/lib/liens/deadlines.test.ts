import { describe, expect, it } from "vitest";
import { localDay } from "@/lib/time/calendar";
import {
  SEEDED_LIEN_RULES,
  addMonths,
  addYears,
  attentionCount,
  daysBetween,
  evaluateLien,
  furnishSpan,
  monthDayAfter,
  recentMonthDay,
  type LienFacts,
  type LienRuleSpec,
} from "@/lib/liens/deadlines";

const ca = SEEDED_LIEN_RULES.find((rule) => rule.state === "CA") as LienRuleSpec;
const tx = SEEDED_LIEN_RULES.find((rule) => rule.state === "TX") as LienRuleSpec;
const fl = SEEDED_LIEN_RULES.find((rule) => rule.state === "FL") as LienRuleSpec;

function facts(patch: Partial<LienFacts> & Pick<LienFacts, "rule">): LienFacts {
  return {
    today: "2026-10-15",
    first: null,
    last: null,
    completion: null,
    notices: [],
    openCents: 100_00,
    mask: 62,
    ...patch,
  };
}

describe("lien deadline math", () => {
  it("adds calendar days, business days, and month-day deadlines", () => {
    expect(daysBetween("2026-01-31", "2026-02-20")).toBe(20);
    const business: LienRuleSpec = { ...ca, prelimKind: "business", prelimDays: 1 };
    const friday = evaluateLien(facts({ rule: business, first: "2026-10-16", last: "2026-10-16", completion: "2026-10-16", today: "2026-10-16" }));
    expect(friday.deadlines.find((row) => row.kind === "prelim")?.date).toBe("2026-10-19");
    expect(monthDayAfter("2026-01-31", 3, 15)).toBe("2026-04-15");
    expect(evaluateLien(facts({ rule: tx, first: "2026-01-31", last: "2026-01-31", today: "2026-01-31" })).deadlines.find((row) => row.kind === "prelim")?.date).toBe("2026-04-15");
  });

  it("clamps month-end and a leap-year anniversary", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(monthDayAfter("2026-01-31", 1, 31)).toBe("2026-02-28");
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    const filed = evaluateLien(
      facts({
        rule: { ...fl, enforceFrom: "filed" },
        today: "2024-02-29",
        first: "2024-02-01",
        last: "2024-02-29",
        notices: [
          { kind: "prelim", sentOn: "2024-02-01" },
          { kind: "filing", sentOn: "2024-02-29" },
        ],
      }),
    );
    expect(filed.deadlines.find((row) => row.kind === "enforcement")?.date).toBe("2025-02-28");
  });

  it("reads the company time zone", () => {
    expect(localDay(Date.parse("2026-10-16T03:00:00.000Z"), "America/New_York")).toBe("2026-10-15");
    expect(recentMonthDay("2026-10-15", 15)).toBe("2026-10-15");
    expect(recentMonthDay("2026-10-14", 15)).toBe("2026-09-15");
  });

  it("moves due, at risk, lapsed, and protected", () => {
    const due = evaluateLien(facts({ rule: ca, first: "2026-10-05", last: "2026-10-15", completion: "2026-10-15" }));
    expect(due.deadlines.find((row) => row.kind === "prelim")).toMatchObject({ date: "2026-10-25", status: "due" });
    expect(due.status).toBe("due");

    const risk = evaluateLien(facts({ rule: ca, first: "2026-09-28", last: "2026-10-15", completion: "2026-10-15" }));
    expect(risk.deadlines.find((row) => row.kind === "prelim")?.status).toBe("at-risk");
    expect(risk.status).toBe("at-risk");

    const past = evaluateLien(facts({ rule: ca, first: "2026-09-01", last: "2026-10-15", completion: "2026-10-15" }));
    expect(past.deadlines.find((row) => row.kind === "prelim")?.status).toBe("at-risk");

    const lapsed = evaluateLien(facts({ rule: fl, first: "2026-08-01", last: "2026-10-15" }));
    expect(lapsed.deadlines.find((row) => row.kind === "prelim")?.status).toBe("lapsed");
    expect(lapsed.status).toBe("lapsed");

    const protectedJob = evaluateLien(
      facts({
        rule: ca,
        first: "2026-09-01",
        last: "2026-10-15",
        completion: "2026-10-15",
        notices: [{ kind: "prelim", sentOn: "2026-09-01" }],
      }),
    );
    expect(protectedJob.deadlines.find((row) => row.kind === "prelim")?.status).toBe("protected");
    expect(protectedJob.deadlines.find((row) => row.kind === "filing")?.date).toBe("2027-01-13");
    expect(protectedJob.status).toBe("protected");
    expect(attentionCount(protectedJob.deadlines)).toBe(0);
    expect(attentionCount(risk.deadlines)).toBe(1);
  });

  it("stops at a zero balance and when an anchor is missing", () => {
    const paid = evaluateLien(facts({ rule: ca, first: "2026-10-05", last: "2026-10-15", completion: "2026-10-15", openCents: 0 }));
    expect(paid.status).toBe("paid");
    expect(paid.deadlines.every((row) => row.status === "paid")).toBe(true);
    expect(attentionCount(paid.deadlines)).toBe(0);

    const missing = evaluateLien(facts({ rule: fl, first: null, last: null, openCents: 42_000 }));
    expect(missing.status).toBe("missing");
    expect(furnishSpan(["2026-10-02", "2026-09-01"])).toEqual({ first: "2026-09-01", last: "2026-10-02" });
    expect(furnishSpan([])).toEqual({ first: null, last: null });
  });
});
