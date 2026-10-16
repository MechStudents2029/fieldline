import Link from "next/link";
import { addFieldPunchAction, markPunchDoneAction, startLogAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { LargeTitle } from "@/components/ios";
import { Toolbar } from "@/components/mac/toolbar";
import { OfflineBridge } from "@/components/offline-bridge";
import { PendingPunches } from "@/components/offline-clock";
import { BreakControl } from "@/components/shift-forms";
import { ClockInForm, ClockOutForm } from "@/components/time-clock";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { Actor } from "@/lib/services/read";
import { noticesFor } from "@/lib/services/automations";
import { leaderTalks } from "@/lib/services/safety";
import { myDay } from "@/lib/services/logs";
import { fieldPunch } from "@/lib/services/punch";
import { mentionUnread } from "@/lib/services/comments";
import { rfiQueue } from "@/lib/services/rfis";
import { submittalQueue } from "@/lib/services/submittals";
import { FileButton } from "@/components/file-button";
import { memberAssignments } from "@/lib/services/schedule";
import { overdueTodoCount } from "@/lib/services/todos";
import { DashboardStrip } from "@/components/dashboard-strip";
import { dashboardForRole } from "@/lib/services/dashboards";
import { formatHours, timeBoard } from "@/lib/services/time";
import { fieldOpenTickets } from "@/lib/services/tm";
import { fieldReviewQueue } from "@/lib/services/reviews";
import { AskReview } from "@/components/review-copy";
import { CostReceiptForm } from "@/components/cost-receipt-form";
import { MileageForm } from "@/components/mileage-form";
import { MaterialRequestForm } from "@/components/material-request-form";
import { receiptAttention, receiptCodes, receiptJobs } from "@/lib/services/cost-receipts";
import { mileageAttention, mileageJobs } from "@/lib/services/mileage";
import { materialAttention, materialCodes, materialJobs, materialStock } from "@/lib/services/material-requests";
import { credentialAttention } from "@/lib/services/certifications";
import { listTimeOff } from "@/lib/services/time-off";
import { createChangeEventAction } from "@/app/(office)/change-events/actions";
import { CHANGE_REASONS } from "@/lib/services/change-events";
import { cancelTimeOffAction, requestTimeOffAction } from "@/app/(office)/time-off/actions";

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
  const punch = fieldPunch(actor);
  const rfis = rfiQueue(actor);
  const submittals = submittalQueue(actor);
  const mentions = mentionUnread(actor);
  const overdueTodos = overdueTodoCount(actor);
  const notices = noticesFor(actor);
  const talks = leaderTalks(actor);
  const tickets = fieldOpenTickets(actor);
  const reviews = fieldReviewQueue(actor);
  const home = dashboardForRole(actor);
  const receipts = receiptAttention(actor);
  const miles = mileageAttention(actor);
  const materials = materialAttention(actor);
  const certs = credentialAttention(actor);
  const timeOff = actor.role === "viewer" ? [] : listTimeOff(actor);
  const open = day.open;
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-7 md:max-w-none md:px-6">
      <div className="hidden md:block">
        <Toolbar title="My day" subtitle={dayTitle(day.timeZone)} search={false} />
      </div>
      <LargeTitle title="My day" subtitle={dayTitle(day.timeZone)} />
      {rfis.overdue.count > 0 || rfis.awaiting.count > 0 || submittals.overdue.count > 0 || submittals.awaiting.count > 0 || mentions > 0 || notices.length > 0 ? (
        <ul className="fl-group">
          {notices.map((notice) => (
            <li key={notice.id}>
              <Link href={notice.href} className="fl-cell">
                <span className="fl-body flex-1">{notice.title}</span>
              </Link>
            </li>
          ))}
          {mentions > 0 ? (
            <li>
              <Link href="/inbox" className="fl-cell">
                <span className="fl-body flex-1">Mentions</span>
                <span className="num">{mentions}</span>
              </Link>
            </li>
          ) : null}
          {rfis.overdue.count > 0 && rfis.overdue.href ? (
            <li>
              <Link href={rfis.overdue.href} className="fl-cell">
                <span className="fl-body flex-1">RFIs overdue</span>
                <span className="num">{rfis.overdue.count}</span>
              </Link>
            </li>
          ) : null}
          {rfis.awaiting.count > 0 && rfis.awaiting.href ? (
            <li>
              <Link href={rfis.awaiting.href} className="fl-cell">
                <span className="fl-body flex-1">RFIs awaiting your answer</span>
                <span className="num">{rfis.awaiting.count}</span>
              </Link>
            </li>
          ) : null}
          {submittals.overdue.count > 0 && submittals.overdue.href ? (
            <li>
              <Link href={submittals.overdue.href} className="fl-cell">
                <span className="fl-body flex-1">Submittals overdue</span>
                <span className="num">{submittals.overdue.count}</span>
              </Link>
            </li>
          ) : null}
          {submittals.awaiting.count > 0 && submittals.awaiting.href ? (
            <li>
              <Link href={submittals.awaiting.href} className="fl-cell">
                <span className="fl-body flex-1">Submittals awaiting your review</span>
                <span className="num">{submittals.awaiting.count}</span>
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}
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
      {receipts.count > 0 && receipts.href ? (
        <Link href={receipts.href} className="fl-cell fl-group">
          <span className="fl-body flex-1">Receipts</span>
          <span className="num">{receipts.count}</span>
        </Link>
      ) : null}
      <CostReceiptForm jobs={receiptJobs(actor.orgId)} codes={receiptCodes(actor.orgId)} />
      {miles.count > 0 && miles.href ? (
        <Link href={miles.href} className="fl-cell fl-group">
          <span className="fl-body flex-1">Miles</span>
          <span className="num">{miles.count}</span>
        </Link>
      ) : null}
      <MileageForm jobs={mileageJobs(actor.orgId)} />
      {materials.count > 0 && materials.href ? (
        <Link href={materials.href} className="fl-cell fl-group">
          <span className="fl-body flex-1">Materials</span>
          <span className="num">{materials.count}</span>
        </Link>
      ) : null}
      <MaterialRequestForm jobs={materialJobs(actor.orgId)} stock={materialStock(actor.orgId)} codes={materialCodes(actor.orgId)} />
      {certs.count > 0 && certs.href ? (
        <Link href={certs.href} className="fl-cell fl-group">
          <span className="fl-body flex-1">Certs</span>
          <span className="num">{certs.count}</span>
        </Link>
      ) : null}
      {reviews.length > 0 ? (
        <section aria-label="Ask for review" data-testid="ask-review" className="flex flex-col gap-2">
          <h2 className="fl-section">Ask for review</h2>
          <ul className="fl-group">
            {reviews.map((row) => (
              <li key={row.id} className="fl-cell">
                <AskReview id={row.id} job={row.job} url={row.url} message={row.message} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {home ? <DashboardStrip name={home.name} tiles={home.tiles} /> : null}
      {talks.length > 0 ? (
        <section aria-label="Toolbox" className="flex flex-col gap-2">
          <h2 className="fl-section">Toolbox</h2>
          <ul className="fl-group">
            {talks.map((talk) => (
              <li key={talk.id}>
                <Link href={talk.href} className="fl-cell">
                  <span className="min-w-0 flex-1">
                    <span className="fl-body block truncate">{talk.title}</span>
                    <span className="fl-footnote block truncate text-[var(--fl-secondary)]">{talk.projectName}</span>
                  </span>
                  <span className="fl-pill">{talk.statusLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-label="T&M" className="flex flex-col gap-2">
        <h2 className="fl-section">T&M</h2>
        <ul className="fl-group">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <Link href={ticket.href} className="fl-cell">
                <span className="min-w-0 flex-1">
                  <span className="fl-body block truncate">{ticket.title}</span>
                  <span className="fl-footnote block truncate text-[var(--fl-secondary)]">{ticket.job}</span>
                </span>
                <span className="fl-pill">{ticket.pill}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/tm/new" className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--fl-accent)] text-sm font-semibold text-white">
          New ticket
        </Link>
      </section>
      <section aria-label="Punch" className="flex flex-col gap-2">
        <h2 className="fl-section">Punch</h2>
        <ul className="flex flex-col gap-3">
          {punch.items.map((item) => (
            <li key={item.id} className="fl-group px-4 py-3">
              <p className="fl-body">{item.title}</p>
              <p className="fl-footnote text-[var(--fl-secondary)]">
                {[item.projectName, item.location, item.statusLabel].filter(Boolean).join(" · ")}
              </p>
              <ActionForm action={markPunchDoneAction.bind(null, item.id)} className="mt-2 flex flex-col gap-2">
                <FileButton name="photo" label={`After photo ${item.title}`} accept="image/jpeg,image/png,image/webp" empty="After photo" />
                <button type="submit" className="h-11 rounded-lg bg-[var(--fl-accent)] text-sm font-semibold text-white">
                  Mark {item.title} done
                </button>
              </ActionForm>
            </li>
          ))}
        </ul>
        <ActionForm action={addFieldPunchAction} className="fl-group flex flex-col gap-2 px-4 py-3">
          <label className="text-sm">
            Job
            <select name="projectId" className="field mt-1" defaultValue={punch.jobs[0]?.id ?? ""}>
              {punch.jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Item
            <input name="title" className="field mt-1" />
          </label>
          <label className="text-sm">
            Room
            <input name="location" className="field mt-1" />
          </label>
          <button type="submit" className="h-11 rounded-lg bg-[var(--fl-accent)] text-sm font-semibold text-white">
            Add punch
          </button>
        </ActionForm>
      </section>
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
        {overdueTodos > 0 ? (
          <ul className="fl-group">
            <li>
              <Link href="/todos?due=overdue" className="fl-cell fl-press">
                <span className="fl-body flex-1">Overdue to-dos</span>
                <span className="num">{overdueTodos}</span>
              </Link>
            </li>
          </ul>
        ) : null}
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
      {actor.role !== "viewer" ? (
        <section className="flex flex-col gap-3" aria-label="Time off">
          <h2 className="fl-section">Time off</h2>
          <ActionForm action={requestTimeOffAction} className="grid gap-2">
            <label className="text-sm">
              Start
              <input type="date" name="startOn" aria-label="Time off start" required className="field mt-1" />
            </label>
            <label className="text-sm">
              End
              <input type="date" name="endOn" aria-label="Time off end" required className="field mt-1" />
            </label>
            <label className="text-sm">
              Hours
              <input name="hours" aria-label="Time off hours" inputMode="decimal" className="field mt-1" />
            </label>
            <label className="text-sm">
              Type
              <select name="kind" aria-label="Time off type" defaultValue="vacation" className="field mt-1">
                <option value="vacation">Vacation</option>
                <option value="sick">Sick</option>
                <option value="personal">Personal</option>
                <option value="unpaid">Unpaid</option>
              </select>
            </label>
            <label className="text-sm">
              Note
              <input name="note" aria-label="Time off note" className="field mt-1" />
            </label>
            <Button type="submit">Request</Button>
          </ActionForm>
          <ul className="fl-group">
            {timeOff.map((row) => (
              <li key={row.id} className="fl-cell" data-request={row.id}>
                <span className="fl-body min-w-0 flex-1 truncate">
                  {row.startOn} · {row.kindLabel}
                </span>
                <span className="fl-pill" data-status={row.status}>
                  {row.statusLabel}
                </span>
                {row.status === "pending" ? (
                  <ActionForm action={cancelTimeOffAction.bind(null, row.id)}>
                    <Button type="submit" variant="secondary">
                      Cancel
                    </Button>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {actor.role !== "viewer" ? (
        <section className="flex flex-col gap-3" aria-label="Change event">
          <h2 className="fl-section">Change event</h2>
          <ActionForm action={createChangeEventAction} className="grid gap-2">
            <label className="text-sm">
              Job
              <select name="projectId" aria-label="Change event job" className="field mt-1" defaultValue="">
                <option value="">Select</option>
                {receiptJobs(actor.orgId).map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Title
              <input name="title" aria-label="Change event title" className="field mt-1" />
            </label>
            <label className="text-sm">
              Reason
              <select name="reason" aria-label="Change event reason" defaultValue="field" className="field mt-1">
                {CHANGE_REASONS.map((row) => (
                  <option key={row.value} value={row.value}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Cost code
              <input name="costCode" aria-label="Change event cost code" className="field mt-1" />
            </label>
            <Button type="submit">Log</Button>
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
