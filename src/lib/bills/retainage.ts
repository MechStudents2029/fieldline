/** Vendor retainage is basis points. 1000 = 10%. Amounts stay integer cents. */

export function clampRetainageBps(bps: number): number {
  if (!Number.isFinite(bps)) return 0;
  return Math.min(10_000, Math.max(0, Math.round(bps)));
}

/** Vendor percent wins when it is set. Otherwise the company default. Both empty is 0. */
export function resolveRetainageBps(vendorBps: number | null | undefined, companyBps: number | null | undefined): number {
  return clampRetainageBps(vendorBps == null ? (companyBps ?? 0) : vendorBps);
}

/** Half a cent rounds away from zero. 10% of 1001¢ is 100¢. 10% of 1005¢ is 101¢. */
export function retainedCents(amountCents: number, bps: number): number {
  const amount = Math.max(0, Math.round(amountCents));
  return Math.round((amount * clampRetainageBps(bps)) / 10_000);
}

export function netPayableCents(amountCents: number, retainageCents: number, kind: "standard" | "release"): number {
  if (kind === "release") return Math.max(0, Math.round(amountCents));
  return Math.max(0, Math.round(amountCents) - Math.max(0, Math.round(retainageCents)));
}

/** Cash still held: retainage on paid bills, minus release bills already written. */
export function heldCents(retainedOnPaidCents: number, releasedCents: number): number {
  return Math.max(0, Math.round(retainedOnPaidCents) - Math.max(0, Math.round(releasedCents)));
}

/** A release is the held amount, once. More than held is refused. */
export function releaseAmountCents(held: number, requested: number): number {
  const available = Math.max(0, Math.round(held));
  const ask = Math.round(requested);
  if (available <= 0) throw new Error("No retainage is held.");
  if (ask <= 0 || ask > available) throw new Error("Release cannot exceed what is held.");
  return ask;
}
