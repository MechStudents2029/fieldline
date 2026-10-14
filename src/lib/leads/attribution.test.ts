import { describe, expect, it } from "vitest";
import {
  attribute,
  contractSoldCents,
  dayInRange,
  formatReturn,
  monthInRange,
  type CashFact,
  type JobFact,
  type LeadFact,
  type SourceFact,
  type SpendFact,
} from "@/lib/leads/attribution";

const sources: SourceFact[] = [
  { id: "google", name: "Google", archived: false },
  { id: "referral", name: "Referral", archived: false },
  { id: "show", name: "Home show", archived: true },
  { id: "yard", name: "Yard sign", archived: false },
];

const open: { from: string; to: string } = { from: "", to: "" };

function finite(row: { winRateBps: number | null; costPerLeadCents: number | null; costPerWonCents: number | null; returnHundredths: number | null }) {
  for (const value of [row.winRateBps, row.costPerLeadCents, row.costPerWonCents, row.returnHundredths]) {
    if (value == null) continue;
    expect(Number.isFinite(value)).toBe(true);
    expect(Number.isInteger(value)).toBe(true);
  }
}

describe("lead source attribution", () => {
  it("computes win rate, cost per lead, cost per won job, and return", () => {
    const leads: LeadFact[] = [
      { sourceId: "google", createdOn: "2026-08-02" },
      { sourceId: "google", createdOn: "2026-08-03" },
      { sourceId: "google", createdOn: "2026-08-04" },
      { sourceId: "referral", createdOn: "2026-08-05" },
    ];
    const wins = [
      { sourceId: "google", wonOn: "2026-08-20" },
      { sourceId: "google", wonOn: "2026-09-01" },
      { sourceId: "referral", wonOn: "2026-08-18" },
    ];
    const jobs: JobFact[] = [
      { sourceId: "google", signedOn: "2026-08-20", soldCents: 100_00 },
      { sourceId: "google", signedOn: "2026-09-01", soldCents: 50_00 },
      { sourceId: "referral", signedOn: "2026-08-18", soldCents: 80_00 },
    ];
    const cash: CashFact[] = [
      { sourceId: "google", paidOn: "2026-08-21", cents: 40_00 },
      { sourceId: "referral", paidOn: "2026-08-19", cents: 80_00 },
    ];
    const spend: SpendFact[] = [
      { sourceId: "google", month: "2026-08", cents: 30_00 },
      { sourceId: "referral", month: "2026-08", cents: 0 },
    ];
    const report = attribute({ sources, leads, wins, jobs, cash, spend }, { from: "2026-08-01", to: "2026-08-31" });
    const google = report.rows.find((row) => row.id === "google");
    expect(google).toMatchObject({
      leads: 3,
      won: 1,
      winRateBps: 3333,
      soldCents: 100_00,
      collectedCents: 40_00,
      spendCents: 30_00,
      costPerLeadCents: 10_00,
      costPerWonCents: 30_00,
      returnHundredths: 133,
    });
    expect(formatReturn(google?.returnHundredths ?? null)).toBe("1.33");
    finite(google!);
  });

  it("dashes return and per-won cost when spend or wins are zero", () => {
    const report = attribute(
      {
        sources,
        leads: [{ sourceId: "referral", createdOn: "2026-08-02" }],
        wins: [],
        jobs: [],
        cash: [],
        spend: [{ sourceId: "referral", month: "2026-08", cents: 0 }],
      },
      open,
    );
    const referral = report.rows.find((row) => row.id === "referral");
    expect(referral).toMatchObject({
      leads: 1,
      won: 0,
      winRateBps: 0,
      spendCents: 0,
      costPerLeadCents: 0,
      costPerWonCents: null,
      returnHundredths: null,
    });
    expect(formatReturn(null)).toBe("—");
    const empty = attribute({ sources, leads: [], wins: [], jobs: [], cash: [], spend: [] }, open);
    const google = empty.rows.find((row) => row.id === "google");
    expect(google).toMatchObject({ leads: 0, winRateBps: null, costPerLeadCents: null, costPerWonCents: null, returnHundredths: null });
    expect(empty.total.winRateBps).toBeNull();
    finite(empty.total);
  });

  it("keeps an archived source when it still has leads or spend", () => {
    const report = attribute(
      {
        sources,
        leads: [{ sourceId: "show", createdOn: "2026-06-02" }],
        wins: [],
        jobs: [],
        cash: [],
        spend: [{ sourceId: "show", month: "2026-06", cents: 80_000 }],
      },
      open,
    );
    expect(report.rows.find((row) => row.id === "show")).toMatchObject({ archived: true, leads: 1, spendCents: 80_000, costPerLeadCents: 80_000 });
    const quiet = attribute({ sources, leads: [], wins: [], jobs: [], cash: [], spend: [] }, open);
    expect(quiet.rows.some((row) => row.id === "show")).toBe(false);
  });

  it("includes the edge days and the months they touch, and drops the days outside", () => {
    expect(dayInRange("2026-08-01", { from: "2026-08-01", to: "2026-08-31" })).toBe(true);
    expect(dayInRange("2026-08-31", { from: "2026-08-01", to: "2026-08-31" })).toBe(true);
    expect(dayInRange("2026-07-31", { from: "2026-08-01", to: "2026-08-31" })).toBe(false);
    expect(dayInRange("2026-09-01", { from: "2026-08-01", to: "2026-08-31" })).toBe(false);
    expect(monthInRange("2026-08", { from: "2026-08-01", to: "2026-08-01" })).toBe(true);
    expect(monthInRange("2026-08", { from: "2026-08-31", to: "2026-08-31" })).toBe(true);
    expect(monthInRange("2026-07", { from: "2026-08-01", to: "2026-08-31" })).toBe(false);
    expect(monthInRange("2026-09", { from: "2026-08-01", to: "2026-08-31" })).toBe(false);
    const report = attribute(
      {
        sources,
        leads: [
          { sourceId: "google", createdOn: "2026-07-31" },
          { sourceId: "google", createdOn: "2026-08-01" },
          { sourceId: "google", createdOn: "2026-08-31" },
          { sourceId: "google", createdOn: "2026-09-01" },
        ],
        wins: [
          { sourceId: "google", wonOn: "2026-07-31" },
          { sourceId: "google", wonOn: "2026-08-01" },
          { sourceId: "google", wonOn: "2026-09-01" },
        ],
        jobs: [
          { sourceId: "google", signedOn: "2026-07-31", soldCents: 1 },
          { sourceId: "google", signedOn: "2026-08-01", soldCents: 5_00 },
          { sourceId: "google", signedOn: "2026-09-01", soldCents: 9_00 },
        ],
        cash: [
          { sourceId: "google", paidOn: "2026-07-31", cents: 1 },
          { sourceId: "google", paidOn: "2026-08-31", cents: 2_00 },
        ],
        spend: [
          { sourceId: "google", month: "2026-07", cents: 70_00 },
          { sourceId: "google", month: "2026-08", cents: 80_00 },
          { sourceId: "google", month: "2026-09", cents: 90_00 },
        ],
      },
      { from: "2026-08-01", to: "2026-08-31" },
    );
    expect(report.rows.find((row) => row.id === "google")).toMatchObject({
      leads: 2,
      won: 1,
      soldCents: 5_00,
      collectedCents: 2_00,
      spendCents: 80_00,
    });
  });

  it("adds approved change orders to sold value and leaves the others out", () => {
    expect(
      contractSoldCents(1_000_00, [
        { status: "approved", priceDeltaCents: 20_000 },
        { status: "approved", priceDeltaCents: -5_000 },
        { status: "sent", priceDeltaCents: 96_000 },
        { status: "draft", priceDeltaCents: 18_000 },
        { status: "void", priceDeltaCents: 4_000 },
      ]),
    ).toBe(1_150_00);
    const report = attribute(
      {
        sources,
        leads: [{ sourceId: "yard", createdOn: "2026-08-02" }],
        wins: [{ sourceId: "yard", wonOn: "2026-08-10" }],
        jobs: [{ sourceId: "yard", signedOn: "2026-08-10", soldCents: contractSoldCents(1_000_00, [{ status: "approved", priceDeltaCents: 15_000 }]) }],
        cash: [],
        spend: [],
      },
      open,
    );
    expect(report.rows.find((row) => row.id === "yard")?.soldCents).toBe(1_150_00);
  });

  it("recomputes the totals row from the sums, not from the row ratios", () => {
    const report = attribute(
      {
        sources,
        leads: [
          { sourceId: "google", createdOn: "2026-08-02" },
          { sourceId: "referral", createdOn: "2026-08-03" },
          { sourceId: "referral", createdOn: "2026-08-04" },
        ],
        wins: [{ sourceId: "google", wonOn: "2026-08-20" }],
        jobs: [{ sourceId: "google", signedOn: "2026-08-20", soldCents: 200_00 }],
        cash: [{ sourceId: "google", paidOn: "2026-08-21", cents: 100_00 }],
        spend: [
          { sourceId: "google", month: "2026-08", cents: 50_00 },
          { sourceId: "referral", month: "2026-08", cents: 10_00 },
        ],
      },
      open,
    );
    expect(report.total).toMatchObject({
      leads: 3,
      won: 1,
      winRateBps: 3333,
      soldCents: 200_00,
      collectedCents: 100_00,
      spendCents: 60_00,
      costPerLeadCents: 20_00,
      costPerWonCents: 60_00,
      returnHundredths: 167,
    });
    const averaged = Math.round(((10_000 + 0) / 2));
    expect(report.total.winRateBps).not.toBe(averaged);
    finite(report.total);
    expect(formatReturn(report.total.returnHundredths)).toBe("1.67");
  });
});
