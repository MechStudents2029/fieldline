"use client";

import { useActionState, useRef, useState } from "react";
import { clockInAction, clockOutAction, type ActionState } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { fillLocation } from "@/lib/geo/locate";
import { enqueuePunch, probeOrigin, type Scope } from "@/lib/offline/browser";

function usePunch(action: (state: ActionState, formData: FormData) => Promise<ActionState>, scope: Scope | undefined, kind: "clock_in" | "clock_out") {
  const [state, formAction, pending] = useActionState(action, null);
  const [local, setLocal] = useState("");
  const located = useRef(false);
  const bypass = useRef(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    if (!located.current) {
      event.preventDefault();
      await fillLocation(form);
      located.current = true;
      form.requestSubmit();
      return;
    }
    located.current = false;
    if (bypass.current) {
      bypass.current = false;
      return;
    }
    if (!scope) return;
    event.preventDefault();
    const online = await probeOrigin();
    if (online) {
      bypass.current = true;
      form.requestSubmit();
      return;
    }
    const data = new FormData(form);
    const capturedAt = new Date().toISOString();
    await enqueuePunch(scope, {
      kind,
      capturedAt,
      projectId: String(data.get("projectId") || ""),
      costCode: String(data.get("costCode") || ""),
      note: String(data.get("note") || ""),
      lat: String(data.get("lat") || ""),
      lng: String(data.get("lng") || ""),
      accuracy: String(data.get("accuracy") || ""),
    });
    setLocal("Saved on this phone, will sync");
  }

  return { state, formAction, pending, onSubmit, local };
}

function LocationFields() {
  return (
    <>
      <input type="hidden" name="lat" />
      <input type="hidden" name="lng" />
      <input type="hidden" name="accuracy" />
    </>
  );
}

function Status({ state, pending, local }: { state: ActionState; pending: boolean; local: string }) {
  return (
    <>
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="text-sm text-pine">
          {state.ok}
        </p>
      ) : null}
      {local ? (
        <p role="status" className="text-sm text-pine">
          {local}
        </p>
      ) : null}
      {pending ? <p className="text-xs text-muted-foreground">Working…</p> : null}
    </>
  );
}

export function ClockInForm({ jobs, codes, scope }: { jobs: { id: string; name: string }[]; codes: string[]; scope?: Scope }) {
  const punch = usePunch(clockInAction, scope, "clock_in");
  return (
    <form action={punch.formAction} onSubmit={punch.onSubmit} className="flex flex-col gap-3">
      <label className="text-sm">
        Job
        <select name="projectId" required className="field mt-1" defaultValue={jobs[0]?.id ?? ""}>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Cost code
        <select name="costCode" required className="field mt-1" defaultValue="TILE-SHOWER">
          {codes.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      <LocationFields />
      <Button type="submit" className="h-14 text-base">
        Clock in
      </Button>
      <Status state={punch.state} pending={punch.pending} local={punch.local} />
    </form>
  );
}

export function ClockOutForm({ compact = false, scope }: { compact?: boolean; scope?: Scope }) {
  const punch = usePunch(clockOutAction, scope, "clock_out");
  return (
    <form action={punch.formAction} onSubmit={punch.onSubmit} className="flex flex-col gap-3">
      {compact ? null : (
        <label className="text-sm">
          Clock-out note
          <textarea name="note" rows={2} className="field mt-1" placeholder="Optional" />
        </label>
      )}
      <LocationFields />
      <Button type="submit" className="fl-primary h-[50px] w-full">
        Clock out
      </Button>
      <Status state={punch.state} pending={punch.pending} local={punch.local} />
    </form>
  );
}
