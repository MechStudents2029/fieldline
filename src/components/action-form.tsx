"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions";

export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? <p className="text-sm text-pine">{state.ok}</p> : null}
      {pending ? <p className="text-xs text-muted-foreground">Working…</p> : null}
    </form>
  );
}
