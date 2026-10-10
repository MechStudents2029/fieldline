"use client";

import { useState } from "react";

export function MarkedPhoto({ markedSrc, originalSrc, alt }: { markedSrc: string; originalSrc: string; alt: string }) {
  const [original, setOriginal] = useState(false);
  return (
    <figure className="flex flex-col gap-2">
      <img src={original ? originalSrc : markedSrc} alt={alt} className="max-h-64 w-full rounded-lg object-cover" />
      <div className="flex items-center gap-2">
        <span className="fl-pill">Marked up</span>
        <button type="button" className="ctl" aria-pressed={original} onClick={() => setOriginal((value) => !value)}>
          {original ? "Marked up" : "Original"}
        </button>
      </div>
    </figure>
  );
}
