import { approveTimeAction, editTimeAction, laborRateAction, manualTimeAction, reopenTimeAction, voidTimeAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { OfflineBridge } from "@/components/offline-bridge";
import { PendingPunches } from "@/components/offline-clock";
import { ShiftForms } from "@/components/shift-forms";
import { ClockInForm, ClockOutForm } from "@/components/time-clock";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { canAddFieldNotes, canManageMoney, canManageSettings } from "@/lib/permissions";
import { formatHours, timeBoard, weekGrid } from "@/lib/services/time";
import { Segmented, Toolbar } from "@/components/mac/toolbar";
import { formatLocalInput, weekdayName } from "@/lib/time/calendar";

function elapsed(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function whenValue(iso: string | null, timeZone: string) {
  if (!iso) return "";
  return formatLocalInput(iso, timeZone);
}

export default async function TimePage() {
  const session = await requireSession();
  const board = timeBoard(session);
  const grid = weekGrid(session);
  const open = board.open;
  const office = board.office;
  const dayLabel = (day: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 md:max-w-none md:px-6 md:pb-8">
      <div className="hidden md:block">
        <Toolbar
          title="Time"
          subtitle={grid.range}
          search={false}
          center={<Segmented items={[{ href: "/time", label: "Day" }, { href: "/time", label: "Week", current: true }, { href: "/time", label: "Pay period" }]} />}
          primary={grid.pendingCount > 0 ? `Approve ${grid.pendingCount}` : undefined}
        />
        {office && office.clockedIn.length > 0 ? (
          <div className="mb-4 flex items-center gap-3 rounded-[10px] border border-[var(--mac-box-border)] bg-[var(--mac-box)] px-3 py-2">
            <span className="mac-t11 text-[var(--mac-secondary)]">On site now {office.clockedIn.length}</span>
            {office.clockedIn.map((row) => (
              <span key={row.entryId} className="mac-t13">
                {row.name}
                <span className="text-[var(--mac-secondary)]"> · {row.projectName} · {row.costCode}</span>
                <span className="num"> · {elapsed(row.since)}</span>
              </span>
            ))}
          </div>
        ) : null}
        <div className="mac-strip mb-4">
          <div>
            <p className="mac-t22 num">{grid.totalHours.toFixed(1)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Hours</p>
          </div>
          <div>
            <p className={`mac-t22 num ${grid.overtimeHours > 0 ? "text-[var(--mac-warning)]" : ""}`}>{grid.overtimeHours.toFixed(1)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Overtime</p>
          </div>
          <div>
            <p className="mac-t22 num">{office ? formatMoney(grid.laborCents) : "—"}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Labor cost</p>
          </div>
          <div>
            <p className="mac-t22 num">{grid.pendingCount}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">To approve</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="mac-table">
            <thead>
              <tr>
                <th className="px-2">Person</th>
                {grid.days.map((day) => (
                  <th key={day} className="px-2 text-right">{dayLabel(day)}</th>
                ))}
                <th className="px-2 text-right">Total</th>
                <th className="px-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.userId}>
                  <td className="px-2">{row.name}</td>
                  {row.hours.map((hours, index) => (
                    <td key={grid.days[index]} className="px-2 text-right num">{hours > 0 ? hours.toFixed(1) : "—"}</td>
                  ))}
                  <td className="px-2 text-right num">{row.total.toFixed(1)}</td>
                  <td className="px-2">{row.status === "Submitted" ? <span className="fl-pill">{row.status}</span> : row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h1 className="fl-large-title md:hidden">Time</h1>
        <p className="fl-footnote text-[var(--fl-secondary)]">The week starts {weekdayName(board.weekStartsOn)}</p>
      </div>
      <section className="fl-strip cols-2">
        <div>
          <p className="fl-number" aria-label="Hours today">
            {formatHours(board.todayMinutes)}
          </p>
          <p className="fl-footnote text-[var(--fl-secondary)]">Today</p>
        </div>
        <div>
          <p className="fl-number" aria-label="Hours this week">
            {formatHours(board.weekMinutes)}
          </p>
          <p className="fl-footnote text-[var(--fl-secondary)]">This week</p>
        </div>
      </section>
      {canAddFieldNotes(session.role) ? (
        <section className="rounded-xl bg-card p-4 ">
          <OfflineBridge
            scope={{ orgId: session.orgId, userId: session.userId }}
            timeZone={board.timeZone}
            weekStartsOn={board.weekStartsOn}
            jobs={board.jobs}
            codes={board.codes}
            open={
              open
                ? {
                    projectId: open.projectId,
                    projectName: board.jobs.find((job) => job.id === open.projectId)?.name ?? "Job",
                    costCode: open.costCode,
                    status: open.status === "break" ? "break" : "open",
                    clockInAt: open.clockInAt,
                  }
                : null
            }
          />
          <PendingPunches />
          {open ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">
                Clocked in on {board.jobs.find((job) => job.id === open.projectId)?.name ?? "a job"} · {open.costCode}
                {open.status === "break" ? " · on break" : ""}
              </p>
              <p className="text-xs text-muted-foreground">Since {formatDateTime(open.clockInAt, board.timeZone)}</p>
              <ClockOutForm scope={{ orgId: session.orgId, userId: session.userId }} />
              <ShiftForms
                scope={{ orgId: session.orgId, userId: session.userId }}
                onBreak={open.status === "break"}
                jobs={board.jobs}
                codes={board.codes}
                projectId={open.projectId}
                costCode={open.costCode}
              />
            </div>
          ) : (
            <ClockInForm jobs={board.jobs} codes={board.codes} scope={{ orgId: session.orgId, userId: session.userId }} />
          )}
        </section>
      ) : (
        <p className="fl-secondary-text text-[var(--fl-secondary)]">View only</p>
      )}
      {board.flags.length > 0 ? (
        <ul className="rounded-xl bg-accent/50 p-4 text-sm">
          {board.flags.map((flag) => (
            <li key={`${flag.kind}-${flag.entryIds.join("-")}`}>{flag.detail}</li>
          ))}
        </ul>
      ) : null}
      <section>
        <h2 className="font-medium">Your punches</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {board.entries.length === 0 ? <li className="text-muted-foreground">No punches yet.</li> : null}
          {board.entries.map((entry) => (
            <li key={entry.id} className="rounded-lg bg-card p-3 ">
              <p className="font-medium">
                {entry.projectName} · {entry.costCode}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(entry.clockInAt, board.timeZone)}
                {entry.clockOutAt ? ` – ${formatDateTime(entry.clockOutAt, board.timeZone)}` : " · open"} · {formatHours(entry.minutes)} · {entry.status}
              </p>
              {entry.note ? <p>{entry.note}</p> : null}
            </li>
          ))}
        </ul>
      </section>
      {office && canManageMoney(session.role) ? (
        <>
          <section>
            <h2 className="font-medium">Clocked in now</h2>
            {office.clockedIn.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nobody is clocked in.</p> : null}
            <ul className="mt-2 space-y-2 text-sm">
              {office.clockedIn.map((row) => (
                <li key={row.entryId}>
                  {row.name} · {row.projectName} · {row.costCode}
                  {row.onBreak ? " · on break" : ""} · since {formatDateTime(row.since, board.timeZone)}
                </li>
              ))}
            </ul>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="font-medium">Waiting for approval</h2>
            {office.pending.length === 0 ? <p className="text-sm text-muted-foreground">No finished punches waiting.</p> : null}
            {office.pending.map((entry) => (
              <article key={entry.id} className="rounded-xl bg-card p-4 text-sm ">
                <p className="font-medium">
                  {entry.name} · {entry.projectName} · {entry.costCode}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatHours(entry.minutes)}
                  {entry.note ? ` · ${entry.note}` : ""}
                  {entry.flags.length > 0 ? ` · ${entry.flags.join(", ")}` : ""}
                </p>
                <ActionForm action={editTimeAction.bind(null, entry.id)} className="mt-3 grid gap-2">
                  <label className="text-sm">
                    Job
                    <select name="projectId" defaultValue={entry.projectId} className="field mt-1">
                      {board.jobs.map((job) => (
                        <option key={job.id} value={job.id}>
                          {job.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Cost code
                    <select name="costCode" defaultValue={entry.costCode} className="field mt-1">
                      {board.codes.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Clock in
                    <input type="datetime-local" name="clockInAt" defaultValue={whenValue(entry.clockInAt, board.timeZone)} className="field mt-1" required />
                  </label>
                  <label className="text-sm">
                    Clock out
                    <input type="datetime-local" name="clockOutAt" defaultValue={whenValue(entry.clockOutAt, board.timeZone)} className="field mt-1" required />
                  </label>
                  <label className="text-sm">
                    Break minutes
                    <input name="breakMinutes" type="number" min={0} defaultValue={entry.breakMinutes} className="field mt-1" />
                  </label>
                  <label className="text-sm">
                    Note
                    <input name="note" defaultValue={entry.note ?? ""} className="field mt-1" />
                  </label>
                  <label className="text-sm">
                    Reason
                    <input name="reason" required className="field mt-1" placeholder="Why this change" />
                  </label>
                  <Button type="submit" variant="outline" className="h-11">
                    Save time
                  </Button>
                </ActionForm>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <ActionForm action={approveTimeAction.bind(null, entry.id)}>
                    <Button type="submit" className="h-11">
                      Approve
                    </Button>
                  </ActionForm>
                  <ActionForm action={voidTimeAction.bind(null, entry.id)} className="flex flex-1 flex-col gap-2 sm:flex-row">
                    <input name="reason" aria-label={`Void reason for ${entry.name}`} placeholder="Reason to void" className="field" required />
                    <Button type="submit" variant="outline" className="h-11">
                      Void
                    </Button>
                  </ActionForm>
                </div>
              </article>
            ))}
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="font-medium">Approved</h2>
            {office.approved.map((entry) => (
              <article key={entry.id} className="rounded-xl bg-card p-4 text-sm ">
                <p className="font-medium">
                  {entry.name} · {entry.projectName} · {entry.costCode}
                </p>
                <p>
                  {formatHours(entry.minutes)}
                  {entry.amountCents != null ? ` · ${formatMoney(entry.amountCents)}` : ""}
                </p>
                <ActionForm action={reopenTimeAction.bind(null, entry.id)} className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input name="reason" aria-label={`Reopen reason for ${entry.name}`} placeholder="Reason to reopen" className="field" required />
                  <Button type="submit" variant="outline" className="h-11">
                    Reopen
                  </Button>
                </ActionForm>
              </article>
            ))}
          </section>
          <section className="rounded-xl bg-card p-4 ">
            <h2 className="font-medium">Add time for someone</h2>
            <ActionForm action={manualTimeAction} className="mt-3 grid gap-2">
              <label className="text-sm">
                Teammate
                <select name="userId" className="field mt-1">
                  {office.members.map((person) => (
                    <option key={person.userId} value={person.userId}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Job
                <select name="projectId" className="field mt-1">
                  {board.jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Cost code
                <select name="costCode" className="field mt-1">
                  {board.codes.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Clock in
                <input type="datetime-local" name="clockInAt" required className="field mt-1" />
              </label>
              <label className="text-sm">
                Clock out
                <input type="datetime-local" name="clockOutAt" required className="field mt-1" />
              </label>
              <label className="text-sm">
                Break minutes
                <input name="breakMinutes" type="number" min={0} defaultValue={0} className="field mt-1" />
              </label>
              <label className="text-sm">
                Reason
                <input name="reason" required className="field mt-1" placeholder="Why you are entering this" />
              </label>
              <Button type="submit" className="h-11">
                Add manual entry
              </Button>
            </ActionForm>
          </section>
          <section className="rounded-xl bg-card p-4 ">
            <h2 className="font-medium">Hourly cost</h2>
            <p className="fl-footnote text-[var(--fl-secondary)]">
              Default {office.defaultHourlyCostCents == null ? "not set" : formatMoney(office.defaultHourlyCostCents)} / hour
            </p>
            <ActionForm action={laborRateAction.bind(null, "")} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="text-sm">
                Default hourly cost
                <input name="rate" inputMode="decimal" defaultValue={office.defaultHourlyCostCents == null ? "" : (office.defaultHourlyCostCents / 100).toFixed(2)} className="field mt-1" />
              </label>
              <Button type="submit" variant="outline" className="h-11">
                Save default
              </Button>
            </ActionForm>
            <ul className="mt-3 space-y-2">
              {office.rates.map((person) => (
                <li key={person.userId}>
                  <ActionForm action={laborRateAction.bind(null, person.userId)} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <label className="text-sm">
                      {person.name}
                      {person.usesDefault ? " (default)" : ""}
                      <input
                        name="rate"
                        aria-label={`Hourly cost for ${person.name}`}
                        inputMode="decimal"
                        defaultValue={person.hourlyCostCents == null ? "" : (person.hourlyCostCents / 100).toFixed(2)}
                        className="field mt-1"
                      />
                    </label>
                    <Button type="submit" variant="outline" className="h-11">
                      Save rate
                    </Button>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </section>
          {canManageSettings(session.role) ? (
            <section className="text-sm">
              <h2 className="font-medium">Payroll hours</h2>
              <p className="fl-footnote text-[var(--fl-secondary)]">Approved hours · {board.timeZone}</p>
              <form action="/api/export/time" className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                <label>
                  From
                  <input type="date" name="from" required className="field mt-1" />
                </label>
                <label>
                  To
                  <input type="date" name="to" required className="field mt-1" />
                </label>
                <Button type="submit" variant="outline" className="h-11">
                  Download CSV
                </Button>
              </form>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
