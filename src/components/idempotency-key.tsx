"use client";

import { useState } from "react";

export function IdempotencyKey() {
  const [key] = useState(() => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `ccm-${Date.now()}`));
  return <input type="hidden" name="idempotencyKey" value={key} />;
}
