"use client";

export function CopyLink({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={url} aria-label="Booking link" className="field min-w-0 flex-1" />
      <button
        type="button"
        className="mac-glass-btn"
        onClick={() => {
          void navigator.clipboard?.writeText(url);
        }}
      >
        Copy
      </button>
    </div>
  );
}
