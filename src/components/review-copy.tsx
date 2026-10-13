"use client";

import { ActionForm } from "@/components/action-form";
import { askReviewAction, markReviewAction } from "@/app/(office)/reviews/actions";

export function ReviewCopy({ id, url, message, canCopy }: { id: string; url: string; message: string; canCopy: boolean }) {
  return (
    <ActionForm action={markReviewAction} className="flex max-w-xl flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value="copy" />
      <input readOnly value={url} aria-label="Review link" className="field" />
      <textarea readOnly value={message} aria-label="Review message" className="field" rows={3} />
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

export function AskReview({ id, job, url, message }: { id: string; job: string; url: string; message: string }) {
  return (
    <ActionForm action={askReviewAction} className="flex min-w-0 flex-1 items-center justify-between gap-2">
      <input type="hidden" name="id" value={id} />
      <span className="fl-body min-w-0 truncate">{job}</span>
      <button
        type="submit"
        className="ctl shrink-0"
        onClick={() => {
          void navigator.clipboard?.writeText(url || message);
        }}
      >
        Ask for review
      </button>
    </ActionForm>
  );
}
