export const DELAY_REASONS = [
  { id: "weather", label: "Weather" },
  { id: "client", label: "Client decision" },
  { id: "change_order", label: "Change order" },
  { id: "material", label: "Material" },
  { id: "sub", label: "Sub" },
  { id: "inspection", label: "Inspection" },
  { id: "other", label: "Other" },
] as const;

export type DelayReasonId = (typeof DELAY_REASONS)[number]["id"];

export function delayReasonLabel(id: string): string {
  return DELAY_REASONS.find((reason) => reason.id === id)?.label ?? id;
}

export function isDelayReason(value: string): value is DelayReasonId {
  return DELAY_REASONS.some((reason) => reason.id === value);
}

/** Signed workday gap. Positive means the current finish is later. */
export function formatWorkdayVariance(days: number): string {
  if (days > 0) return `+${days} wd`;
  if (days < 0) return `−${Math.abs(days)} wd`;
  return "0 wd";
}
