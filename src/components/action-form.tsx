"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions";

export function ActionForm({
  action,
  children,
  className,
  onSubmit,
  id,
  dataBar,
  dataSheet,
  dataDetailEdit,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  id?: string;
  dataBar?: string;
  dataSheet?: string;
  dataDetailEdit?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form id={id} action={formAction} onSubmit={onSubmit} className={className} data-bar={dataBar} data-sheet={dataSheet} data-detail-edit={dataDetailEdit ? "" : undefined} aria-busy={pending}>
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
      {state?.confirmMessage ? (
        <div className="flex flex-col gap-2">
          {state.confirmUrl ? (
            <label className="text-sm">
              Portal link
              <input readOnly value={state.confirmUrl} aria-label="Portal link" className="field mt-1" />
            </label>
          ) : null}
          <label className="text-sm">
            Message
            <textarea readOnly value={state.confirmMessage} aria-label="Message" rows={2} className="field mt-1" />
          </label>
          <button
            type="button"
            className="ctl w-fit"
            onClick={() => {
              void navigator.clipboard.writeText([state.confirmMessage, state.confirmUrl].filter(Boolean).join("\n"));
            }}
          >
            Copy
          </button>
        </div>
      ) : null}
      {state?.inviteUrl ? (
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-3">
          <p role="status" className="text-sm">
            Copy the link. Shown once.
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
