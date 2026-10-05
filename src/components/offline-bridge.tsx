"use client";

import { useEffect } from "react";
import { ensureSyncLoop, loadScope, saveBootstrap, type Scope } from "@/lib/offline/browser";
import type { ShiftSnapshot } from "@/lib/offline/replay";

export function OfflineBridge({
  scope,
  timeZone,
  weekStartsOn,
  jobs,
  codes,
  open,
}: {
  scope: Scope;
  timeZone: string;
  weekStartsOn: number;
  jobs: { id: string; name: string }[];
  codes: string[];
  open: ShiftSnapshot;
}) {
  const fingerprint = JSON.stringify({ orgId: scope.orgId, userId: scope.userId, timeZone, weekStartsOn, jobs, codes, open });
  useEffect(() => {
    const saved = JSON.parse(fingerprint) as {
      orgId: string;
      userId: string;
      timeZone: string;
      weekStartsOn: number;
      jobs: { id: string; name: string }[];
      codes: string[];
      open: ShiftSnapshot;
    };
    ensureSyncLoop();
    void saveBootstrap(saved);
    void loadScope({ orgId: saved.orgId, userId: saved.userId });
    void navigator.serviceWorker?.ready.then(() => {
      const frame = document.getElementById("offline-warm") as HTMLIFrameElement | null;
      frame?.contentWindow?.location.replace("/offline");
    });
  }, [fingerprint]);
  return <iframe id="offline-warm" src="/offline" title="Offline clock" hidden aria-hidden="true" className="pointer-events-none absolute h-px w-px overflow-hidden" />;
}
