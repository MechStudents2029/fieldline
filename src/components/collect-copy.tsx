"use client";

import { markFollowUpAction } from "@/app/(office)/collections/actions";
import { ActionForm } from "@/components/action-form";

export function CollectCopy({ id, url, message, canCopy }: { id: string; url: string; message: string; canCopy: boolean }) {
  return (
    <ActionForm action={markFollowUpAction} className="flex max-w-xl flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value="copy" />
      <input readOnly value={url} aria-label="Pay link" className="field" />
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
