"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { approveEntriesAction, editTimeAction, officeClockOutAction, saveAndApproveAction, undoTimeAction } from "@/app/actions";
import { Segmented, Toolbar } from "@/components/mac/toolbar";
import { formatMoney } from "@/lib/money";
import type { ReviewEntry, TimeReview, TimeUndo } from "@/lib/services/time";

function hours(value: number) {
  return value > 0 ? value.toFixed(1) : "—";
}

function toneClass(tone: "danger" | "warning" | null) {
  if (tone === "danger") return "font-semibold text-[var(--mac-danger)]";
  if (tone === "warning") return "font-semibold text-[var(--mac-warning)]";
  return "";
}

export function TimeReview({ review }: { review: TimeReview }) {
  const router = useRouter();
  const [personId, setPersonId] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [zone, setZone] = useState<"people" | "entries">("people");
  const [stack, setStack] = useState<TimeUndo[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [clockOutId, setClockOutId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedId = review.rows.some((row) => row.userId === personId)
    ? personId
    : (review.rows.find((row) => row.status === "Submitted")?.userId ?? review.rows[0]?.userId ?? null);
  const person = review.rows.find((row) => row.userId === selectedId) ?? null;
  const entries = review.entries.filter((entry) => entry.userId === selectedId);
  const selectedPending = checked.filter((id) => review.pendingIds.includes(id));

  async function approve(ids: string[]) {
    const ready = ids.filter((id) => review.pendingIds.includes(id));
    if (ready.length === 0 || busy) return;
    setBusy(true);
    const result = await approveEntriesAction(ready);
    setBusy(false);
    if (!result || result.error) {
      setNotice(result?.error ?? "Could not approve.");
      return;
    }
    setStack((current) => [...current, { kind: "approve", ids: ready }]);
    setChecked([]);
    setNotice(result.ok ?? null);
    router.refresh();
  }

  async function undo() {
    const last = stack[stack.length - 1];
    if (!last || busy) return;
    setBusy(true);
    const result = await undoTimeAction(last);
    setBusy(false);
    if (!result || result.error) {
      setNotice(result?.error ?? "Could not undo.");
      return;
    }
    setStack((current) => current.slice(0, -1));
    setNotice("Undone.");
    router.refresh();
  }

  useEffect(() => {
    const onCommand = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === "approve") void approve(review.pendingIds);
      else if (action === "prev") router.push(review.prevHref);
      else if (action === "next") router.push(review.nextHref);
      else if (action === "day") router.push(review.dayHref);
      else if (action === "week") router.push(review.weekHref);
      else if (action === "period") router.push(review.periodHref);
      else if (action === "clockout") setClockOutId(review.onSite[0]?.entryId ?? null);
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey && !typing) {
        event.preventDefault();
        void undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a" && !typing) {
        event.preventDefault();
        setChecked(review.pendingIds);
        setZone("entries");
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        if (zone === "entries") setCursor((index) => Math.max(0, Math.min(entries.length - 1, index + delta)));
        else {
          const index = review.rows.findIndex((row) => row.userId === selectedId);
          const next = review.rows[Math.max(0, Math.min(review.rows.length - 1, index + delta))];
          if (next) {
            setPersonId(next.userId);
            setCursor(0);
          }
        }
      } else if (event.key === " " && zone === "entries") {
        const entry = entries[cursor];
        if (!entry || entry.status !== "pending") return;
        event.preventDefault();
        setChecked((current) => (current.includes(entry.id) ? current.filter((id) => id !== entry.id) : [...current, entry.id]));
      }
    };
    window.addEventListener("fieldline-time", onCommand);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("fieldline-time", onCommand);
      window.removeEventListener("keydown", onKey);
    };
  });

  const dayTotals = review.dayHeaders.map((_, index) => review.rows.reduce((sum, row) => sum + (row.hours[index]?.hours ?? 0), 0));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title="Time"
        subtitle={review.range}
        search={false}
        leading={
          <span className="mac-seg" role="group" aria-label="Week">
            <a href={review.prevHref} aria-label={`Previous ${review.stepLabel}`}>
              ‹
            </a>
            <a href={review.nextHref} aria-label={`Next ${review.stepLabel}`}>
              ›
            </a>
          </span>
        }
        center={
          <Segmented
            items={[
              { href: review.dayHref, label: "Day", current: review.view === "day" },
              { href: review.weekHref, label: "Week", current: review.view === "week" },
              { href: review.periodHref, label: "Pay period", current: review.view === "period" },
            ]}
          />
        }
        primary={`Approve ${review.pendingCount}`}
        primaryDisabled={review.pendingCount === 0 || busy}
        onPrimary={() => void approve(review.pendingIds)}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 pb-2">
        <div className="mac-strip">
          <div>
            <p className="mac-t22 num">{review.totalHours.toFixed(1)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Hours</p>
          </div>
          <div>
            <p className={`mac-t22 num ${review.overtimeHours > 0 ? "text-[var(--mac-warning)]" : ""}`}>{review.overtimeHours.toFixed(1)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Overtime</p>
          </div>
          <div>
            <p className="mac-t22 num">{formatMoney(review.laborCents)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Labor cost</p>
          </div>
          <div>
            <p className="mac-t22 num">{review.pendingCount}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">To approve</p>
          </div>
        </div>
        <section className="rounded-[10px] border border-[var(--mac-box-border)] bg-[var(--mac-box)]">
          <div className="flex items-center gap-3 px-3 py-2">
            <h2 className="mac-t11 text-[var(--mac-secondary)]">On site now {review.onSite.length}</h2>
          </div>
          {review.onSite.length === 0 ? <p className="px-3 pb-2 mac-t13 text-[var(--mac-secondary)]">Nobody is clocked in.</p> : null}
          {review.onSite.map((row) => (
            <div key={row.entryId} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--mac-separator)] px-3 py-2">
              <span className="inline-flex items-center gap-2 mac-t13">
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--mac-sel)] text-[11px] font-semibold text-white">{row.initials}</span>
                {row.name}
              </span>
              <span className="mac-t13 text-[var(--mac-secondary)]">
                {row.projectName} · {row.costCode}
              </span>
              <span className="mac-t13 num">In {row.inLabel}</span>
              <span className={`mac-t13 num ${row.forgotten ? "font-semibold text-[var(--mac-warning)]" : ""}`}>{row.elapsed}</span>
              {clockOutId === row.entryId ? (
                <form
                  className="ml-auto flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const reason = String(new FormData(event.currentTarget).get("reason") || "");
                    setBusy(true);
                    void officeClockOutAction(row.entryId, reason).then((result) => {
                      setBusy(false);
                      if (!result || result.error) setNotice(result?.error ?? "Could not clock out.");
                      else {
                        setClockOutId(null);
                        setNotice(result.ok ?? null);
                        router.refresh();
                      }
                    });
                  }}
                >
                  <input name="reason" aria-label={`Clock-out reason for ${row.name}`} required minLength={3} placeholder="Reason" className="h-6 rounded-md bg-[var(--mac-window)] px-2 text-[13px]" />
                  <button type="submit" className="mac-glass-btn" disabled={busy}>
                    Clock out
                  </button>
                </form>
              ) : (
                <button type="button" className="mac-glass-btn ml-auto" onClick={() => setClockOutId(row.entryId)}>
                  Clock out
                </button>
              )}
            </div>
          ))}
        </section>
        {notice ? (
          <p role="status" className="mac-t13">
            {notice}
          </p>
        ) : null}
        <div className="overflow-x-auto" onMouseDown={() => setZone("people")}>
          <table className="mac-table">
            <thead>
              <tr>
                <th className="px-2 text-left">Person</th>
                {review.dayHeaders.map((day) => (
                  <th key={day.key} className="px-2 text-right">
                    {day.label}
                  </th>
                ))}
                <th className="px-2 text-right">Total</th>
                <th className="px-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {review.rows.length === 0 ? (
                <tr>
                  <td colSpan={review.dayHeaders.length + 3} className="px-2 text-[var(--mac-secondary)]">
                    No time this week.
                  </td>
                </tr>
              ) : null}
              {review.rows.map((row) => (
                <tr key={row.userId} className={row.userId === selectedId ? "is-selected" : undefined} aria-selected={row.userId === selectedId} onClick={() => { setPersonId(row.userId); setCursor(0); setZone("people"); }}>
                  <td className="px-2">
                    <span className="inline-flex items-center gap-2">
                      <span className={`inline-flex size-5 items-center justify-center rounded-full text-[10px] font-semibold ${row.userId === selectedId ? "bg-white/20" : "bg-[var(--mac-fill)]"}`}>{row.initials}</span>
                      {row.name}
                    </span>
                  </td>
                  {row.hours.map((cell) => (
                    <td key={cell.day} data-fit="amount" className={`fit px-2 text-right num ${toneClass(cell.tone)}`}>
                      {hours(cell.hours)}
                    </td>
                  ))}
                  <td data-fit="amount" className={`fit px-2 text-right num ${toneClass(row.totalTone)}`}>{row.total.toFixed(1)}</td>
                  <td data-fit="status" className="fit px-2">{row.status === "Submitted" ? <span className="fl-pill">Submitted</span> : row.status}</td>
                </tr>
              ))}
            </tbody>
            {review.rows.length > 0 ? (
              <tfoot>
                <tr>
                  <td className="px-2">Total</td>
                  {dayTotals.map((total, index) => (
                    <td key={review.dayHeaders[index]?.key} className="px-2 text-right num">
                      {hours(total)}
                    </td>
                  ))}
                  <td className="px-2 text-right num">{review.totalHours.toFixed(1)}</td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        {person ? (
          <section onMouseDown={() => setZone("entries")}>
            <div className="mb-1 flex items-center gap-3">
              <h2 className="mac-t15">
                {person.name} <span className="mac-t11 font-normal text-[var(--mac-secondary)]">{entries.length} entries</span>
              </h2>
              <button type="button" className="mac-glass-btn ml-auto" disabled={selectedPending.length === 0 || busy} onClick={() => void approve(selectedPending)}>
                Approve selected
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="mac-table">
                <thead>
                  <tr>
                    <th className="px-2" />
                    <th className="px-2 text-left">Day</th>
                    <th className="px-2 text-left">Job</th>
                    <th className="px-2 text-left">Cost code</th>
                    <th className="px-2 text-left">In</th>
                    <th className="px-2 text-left">Out</th>
                    <th className="px-2 text-right">Break</th>
                    <th className="px-2 text-right">Hours</th>
                    <th className="px-2 text-left">Status</th>
                    <th className="px-2 text-left">Note</th>
                    <th className="px-2 text-left">Reason</th>
                    <th className="px-2" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, index) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      review={review}
                      active={zone === "entries" && index === cursor}
                      checked={checked.includes(entry.id)}
                      busy={busy}
                      onToggle={() => setChecked((current) => (current.includes(entry.id) ? current.filter((id) => id !== entry.id) : [...current, entry.id]))}
                      onDone={(undoStep, message) => {
                        if (undoStep) setStack((current) => [...current, undoStep]);
                        setNotice(message);
                        router.refresh();
                      }}
                      onError={setNotice}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
      <div className="sticky bottom-0 flex h-[30px] items-center bg-[var(--mac-window)] px-4 mac-t11 text-[var(--mac-secondary)]">
        {review.rows.length} people · {review.entries.length} entries · {selectedPending.length} selected · Labor {formatMoney(review.laborCents)}
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  review,
  active,
  checked,
  busy,
  onToggle,
  onDone,
  onError,
}: {
  entry: ReviewEntry;
  review: TimeReview;
  active: boolean;
  checked: boolean;
  busy: boolean;
  onToggle: () => void;
  onDone: (undoStep: TimeUndo | null, message: string) => void;
  onError: (message: string) => void;
}) {
  const formId = `time-${entry.id}`;
  const label = entry.note || `${entry.costCode} ${entry.dayLabel}`;
  async function read(approve: boolean) {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement) || busy) return;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const input = {
      projectId: String(data.get("projectId") || ""),
      costCode: String(data.get("costCode") || ""),
      clockInAt: String(data.get("clockInAt") || ""),
      clockOutAt: String(data.get("clockOutAt") || ""),
      breakMinutes: Number(data.get("breakMinutes") || 0),
      note: String(data.get("note") || ""),
      reason: String(data.get("reason") || ""),
    };
    const before: TimeUndo = {
      kind: "edit",
      entryId: entry.id,
      reopen: approve,
      before: {
        projectId: entry.projectId,
        costCode: entry.costCode,
        clockInAt: entry.clockInAt,
        clockOutAt: entry.clockOutAt,
        breakMinutes: entry.breakMinutes,
        note: entry.note,
        reason: "Undo edit",
      },
    };
    if (approve) {
      const result = await saveAndApproveAction(entry.id, input);
      if (!result || result.error) onError(result?.error ?? "Could not approve.");
      else onDone(before, result.ok ?? "Approved.");
      return;
    }
    const formData = new FormData();
    for (const [key, value] of Object.entries(input)) formData.set(key, String(value));
    const result = await editTimeAction(entry.id, null, formData);
    if (!result || result.error) onError(result?.error ?? "Could not save.");
    else onDone(before, result.ok ?? "Time updated.");
  }
  return (
    <tr aria-current={active ? "true" : undefined}>
      <td className="px-2">
        <input type="checkbox" aria-label={`Select ${label}`} disabled={entry.status !== "pending" || busy} checked={checked} onChange={onToggle} />
      </td>
      <td className="fit num px-2" data-fit="date">{entry.dayLabel}</td>
      <td className="px-2">
        {entry.locked ? (
          entry.projectName
        ) : (
          <select form={formId} name="projectId" aria-label="Job" defaultValue={entry.projectId} className="h-6 max-w-[180px] bg-transparent text-[13px]">
            {review.jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="px-2">
        {entry.locked ? (
          entry.costCode
        ) : (
          <select form={formId} name="costCode" aria-label="Cost code" defaultValue={entry.costCode} className="h-6 bg-transparent text-[13px]">
            {review.codes.includes(entry.costCode) ? null : <option value={entry.costCode}>{entry.costCode}</option>}
            {review.codes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="px-2">
        {entry.locked ? (
          <span className="num">{entry.inLabel}</span>
        ) : (
          <input form={formId} type="datetime-local" name="clockInAt" aria-label="Clock in" defaultValue={entry.clockInLocal} required className="h-6 bg-transparent text-[13px] num" />
        )}
      </td>
      <td className="px-2">
        {entry.locked ? (
          <span className="num">{entry.outLabel}</span>
        ) : (
          <input form={formId} type="datetime-local" name="clockOutAt" aria-label="Clock out" defaultValue={entry.clockOutLocal} required className="h-6 bg-transparent text-[13px] num" />
        )}
      </td>
      <td className="px-2 text-right num">
        {entry.locked ? (
          `${entry.breakMinutes}m`
        ) : (
          <input form={formId} name="breakMinutes" aria-label="Break minutes" type="number" min={0} defaultValue={entry.breakMinutes} className="h-6 w-14 bg-transparent text-right text-[13px] num" />
        )}
      </td>
      <td data-fit="amount" className={`fit px-2 text-right num ${entry.flags.includes("overlap") || entry.flags.includes("open_long") ? "font-semibold text-[var(--mac-danger)]" : ""}`}>{entry.hoursLabel}</td>
      <td data-fit="status" className="fit px-2">{entry.status === "pending" ? <span className="fl-pill">Submitted</span> : entry.status === "approved" ? "Approved" : "On site"}</td>
      <td className="px-2">
        {entry.note ? <span>{entry.note}</span> : null}
        {entry.locked ? null : <input form={formId} name="note" aria-label="Note" defaultValue={entry.note ?? ""} className="sr-only" />}
      </td>
      <td className="px-2">
        {entry.locked ? null : <input form={formId} name="reason" aria-label="Reason" required minLength={3} placeholder="Reason" className="h-6 w-36 bg-transparent text-[13px]" />}
      </td>
      <td className="px-2">
        {entry.locked ? null : (
          <span className="flex gap-1">
            <form id={formId} onSubmit={(event) => event.preventDefault()} />
            <button type="button" className="mac-glass-btn" disabled={busy} onClick={() => void read(false)}>
              Save time
            </button>
            <button type="button" className="mac-glass-btn" disabled={busy} onClick={() => void read(true)}>
              Save and approve
            </button>
          </span>
        )}
      </td>
    </tr>
  );
}
