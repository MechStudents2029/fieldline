"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { assignDispatchAction } from "@/app/(office)/dispatch/actions";
import type { ActionState } from "@/app/actions";
import { DAY_END, DAY_START, DEFAULT_SPAN, formatClock, minuteFromRatio, windowOf } from "@/lib/dispatch/assign";
import { openTray, shortDay } from "@/lib/dispatch/board";
import type { BoardCard, DispatchBoard as Board } from "@/lib/services/dispatch";

const HOUR = 64;
const GRID = ((DAY_END - DAY_START) / 60) * HOUR;
const MARKS = Array.from({ length: DAY_END / 60 - DAY_START / 60 + 1 }, (_, index) => DAY_START / 60 + index);

function hourMark(hour: number): string {
  if (hour === 12) return "12p";
  if (hour > 12) return `${hour - 12}p`;
  return `${hour}a`;
}

function bookedLabel(cards: BoardCard[]): string {
  let mins = 0;
  for (const card of cards) {
    const window = windowOf(card.startMin, card.endMin);
    if (window) mins += window.endMin - window.startMin;
  }
  const hours = mins / 60;
  const label = hours === 0 ? "0h" : Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
  return `${label} booked`;
}

function spanOf(card: BoardCard): number {
  const window = windowOf(card.startMin, card.endMin);
  return window ? window.endMin - window.startMin : DEFAULT_SPAN;
}

function rangeLabel(card: BoardCard): string {
  const window = windowOf(card.startMin, card.endMin);
  if (!window) return "—";
  return `${formatClock(window.startMin)}–${formatClock(window.endMin)}`;
}

function lanesOf(cards: BoardCard[]): Map<string, { lane: number; count: number }> {
  const rows = cards
    .map((card) => ({ card, window: windowOf(card.startMin, card.endMin) }))
    .filter((row): row is { card: BoardCard; window: { startMin: number; endMin: number } } => Boolean(row.window))
    .sort((a, b) => a.window.startMin - b.window.startMin || a.card.title.localeCompare(b.card.title));
  const ends: number[] = [];
  const lane = new Map<string, number>();
  for (const row of rows) {
    let index = ends.findIndex((end) => end <= row.window.startMin);
    if (index < 0) {
      index = ends.length;
      ends.push(row.window.endMin);
    } else {
      ends[index] = row.window.endMin;
    }
    lane.set(row.card.id, index);
  }
  const count = Math.max(1, ends.length);
  return new Map([...lane].map(([id, index]) => [id, { lane: index, count }]));
}

function CardFace({ card, className, style, onPointerDown, onOpen }: { card: BoardCard; className: string; style?: CSSProperties; onPointerDown: (card: BoardCard, event: ReactPointerEvent<HTMLDivElement>) => void; onOpen: (card: BoardCard, x: number, y: number) => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={card.title}
      data-card={card.id}
      className={className}
      style={style}
      onPointerDown={(event) => onPointerDown(card, event)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onOpen(card, rect.left, rect.bottom);
      }}
    >
      <span className="block truncate text-[12px] leading-4">{card.title}</span>
      <span className="block truncate text-[11px] leading-4 text-[var(--mac-secondary)]">{card.site}</span>
      <span className="num block truncate text-[11px] leading-4 text-[var(--mac-secondary)]">{rangeLabel(card)}</span>
    </div>
  );
}

function CardPopover({ card, board, x, y, onClose, onResult }: { card: BoardCard; board: Board; x: number; y: number; onClose: () => void; onResult: (result: ActionState) => void }) {
  const [state, setState] = useState<ActionState>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    function outside(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const dialog = document.getElementById("dispatch-popover");
      if (dialog && !dialog.contains(target)) onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const left = Math.max(8, Math.min(x, (typeof window === "undefined" ? 800 : window.innerWidth) - 240));
  const top = Math.max(8, Math.min(y + 8, (typeof window === "undefined" ? 600 : window.innerHeight) - 220));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const intent = (event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null) as HTMLButtonElement | null;
    if (intent?.name === "intent") data.set("intent", intent.value);
    setPending(true);
    const result = await assignDispatchAction(null, data);
    setPending(false);
    setState(result);
    onResult(result);
    if (result?.ok) onClose();
  }

  return (
    <div id="dispatch-popover" role="dialog" aria-label={card.title} className="fixed z-40 w-56 rounded-xl bg-[var(--mac-window)] p-2" style={{ left, top, boxShadow: "0 0 0 0.5px var(--mac-separator), 0 12px 32px rgba(0,0,0,0.16)" }}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-1">
        <input type="hidden" name="card" value={card.id} />
        <input type="hidden" name="day" value={board.day} />
        <input name="start" type="time" aria-label="Start" defaultValue={card.start ?? ""} className="field" required />
        <input name="end" type="time" aria-label="End" defaultValue={card.end ?? ""} className="field" required />
        <select name="assignee" aria-label="Tech" defaultValue={card.assigneeId ?? ""} className="field">
          <option value="">Unassigned</option>
          {board.people.map((person) => (
            <option key={person.id} value={person.id}>{person.name}</option>
          ))}
        </select>
        <div className="flex gap-1">
          <button type="submit" name="intent" value="assign" className="mac-primary" disabled={pending}>Assign</button>
          <button type="submit" name="intent" value="unassign" className="ctl" disabled={pending}>Unassign</button>
        </div>
        {state?.error ? <p role="alert" className="text-[12px] text-[var(--mac-danger)]">{state.error}</p> : null}
      </form>
    </div>
  );
}

