import { formatMoney } from "@/lib/money";

export const FULL_BPS = 10_000;

export type LineKind = "purchase" | "work";
export type ReceiptCondition = "ok" | "short" | "damaged" | "backordered";
export type ReceiveLabel = "Not received" | "Partially received" | "Received";

export type PostedSlice = {
  qtyMilli: number;
  percentBps: number;
  condition: ReceiptCondition;
  voided: boolean;
};

export function orderedMilli(kind: LineKind, qtyMilli: number | null | undefined, amountCents: number): number {
  if (kind === "work") return FULL_BPS;
  if (qtyMilli != null && qtyMilli > 0) return qtyMilli;
  return amountCents > 0 ? 1000 : 0;
}

export function trackedLine(kind: LineKind, qtyMilli: number | null | undefined, expectedOn: string | null | undefined, slices: PostedSlice[]): boolean {
  if (kind === "work") return true;
  if (qtyMilli != null && qtyMilli > 0) return true;
  if (expectedOn) return true;
  return slices.some((slice) => !slice.voided);
}

export function receivedQty(kind: LineKind, slices: PostedSlice[]): number {
  const sum = slices
    .filter((slice) => !slice.voided && slice.condition !== "damaged")
    .reduce((total, slice) => total + Math.max(0, kind === "work" ? slice.percentBps : slice.qtyMilli), 0);
  return kind === "work" ? Math.min(FULL_BPS, sum) : sum;
}

export function remainingQty(ordered: number, received: number): number {
  return Math.max(0, ordered - received);
}

export function receiveLabel(ordered: number, received: number): ReceiveLabel {
  if (ordered <= 0 || received <= 0) return "Not received";
  if (received >= ordered) return "Received";
  return "Partially received";
}

export function orderLabel(lines: { ordered: number; received: number }[]): ReceiveLabel | null {
  if (lines.length === 0) return null;
  if (lines.every((line) => receiveLabel(line.ordered, line.received) === "Received")) return "Received";
  if (lines.some((line) => line.received > 0)) return "Partially received";
  return "Not received";
}

export function receivedCents(amountCents: number, ordered: number, received: number): number {
  if (amountCents <= 0 || ordered <= 0 || received <= 0) return 0;
  return Math.min(amountCents, Math.round((amountCents * Math.min(received, ordered)) / ordered));
}

export function assertReceive(input: {
  kind: LineKind;
  ordered: number;
  received: number;
  qtyMilli: number;
  percentBps: number;
  condition: ReceiptCondition;
  expectedOn: string | null;
}): void {
  const qty = input.kind === "work" ? input.percentBps : input.qtyMilli;
  if (!Number.isInteger(qty) || qty < 0) throw new Error("Enter a quantity.");
  if (qty === 0 && input.condition !== "backordered") throw new Error("Enter a quantity.");
  if (input.condition === "backordered" && !input.expectedOn) throw new Error("Enter the new expected date.");
  const left = remainingQty(input.ordered, input.received);
  if (input.condition === "damaged") {
    if (qty > input.ordered) throw new Error("That is more than remaining.");
    return;
  }
  if (qty > left) throw new Error("That is more than remaining.");
}

export function formatQty(milli: number): string {
  const units = milli / 1000;
  if (Number.isInteger(units)) return String(units);
  return units.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatComplete(bps: number): string {
  return `${Math.round(bps / 100)}%`;
}

export function parseQtyMilli(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 1000);
}

export function parsePercentBps(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value * 100);
}

export function isCondition(value: string): value is ReceiptCondition {
  return value === "ok" || value === "short" || value === "damaged" || value === "backordered";
}

function codeKey(code: string) {
  return code.trim().toUpperCase() || "UNCODED";
}

export function overReceived(
  lines: { costCode: string; receivedCents: number }[],
  prior: { costCode: string; amountCents: number }[],
  incoming: { costCode: string; amountCents: number }[],
): { code: string; overCents: number }[] {
  const pool = new Map<string, number>();
  for (const line of lines) {
    const key = codeKey(line.costCode);
    pool.set(key, (pool.get(key) ?? 0) + Math.max(0, line.receivedCents));
  }
  for (const row of prior) {
    const key = codeKey(row.costCode);
    const left = pool.get(key) ?? 0;
    const used = Math.min(left, Math.max(0, row.amountCents));
    pool.set(key, left - used);
  }
  const overs: { code: string; overCents: number }[] = [];
  for (const row of incoming) {
    const key = codeKey(row.costCode);
    const left = pool.get(key) ?? 0;
    const take = Math.max(0, row.amountCents);
    if (take > left) overs.push({ code: key, overCents: take - left });
    pool.set(key, Math.max(0, left - take));
  }
  return overs;
}

export function receiveOverageMessage(number: string, overs: { code: string; overCents: number }[]): string | null {
  if (overs.length === 0) return null;
  const detail = overs.map((row) => `${formatMoney(row.overCents)} over on ${row.code}`).join(", ");
  return `Billed past received on ${number}: ${detail}.`;
}

export function unbilledReceived(
  lines: { costCode: string; description: string | null; receivedCents: number }[],
  prior: { costCode: string; amountCents: number }[],
): { costCode: string; description: string; amountCents: number }[] {
  const pool = new Map<string, number>();
  for (const row of prior) {
    const key = codeKey(row.costCode);
    pool.set(key, (pool.get(key) ?? 0) + Math.max(0, row.amountCents));
  }
  const out: { costCode: string; description: string; amountCents: number }[] = [];
  for (const line of lines) {
    const key = codeKey(line.costCode);
    const billed = pool.get(key) ?? 0;
    const used = Math.min(billed, Math.max(0, line.receivedCents));
    pool.set(key, billed - used);
    const left = Math.max(0, line.receivedCents) - used;
    if (left <= 0) continue;
    out.push({ costCode: line.costCode, description: line.description?.trim() || "", amountCents: left });
  }
  return out;
}

export function matchApplies(lines: { expectedOn?: string | null }[], slices: PostedSlice[]): boolean {
  if (slices.some((slice) => !slice.voided)) return true;
  return lines.some((line) => Boolean(line.expectedOn));
}
