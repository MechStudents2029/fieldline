"use client";

import { useRef, useState } from "react";
import type { ActionState } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { enqueueLogDraft, probeOrigin, type Scope } from "@/lib/offline/browser";
import type { OfflineEvent } from "@/lib/offline/event";

function draftFrom(form: HTMLFormElement): NonNullable<OfflineEvent["log"]> {
  const data = new FormData(form);
  const text = (name: string) => {
    const value = data.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    notes: text("notes"),
    plannedNext: text("plannedNext"),
    weatherSky: text("weatherSky"),
    weatherHighF: text("weatherHighF"),
    weatherLowF: text("weatherLowF"),
    weatherLostHours: text("weatherLostHours"),
    weatherImpact: text("weatherImpact"),
    delayCause: text("delayCause"),
    delayHours: text("delayHours"),
    deliveries: text("deliveries"),
    visitors: text("visitors"),
    safetyNote: text("safetyNote"),
  };
}

export function LogDraftSaver({
  action,
  scope,
  projectId,
  children,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  scope: Scope;
  projectId: string;
  children: React.ReactNode;
}) {
  const [local, setLocal] = useState("");
  const bypass = useRef(false);
  const timer = useRef(0);

  async function queue(form: HTMLFormElement, publishing: boolean) {
    await enqueueLogDraft(scope, projectId, draftFrom(form));
    setLocal(publishing ? "Publishing needs a connection. The notes are saved on this phone." : "Saved on this phone, will sync");
  }

  return (
    <div
      onInput={(event) => {
        const form = (event.target as HTMLElement).closest("form");
        if (!form) return;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          void probeOrigin().then((online) => {
            if (!online) void queue(form, false);
          });
        }, 500);
      }}
    >
      <ActionForm
        action={action}
        className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
        onSubmit={(event) => {
          if (bypass.current) {
            bypass.current = false;
            return;
          }
          event.preventDefault();
          const form = event.currentTarget;
          const submitter = (event.nativeEvent as SubmitEvent).submitter;
          const publishing = submitter instanceof HTMLButtonElement && submitter.value === "publish";
          void probeOrigin().then(async (online) => {
            if (!online) {
              await queue(form, publishing);
              return;
            }
            bypass.current = true;
            if (submitter instanceof HTMLElement) form.requestSubmit(submitter);
            else form.requestSubmit();
          });
        }}
      >
        {children}
      </ActionForm>
      {local ? (
        <p role="status" className="text-sm text-pine">
          {local}
        </p>
      ) : null}
    </div>
  );
}