export function DispatchBoard({ board }: { board: Board }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ id: string; x: number; y: number } | null>(null);
  const [who, setWho] = useState(board.columns[0]?.id ?? "");
  const columnCards = (columnId: string) => board.cards.filter((card) => card.dueOn === board.day && card.assigneeId === columnId && card.start).sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0) || a.title.localeCompare(b.title));
  const tray = openTray(board.cards, board.columns, board.day);
  const pickedCard = picked ? board.cards.find((card) => card.id === picked.id) : null;

  function finish() {
    setPicked(null);
    router.refresh();
  }

  async function place(card: BoardCard, columnId: string, ratio: number) {
    const startMin = minuteFromRatio(ratio);
    const data = new FormData();
    data.set("card", card.id);
    data.set("assignee", columnId);
    data.set("intent", "assign");
    data.set("start", formatClock(startMin));
    data.set("end", formatClock(startMin + spanOf(card)));
    data.set("day", board.day);
    const result = await assignDispatchAction(null, data);
    setError(result?.error ?? null);
    setNotice(result?.warning ?? null);
    if (!result?.error) router.refresh();
  }

  function openCard(card: BoardCard, x: number, y: number) {
    if (!board.canEdit) return;
    setPicked({ id: card.id, x, y });
  }

  function onPointerDown(card: BoardCard, event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (!board.canEdit) return;
    event.preventDefault();
    const target = event.currentTarget;
    if (typeof target.setPointerCapture === "function") target.setPointerCapture(event.pointerId);
    const originX = event.clientX;
    const originY = event.clientY;
    let moved = false;
    let lastX = originX;
    let lastY = originY;
    const move = (ev: PointerEvent) => {
      if (ev.cancelable) ev.preventDefault();
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (Math.abs(ev.clientX - originX) + Math.abs(ev.clientY - originY) > 6) moved = true;
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (typeof target.releasePointerCapture === "function" && target.hasPointerCapture?.(ev.pointerId)) target.releasePointerCapture(ev.pointerId);
      const x = ev.type === "pointercancel" ? lastX : ev.clientX;
      const y = ev.type === "pointercancel" ? lastY : ev.clientY;
      if (!moved) {
        setPicked({ id: card.id, x, y });
        return;
      }
      const hit = document.elementFromPoint(x, y);
      const slot = hit?.closest<HTMLElement>("[data-slot]");
      const rect = slot?.getBoundingClientRect();
      const columnId = slot?.dataset.column || "";
      if (!slot || !columnId || !rect || rect.height <= 0) return;
      void place(card, columnId, (y - rect.top) / rect.height);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  if (board.cards.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 px-4 py-8">
        <h2 className="mac-t15">No work this day</h2>
        <p className="mac-t13 text-[var(--mac-secondary)]">Open the week</p>
        <a href="/schedule" className="mac-primary">Schedule</a>
      </div>
    );
  }

  const phoneColumn = board.columns.find((column) => column.id === who) ?? board.columns[0];
  const phoneCards = phoneColumn ? columnCards(phoneColumn.id) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {notice ? <p data-notice role="status" className="px-4 py-1 text-[12px] text-[var(--mac-accent)]">{notice}</p> : null}
      {error ? <p role="alert" className="px-4 py-1 text-[12px] text-[var(--mac-danger)]">{error}</p> : null}
      <div className="flex flex-col gap-3 px-4 pb-4 md:hidden">
        <div className="flex gap-2 overflow-x-auto">
          {board.columns.map((column) => (
            <button key={column.id} type="button" className="mac-glass-btn" aria-pressed={phoneColumn?.id === column.id} onClick={() => setWho(column.id)}>
              {column.name}
            </button>
          ))}
        </div>
        <ul className="flex flex-col gap-2">
          {phoneCards.map((card) => (
            <li key={card.id}>
              <CardFace card={card} className="rounded-lg bg-[var(--mac-fill)] px-2 py-2" onPointerDown={onPointerDown} onOpen={openCard} />
            </li>
          ))}
        </ul>
        <section aria-label="Open">
          <h2 className="mac-t13">Open <span className="num text-[var(--mac-secondary)]">{tray.length}</span></h2>
          <ul className="mt-2 flex flex-col">
            {tray.map((card) => (
              <li key={card.id} className="border-t border-[var(--mac-separator)]">
                <OpenRow card={card} onPointerDown={onPointerDown} onOpen={openCard} />
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="hidden min-h-0 flex-1 md:flex">
        <div className="flex min-h-0 min-w-0 flex-1 overflow-auto" style={{ touchAction: "none" }}>
          <div className="sticky left-0 z-20 flex w-14 shrink-0 flex-col bg-[var(--mac-window)]">
            <div className="h-12 shrink-0" />
            <div className="relative" style={{ height: GRID }}>
              {MARKS.map((hour, index) => (
                <span key={hour} className="absolute right-1 -translate-y-1/2 text-[11px] text-[var(--mac-secondary)]" style={{ top: index * HOUR }}>{hourMark(hour)}</span>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 flex-1">
            {board.columns.map((column) => {
              const rows = columnCards(column.id);
              const lanes = lanesOf(rows);
              return (
                <section key={column.id} aria-label={column.name} className="flex min-w-[180px] flex-1 flex-col border-l border-[var(--mac-separator)]">
                  <header className="flex h-12 shrink-0 flex-col justify-center bg-[var(--mac-window)] px-2" data-out={column.out ? "1" : undefined}>
                    <h2 className="truncate text-[13px] leading-4">
                      {column.name}
                      {column.out ? <span className="fl-pill fl-pill-sm ml-1">Out</span> : null}
                    </h2>
                    <p className="num text-[11px] leading-4 text-[var(--mac-secondary)]">{bookedLabel(rows)}</p>
                  </header>
                  <div data-slot data-column={column.id} className="relative shrink-0" style={{ height: GRID }}>
                    {MARKS.map((hour) => (
                      <div key={hour} className="pointer-events-none absolute right-0 left-0 border-t border-[var(--mac-separator)]" style={{ top: ((hour * 60 - DAY_START) / 60) * HOUR }} />
                    ))}
                    {rows.map((card) => {
                      const window = windowOf(card.startMin, card.endMin);
                      const lane = lanes.get(card.id) ?? { lane: 0, count: 1 };
                      if (!window) return null;
                      const span = DAY_END - DAY_START;
                      const rawTop = ((window.startMin - DAY_START) / span) * GRID;
                      const rawHeight = ((window.endMin - window.startMin) / span) * GRID;
                      const top = Math.max(0, rawTop);
                      const height = Math.max(48, rawHeight - (top - rawTop));
                      return (
                        <CardFace
                          key={card.id}
                          card={card}
                          onPointerDown={onPointerDown}
                          onOpen={openCard}
                          className="absolute overflow-hidden rounded-md bg-[var(--mac-fill)] px-1.5 py-1 text-left"
                          style={{
                            top,
                            height,
                            left: `calc(${(100 / lane.count) * lane.lane}% + 2px)`,
                            width: `calc(${100 / lane.count}% - 4px)`,
                            boxShadow: card.conflict ? "inset 3px 0 0 var(--mac-danger)" : undefined,
                            touchAction: "none",
                          }}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
        <aside aria-label="Open" className="flex w-[260px] shrink-0 flex-col border-l border-[var(--mac-separator)]" style={{ touchAction: "none" }}>
          <h2 className="px-3 py-2 text-[13px]">Open <span className="num text-[var(--mac-secondary)]">{tray.length}</span></h2>
          <ul className="min-h-0 flex-1 overflow-auto">
            {tray.map((card) => (
              <li key={card.id} className="border-t border-[var(--mac-separator)]">
                <OpenRow card={card} onPointerDown={onPointerDown} onOpen={openCard} />
              </li>
            ))}
          </ul>
        </aside>
      </div>
      {picked && pickedCard && board.canEdit ? (
        <CardPopover
          key={picked.id}
          card={pickedCard}
          board={board}
          x={picked.x}
          y={picked.y}
          onClose={finish}
          onResult={(result) => {
            setError(result?.error ?? null);
            setNotice(result?.warning ?? null);
          }}
        />
      ) : null}
    </div>
  );
}

function OpenRow({ card, onPointerDown, onOpen }: { card: BoardCard; onPointerDown: (card: BoardCard, event: ReactPointerEvent<HTMLDivElement>) => void; onOpen: (card: BoardCard, x: number, y: number) => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={card.title}
      data-card={card.id}
      className="w-full px-3 py-2 text-left"
      style={{ touchAction: "none" }}
      onPointerDown={(event) => onPointerDown(card, event)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onOpen(card, rect.left, rect.bottom);
      }}
    >
      <span className="block truncate text-[13px] leading-4">{card.title}</span>
      <span className="block truncate text-[11px] leading-4 text-[var(--mac-secondary)]">{card.site}</span>
      <span className="num block text-[11px] leading-4 text-[var(--mac-secondary)]">{shortDay(card.dueOn)}</span>
    </div>
  );
}
