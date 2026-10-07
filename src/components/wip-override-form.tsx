"use client";

import { useActionState } from "react";
import { setWipOverrideAction } from "@/app/actions";

export function WipOverrideForm({
  projectId,
  asOf,
  amount,
  note,
}: {
  projectId: string;
  asOf: string;
  amount: string;
  note: string;
}) {
  const [state, action, pending] = useActionState(setWipOverrideAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="asof" value={asOf} />
      <label className="flex w-32 flex-col text-[13px]">
        Projected
        <input name="amount" aria-label="Projected" defaultValue={amount} inputMode="decimal" required className="field mt-1" />
      </label>
      <label className="flex min-w-0 flex-1 flex-col text-[13px]">
        Note
        <input name="note" aria-label="Note" defaultValue={note} required maxLength={200} className="field mt-1" />
      </label>
      <button type="submit" className="mac-primary" disabled={pending}>
        Save
      </button>
      {state?.error ? (
        <p role="alert" className="w-full text-[13px] text-[var(--mac-danger)]">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
