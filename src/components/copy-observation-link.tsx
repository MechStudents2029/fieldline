"use client";

import { copyObservationLinkAction } from "@/app/(office)/observations/actions";

export function CopyObservationLink({ observationId, url }: { observationId: string; url: string }) {
  return (
    <button
      type="button"
      className="mac-glass-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(url);
        void copyObservationLinkAction(observationId);
      }}
    >
      Copy link
    </button>
  );
}
