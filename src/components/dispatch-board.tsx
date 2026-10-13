"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { assignDispatchAction } from "@/app/(office)/dispatch/actions";
import { ActionForm } from "@/components/action-form";
import type { BoardCard, DispatchBoard as Board } from "@/lib/services/dispatch";

function Card({ card, board, showDay }: { card: BoardCard; board: Board; showDay?: boolean }) {
  return (
    <article aria-label={card.title} data-card={card.id} className="rounded-lg bg-[var(--mac-fill)] px-2 py-2" draggable={board.canEdit} onDragStart={(event) => { event.dataTransfer.setData("text/plain", card.id); event.dataTransfer.effectAllowed = "move"; }}>
      <div className="flex items-baseline justify-between gap-2">
        <a href={card.href} className="min-w-0 truncate mac-t13">{card.title}</a>
        <span className="num shrink-0 mac-t11 text-[var(--mac-secondary)]">{showDay && card.overdue ? card.dueOn.slice(5) : card.start || "—"}</span>
      </div>
      <p className="truncate mac-t11 text-[var(--mac-secondary)]">{card.site}{card.end ? ` · ${card.start}–${card.end}` : ""}</p>
      <div className="mt-1 flex gap-1">
        <span className="fl-pill">{card.held ? "Held" : card.status}</span>
        {card.conflict ? <span className="fl-pill text-[var(--mac-danger)]">Conflict</span> : null}
      </div>
      {board.canEdit ? (
        <ActionForm action={assignDispatchAction} className="mt-2 flex flex-col gap-1">
          <input type="hidden" name="card" value={card.id} />
          <input type="hidden" name="day" value={card.dueOn} />
          <div className="flex gap-1">
            <input name="start" type="time" aria-label="Start" defaultValue={card.start ?? ""} className="field" />
            <input name="end" type="time" aria-label="End" defaultValue={card.end ?? ""} className="field" />
          </div>
          <select name="assignee" aria-label="Crew" defaultValue={card.assigneeId ?? ""} className="field">
            <option value="">Unassigned</option>
            {board.people.map((person) => (
              <option key={person.id} value={person.id}>{person.name}</option>
            ))}
          </select>
          <div className="flex gap-1">
            <button type="submit" name="intent" value="assign" className="mac-primary">Assign</button>
            <button type="submit" name="intent" value="unassign" className="ctl">Unassign</button>
          </div>
        </ActionForm>
      ) : null}
    </article>
  );
}

export function DispatchBoard({ board }: { board: Board }) {
  const router = useRouter();
  const [dragError, setDragError] = useState<string | null>(null);
  const timed = (columnId: string) => board.cards.filter((card) => card.dueOn === board.day && (card.assigneeId ?? "") === columnId && card.start).sort((a, b) => (a.start || "").localeCompare(b.start || "") || a.title.localeCompare(b.title));
  const tray = board.cards.filter((card) => card.overdue || !card.start).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title));

  async function onDrop(columnId: string, event: React.DragEvent) {
    event.preventDefault();
    if (!board.canEdit) return;
    const card = board.cards.find((row) => row.id === event.dataTransfer.getData("text/plain"));
    if (!card || (card.assigneeId ?? "") === columnId) return;
    const data = new FormData();
    data.set("card", card.id);
    data.set("assignee", columnId);
    data.set("intent", columnId ? "assign" : "unassign");
    data.set("start", card.start ?? "");
    data.set("end", card.end ?? "");
    data.set("day", card.dueOn);
    const result = await assignDispatchAction(null, data);
    setDragError(result?.error ?? null);
    if (!result?.error) router.refresh();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-6">
      <div className="flex flex-wrap items-center gap-2">
        <a href={`/dispatch?on=${board.prev}`} className="mac-glass-btn" aria-label="Previous day">‹</a>
        <a href="/dispatch" className="mac-glass-btn">Today</a>
        <a href={`/dispatch?on=${board.next}`} className="mac-glass-btn" aria-label="Next day">›</a>
        <input aria-label="Day" type="date" className="field w-auto" defaultValue={board.day} onChange={(event) => { if (event.target.value) router.push(`/dispatch?on=${event.target.value}`); }} />
      </div>
      {dragError ? <p role="alert" className="text-sm text-[var(--mac-danger)]">{dragError}</p> : null}
      {board.cards.length === 0 ? (
        <div className="flex flex-col items-start gap-2 py-8">
          <h2 className="mac-t15">No work this day</h2>
          <p className="mac-t13 text-[var(--mac-secondary)]">Open the week</p>
          <a href="/schedule" className="mac-primary">Schedule</a>
        </div>
      ) : (
        <>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {board.columns.map((column) => {
              const rows = timed(column.id);
              return (
                <section key={column.id || "none"} aria-label={column.name} className="flex w-72 shrink-0 flex-col gap-2" onDragOver={(event) => { if (board.canEdit) event.preventDefault(); }} onDrop={(event) => void onDrop(column.id, event)}>
                  <h2 className="mac-t13">{column.name} <span className="num text-[var(--mac-secondary)]">{rows.length}</span></h2>
                  {rows.map((card) => <Card key={card.id} card={card} board={board} />)}
                </section>
              );
            })}
          </div>
          <section aria-label="Open">
            <h2 className="mac-t13">Open <span className="num">{tray.length}</span></h2>
            <ul className="mt-2 flex flex-col gap-2">
              {tray.map((card) => (
                <li key={card.id}><Card card={card} board={board} showDay /></li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
