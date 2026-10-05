"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions";

export function ActionForm({
  action,
  children,
  className,
  onSubmit,
  id,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  id?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form id={id} action={formAction} onSubmit={onSubmit} className={className} aria-busy={pending}>
      {children}
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="text-sm text-pine">
          {state.ok}
        </p>
      ) : null}
      {state?.inviteUrl ? (
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-3">
          <p role="status" className="text-sm">
            Nothing was emailed. Copy the link into a text. It is shown once.
          </p>
          <label className="text-sm">
            Invite link
            <input readOnly value={state.inviteUrl} aria-label="Invite link" className="field mt-1" />
          </label>
          <button
            type="button"
            className="h-11 rounded-lg bg-secondary px-3 text-sm"
            onClick={() => {
              const url = state.inviteUrl;
              if (url) void navigator.clipboard.writeText(url);
            }}
          >
            Copy link
          </button>
          <label className="text-sm">
            Message to paste
            <textarea readOnly value={state.inviteMessage || ""} aria-label="Invite message" rows={3} className="field mt-1" />
          </label>
        </div>
      ) : null}
      {pending ? (
        <p role="status" className="text-xs text-muted-foreground">
          Working…
        </p>
      ) : null}
    </form>
  );
}
