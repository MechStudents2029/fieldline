export const CONFIRM_STATUSES = ["requested", "confirmed", "declined"] as const;
export type ConfirmStatus = (typeof CONFIRM_STATUSES)[number];
export type ConfirmEvent = "request" | "confirm" | "decline";

export function isConfirmStatus(value: string | null | undefined): value is ConfirmStatus {
  return value === "requested" || value === "confirmed" || value === "declined";
}

/** Request from any state. Confirm and decline only from Requested. */
export function nextConfirmStatus(current: string | null | undefined, event: ConfirmEvent): ConfirmStatus {
  if (event === "request") return "requested";
  if (current !== "requested") throw new Error(event === "confirm" ? "confirm" : "decline");
  return event === "confirm" ? "confirmed" : "declined";
}

/** A confirmed date is no longer confirmed once the dates move or the item is held. */
export function resetsOnMove(status: string | null | undefined): boolean {
  return status === "confirmed";
}

export function confirmPill(status: string | null | undefined): string | null {
  if (status === "requested") return "Requested";
  if (status === "confirmed") return "Confirmed";
  if (status === "declined") return "Declined";
  return null;
}
