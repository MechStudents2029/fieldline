"use client";

import { useActionState } from "react";
import { shiftScheduleDatesAction } from "@/app/actions";
import { DELAY_REASONS } from "@/lib/schedule/delays";

export function ScheduleShiftForm({ itemId, startDate, endDate }: { itemId: string; startDate: string; endDate: string }) {
  const [state, action, pending] = useActionState(shiftScheduleDatesAction, null);
  return (
    <form action={action} className="flex max-w-sm flex-col gap-2" aria-busy={pending}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="startDate" value={startDate} />
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
          <label className="text-sm">
            Note
            <input name="note" aria-label="Note" className="field mt-1" />
          </label>
        </>
      ) : null}
      <label className="text-sm">
        End
        <input name="endDate" type="date" aria-label="End" defaultValue={endDate} required className="field mt-1" />
      </label>
      {state?.confirm ? <p role="status">{state.confirm}</p> : null}
      {state?.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      {state?.ok ? <p role="status">{state.ok}</p> : null}
      <button type="submit" className="mac-primary w-fit" disabled={pending}>
        {state?.confirm ?? "Save"}
      </button>
    </form>
  );
}
