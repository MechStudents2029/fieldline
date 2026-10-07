"use client";

import { useState } from "react";
import { useActionState } from "react";
import type { ActionState } from "@/app/actions";
import { rotateVendorPortalAction } from "@/app/actions";

export function VendorLink({ contactId, hasPortal }: { contactId: string; hasPortal: boolean }) {
  const [state, action, pending] = useActionState(rotateVendorPortalAction.bind(null, contactId), null as ActionState);
  const [copied, setCopied] = useState(false);
  const url = state?.vendorUrl;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="mac-t13 font-semibold">Portal</h2>
      <form action={action}>
        <button type="submit" className="mac-glass-btn" disabled={pending}>
          {hasPortal || url ? "New link" : "Create link"}
        </button>
      </form>
      {url ? (
        <div className="flex flex-col gap-2">
          <label className="text-sm">
            Portal link
            <input readOnly value={url} aria-label="Portal link" className="field mt-1" />
          </label>
          <button
            type="button"
            className="h-8 rounded-md bg-[var(--fl-fill)] px-3 text-sm font-semibold"
            onClick={() => {
              void navigator.clipboard.writeText(url).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
