const STOP = new Set(["tile", "with", "from", "each", "and", "the", "installed", "materials", "labor", "set"]);

export type CostCodeBookRow = {
  code: string;
  name: string;
  vendor: string | null;
  keywords: string | null;
};

export type CostCodeHistoryRow = {
  costCode: string | null;
  vendorName: string | null;
  projectId: string;
};

export type CostCodeSuggestion = {
  code: string;
  reason: string;
};

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string): string[] {
  return norm(value)
    .split(" ")
    .filter((word) => word.length >= 4 && !STOP.has(word));
}

function sameVendor(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = norm(left ?? "");
  const b = norm(right ?? "");
  return a.length > 0 && a === b;
}

/**
 * Pick a cost code this company already uses. Line text can break a tie.
 * Returns null when several codes match the vendor equally, or when nothing matches.
 */
export function suggestCostCode(input: {
  vendor: string | null;
  lineText: string;
  book: CostCodeBookRow[];
  history: CostCodeHistoryRow[];
  projectId: string;
}): CostCodeSuggestion | null {
  const vendor = input.vendor?.trim() || null;
  if (!vendor) return null;
  const lineTokens = new Set(tokens(input.lineText));
  const scores = new Map<string, { score: number; lineWord: string | null; job: boolean; company: boolean; vendor: boolean }>();

  function bump(code: string, points: number, patch: Partial<{ lineWord: string; job: boolean; company: boolean; vendor: boolean }>) {
    const current = scores.get(code) ?? { score: 0, lineWord: null, job: false, company: false, vendor: false };
    current.score += points;
    if (patch.lineWord) current.lineWord = patch.lineWord;
    if (patch.job) current.job = true;
    if (patch.company) current.company = true;
    if (patch.vendor) current.vendor = true;
    scores.set(code, current);
  }

  for (const item of input.book) {
    if (!item.code) continue;
    if (sameVendor(item.vendor, vendor)) bump(item.code, 4, { vendor: true });
    const words = tokens(`${item.keywords ?? ""} ${item.name}`);
    const hit = words.find((word) => lineTokens.has(word));
    if (hit) bump(item.code, 8, { lineWord: hit });
  }

  for (const row of input.history) {
    if (!row.costCode || !sameVendor(row.vendorName, vendor)) continue;
    if (row.projectId === input.projectId) bump(row.costCode, 6, { job: true });
    else bump(row.costCode, 3, { company: true });
  }

  let best: { code: string; score: number } | null = null;
  let tied = false;
  for (const [code, row] of scores) {
    if (row.score <= 0) continue;
    if (!best || row.score > best.score) {
      best = { code, score: row.score };
      tied = false;
    } else if (row.score === best.score && code !== best.code) {
      tied = true;
    }
  }
  if (!best || tied) return null;
  const row = scores.get(best.code)!;
  const word = row.lineWord ? row.lineWord.charAt(0).toUpperCase() + row.lineWord.slice(1) : null;
  const reason = word
    ? `${word} matches ${best.code} in the price book.`
    : row.job
      ? `${vendor} was posted to ${best.code} on this job.`
      : row.company
        ? `${vendor} was posted to ${best.code} on another job.`
        : `${vendor} is the vendor on ${best.code}.`;
  return { code: best.code, reason };
}
