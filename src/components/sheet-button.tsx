"use client";

import { useState } from "react";

export function SheetButton({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative z-30">
      <button type="button" className="mac-glass-btn" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {label}
      </button>
      {open ? (
        <div role="dialog" aria-label={label} className="relative z-30 mt-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
