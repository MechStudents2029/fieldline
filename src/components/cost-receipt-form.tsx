"use client";

import { useActionState } from "react";
import { submitCostReceiptAction, type ActionState } from "@/app/actions";
import { FileButton } from "@/components/file-button";
import { Button } from "@/components/ui/button";

export function CostReceiptForm({
  jobs,
  codes,
  fixedProjectId,
}: {
  jobs: { id: string; name: string }[];
  codes: string[];
  fixedProjectId?: string;
}) {
  const [state, action, pending] = useActionState(submitCostReceiptAction, null as ActionState);
  return (
    <section className="flex flex-col gap-3" aria-label="Receipt">
      <div className="flex items-center gap-2">
        <h2 className="fl-section">Receipt</h2>
        <span className="fl-pill">Online</span>
      </div>
      <p className="text-xs text-muted-foreground">Receipts need a connection. They are not saved on this phone.</p>
      <form action={action} className="grid gap-2" aria-busy={pending}>
        <FileButton name="photo" label="Receipt photo" accept="image/jpeg,image/png,image/webp" capture="environment" />
        {fixedProjectId ? (
          <input type="hidden" name="projectId" value={fixedProjectId} />
        ) : (
          <label className="text-sm">
            Job
            <select name="projectId" aria-label="Job" className="field mt-1" defaultValue="">
              <option value="">No job yet</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          Store
          <input name="vendor" aria-label="Store" className="field mt-1" required />
        </label>
        <label className="text-sm">
          Date
          <input name="purchasedOn" aria-label="Date" type="date" className="field mt-1" required />
        </label>
        <label className="text-sm">
          Total
          <input name="amount" aria-label="Total" inputMode="decimal" className="field mt-1" required />
        </label>
        <label className="text-sm">
          Cost code
          <input name="costCode" aria-label="Cost code" list="receipt-codes" className="field mt-1" />
        </label>
        <datalist id="receipt-codes">
          {codes.map((code) => (
            <option key={code} value={code} />
          ))}
        </datalist>
        <label className="text-sm">
          Note
          <input name="note" aria-label="Note" className="field mt-1" />
        </label>
        <label className="text-sm">
          Paid with
          <select name="payMethod" aria-label="Paid with" className="field mt-1" defaultValue="company_card">
            <option value="company_card">Company card</option>
            <option value="personal">Personal</option>
            <option value="cash">Cash</option>
          </select>
        </label>
        <Button type="submit" className="h-11">
          Add receipt
        </Button>
        {pending ? <p className="text-xs text-muted-foreground">Working…</p> : null}
        {state?.error ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
