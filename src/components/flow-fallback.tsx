"use client";

import { useEffect, useState } from "react";
import { reportBoundaryError } from "@/app/actions";
import { clientErrorReference } from "@/lib/errors/report";

export function FlowLoading({ label }: { label: string }) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col justify-center gap-3 px-4" aria-busy="true" aria-live="polite">
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      <div className="h-10 w-4/5 animate-pulse rounded-md bg-muted" />
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function FlowError({
  error,
  retry,
  title,
}: {
  error?: Error & { digest?: string };
  retry: () => void;
  title: string;
}) {
  const [ref] = useState(() => clientErrorReference(error?.digest));

  useEffect(() => {
    const path = window.location.pathname;
    void reportBoundaryError({
      ref,
      path,
      message: error?.message || title,
      digest: error?.digest,
    });
  }, [error, ref, title]);

  return (
    <div role="alert" className="mx-auto flex min-h-[50vh] max-w-lg flex-col justify-center gap-3 px-4">
      <h1 className="font-heading text-3xl">{title}</h1>
      <p className="text-sm text-muted-foreground">The page did not finish loading. Your signed records are unchanged.</p>
      <p className="text-sm">
        Reference <span className="font-medium">{ref}</span>
      </p>
      <button type="button" onClick={() => retry()} className="h-11 w-fit rounded-lg bg-primary px-4 text-sm text-primary-foreground">
        Try again
      </button>
    </div>
  );
}
