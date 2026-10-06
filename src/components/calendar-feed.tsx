"use client";

import { useState } from "react";
import { useActionState } from "react";
import type { ActionState } from "@/app/actions";
import { rotateCalendarFeedAction } from "@/app/actions";

export function CalendarFeed({ hasFeed }: { hasFeed: boolean }) {
  const [state, action, pending] = useActionState(rotateCalendarFeedAction, null as ActionState);
  const [copied, setCopied] = useState(false);
  const url = state?.feedUrl;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Calendar</h2>
      <form action={action}>
        <button type="submit" className="underline" disabled={pending}>
          {hasFeed || url ? "New link" : "Create link"}
        </button>
      </form>
      {url ? (
        <div className="flex flex-col gap-2">
          <label className="text-sm">
            Feed
            <input readOnly value={url} aria-label="Calendar link" className="field mt-1" />
          </label>
          <button
            type="button"
            className="h-11 rounded-md bg-[var(--fl-fill)] text-sm font-semibold"
            onClick={() => {
              void navigator.clipboard.writeText(url).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
