import Link from "next/link";
import { startLogAction } from "@/app/actions";
import { LargeTitle } from "@/components/ios";
import { OfflineBridge } from "@/components/offline-bridge";
import { PendingPunches } from "@/components/offline-clock";
import { ClockInForm, ClockOutForm } from "@/components/time-clock";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { Actor } from "@/lib/services/read";
import { myDay } from "@/lib/services/logs";
import { weekdayName } from "@/lib/time/calendar";

export function MyDay({ actor }: { actor: Actor }) {
  const day = myDay(actor);
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <LargeTitle
        title="My day"
        subtitle={`Where you are, the clock, and today’s log. ${day.timeZone}. Week starts ${weekdayName(day.weekStartsOn)}.`}
      />
      <OfflineBridge
        scope={{ orgId: actor.orgId, userId: actor.userId }}
        timeZone={day.timeZone}
        weekStartsOn={day.weekStartsOn}
        jobs={day.clockJobs}
        codes={day.codes}
        open={day.open ? { ...day.open, status: day.open.status === "break" ? "break" : "open" } : null}
      />
      <PendingPunches />
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        {day.open ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Clocked in on {day.open.projectName} · {day.open.costCode}
              {day.open.status === "break" ? " · on break" : ""}
            </p>
            <p className="text-xs text-muted-foreground">Since {formatDateTime(day.open.clockInAt, day.timeZone)}</p>
            <ClockOutForm compact scope={{ orgId: actor.orgId, userId: actor.userId }} />
            <form action={startLogAction.bind(null, day.open.projectId)}>
              <Button type="submit" className="h-14 w-full text-base">
                {day.todayLogId ? "Continue today's log" : "Start today's log"}
              </Button>
            </form>
            <Link href="/time" className="text-center text-sm underline">
              Switch job, break, or add a note
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm">You are not clocked in.</p>
            <ClockInForm jobs={day.clockJobs} codes={day.codes} scope={{ orgId: actor.orgId, userId: actor.userId }} />
            <p className="text-sm text-muted-foreground">Clock in to start today’s log for that job.</p>
          </div>
        )}
      </section>
      {day.flags.length > 0 ? (
        <ul className="rounded-xl bg-accent/50 p-4 text-sm">
          {day.flags.map((flag) => (
            <li key={flag}>{flag}</li>
          ))}
        </ul>
      ) : null}
      <section>
        <h2 className="font-medium">Jobs</h2>
        <ul className="mt-2 space-y-2">
          {day.jobs.length === 0 ? <li className="text-sm text-muted-foreground">No job is on your list yet.</li> : null}
          {day.jobs.map((job) => (
            <li key={job.id} className="rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
              <Link href={`/projects/${job.id}/logs`} className="font-medium">
                {job.name}
              </Link>
              {job.address ? <p className="text-muted-foreground">{job.address}</p> : null}
              {job.map ? (
                <a href={job.map} className="mt-2 inline-flex h-11 items-center underline" target="_blank" rel="noreferrer">
                  Open in maps
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="font-medium">Open tasks</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {day.tasks.length === 0 ? <li className="text-muted-foreground">Nothing assigned.</li> : null}
          {day.tasks.map((task) => (
            <li key={task.id} className="rounded-lg bg-card p-3 ring-1 ring-foreground/10">
              {task.relatedId ? (
                <Link href={`/projects/${task.relatedId}`} className="font-medium">
                  {task.title}
                </Link>
              ) : (
                task.title
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
