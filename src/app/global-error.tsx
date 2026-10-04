"use client";

import { useEffect, useState } from "react";
import { reportBoundaryError } from "@/app/actions";
import { clientErrorReference } from "@/lib/errors/report";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [ref] = useState(() => clientErrorReference(error.digest));

  useEffect(() => {
    const path = window.location.pathname;
    void reportBoundaryError({
      ref,
      path,
      message: error.message || "Fieldline hit a snag.",
      digest: error.digest,
    });
  }, [error, ref]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f4efe6", color: "#1c1917", fontFamily: "Georgia, serif" }}>
        <main role="alert" style={{ maxWidth: "32rem", margin: "4rem auto", padding: "0 1rem" }}>
          <h1 style={{ fontSize: "2rem", fontWeight: 500 }}>Fieldline hit a snag.</h1>
          <p style={{ fontFamily: "sans-serif", fontSize: "0.95rem" }}>
            Try again. If it keeps happening, include this reference in Send feedback. Nothing was emailed.
          </p>
          <p style={{ fontFamily: "sans-serif" }}>
            Reference <strong>{ref}</strong>
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ minHeight: "2.75rem", padding: "0 1rem", borderRadius: "0.5rem", border: 0, background: "#1f4d3a", color: "#f4efe6" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
