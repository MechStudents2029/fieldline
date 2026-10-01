import { dollarsToCents } from "@/lib/money";

export type ReceiptExtraction = {
  vendor: string | null;
  amountCents: number | null;
  confidence: number;
  note: string;
};

export function extractReceiptText(raw: string): ReceiptExtraction {
  const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) {
    return {
      vendor: null,
      amountCents: null,
      confidence: 0.15,
      note: "No readable text in this file. Enter the vendor and amount.",
    };
  }

  const total = text.match(
    /(?:grand\s+total|amount\s+due|balance\s+due|total)\s*[:\-]?\s*\$?\s*([\d,]+\.\d{2})/i,
  );
  const anyMoney = text.match(/\$\s*([\d,]+\.\d{2})/g);
  let amountCents: number | null = null;
  if (total) amountCents = dollarsToCents(Number(total[1].replace(/,/g, "")));
  else if (anyMoney && anyMoney.length === 1) {
    amountCents = dollarsToCents(Number(anyMoney[0].replace(/[$,]/g, "")));
  }

  const labeled = text.match(/(?:vendor|merchant|store)\s*[:\-]\s*([A-Za-z0-9&.' -]{2,40})/i);
  let vendor = labeled?.[1]?.trim() ?? null;
  if (!vendor) {
    const first = text.split(/[.|\n]/)[0]?.trim() ?? "";
    if (first && !/^total/i.test(first) && first.length < 40) vendor = first.slice(0, 40);
  }

  let confidence = 0.2;
  if (vendor && amountCents != null && total) confidence = 0.9;
  else if (amountCents != null) confidence = 0.55;
  else if (vendor) confidence = 0.4;

  return {
    vendor,
    amountCents,
    confidence,
    note:
      confidence >= 0.7
        ? "Read from the receipt text. Confirm before posting to the job."
        : "Low confidence. Confirm the vendor and amount before posting.",
  };
}
