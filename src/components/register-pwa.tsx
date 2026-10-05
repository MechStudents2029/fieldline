"use client";

import { useEffect } from "react";

export function RegisterPwa() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* Demo install is optional. A failed registration must not block the office. */
    });
  }, []);
  return null;
}
