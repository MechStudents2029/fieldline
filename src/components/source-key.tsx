"use client";

import { useState } from "react";

export function SourceKey({ scope }: { scope: string }) {
  const [value] = useState(() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `${scope}-${Date.now()}`;
  });
  return <input type="hidden" name="sourceKey" value={value} />;
}
