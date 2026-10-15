"use client";

export function NecCopy({ url }: { url: string }) {
  return (
    <button
      type="button"
      className="mac-glass-btn"
      aria-label="Copy portal link"
      data-portal={url}
      onClick={() => {
        void navigator.clipboard?.writeText(url);
      }}
    >
      Copy
    </button>
  );
}
