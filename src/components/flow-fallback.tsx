"use client";

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

export function FlowError({ reset, title }: { reset: () => void; title: string }) {
  return (
    <div role="alert" className="mx-auto flex min-h-[50vh] max-w-lg flex-col justify-center gap-3 px-4">
      <h1 className="font-heading text-3xl">{title}</h1>
      <p className="text-sm text-muted-foreground">The page did not finish loading. Your signed records are unchanged.</p>
      <button type="button" onClick={reset} className="h-11 w-fit rounded-lg bg-primary px-4 text-sm text-primary-foreground">
        Try again
      </button>
    </div>
  );
}
