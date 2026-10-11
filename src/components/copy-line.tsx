"use client";

import { useState } from "react";

export function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="flex items-center gap-2">
      <input readOnly aria-label={label} value={value} className="ctl min-w-0 flex-1" />
      <button
        type="button"
        className="ctl"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => setCopied(true));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
