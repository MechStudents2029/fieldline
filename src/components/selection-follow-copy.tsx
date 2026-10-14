"use client";

import { markSelectionFollowUpAction } from "@/app/(office)/selection-followups/actions";
import { ActionForm } from "@/components/action-form";

export function SelectionFollowCopy({ id, url, message, canCopy }: { id: string; url: string; message: string; canCopy: boolean }) {
  return (
    <ActionForm action={markSelectionFollowUpAction} className="flex max-w-xl flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value="copy" />
      <input readOnly value={url} aria-label="Selection link" className="field" />
      <textarea readOnly value={message} aria-label="Follow-up message" className="field" rows={3} />
      {canCopy ? (
        <button
          type="submit"
          className="mac-primary w-fit"
          onClick={() => {
            const text = url || message;
            void navigator.clipboard?.writeText(text);
          }}
        >
          Copy link
        </button>
      ) : null}
    </ActionForm>
  );
}
