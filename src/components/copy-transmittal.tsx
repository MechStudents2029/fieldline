"use client";

import { copyTransmittalAction } from "@/app/(office)/transmittals/actions";

export function CopyTransmittalLink({ transmittalId, url }: { transmittalId: string; url: string }) {
  return (
    <button
      type="button"
      className="mac-glass-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(url);
        void copyTransmittalAction(transmittalId);
      }}
    >
      Copy link
    </button>
  );
}
