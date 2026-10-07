"use client";

export function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <label className="text-sm">
        {label}
        <input readOnly value={value} aria-label={label} className="field mt-1" />
      </label>
      <button type="button" className="mt-1 text-sm text-[var(--fl-accent)]" onClick={() => void navigator.clipboard.writeText(value)}>
        Copy
      </button>
    </div>
  );
}
