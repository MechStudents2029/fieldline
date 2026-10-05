"use client";

import { useActionState } from "react";
import { readBillAction, saveBillAction, type ActionState } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";

type Choice = { id: string; label: string };

const EMPTY_LINES = [
  { description: "", amount: "", costCode: "" },
  { description: "", amount: "", costCode: "" },
  { description: "", amount: "", costCode: "" },
];

export function BillComposer({
  projects,
  vendors,
  codes,
}: {
  projects: Choice[];
  vendors: Choice[];
  codes: string[];
}) {
  const [read, readAction, reading] = useActionState(readBillAction, null as ActionState);
  const draft = read?.bill ?? null;
  const lines = draft && draft.lines.length > 0 ? [...draft.lines, ...EMPTY_LINES].slice(0, 6) : EMPTY_LINES;

  return (
    <div className="flex flex-col gap-4">
      <form action={readAction} className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">Read a bill file</h2>
        <p className="text-xs text-muted-foreground">Upload a .txt file or pick a sample. A low-confidence read stays a draft. Nothing hits the job until you approve it.</p>
        <label className="text-sm">
          Job
          <select name="projectId" aria-label="Job for this file" className="field mt-1" defaultValue={draft?.projectId ?? ""} required>
            <option value="">Choose a job</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.label}
              </option>
            ))}
          </select>
        </label>
        <input name="file" type="file" accept=".txt,.csv,.json,text/plain" aria-label="Upload a bill file" className="block min-h-11 w-full text-base" />
        <label className="text-sm">
          Or use a sample
          <select name="sample" className="field mt-1" defaultValue="">
            <option value="">Upload instead</option>
            <option value="harbor-plumbing.svg">Harbor Plumbing sample</option>
            <option value="casa-tile.svg">Casa Tile sample</option>
            <option value="summit-lumber.svg">Summit Lumber sample</option>
          </select>
        </label>
        <Button type="submit" variant="outline" className="h-11">
          Read bill
        </Button>
        {reading ? <p className="text-xs text-muted-foreground">Working…</p> : null}
        {read?.error ? (
          <p role="alert" className="text-sm text-destructive">
            {read.error}
          </p>
        ) : null}
        {read?.ok ? (
          <p role="status" className="text-sm text-pine">
            {read.ok}
          </p>
        ) : null}
      </form>
      <ActionForm key={draft?.documentId ?? "manual"} action={saveBillAction} className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:grid-cols-2">
        <h2 className="font-medium sm:col-span-2">Bill</h2>
        {draft ? (
          <p className={`text-xs sm:col-span-2 ${draft.lowConfidence ? "text-copper" : "text-muted-foreground"}`}>
            {Math.round(draft.confidence * 100)}% confidence. {draft.note}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground sm:col-span-2">Or type the bill without a file. It is saved as a draft.</p>
        )}
        <input type="hidden" name="documentId" value={draft?.documentId ?? ""} />
        <input type="hidden" name="lowConfidence" value={draft?.lowConfidence ? "1" : "0"} />
        <label className="text-sm">
          Job
          <select name="projectId" aria-label="Job" className="field mt-1" defaultValue={draft?.projectId ?? ""} required>
            <option value="">Choose a job</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Sub or vendor
          <select name="vendorContactId" aria-label="Sub or vendor" className="field mt-1" defaultValue={draft?.vendorContactId ?? ""} required>
            <option value="">Choose a contact</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Bill number
          <input name="billNumber" aria-label="Bill number" defaultValue={draft?.billNumber ?? ""} className="field mt-1" required />
        </label>
        <label className="text-sm">
          Bill date
          <input name="billDate" type="date" aria-label="Bill date" defaultValue={draft?.billDate ?? ""} className="field mt-1" required />
        </label>
        <label className="text-sm">
          Due date
          <input name="dueDate" type="date" aria-label="Due date" defaultValue={draft?.dueDate ?? ""} className="field mt-1" required />
        </label>
        <label className="text-sm">
          Memo
          <input name="memo" aria-label="Memo" className="field mt-1" />
        </label>
        <div className="sm:col-span-2">
          <p className="text-sm font-medium">Lines</p>
          <datalist id="bill-codes">
            {codes.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
          <div className="mt-2 flex flex-col gap-2">
            {lines.map((line, index) => (
              <div key={`${draft?.documentId ?? "line"}-${index}`} className="grid gap-2 sm:grid-cols-3">
                <input name="description" aria-label={`Line ${index + 1} description`} defaultValue={line.description} placeholder="Description" className="field" />
                <input name="costCode" aria-label={`Line ${index + 1} cost code`} list="bill-codes" defaultValue={line.costCode} placeholder="Cost code" className="field" />
                <input name="amount" aria-label={`Line ${index + 1} amount`} defaultValue={line.amount} inputMode="decimal" placeholder="Amount" className="field" />
              </div>
            ))}
          </div>
        </div>
        <Button type="submit" className="h-11 sm:col-span-2">
          Save draft
        </Button>
      </ActionForm>
    </div>
  );
}
