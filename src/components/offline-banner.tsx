"use client";

import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(navigator.onLine === false);
    sync();
    window.addEventListener("offline", sync);
    window.addEventListener("online", sync);
    return () => {
      window.removeEventListener("offline", sync);
      window.removeEventListener("online", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      aria-label="You're offline — changes may not save"
      className="border-b border-copper/40 bg-accent px-4 py-2 text-center text-sm"
    >
      {"You're offline — changes may not save"}
    </p>
  );
}
