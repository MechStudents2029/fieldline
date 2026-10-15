import { netPayableCents } from "@/lib/bills/retainage";

/** 1099-NEC threshold in cents. 2025 and earlier stay at $600. 2026 and later are $2,000. */
const THRESHOLDS: { through: number; cents: number }[] = [
  { through: 2025, cents: 60_000 },
  { through: 9999, cents: 200_000 },
];

export const TAX_CLASSES = [
  { id: "individual", label: "Individual" },
  { id: "sole_prop", label: "Sole prop" },
  { id: "partnership", label: "Partnership" },
  { id: "llc", label: "LLC" },
  { id: "c_corp", label: "C corp" },
  { id: "s_corp", label: "S corp" },
  { id: "attorney", label: "Attorney" },
  { id: "other", label: "Other" },
] as const;

export type TaxClass = (typeof TAX_CLASSES)[number]["id"];

const CLASS_IDS = new Set<string>(TAX_CLASSES.map((row) => row.id));
const CORPS = new Set(["c_corp", "s_corp"]);
const CARD_METHODS = new Set(["card", "processor", "third_party"]);

export type W9State = "on_file" | "missing" | "stale";

export type NecPayment = {
  paidOn: string;
  status: string;
  amountCents: number;
  retainageCents: number;
  kind: string;
  method: string | null;
  creditCents: number;
};

export function isTaxClass(value: string): value is TaxClass {
  return CLASS_IDS.has(value);
}

export function necThresholdCents(year: number): number {
  const value = Math.trunc(year);
  for (const row of THRESHOLDS) {
    if (value <= row.through) return row.cents;
  }
  return 200_000;
}

/** Corporations are out. Attorneys stay in, including when the exempt flag is set. */
export function exemptFromNec(taxClass: string | null | undefined, exemptFlag: boolean): boolean {
  if ((taxClass ?? "") === "attorney") return false;
  if (exemptFlag) return true;
  return CORPS.has(taxClass ?? "");
}

/** Card and a known third-party processor are reported on 1099-K, not box 1. */
export function cardExcluded(method: string | null | undefined): boolean {
  return CARD_METHODS.has((method ?? "").trim().toLowerCase());
}

export function necCashCents(amountCents: number, retainageCents: number, kind: string, creditCents: number): number {
  const net = netPayableCents(amountCents, retainageCents, kind === "release" ? "release" : "standard");
  return Math.max(0, net - Math.max(0, Math.round(creditCents)));
}

export function w9State(expiresOn: string | null | undefined, today: string): W9State {
  if (!expiresOn || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return "missing";
  if (expiresOn < today) return "stale";
  return "on_file";
}

export function w9Label(state: W9State): string {
  if (state === "on_file") return "On file";
  if (state === "stale") return "Stale";
  return "Missing";
}

/** December 1 through January 31, company calendar. */
export function filingSeason(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const month = Number(day.slice(5, 7));
  return month === 12 || month === 1;
}

/** December files the year in progress. January files the year that just ended. */
export function filingYear(day: string): number | null {
  if (!filingSeason(day)) return null;
  const year = Number(day.slice(0, 4));
  return Number(day.slice(5, 7)) === 1 ? year - 1 : year;
}

export function maskTin(tin: string | null | undefined): string {
  const digits = (tin ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `••••${digits.slice(-4)}`;
}

export function boxFigures(payments: NecPayment[], year: number): { cashCents: number; cardCents: number } {
  let cashCents = 0;
  let cardCents = 0;
  const prefix = String(year);
  for (const row of payments) {
    if (row.status !== "paid" || !row.paidOn.startsWith(prefix)) continue;
    const cents = necCashCents(row.amountCents, row.retainageCents, row.kind, row.creditCents);
    if (cardExcluded(row.method)) cardCents += cents;
    else cashCents += cents;
  }
  return { cashCents, cardCents };
}
