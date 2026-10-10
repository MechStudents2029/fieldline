"use client";

export function PrintButton() {
  return (
    <button type="button" className="ctl" onClick={() => window.print()}>
      Print
    </button>
  );
}
