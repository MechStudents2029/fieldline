"use client";

export function SelectionBar({
  label,
  count,
  onClear,
  children,
}: {
  label: string;
  count: number;
  onClear: () => void;
  children: React.ReactNode;
}) {
  if (count < 1) return null;
  return (
    <div role="region" aria-label={label} data-bar="selection" className="ctl-bar">
      <span className="ctl-count">{count} selected</span>
      <span className="ctl-dot" aria-hidden="true">
        ·
      </span>
      {children}
      <span className="ctl-dot" aria-hidden="true">
        ·
      </span>
      <button type="button" className="ctl" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
