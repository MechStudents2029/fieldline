"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { formatDateTime } from "@/lib/format";
import { enqueuePunch, flushActive, loadLastScope, outboxSnapshot, subscribeOutbox, type Bootstrap } from "@/lib/offline/browser";
import { projectShift } from "@/lib/offline/replay";
import { Button } from "@/components/ui/button";

function useOutbox() {
  return useSyncExternalStore(subscribeOutbox, outboxSnapshot, outboxSnapshot);
}

export function PendingPunches() {
  const view = useOutbox();
  if (view.events.length === 0 && !view.signIn) return null;
  return (
    <section className="rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10" aria-label="Punches saved on this phone">
      {view.pendingCount > 0 ? (
        <p>
          {view.pendingCount} saved on this phone, will sync
        </p>
      ) : null}
      {view.reviewCount > 0 ? <p>{view.reviewCount} need office review</p> : null}
      {view.signIn ? <p role="alert">Sign in again to sync these punches. They stay on this phone.</p> : null}
      <ul className="mt-2 space-y-2">
        {view.events.map((event) => (
          <li key={event.clientEventId}>
            <p>{event.kind === "log_draft" ? "Daily log notes" : event.kind.replaceAll("_", " ")}</p>
            <p className="text-xs text-muted-foreground">
              {event.syncStatus === "needs_review" ? "Needs office review" : "Saved on this phone, will sync"}
              {view.bootstrap ? ` · ${formatDateTime(event.capturedAt, view.bootstrap.timeZone)}` : ""}
            </p>
            {event.note ? <p>{event.note}</p> : null}
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" className="mt-3 h-12 w-full" onClick={() => void flushActive()}>
        Sync now
      </Button>
    </section>
  );
}

export function OfflineClock() {
  const view = useOutbox();
  useEffect(() => {
    void loadLastScope();
  }, []);
  if (!view.loaded) return <p className="text-sm text-muted-foreground">Opening the clock saved on this phone…</p>;
  if (!view.bootstrap) {
    return <p className="text-sm">Open Time once while you have a signal. This phone does not have your jobs yet.</p>;
  }
  return <ClockPanel boot={view.bootstrap} />;
}

function ClockPanel({ boot }: { boot: Bootstrap }) {
  const view = useOutbox();
  const [message, setMessage] = useState("");
  const names = new Map(boot.jobs.map((job) => [job.id, job.name]));
  const shift = projectShift(boot.open, view.events, names);
  const scope = { orgId: boot.orgId, userId: boot.userId };

  async function punch(form: HTMLFormElement, kind: "clock_in" | "clock_out" | "break_start" | "break_end" | "switch") {
    const data = new FormData(form);
    const capturedAt = new Date().toISOString();
    await enqueuePunch(scope, {
      kind,
      capturedAt,
      projectId: String(data.get("projectId") || shift?.projectId || ""),
      costCode: String(data.get("costCode") || shift?.costCode || ""),
      note: String(data.get("note") || ""),
      lat: String(data.get("lat") || ""),
      lng: String(data.get("lng") || ""),
    });
    setMessage(`Saved on this phone, will sync · ${formatDateTime(capturedAt, boot.timeZone)}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <PendingPunches />
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        {shift ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Clocked in on {shift.projectName} · {shift.costCode}
              {shift.status === "break" ? " · on break" : ""}
            </p>
            <p className="text-xs text-muted-foreground">Since {formatDateTime(shift.clockInAt, boot.timeZone)}</p>
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void punch(event.currentTarget, "clock_out");
              }}
            >
              <label className="text-sm">
                Clock-out note
                <textarea name="note" rows={2} className="field mt-1" placeholder="Optional" />
              </label>
              <Button type="submit" className="h-14 text-base">
                Clock out
              </Button>
            </form>
            <Button
              type="button"
              variant="outline"
              className="h-12"
              onClick={() => {
                void enqueuePunch(scope, { kind: shift.status === "break" ? "break_end" : "break_start" }).then((row) =>
                  setMessage(`Saved on this phone, will sync · ${formatDateTime(row.capturedAt, boot.timeZone)}`),
                );
              }}
            >
              {shift.status === "break" ? "End break" : "Start break"}
            </Button>
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void punch(event.currentTarget, "switch");
              }}
            >
              <label className="text-sm">
                Switch to job
                <select name="projectId" className="field mt-1" defaultValue={shift.projectId}>
                  {boot.jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Switch to cost code
                <select name="costCode" className="field mt-1" defaultValue={shift.costCode}>
                  {boot.codes.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="outline" className="h-12">
                Switch job
              </Button>
            </form>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void punch(event.currentTarget, "clock_in");
            }}
          >
            <label className="text-sm">
              Job
              <select name="projectId" required className="field mt-1" defaultValue={boot.jobs[0]?.id ?? ""}>
                {boot.jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Cost code
              <select name="costCode" required className="field mt-1" defaultValue="TILE-SHOWER">
                {boot.codes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" className="h-14 text-base">
              Clock in
            </Button>
          </form>
        )}
        {message ? (
          <p role="status" className="mt-3 text-sm text-pine">
            {message}
          </p>
        ) : null}
      </section>
      <p className="text-xs text-muted-foreground">Manual time, approvals, and photos stay online.</p>
    </div>
  );
}
