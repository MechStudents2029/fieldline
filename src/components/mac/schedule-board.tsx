"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { moveScheduleAction, previewScheduleShiftAction, saveScheduleAction } from "@/app/actions";
import { Segmented, Toolbar } from "@/components/mac/toolbar";
import { shiftSpan } from "@/lib/schedule/range";
import type { ScheduleBoard as Board, ScheduleChip } from "@/lib/services/schedule";
import { addCalendarDays } from "@/lib/time/calendar";

type Draft = {
  id: string | null;
  projectId: string;
  title: string;
  startDate: string;
  endDate: string;
  startTime: string;
  status: string;
  note: string;
  assigneeIds: string[];
};

type Pending = {
  id: string;
  startDate: string;
  endDate: string;
  assigneeId: string | null;
  label?: string;
};

export function ScheduleBoard({ board, openJobId }: { board: Board; openJobId: string | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(() => {
    if (openJobId == null) return null;
    const jobId = board.jobs.some((job) => job.id === openJobId) ? openJobId : board.jobs[0]?.id || "";
    return {
      id: null,
      projectId: jobId,
      title: "",
      startDate: board.today,
      endDate: board.today,
      startTime: "",
      status: "planned",
      note: "",
      assigneeIds: [],
    };
  });
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmMove, setConfirmMove] = useState<{ label: string; start: string; end: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === "prev") router.push(board.hrefs.prev);
      else if (action === "next") router.push(board.hrefs.next);
      else if (action === "today") router.push(board.hrefs.today);
      else if (action === "week") router.push(board.hrefs.week);
      else if (action === "two") router.push(board.hrefs.two);
    };
    window.addEventListener("fieldline-schedule", onCommand);
    return () => window.removeEventListener("fieldline-schedule", onCommand);
  }, [board.hrefs, router]);

  function openCreate(userId: string | null, day: string) {
    setPending(null);
    setConfirmMove(null);
    setError(null);
    setDraft({
      id: null,
      projectId: board.jobs[0]?.id || "",
      title: "",
      startDate: day,
      endDate: day,
      startTime: "",
      status: "planned",
      note: "",
      assigneeIds: userId ? [userId] : [],
    });
  }

  function openEdit(item: ScheduleChip) {
    setPending(null);
    setConfirmMove(null);
    setError(null);
    setDraft({
      id: item.id,
      projectId: item.projectId,
      title: item.title,
      startDate: item.startDate,
      endDate: item.endDate,
      startTime: item.startTime ?? "",
      status: item.status,
      note: item.note ?? "",
      assigneeIds: item.assigneeIds,
    });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!board.canEdit || busy) return;
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const start = String(data.get("startDate") || "");
    const end = String(data.get("endDate") || "");
    if (confirmMove && confirmMove.start === start && confirmMove.end === end) data.set("confirmShift", "1");
    const result = await saveScheduleAction(null, data);
    setBusy(false);
    if (result?.confirm) {
      setConfirmMove({ label: result.confirm, start, end });
      setError(null);
      return;
    }
    if (!result || result.error) {
      setError(result?.error ?? "Could not save.");
      return;
    }
    setDraft(null);
    setError(null);
    router.replace(board.hrefs.current);
    router.refresh();
  }

  async function saveMove() {
    if (!pending || busy || !board.canEdit) return;
    setBusy(true);
    const result = await moveScheduleAction(pending);
    setBusy(false);
    if (!result || result.error) {
      setError(result?.error ?? "Could not save.");
      return;
    }
    setPending(null);
    setError(null);
    router.refresh();
  }

  function onGridKey(event: React.KeyboardEvent) {
    if (!board.canEdit) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
    const chip = target.closest<HTMLElement>("[data-chip-id]");
    if (!chip || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const itemId = chip.dataset.chipId || "";
    const baseStart = pending?.id === itemId ? pending.startDate : chip.dataset.start || "";
    const baseEnd = pending?.id === itemId ? pending.endDate : chip.dataset.end || "";
    const baseUser = pending?.id === itemId ? pending.assigneeId : chip.dataset.user || null;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const nextStart = addCalendarDays(baseStart, event.key === "ArrowRight" ? 1 : -1);
      const shifted = shiftSpan(baseStart, baseEnd, nextStart);
      setDraft(null);
      void stageMove({ id: itemId, startDate: shifted.startDate, endDate: shifted.endDate, assigneeId: baseUser || null });
      return;
    }
    const index = board.rows.findIndex((row) => (row.userId ?? "") === (baseUser ?? ""));
    const next = board.rows[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    setDraft(null);
    setPending({ id: itemId, startDate: baseStart, endDate: baseEnd, assigneeId: next.userId });
  }

  function onDrop(event: React.DragEvent, day: string, userId: string | null) {
    if (!board.canEdit) return;
    event.preventDefault();
    const raw = event.dataTransfer.getData("text/plain");
    if (!raw) return;
    let payload: { id: string; start: string; end: string };
    try {
      payload = JSON.parse(raw) as { id: string; start: string; end: string };
    } catch {
      return;
    }
    if (!payload.id || !payload.start || !payload.end) return;
    const shifted = shiftSpan(payload.start, payload.end, day);
    void stageMove({ id: payload.id, startDate: shifted.startDate, endDate: shifted.endDate, assigneeId: userId });
  }

  async function stageMove(next: Pending) {
    setBusy(true);
    const preview = await previewScheduleShiftAction({ id: next.id, startDate: next.startDate, endDate: next.endDate });
    setBusy(false);
    if (preview.error) {
      setError(preview.error);
      return;
    }
    if (preview.count > 1) {
      setError(null);
      setPending({ ...next, label: preview.label });
      return;
    }
    setBusy(true);
    const result = await moveScheduleAction(next);
    setBusy(false);
    if (!result || result.error) {
      setError(result?.error ?? "Could not save.");
      return;
    }
    setPending(null);
    router.refresh();
  }

  const conflictLabel = board.counts.conflicts === 1 ? "1 conflict" : `${board.counts.conflicts} conflicts`;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Toolbar
        title="Schedule"
        subtitle={board.label}
        search={false}
        leading={
          <span className="inline-flex items-center gap-1">
            <a href={board.hrefs.prev} className="mac-glass-btn" aria-label="Previous week">
              ‹
            </a>
            <a href={board.hrefs.today} className="mac-glass-btn">
              Today
            </a>
            <a href={board.hrefs.next} className="mac-glass-btn" aria-label="Next week">
              ›
            </a>
          </span>
        }
        center={
          <Segmented
            items={[
              { href: board.hrefs.week, label: "Week", current: board.span === 7 },
              { href: board.hrefs.two, label: "2 weeks", current: board.span === 14 },
            ]}
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-auto px-4" onKeyDown={onGridKey}>
        <table className="mac-table mac-schedule w-full">
          <thead>
            <tr>
              <th className="px-2 text-left">Person</th>
              {board.days.map((day) => (
                <th key={day.date} className={`px-1 text-left ${day.isToday ? "text-[var(--mac-accent)]" : ""}`}>
                  {day.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => (
              <tr key={row.userId ?? "unassigned"} data-mac-row={row.name}>
                <td className="px-2 align-top">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex size-5 items-center justify-center rounded-full bg-[var(--mac-fill)] text-[10px] font-semibold">{row.initials}</span>
                    {row.name}
                  </span>
                </td>
                {row.cells.map((cell) => {
                  const lifted = pending && (pending.assigneeId ?? "") === (row.userId ?? "") && pending.startDate <= cell.date && cell.date <= pending.endDate;
                  return (
                    <td
                      key={cell.date}
                      className={`relative h-[72px] align-top ${lifted ? "outline outline-1 outline-[var(--mac-accent)]" : ""}`}
                      onDragOver={(event) => {
                        if (board.canEdit) event.preventDefault();
                      }}
                      onDrop={(event) => onDrop(event, cell.date, row.userId)}
                    >
                      {board.canEdit && cell.items.length === 0 ? (
                        <button type="button" aria-label={`Add ${row.name} ${cell.date}`} className="absolute inset-0" onClick={() => openCreate(row.userId, cell.date)} />
                      ) : null}
                      <div className="relative z-10 flex flex-col gap-1 p-1">
                        {cell.items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            draggable={board.canEdit}
                            data-chip-id={item.id}
                            data-start={item.startDate}
                            data-end={item.endDate}
                            data-user={row.userId ?? ""}
                            aria-label={`${item.jobName} ${item.title}${item.conflict ? " Conflict" : ""}`}
                            className={`rounded-md bg-[var(--mac-fill)] px-1.5 py-1 text-left ${cell.date === board.today ? "ring-1 ring-[var(--mac-accent)]" : ""}`}
                            onClick={() => openEdit(item)}
                            onDragStart={(event) => {
                              event.dataTransfer.setData("text/plain", JSON.stringify({ id: item.id, start: item.startDate, end: item.endDate }));
                              event.dataTransfer.effectAllowed = "move";
                            }}
                          >
                            <span className="block truncate text-[11px] font-semibold leading-4">{item.jobName}</span>
                            <span className="block truncate text-[11px] leading-4 text-[var(--mac-secondary)]">{item.title}</span>
                            {item.conflict ? <span className="mt-0.5 inline-flex rounded bg-[var(--mac-danger)]/10 px-1 text-[10px] font-semibold text-[var(--mac-danger)]">Conflict</span> : null}
                            {item.rfiDue ? <span className="mt-0.5 inline-flex rounded bg-[var(--mac-fill)] px-1 text-[10px] text-[var(--mac-secondary)]">RFI</span> : null}
                          </button>
                        ))}
                        {board.canEdit && cell.items.length > 0 ? (
                          <button type="button" aria-label={`Add ${row.name} ${cell.date}`} className="text-left text-[10px] text-[var(--mac-secondary)]" onClick={() => openCreate(row.userId, cell.date)}>
                            Add
                          </button>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex h-[30px] items-center gap-3 px-4 mac-t11 text-[var(--mac-secondary)]">
        <span>
          <span className="num">{board.counts.items}</span> items
        </span>
        <span>
          <span className="num">{board.counts.people}</span> people
        </span>
        <span>
          <span className="num">{board.counts.conflicts}</span> {conflictLabel.replace(/^\d+\s/, "")}
        </span>
        {pending && board.canEdit ? (
          <button type="button" data-mac-primary className="mac-primary ml-auto" onClick={() => void saveMove()} disabled={busy}>
            {pending.label ?? "Save"}
          </button>
        ) : null}
        {error && !draft ? (
          <span role="alert" className="text-[var(--mac-danger)]">
            {error}
          </span>
        ) : null}
      </div>
      {draft ? (
        <aside role="dialog" aria-label="Schedule item" className="absolute inset-y-0 right-0 z-20 flex w-[320px] flex-col gap-3 overflow-hidden border-l border-[var(--mac-separator)] bg-[var(--mac-window)] p-4">
          <div className="flex shrink-0 items-center justify-between bg-[var(--mac-window)]">
            <h2 className="mac-t15">{draft.id ? "Item" : "New item"}</h2>
            <button type="button" className="mac-glass-btn" onClick={() => setDraft(null)} aria-label="Close">
              Close
            </button>
          </div>
          <form key={`${draft.id ?? "new"}-${draft.startDate}-${draft.assigneeIds.join(",")}`} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden" onSubmit={onSubmit}>
            {draft.id ? <input type="hidden" name="itemId" value={draft.id} /> : null}
            <label className="text-[13px]">
              Job
              <select name="projectId" defaultValue={draft.projectId} aria-label="Job" className="field mt-1" disabled={!board.canEdit} required>
                {board.jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[13px]">
              Title
              <input name="title" aria-label="Title" defaultValue={draft.title} required className="field mt-1" disabled={!board.canEdit} />
            </label>
            <label className="text-[13px]">
              Start
              <input name="startDate" type="date" aria-label="Start" defaultValue={draft.startDate} required className="field mt-1" disabled={!board.canEdit} />
            </label>
            <label className="text-[13px]">
              End
              <input name="endDate" type="date" aria-label="End" defaultValue={draft.endDate} required className="field mt-1" disabled={!board.canEdit} />
            </label>
            <label className="text-[13px]">
              Start time
              <input name="startTime" type="time" aria-label="Start time" defaultValue={draft.startTime} className="field mt-1" disabled={!board.canEdit} />
            </label>
            <label className="text-[13px]">
              Status
              <select name="status" aria-label="Status" defaultValue={draft.status} className="field mt-1" disabled={!board.canEdit}>
                <option value="planned">Planned</option>
                <option value="confirmed">Confirmed</option>
                <option value="done">Done</option>
              </select>
            </label>
            <label className="text-[13px]">
              Note
              <textarea name="note" aria-label="Note" defaultValue={draft.note} rows={3} className="field mt-1" disabled={!board.canEdit} />
            </label>
            {draft.id ? <input type="hidden" name="linksForm" value="1" /> : null}
            {draft.id ? (
              <fieldset className="flex flex-col gap-1">
                <legend className="text-[13px]">After</legend>
                {board.catalog
                  .filter((item) => item.projectId === draft.projectId && item.id !== draft.id)
                  .sort((a, b) => a.title.localeCompare(b.title))
                  .map((item) => {
                    const link = board.links.find((row) => row.itemId === draft.id && row.predecessorId === item.id);
                    return (
                      <label key={item.id} className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 text-[13px]">
                        <input type="checkbox" name="pred" value={item.id} aria-label={`After ${item.title}`} defaultChecked={Boolean(link)} disabled={!board.canEdit} />
                        <span className="truncate">{item.title}</span>
                        <span className="inline-flex items-center gap-1">
                          <input
                            name={`lag-${item.id}`}
                            aria-label={`Lag ${item.title} workdays`}
                            type="number"
                            min={0}
                            max={60}
                            defaultValue={link?.lag ?? 0}
                            style={{ width: 52 }}
                            className="h-7 shrink-0 rounded-md border border-[var(--mac-separator)] bg-[var(--mac-window)] px-1 text-right num"
                            disabled={!board.canEdit}
                          />
                          <span className="text-[var(--mac-secondary)]">workdays</span>
                        </span>
                      </label>
                    );
                  })}
              </fieldset>
            ) : null}
            <fieldset className="flex flex-col gap-1">
              <legend className="text-[13px]">Crew</legend>
              {board.crew.map((person) => (
                <label key={person.id} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" name="assignee" value={person.id} defaultChecked={draft.assigneeIds.includes(person.id)} disabled={!board.canEdit} />
                  {person.name}
                </label>
              ))}
            </fieldset>
            {confirmMove ? (
              <p role="status" className="text-[13px]">
                {confirmMove.label}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-[13px] text-[var(--mac-danger)]">
                {error}
              </p>
            ) : null}
            {draft.id ? (
              <a href={`/schedule/items/${draft.id}#comments`} className="mac-t13 text-[var(--mac-accent)]">
                Comments
              </a>
            ) : null}
            {board.canEdit ? (
              <button type="submit" data-mac-primary className="mac-primary" disabled={busy}>
                {confirmMove?.label ?? "Save"}
              </button>
            ) : null}
          </form>
        </aside>
      ) : null}
    </div>
  );
}
