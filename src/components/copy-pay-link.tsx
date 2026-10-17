"use client";

import { copyPayLinkAction } from "@/app/(office)/pay-applications/actions";

export function CopyPayLink({ applicationId, url }: { applicationId: string; url: string }) {
  return (
    <button
      type="button"
      className="mac-glass-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(url);
        void copyPayLinkAction(applicationId);
      }}
    >
      Copy link
    </button>
  );
}
