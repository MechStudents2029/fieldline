"use client";

import { copyDelayLinkAction } from "@/app/(office)/delays/actions";

export function CopyDelayLink({ claimId, url }: { claimId: string; url: string }) {
  return (
    <button
      type="button"
      className="mac-glass-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(url);
        void copyDelayLinkAction(claimId);
      }}
    >
      Copy link
    </button>
  );
}
