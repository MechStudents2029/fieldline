export const SUBMITTAL_STATUSES = ["draft", "submitted", "review", "approved", "noted", "revise", "rejected", "void"] as const;
export type SubmittalStatus = (typeof SUBMITTAL_STATUSES)[number];

export const SUBMITTAL_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  review: "Under review",
  approved: "Approved",
  noted: "Approved as noted",
  revise: "Revise and resubmit",
  rejected: "Rejected",
  void: "Void",
};

const OPEN = new Set(["draft", "submitted", "review", "revise"]);
const MOVES: Record<string, readonly string[]> = {
  draft: ["submitted", "void"],
  submitted: ["review", "approved", "noted", "revise", "rejected", "void"],
  review: ["approved", "noted", "revise", "rejected", "void"],
  revise: ["submitted", "void"],
  approved: [],
  noted: [],
  rejected: [],
  void: [],
};

export function submittalLabel(number: number): string {
  return `SUB-${String(number).padStart(3, "0")}`;
}

/** Voided numbers stay taken. The next number is one past the highest on that job. */
export function nextSubmittalNumber(numbers: readonly number[]): number {
  let max = 0;
  for (const value of numbers) {
    if (Number.isInteger(value) && value > max) max = value;
  }
  return max + 1;
}

export function canMoveSubmittal(from: string, to: string): boolean {
  return (MOVES[from] ?? []).includes(to);
}

export function isOpenSubmittal(status: string): boolean {
  return OPEN.has(status);
}

export function isOverdueSubmittal(status: string, dueOn: string | null, today: string): boolean {
  return isOpenSubmittal(status) && Boolean(dueOn) && (dueOn as string) < today;
}

export function awaitingReview(status: string): boolean {
  return status === "submitted" || status === "review";
}

export function submittalAge(fromDay: string, today: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return 0;
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const to = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export function pendingSubmittal(status: string): boolean {
  return status === "draft" || status === "submitted" || status === "review" || status === "revise";
}
