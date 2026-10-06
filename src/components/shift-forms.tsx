"use client";

import { useActionState, useRef, useState } from "react";
import { breakAction, switchJobAction, type ActionState } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { enqueuePunch, probeOrigin, type Scope } from "@/lib/offline/browser";

export function BreakControl({ scope, onBreak }: { scope: Scope; onBreak: boolean }) {
  return <BreakButton scope={scope} onBreak={onBreak} />;
}

export function ShiftForms({
  scope,
  onBreak,
  jobs,
  codes,
  projectId,
  costCode,
}: {
  scope: Scope;
  onBreak: boolean;
  jobs: { id: string; name: string }[];
  codes: string[];
  projectId: string;
  costCode: string;
}) {
  return (
    <>
      <BreakButton scope={scope} onBreak={onBreak} />
      <SwitchForm scope={scope} jobs={jobs} codes={codes} projectId={projectId} costCode={costCode} />
    </>
  );
}

function BreakButton({ scope, onBreak }: { scope: Scope; onBreak: boolean }) {
  const action = breakAction.bind(null, onBreak ? "end" : "start");
  const [state, formAction, pending] = useActionState(action, null);
  const [local, setLocal] = useState("");
  const bypass = useRef(false);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (bypass.current) {
          bypass.current = false;
          return;
        }
        event.preventDefault();
        const form = event.currentTarget;
        void probeOrigin().then(async (online) => {
          if (online) {
            bypass.current = true;
            form.requestSubmit();
            return;
          }
          await enqueuePunch(scope, { kind: onBreak ? "break_end" : "break_start" });
          setLocal("Saved on this phone, will sync");
        });
      }}
    >
      <Button type="submit" variant="secondary" className="h-[50px] w-full text-[17px]">
        {onBreak ? "End break" : "Break"}
      </Button>
      <Line state={state} pending={pending} local={local} />
    </form>
  );
}

function SwitchForm({
  scope,
  jobs,
  codes,
  projectId,
  costCode,
}: {
  scope: Scope;
  jobs: { id: string; name: string }[];
  codes: string[];
  projectId: string;
  costCode: string;
}) {
  const [state, formAction, pending] = useActionState(switchJobAction, null);
  const [local, setLocal] = useState("");
  const bypass = useRef(false);
  return (
    <form
      action={formAction}
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        if (bypass.current) {
          bypass.current = false;
          return;
        }
        event.preventDefault();
        const form = event.currentTarget;
        void probeOrigin().then(async (online) => {
          if (online) {
            bypass.current = true;
            form.requestSubmit();
            return;
          }
          const data = new FormData(form);
          await enqueuePunch(scope, {
            kind: "switch",
            projectId: String(data.get("projectId") || ""),
            costCode: String(data.get("costCode") || ""),
          });
          setLocal("Saved on this phone, will sync");
        });
      }}
    >
      <label className="text-sm">
        Switch to job
        <select name="projectId" className="field mt-1" defaultValue={projectId}>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Switch to cost code
        <select name="costCode" className="field mt-1" defaultValue={costCode}>
          {codes.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="outline" className="h-12">
        Switch job
      </Button>
      <Line state={state} pending={pending} local={local} />
    </form>
  );
}

function Line({ state, pending, local }: { state: ActionState; pending: boolean; local: string }) {
  return (
    <>
      {state?.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      {state?.ok ? <p role="status" className="text-sm text-pine">{state.ok}</p> : null}
      {local ? <p role="status" className="text-sm text-pine">{local}</p> : null}
      {pending ? <p className="text-xs text-muted-foreground">Working…</p> : null}
    </>
  );
}
