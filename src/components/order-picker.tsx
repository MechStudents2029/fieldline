"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createOrderFromAction } from "@/app/actions";

type Row = { id: string; label: string; ordered: boolean };
type Vendor = { id: string; name: string };
type Draft = { id: string; number: string; label: string };

export function OrderPicker({
  sourceKind,
  projectId,
  rows,
  vendors,
  drafts,
}: {
  sourceKind: "selection" | "change_order_line" | "budget_line";
  projectId: string;
  rows: Row[];
  vendors: Vendor[];
  drafts: Draft[];
}) {
  const router = useRouter();
  const open = rows.filter((row) => !row.ordered);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (open.length === 0) return <p className="mac-t13 text-[var(--mac-secondary)]">Nothing to order.</p>;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const data = new FormData(event.currentTarget);
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        if (submitter instanceof HTMLButtonElement && submitter.name) data.set(submitter.name, submitter.value);
        setBusy(true);
        void createOrderFromAction(null, data).then((result) => {
          setBusy(false);
          if (!result || result.error) {
            setError(result?.error ?? "Could not create the order.");
            setNotice(null);
            return;
          }
          setError(null);
          setNotice(result.ok ?? "Saved.");
          router.refresh();
        });
      }}
    >
      <input type="hidden" name="sourceKind" value={sourceKind} />
      <input type="hidden" name="projectId" value={projectId} />
      <ul className="flex flex-col gap-1">
        {open.map((row) => (
          <li key={row.id}>
            <label className="flex items-center gap-2 mac-t13">
              <input type="checkbox" name="sourceId" value={row.id} defaultChecked={open.length === 1} />
              {row.label}
            </label>
          </li>
        ))}
      </ul>
      <select name="vendorContactId" aria-label="Vendor" className="ctl" defaultValue="">
        <option value="">Vendor</option>
        {vendors.map((vendor) => (
          <option key={vendor.id} value={vendor.id}>
            {vendor.name}
          </option>
        ))}
      </select>
      <select name="kind" aria-label="Type" className="ctl" defaultValue="purchase">
        <option value="purchase">Purchase order</option>
        <option value="work">Work order</option>
      </select>
      <select name="purchaseOrderId" aria-label="Draft" className="ctl" defaultValue="">
        <option value="">New</option>
        {drafts.map((draft) => (
          <option key={draft.id} value={draft.id}>
            {draft.label}
          </option>
        ))}
      </select>
      <span className="flex flex-wrap gap-2">
        <button type="submit" name="mode" value="create" className="mac-primary" disabled={busy}>
          Create PO
        </button>
        <button type="submit" name="mode" value="add" className="ctl" disabled={busy || drafts.length === 0}>
          Add to existing draft PO
        </button>
      </span>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mac-t13">
          {notice}
        </p>
      ) : null}
    </form>
  );
}
