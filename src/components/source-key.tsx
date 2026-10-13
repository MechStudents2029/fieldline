"use client";

import { useEffect, useRef, useState } from "react";

function freshKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** One key per form until the quantity changes, so a double submit posts once. */
export function SourceKey({ scope }: { scope: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    const stored = sessionStorage.getItem(scope);
    const next = stored || freshKey();
    if (!stored) sessionStorage.setItem(scope, next);
    const frame = requestAnimationFrame(() => setValue(next));
    const qty = ref.current?.form?.querySelector<HTMLInputElement>('input[name="qty"]');
    if (!qty) return () => cancelAnimationFrame(frame);
    const rotate = () => {
      const key = freshKey();
      sessionStorage.setItem(scope, key);
      setValue(key);
    };
    qty.addEventListener("input", rotate);
    return () => {
      cancelAnimationFrame(frame);
      qty.removeEventListener("input", rotate);
    };
  }, [scope]);
  return <input ref={ref} type="hidden" name="sourceKey" value={value} />;
}
