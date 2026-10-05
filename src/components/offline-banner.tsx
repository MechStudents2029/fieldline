"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ensureSyncLoop, onlineSnapshot, subscribeOnline } from "@/lib/offline/browser";

const COPY =
  "You're offline. Clock in, breaks, job switches, clock out, and daily log notes save on this phone and sync later. Photos, approvals, and manual time stay online.";

export function OfflineBanner() {
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, () => true);
  useEffect(() => {
    ensureSyncLoop();
  }, []);
  if (online) return null;
  return (
    <p role="status" aria-live="polite" aria-label={COPY} className="border-b border-copper/40 bg-accent px-4 py-2 text-center text-sm">
      {COPY}
    </p>
  );
}
