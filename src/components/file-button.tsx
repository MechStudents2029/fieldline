"use client";

import { useRef, useState } from "react";

export function FileButton({
  name,
  label,
  accept,
  multiple,
  empty = "Photo",
}: {
  name: string;
  label: string;
  accept: string;
  multiple?: boolean;
  empty?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<string[]>([]);
  function clear() {
    if (ref.current) ref.current.value = "";
    setNames([]);
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
        onChange={(event) => setNames([...(event.target.files ?? [])].map((file) => file.name))}
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
