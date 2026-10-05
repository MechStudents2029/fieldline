"use client";

import { useActionState, useRef, useState } from "react";
import { clockInAction, clockOutAction, type ActionState } from "@/app/actions";
import { Button } from "@/components/ui/button";

function usePunch(action: (state: ActionState, formData: FormData) => Promise<ActionState>) {
  const [state, formAction, pending] = useActionState(action, null);
  const armed = useRef(false);
  const [locNote, setLocNote] = useState("");

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const include = (form.elements.namedItem("includeLocation") as HTMLInputElement | null)?.checked;
    if (!include || armed.current) {
      armed.current = false;
      return;
    }
    event.preventDefault();
    if (!navigator.geolocation) {
      setLocNote("Location was not saved. The punch still goes through.");
      armed.current = true;
      form.requestSubmit();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = form.elements.namedItem("lat") as HTMLInputElement | null;
        const lng = form.elements.namedItem("lng") as HTMLInputElement | null;
        if (lat) lat.value = String(position.coords.latitude);
        if (lng) lng.value = String(position.coords.longitude);
        armed.current = true;
        form.requestSubmit();
      },
      () => {
        setLocNote("Location was not saved. The punch still goes through.");
        armed.current = true;
        form.requestSubmit();
      },
      { enableHighAccuracy: false, maximumAge: 0, timeout: 8000 },
    );
  }

  return { state, formAction, pending, onSubmit, locNote };
}

function LocationFields({ locNote }: { locNote: string }) {
  return (
    <>
      <input type="hidden" name="lat" />
      <input type="hidden" name="lng" />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="includeLocation" className="mt-1" />
        <span>Include my location for this punch only. Deny it and the punch still saves.</span>
      </label>
      {locNote ? (
        <p role="status" className="text-sm">
          {locNote}
        </p>
      ) : null}
    </>
  );
}

function Status({ state, pending }: { state: ActionState; pending: boolean }) {
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
      {pending ? <p className="text-xs text-muted-foreground">Working…</p> : null}
    </>
  );
}

export function ClockInForm({ jobs, codes }: { jobs: { id: string; name: string }[]; codes: string[] }) {
  const punch = usePunch(clockInAction);
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
      <LocationFields locNote={punch.locNote} />
      <Button type="submit" className="h-14 text-base">
        Clock in
      </Button>
      <Status state={punch.state} pending={punch.pending} />
    </form>
  );
}

export function ClockOutForm({ compact = false }: { compact?: boolean }) {
  const punch = usePunch(clockOutAction);
  return (
    <form action={punch.formAction} onSubmit={punch.onSubmit} className="flex flex-col gap-3">
      {compact ? null : (
        <label className="text-sm">
          Clock-out note
          <textarea name="note" rows={2} className="field mt-1" placeholder="Optional" />
        </label>
      )}
      {compact ? null : <LocationFields locNote={punch.locNote} />}
      <Button type="submit" className="h-14 w-full text-base">
        Clock out
      </Button>
      <Status state={punch.state} pending={punch.pending} />
    </form>
  );
}
