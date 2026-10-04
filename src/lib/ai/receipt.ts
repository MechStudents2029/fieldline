import { dollarsToCents } from "@/lib/money";

export type ReceiptLine = {
  description: string;
  amountCents: number | null;
};

export type ReceiptExtraction = {
  vendor: string | null;
  amountCents: number | null;
  purchasedOn: string | null;
  lines: ReceiptLine[];
  confidence: number;
  note: string;
};

/** Below this, a read is not confident enough to skip a person. Posting still requires the confirm button. */
export const RECEIPT_REVIEW_CONFIDENCE = 0.7;

export type StoredReceipt = {
  vendor?: string | null;
  amountCents?: number | null;
  purchasedOn?: string | null;
  confidence?: number | null;
  note?: string | null;
  lines?: ReceiptLine[];
  suggestedCode?: string | null;
  suggestedReason?: string | null;
  posted?: boolean;
};

/**
 * The read step never posts a cost. A low-confidence read is refused even if an old form asks to post.
 * A confident read also waits for the confirm button.
 */
export function receiptAutoPostAllowed(confidence: number, postRequested: boolean): boolean {
  if (!postRequested || confidence < RECEIPT_REVIEW_CONFIDENCE) return false;
  return false;
}

export function readReceiptMeta(metadataJson: string | null): StoredReceipt {
  if (!metadataJson) return {};
  try {
    const parsed = JSON.parse(metadataJson) as StoredReceipt;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function receiptPlainText(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function moneyToCents(raw: string): number {
  return dollarsToCents(Number(raw.replace(/,/g, "")));
}

function validDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function purchasedOnFrom(text: string): string | null {
  const iso = text.match(/(?:date|purchased|purchase\s+date)\s*[:\-]?\s*(\d{4})-(\d{2})-(\d{2})/i);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (validDate(year, month, day)) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const us = text.match(/(?:date|purchased|purchase\s+date)\s*[:\-]?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (!us) return null;
  let year = Number(us[3]);
  if (year < 100) year += 2000;
  const month = Number(us[1]);
  const day = Number(us[2]);
  if (!validDate(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function labeledTotal(text: string): number | null {
  const patterns = [
    /grand\s+total\s*[:\-]?\s*\$?\s*([\d,]+\.\d{2})/i,
    /amount\s+due\s*[:\-]?\s*\$?\s*([\d,]+\.\d{2})/i,
    /balance\s+due\s*[:\-]?\s*\$?\s*([\d,]+\.\d{2})/i,
    /(?:^|[^a-z])total\s*[:\-]?\s*\$?\s*([\d,]+\.\d{2})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return moneyToCents(match[1]);
  }
  return null;
}

function vendorFrom(lines: string[]): string | null {
  for (const line of lines) {
    const labeled = line.match(/(?:vendor|merchant|store)\s*[:\-]\s*(.+)$/i);
    if (!labeled) continue;
    const name = labeled[1].trim().replace(/[.,]+$/, "");
    if (name.length >= 2 && name.length <= 60 && !/\$/.test(name)) return name;
  }
  const first = lines[0]?.trim() ?? "";
  if (!first || first.length > 40 || /^total\b/i.test(first) || /\$/.test(first) || /^date\b/i.test(first)) return null;
  return first;
}

function lineItems(lines: string[], totalCents: number | null): ReceiptLine[] {
  const items: ReceiptLine[] = [];
  for (const line of lines) {
    const match = line.match(/^(.+?)\s+\$?\s*([\d,]+\.\d{2})\s*$/);
    if (!match) continue;
    const description = match[1].trim();
    const amountCents = moneyToCents(match[2]);
    if (/^(grand\s+total|amount\s+due|balance\s+due|total)$/i.test(description)) continue;
    if (totalCents != null && amountCents === totalCents && /total|amount due|balance due/i.test(description)) continue;
    if (description.length < 2) continue;
    items.push({ description, amountCents });
  }
  return items;
}

export function extractReceiptText(raw: string): ReceiptExtraction {
  const text = receiptPlainText(raw);
  if (!text) {
    return {
      vendor: null,
      amountCents: null,
      purchasedOn: null,
      lines: [],
      confidence: 0.15,
      note: "No readable text in this file. Enter the vendor and amount.",
    };
  }

  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const total = labeledTotal(text);
  const amounts = text.match(/\$\s*([\d,]+\.\d{2})/g) ?? [];
  let amountCents = total;
  const labeled = total != null;
  if (amountCents == null && amounts.length === 1) amountCents = moneyToCents(amounts[0].replace(/[$,]/g, ""));
  const vendor = vendorFrom(lines);
  const purchasedOn = purchasedOnFrom(text);
  const parsedLines = lineItems(lines, amountCents);
  const ambiguous = !labeled && amounts.length > 1;

  let confidence = 0.2;
  if (vendor && amountCents != null && labeled) confidence = 0.9;
  else if (amountCents != null && labeled) confidence = 0.55;
  else if (vendor && amountCents != null) confidence = 0.5;
  else if (amountCents != null) confidence = 0.45;
  else if (vendor) confidence = 0.35;
  if (ambiguous) confidence = Math.min(confidence, 0.4);

  return {
    vendor,
    amountCents,
    purchasedOn,
    lines: parsedLines,
    confidence,
    note:
      confidence >= RECEIPT_REVIEW_CONFIDENCE
        ? "Read from the receipt text. Confirm the fields, then post to the job."
        : "Low confidence. Confirm the vendor and amount before posting.",
  };
}
