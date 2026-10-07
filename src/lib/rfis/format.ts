import { formatWhole } from "@/lib/money";

export const RFI_STATUSES = ["open", "answered", "closed", "void"] as const;
export type RfiStatus = (typeof RFI_STATUSES)[number];

export const RFI_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  answered: "Answered",
  closed: "Closed",
  void: "Void",
};

export function rfiLabel(number: number): string {
  return `RFI-${String(number).padStart(3, "0")}`;
}

/** Voided numbers stay taken. The next number is one past the highest on that job. */
export function nextRfiNumber(numbers: readonly number[]): number {
  let max = 0;
  for (const value of numbers) {
    if (Number.isInteger(value) && value > max) max = value;
  }
  return max + 1;
}

export function ageDays(fromDay: string, today: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return 0;
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const to = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export function isOverdueRfi(status: string, dueOn: string | null, today: string): boolean {
  return status === "open" && Boolean(dueOn) && (dueOn as string) < today;
}

export function impactText(input: {
  costImpact: boolean;
  costImpactCents: number | null;
  scheduleImpactDays: number | null;
  showMoney: boolean;
}): string {
  const parts: string[] = [];
  if (input.costImpact) {
    parts.push(input.showMoney && input.costImpactCents != null ? formatWhole(input.costImpactCents) : "Cost");
  }
  if (input.scheduleImpactDays) parts.push(`${input.scheduleImpactDays}d`);
  return parts.join(" · ");
}
