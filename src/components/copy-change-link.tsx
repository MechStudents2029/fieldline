"use client";

import { copyChangeQuoteAction } from "@/app/(office)/change-events/actions";

export function CopyChangeLink({ quoteId, url }: { quoteId: string; url: string }) {
  return (
    <button
      type="button"
      className="mac-glass-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(url);
        void copyChangeQuoteAction(quoteId);
      }}
    >
      Copy link
    </button>
  );
}
