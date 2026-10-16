"use client";

import { copyHandoverAction } from "@/app/(office)/handover/actions";

export function CopyHandoverLink({ packageId, url }: { packageId: string; url: string }) {
  return (
    <button
      type="button"
      className="mac-glass-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(url);
        void copyHandoverAction(packageId);
      }}
    >
      Copy link
    </button>
  );
}
