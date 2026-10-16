"use client";

export function CopyNote({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="mac-glass-btn"
      aria-label="Copy note"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
      }}
    >
      Copy note
    </button>
  );
}
