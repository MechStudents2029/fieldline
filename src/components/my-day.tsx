import Link from "next/link";
import { startLogAction } from "@/app/actions";
import { LargeTitle } from "@/components/ios";
import { Toolbar } from "@/components/mac/toolbar";
import { OfflineBridge } from "@/components/offline-bridge";
import { PendingPunches } from "@/components/offline-clock";
import { BreakControl } from "@/components/shift-forms";
import { ClockInForm, ClockOutForm } from "@/components/time-clock";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { Actor } from "@/lib/services/read";
import { myDay } from "@/lib/services/logs";
import { memberAssignments } from "@/lib/services/schedule";
import { formatHours, timeBoard } from "@/lib/services/time";

function clock(iso: string) {
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
}

function dayTitle(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone }).format(new Date());
}

function assignmentLine(jobName: string, title: string, startTime: string | null) {
  return `${jobName} · ${title}${startTime ? ` · ${startTime}` : ""}`;
}

export function MyDay({ actor }: { actor: Actor }) {
  const day = myDay(actor);
  const board = timeBoard(actor);
  const plan = memberAssignments(actor);
  const open = day.open;
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-7 md:max-w-none md:px-6">
      <div className="hidden md:block">
        <Toolbar title="My day" subtitle={dayTitle(day.timeZone)} search={false} />
      </div>
      <LargeTitle title="My day" subtitle={dayTitle(day.timeZone)} />
      <section aria-label="Today on the schedule" className="flex flex-col gap-2">
        <h2 className="fl-section">Today</h2>
        <ul className="fl-group">
          {plan.today.length === 0 ? <li className="fl-cell">No job today</li> : null}
          {plan.today.map((item) => (
            <li key={item.id} className="fl-cell">
              <Link href={`/projects/${item.projectId}`} className="fl-body min-w-0 flex-1 truncate">
                {assignmentLine(item.jobName, item.title, item.startTime)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Tomorrow" className="flex flex-col gap-2">
        <h2 className="fl-section">Tomorrow</h2>
        <ul className="fl-group">
          {plan.tomorrow.length === 0 ? <li className="fl-cell">No job tomorrow</li> : null}
          {plan.tomorrow.map((item) => (
            <li key={item.id} className="fl-cell">
              <Link href={`/projects/${item.projectId}`} className="fl-body min-w-0 flex-1 truncate">
                {assignmentLine(item.jobName, item.title, item.startTime)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <OfflineBridge
        scope={{ orgId: actor.orgId, userId: actor.userId }}
        timeZone={day.timeZone}
        weekStartsOn={day.weekStartsOn}
        jobs={day.clockJobs}
        codes={day.codes}
        open={open ? { ...open, status: open.status === "break" ? "break" : "open" } : null}
      />
      <PendingPunches />
      {open ? (
        <section className="rounded-[var(--fl-radius)] bg-card px-4 py-5">
          <p className="fl-footnote text-[var(--fl-secondary)]">On the clock</p>
          <p className="fl-large-title tabular-nums">{clock(open.clockInAt)}</p>
          <p className="fl-secondary-text mt-2 text-[var(--fl-secondary)]">
            {open.projectName} · {open.costCode}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <BreakControl scope={{ orgId: actor.orgId, userId: actor.userId }} onBreak={open.status === "break"} />
            <ClockOutForm compact scope={{ orgId: actor.orgId, userId: actor.userId }} />
          </div>
          <form action={startLogAction.bind(null, open.projectId)} className="mt-3">
            <Button type="submit" variant="outline" className="h-11 w-full">
              {day.todayLogId ? "Continue today's log" : "Start today's log"}
            </Button>
          </form>
        </section>
      ) : (
        <section className="rounded-[var(--fl-radius)] bg-card p-4">
          <ClockInForm jobs={day.clockJobs} codes={day.codes} scope={{ orgId: actor.orgId, userId: actor.userId }} />
        </section>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="fl-section">Hours</h2>
        <ul className="fl-group">
          <li className="fl-cell">
            <span className="fl-body flex-1">Clocked in</span>
            <span className="fl-body tabular-nums text-[var(--fl-secondary)]">
              {open ? formatDateTime(open.clockInAt, day.timeZone).split(",").pop()?.trim() : "—"}
            </span>
          </li>
          <li className="fl-cell">
            <span className="fl-body flex-1">Break</span>
            <span className="fl-body tabular-nums text-[var(--fl-secondary)]">{board.open ? `${board.open.breakMinutes} min` : "0 min"}</span>
          </li>
          <li className="fl-cell">
            <span className="fl-body flex-1">This week</span>
            <span className="fl-body tabular-nums text-[var(--fl-secondary)]">{formatHours(board.weekMinutes)}</span>
          </li>
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="fl-section">Tasks</h2>
        <ul className="fl-group">
          {day.tasks.map((task) => (
            <li key={task.id} className="fl-cell">
              <span className="size-[22px] shrink-0 rounded-full border border-[var(--fl-tertiary)]" />
              {task.relatedId ? (
                <Link href={`/projects/${task.relatedId}`} className="fl-body min-w-0 flex-1 truncate">
                  {task.title}
                </Link>
              ) : (
                <span className="fl-body min-w-0 flex-1 truncate">{task.title}</span>
              )}
            </li>
          ))}
          {open ? (
            <li className="fl-cell">
              <span className="fl-body flex-1">Daily log</span>
              <span className="fl-body text-[var(--fl-secondary)]">{day.todayLogId ? "Started" : "Not started"}</span>
            </li>
          ) : null}
          {day.jobs.map((job) => (
            <li key={job.id} className="fl-cell">
              <Link href={`/projects/${job.id}/logs`} className="fl-body min-w-0 flex-1 truncate">
                {job.name}
              </Link>
              {job.map ? (
                <a href={job.map} className="fl-footnote text-[var(--fl-accent)]" target="_blank" rel="noreferrer">
                  Map
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
