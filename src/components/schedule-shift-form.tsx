"use client";

import { useActionState } from "react";
import { shiftScheduleDatesAction } from "@/app/actions";

export function ScheduleShiftForm({ itemId, startDate, endDate }: { itemId: string; startDate: string; endDate: string }) {
  const [state, action, pending] = useActionState(shiftScheduleDatesAction, null);
  return (
    <form action={action} className="flex max-w-sm flex-col gap-2" aria-busy={pending}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="startDate" value={startDate} />
      {state?.confirm ? <input type="hidden" name="confirmShift" value="1" /> : null}
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
