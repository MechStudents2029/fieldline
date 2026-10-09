"use client";

import { useRef, useState } from "react";

export function FileButton({
  name,
  label,
  accept,
  multiple,
  empty = "Photo",
  onPick,
}: {
  name: string;
  label: string;
  accept: string;
  multiple?: boolean;
  empty?: string;
  onPick?: (file: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<string[]>([]);
  function clear() {
    if (ref.current) ref.current.value = "";
    setNames([]);
    onPick?.(null);
  }
  return (
    <div className="file-pick">
      <input
        ref={ref}
        className="file-pick-input"
        type="file"
        name={name}
        accept={accept}
        multiple={multiple}
        aria-label={label}
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          setNames(files.map((file) => file.name));
          onPick?.(files[0] ?? null);
        }}
      />
      <button type="button" className="file-pick-btn" onClick={() => ref.current?.click()}>
        {names.length ? names.join(", ") : empty}
      </button>
      {names.length ? (
        <button type="button" className="file-pick-clear" aria-label={`Remove ${label}`} onClick={clear}>
          Remove
        </button>
      ) : null}
    </div>
  );
}
