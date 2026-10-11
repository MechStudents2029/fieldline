"use client";

import { useActionState } from "react";
import { acceptProposedAction } from "@/app/actions";
import { DELAY_REASONS } from "@/lib/schedule/delays";

export function ConfirmPropose({ itemId }: { itemId: string }) {
  const [state, action, pending] = useActionState(acceptProposedAction.bind(null, itemId), null);
  return (
    <form action={action} className="flex flex-col gap-2" aria-busy={pending}>
      {state?.confirm || state?.needsReason ? <input type="hidden" name="confirmShift" value="1" /> : null}
      {state?.needsReason ? (
        <>
          <p className="num text-sm">+{state.delayDays ?? 0} wd</p>
          <label className="text-sm">
            Reason
            <select name="reason" aria-label="Reason" required className="field mt-1" defaultValue="">
              <option value="">Reason</option>
              {DELAY_REASONS.map((reason) => (
                <option key={reason.id} value={reason.id}>
                  {reason.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      {state?.confirm ? <p role="status">{state.confirm}</p> : null}
      {state?.error ? <p role="alert">{state.error}</p> : null}
      <button type="submit" className="mac-primary w-fit" disabled={pending}>
        Propose date
      </button>
    </form>
  );
}
