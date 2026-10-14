/** Channel math. Counts and money stay integers. A zero denominator is null, never NaN or Infinity. */

export type DayRange = { from: string; to: string };

export type SourceFact = { id: string; name: string; archived: boolean };

export type LeadFact = { sourceId: string; createdOn: string };

export type WinFact = { sourceId: string; wonOn: string };

export type JobFact = { sourceId: string; signedOn: string; soldCents: number };

export type CashFact = { sourceId: string; paidOn: string; cents: number };

export type SpendFact = { sourceId: string; month: string; cents: number };

export type AttributionRow = {
  id: string;
  name: string;
  archived: boolean;
  leads: number;
  won: number;
  winRateBps: number | null;
  soldCents: number;
  collectedCents: number;
  spendCents: number;
  costPerLeadCents: number | null;
  costPerWonCents: number | null;
  returnHundredths: number | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

function whole(value: number): number {
  if (!Number.isInteger(value) || !Number.isFinite(value)) return 0;
  return value;
}

/** Signed contract plus approved change orders. Draft, sent, and void stay off. */
export function contractSoldCents(originalCents: number, orders: { status: string; priceDeltaCents: number }[]): number {
  let sold = whole(originalCents);
  for (const order of orders) {
    if (order.status !== "approved") continue;
    sold += whole(order.priceDeltaCents);
  }
  return sold;
}

export function dayInRange(day: string, range: DayRange): boolean {
  if (!DAY.test(day)) return false;
  if (range.from && day < range.from) return false;
  if (range.to && day > range.to) return false;
  return true;
}

/** A spend month counts when any of its days sit in the range. */
export function monthInRange(month: string, range: DayRange): boolean {
  if (!MONTH.test(month)) return false;
  if (!range.from && !range.to) return true;
  const [year, mon] = month.split("-").map(Number);
  if (!year || !mon || mon < 1 || mon > 12) return false;
  const start = `${month}-01`;
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const end = `${month}-${String(last).padStart(2, "0")}`;
  if (range.from && end < range.from) return false;
  if (range.to && start > range.to) return false;
  return true;
}

export function rateBps(part: number, wholeCount: number): number | null {
  const denominator = whole(wholeCount);
  if (denominator === 0) return null;
  const bps = Math.round((whole(part) * 10_000) / denominator);
  return Number.isFinite(bps) ? bps : null;
}

export function divideCents(numerator: number, denominator: number): number | null {
  const count = whole(denominator);
  if (count === 0) return null;
  const cents = Math.round(whole(numerator) / count);
  return Number.isFinite(cents) ? cents : null;
}

/** collected / spend, in hundredths. 150 is 1.50. Null when spend is 0. */
export function ratioHundredths(numerator: number, denominator: number): number | null {
  const spend = whole(denominator);
  if (spend === 0) return null;
  const hundredths = Math.round((whole(numerator) * 100) / spend);
  return Number.isFinite(hundredths) ? hundredths : null;
}

export function formatReturn(hundredths: number | null): string {
  if (hundredths == null || !Number.isInteger(hundredths) || !Number.isFinite(hundredths)) return "—";
  const sign = hundredths < 0 ? "-" : "";
  const abs = Math.abs(hundredths);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function ratios(input: { leads: number; won: number; soldCents: number; collectedCents: number; spendCents: number }) {
  const leads = whole(input.leads);
  const won = whole(input.won);
  const soldCents = whole(input.soldCents);
  const collectedCents = whole(input.collectedCents);
  const spendCents = whole(input.spendCents);
  return {
    leads,
    won,
    soldCents,
    collectedCents,
    spendCents,
    winRateBps: rateBps(won, leads),
    costPerLeadCents: divideCents(spendCents, leads),
    costPerWonCents: divideCents(spendCents, won),
    returnHundredths: ratioHundredths(collectedCents, spendCents),
  };
}

function row(id: string, name: string, archived: boolean, input: Parameters<typeof ratios>[0]): AttributionRow {
  const figured = ratios(input);
  return { id, name, archived, ...figured };
}

export function attribute(
  input: {
    sources: SourceFact[];
    leads: LeadFact[];
    wins: WinFact[];
    jobs: JobFact[];
    cash: CashFact[];
    spend: SpendFact[];
  },
  range: DayRange,
): { rows: AttributionRow[]; total: AttributionRow } {
  const totals = { leads: 0, won: 0, soldCents: 0, collectedCents: 0, spendCents: 0 };
  const rows: AttributionRow[] = [];
  for (const source of input.sources) {
    const leads = input.leads.filter((lead) => lead.sourceId === source.id && dayInRange(lead.createdOn, range)).length;
    const won = input.wins.filter((win) => win.sourceId === source.id && dayInRange(win.wonOn, range)).length;
    const soldCents = input.jobs
      .filter((job) => job.sourceId === source.id && dayInRange(job.signedOn, range))
      .reduce((sum, job) => sum + whole(job.soldCents), 0);
    const collectedCents = input.cash
      .filter((cash) => cash.sourceId === source.id && dayInRange(cash.paidOn, range))
      .reduce((sum, cash) => sum + whole(cash.cents), 0);
    const spendCents = input.spend
      .filter((spend) => spend.sourceId === source.id && monthInRange(spend.month, range))
      .reduce((sum, spend) => sum + whole(spend.cents), 0);
    const active = leads > 0 || won > 0 || soldCents !== 0 || collectedCents !== 0 || spendCents !== 0;
    if (source.archived && !active) continue;
    totals.leads += leads;
    totals.won += won;
    totals.soldCents += soldCents;
    totals.collectedCents += collectedCents;
    totals.spendCents += spendCents;
    rows.push(row(source.id, source.name, source.archived, { leads, won, soldCents, collectedCents, spendCents }));
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, total: row("total", "Total", false, totals) };
}
