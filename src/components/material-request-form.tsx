"use client";

import { useActionState } from "react";
import { createMaterialRequestAction, editMaterialRequestAction, type ActionState } from "@/app/actions";
import { Button } from "@/components/ui/button";

export type MaterialFormLine = {
  stockItemId: string | null;
  description: string;
  qtyLabel: string;
  costCode: string | null;
};

export type MaterialFormRequest = {
  id: string;
  status: string;
  userId: string;
  projectId: string;
  urgency: string;
  note: string | null;
  lines: MaterialFormLine[];
};

export function MaterialRequestForm({
  jobs,
  stock,
  codes,
  people,
  request,
  fixedProjectId,
}: {
  jobs: { id: string; name: string }[];
  stock: { id: string; sku: string; name: string }[];
  codes: string[];
  people?: { id: string; name: string }[];
  request?: MaterialFormRequest;
  fixedProjectId?: string;
}) {
  const action = request ? editMaterialRequestAction.bind(null, request.id) : createMaterialRequestAction;
  const [state, formAction, pending] = useActionState(action, null as ActionState);
  const showSubmit = !request || request.status === "draft";
  const first = request?.lines[0];
  const second = request?.lines[1];
  const projectId = fixedProjectId || request?.projectId || "";
  return (
    <section className="flex flex-col gap-3" aria-label="Material request">
      <h2 className="fl-section">{request ? "Edit" : "Material"}</h2>
      <form action={formAction} className="grid gap-2" aria-busy={pending}>
        {people && people.length > 0 ? (
          <label className="text-sm">
            Person
            <select name="userId" aria-label="Person" className="field mt-1" defaultValue={request?.userId ?? people[0]?.id ?? ""}>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {fixedProjectId ? (
          <input type="hidden" name="projectId" value={fixedProjectId} />
        ) : (
          <label className="text-sm">
            Job
            <select name="projectId" aria-label="Job" className="field mt-1" required defaultValue={projectId}>
              <option value="">Job</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <LineFields stock={stock} codes={codes} line={first} />
        <LineFields stock={stock} codes={codes} line={second} extra />
        <label className="text-sm">
          Urgency
          <select name="urgency" aria-label="Urgency" className="field mt-1" defaultValue={request?.urgency ?? "normal"}>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <label className="text-sm">
          Note
          <input name="note" aria-label="Note" className="field mt-1" defaultValue={request?.note ?? ""} />
        </label>
        <div className="flex gap-2">
          <Button type="submit" name="intent" value="draft" variant="outline" className="h-11">
            Save
          </Button>
          {showSubmit ? (
            <Button type="submit" name="intent" value="submit" className="h-11">
              Submit
            </Button>
          ) : null}
        </div>
        {pending ? <p className="text-xs text-muted-foreground">Working…</p> : null}
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
      </form>
    </section>
  );
}

function LineFields({
  stock,
  codes,
  line,
  extra,
}: {
  stock: { id: string; sku: string; name: string }[];
  codes: string[];
  line?: MaterialFormLine;
  extra?: boolean;
}) {
  const skuLabel = extra ? "Extra SKU" : "SKU";
  const itemLabel = extra ? "Extra item" : "Item";
  const qtyLabel = extra ? "Extra qty" : "Qty";
  const codeLabel = extra ? "Extra cost code" : "Cost code";
  return (
    <div className="grid gap-2">
      <label className="text-sm">
        {skuLabel}
        <select name="lineSku" aria-label={skuLabel} className="field mt-1" defaultValue={line?.stockItemId ?? ""}>
          <option value="">No SKU</option>
          {stock.map((item) => (
            <option key={item.id} value={item.id}>
              {item.sku} · {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        {itemLabel}
        <input name="lineDesc" aria-label={itemLabel} className="field mt-1" defaultValue={line?.description ?? ""} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">
          {qtyLabel}
          <input name="lineQty" aria-label={qtyLabel} inputMode="decimal" className="field mt-1" defaultValue={line?.qtyLabel ?? ""} />
        </label>
        <label className="text-sm">
          {codeLabel}
          <input name="lineCode" aria-label={codeLabel} className="field mt-1" list={extra ? "material-codes-extra" : "material-codes"} defaultValue={line?.costCode ?? ""} />
        </label>
      </div>
      <datalist id={extra ? "material-codes-extra" : "material-codes"}>
        {codes.map((code) => (
          <option key={code} value={code} />
        ))}
      </datalist>
    </div>
  );
}
