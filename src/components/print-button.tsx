"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex h-11 items-center rounded-lg border border-input bg-background px-4 text-sm">
      Print
    </button>
  );
}
