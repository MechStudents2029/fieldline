"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ganttMoveAction, previewScheduleShiftAction } from "@/app/actions";
import { DELAY_REASONS } from "@/lib/schedule/delays";
import { dayHeading, dayWidth, moveBar, resizeBar } from "@/lib/schedule/gantt";
import { formatCalendarDay } from "@/lib/format";
import { formatPercent } from "@/lib/money";
import type { GanttBar, GanttGroup, GanttModel } from "@/lib/services/gantt";

type Draft = { id: string; startDate: string; endDate: string; label?: string; days?: number; reason?: string };

const ROW = 32;

export function GanttBoard({ model, critical = false, printHref, chrome = true }: { model: GanttModel; critical?: boolean; printHref: string; chrome?: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(critical);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [ghost, setGhost] = useState<Record<string, { start: string; end: string }>>({});
  const [confirm, setConfirm] = useState<Draft | null>(null);
  const [gate, setGate] = useState<Draft | null>(null);
  const [delay, setDelay] = useState<Draft | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const criticalOn = chrome ? on : critical;
  const width = dayWidth(model.zoom);
  const expanded = (group: GanttGroup) => model.scope === "job" || open[group.id];
  const lines: ({ kind: "group"; group: GanttGroup } | { kind: "bar"; bar: GanttBar })[] = [];
  for (const group of model.groups) {
    if (model.scope === "org" || group.title) lines.push({ kind: "group", group });
    if (expanded(group)) for (const bar of group.bars) lines.push({ kind: "bar", bar });
  }
  const indexOf = new Map<string, number>();
  lines.forEach((line, index) => {
    if (line.kind === "bar") indexOf.set(line.bar.id, index);
  });

  function placed(bar: GanttBar) {
    return ghost[bar.id] ?? { start: bar.start, end: bar.end };
  }

  function xOf(date: string) {
    const index = model.days.findIndex((day) => day.date === date);
    return index < 0 ? 0 : index * width;
  }

  function wOf(start: string, end: string) {
    const left = model.days.findIndex((day) => day.date === start);
    const right = model.days.findIndex((day) => day.date === end);
    if (left < 0 || right < 0) return width;
    return Math.max(width / 2, (right - left + 1) * width - 2);
  }

  function clearDrafts() {
    setConfirm(null);
    setGate(null);
    setDelay(null);
    setGhost({});
    setError(null);
  }

  async function stage(id: string, startDate: string, endDate: string, flags?: { confirmGate?: boolean; confirmShift?: boolean; reason?: string; note?: string }) {
    if (!model.canEdit || busy) return;
    setBusy(true);
    setError(null);
    if (flags?.confirmGate || flags?.confirmShift || flags?.reason) {
      const result = await ganttMoveAction({ id, startDate, endDate, ...flags });
      setBusy(false);
      if (result?.needsGate) {
        setGate({ id, startDate, endDate, reason: result.gateReason });
        return;
      }
      if (result?.needsReason) {
        setDelay({ id, startDate, endDate, days: result.delayDays, label: result.confirm });
        return;
      }
      if (result?.confirm) {
        setConfirm({ id, startDate, endDate, label: result.confirm });
        return;
      }
      if (!result || result.error) {
        setError(result?.error ?? "Could not save.");
        return;
      }
      clearDrafts();
      router.refresh();
      return;
    }
    const preview = await previewScheduleShiftAction({ id, startDate, endDate });
    setBusy(false);
    if (preview.error) {
      setError(preview.error);
      return;
    }
    if (preview.needsGate) {
      setGate({ id, startDate, endDate, reason: preview.gateReason ?? "This inspection has not passed." });
      return;
    }
    if (preview.needsReason) {
      setReason("");
      setNote("");
      setDelay({ id, startDate, endDate, days: preview.days, label: preview.count > 1 ? preview.label : undefined });
      return;
    }
    if (preview.count > 1) {
      setConfirm({ id, startDate, endDate, label: preview.label });
      return;
    }
    await stage(id, startDate, endDate, { confirmShift: true });
  }

  function begin(event: React.PointerEvent, bar: GanttBar, mode: "move" | "resize") {
    if (!model.canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    const originX = event.clientX;
    const current = placed(bar);
    const apply = (clientX: number) => {
      const days = Math.round((clientX - originX) / width);
      const next = mode === "move" ? moveBar(current.start, current.end, days) : resizeBar(current.start, current.end, days);
      setGhost((prev) => ({ ...prev, [bar.id]: { start: next.startDate, end: next.endDate } }));
      return { days, next };
    };
    const move = (ev: PointerEvent) => apply(ev.clientX);
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const { days, next } = apply(ev.clientX);
      if (!days || (next.startDate === bar.start && next.endDate === bar.end)) {
        setGhost((prev) => {
          const copy = { ...prev };
          delete copy[bar.id];
          return copy;
        });
        return;
      }
      void stage(bar.id, next.startDate, next.endDate);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onKey(event: React.KeyboardEvent, bar: GanttBar) {
    if (!model.canEdit) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const current = placed(bar);
    const next = event.shiftKey ? resizeBar(current.start, current.end, delta) : moveBar(current.start, current.end, delta);
    setGhost((prev) => ({ ...prev, [bar.id]: { start: next.startDate, end: next.endDate } }));
    void stage(bar.id, next.startDate, next.endDate);
  }

  const chartWidth = model.days.length * width;
  const chartHeight = Math.max(lines.length, 1) * ROW;

  return (
    <div className="flex min-h-0 flex-col gap-2" data-gantt={model.scope} data-zoom={model.zoom} data-critical-on={criticalOn ? "1" : "0"}>
      {chrome ? (
        <div className="flex items-center gap-2">
          <span className="num mac-t13" data-finish>
            {model.finishLabel}
          </span>
          <button type="button" className="mac-glass-btn" aria-pressed={criticalOn} onClick={() => setOn((value) => !value)}>
            Critical
          </button>
          <a className="mac-glass-btn" href={`${printHref}?zoom=${model.zoom}&critical=${criticalOn ? "1" : "0"}`}>
            Print
          </a>
          {confirm ? (
            <span className="ml-auto inline-flex items-center gap-2">
              <button type="button" className="mac-primary" disabled={busy} onClick={() => void stage(confirm.id, confirm.startDate, confirm.endDate, { confirmShift: true })}>
                {confirm.label}
              </button>
              <button type="button" className="mac-glass-btn" onClick={clearDrafts}>
                Cancel
              </button>
            </span>
          ) : null}
          {gate ? (
            <span className="ml-auto inline-flex items-center gap-2">
              <span role="alert">{gate.reason}</span>
              <button type="button" className="mac-primary" disabled={busy} onClick={() => void stage(gate.id, gate.startDate, gate.endDate, { confirmGate: true })}>
                Move anyway
              </button>
              <button type="button" className="mac-glass-btn" onClick={clearDrafts}>
                Cancel
              </button>
            </span>
          ) : null}
          {error ? <span role="alert" className="text-[var(--mac-danger)]">{error}</span> : null}
        </div>
      ) : (
        <p className="num mac-t13" data-finish>
          {model.finishLabel}
        </p>
      )}
      <div className="flex min-h-0 min-w-0 overflow-hidden">
        <table className="mac-table gantt-names shrink-0">
          <colgroup>
            <col className="name" />
            <col style={{ width: 72 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 44 }} />
            <col style={{ width: 44 }} />
          </colgroup>
          <thead>
            <tr>
              {["Name", "Start", "Finish", "Wd", "%"].map((label) => (
                <th key={label} className={label === "Name" ? "text-left" : "num text-right"}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5}>No items</td>
              </tr>
            ) : null}
            {lines.map((line) =>
              line.kind === "group" ? (
                <tr key={`g-${line.group.id}`} data-group={line.group.title || line.group.id} style={{ height: ROW }}>
                  <td colSpan={3}>
                    {model.scope === "org" ? (
                      <button type="button" className="truncate font-semibold" aria-expanded={Boolean(open[line.group.id])} data-expand={line.group.id} onClick={() => setOpen((prev) => ({ ...prev, [line.group.id]: !prev[line.group.id] }))}>
                        {line.group.title}
                      </button>
                    ) : (
                      <span className="font-semibold">{line.group.title}</span>
                    )}
                  </td>
                  <td className="num text-right">{line.group.bars.reduce((sum, bar) => sum + bar.workdays, 0)}</td>
                  <td className="num text-right">{formatPercent(line.group.progressBps)}</td>
                </tr>
              ) : (
                <tr key={line.bar.id} style={{ height: ROW }}>
                  <td>
                    <span className="flex items-center gap-1">
                      <a href={line.bar.href} className="truncate">
                        {line.bar.title}
                      </a>
                      {line.bar.held ? <span className="fl-pill fl-pill-sm" data-held={line.bar.id}>Held</span> : null}
                    </span>
                  </td>
                  <td className="num text-right">{formatCalendarDay(placed(line.bar).start)}</td>
                  <td className="num text-right">{formatCalendarDay(placed(line.bar).end)}</td>
                  <td className="num text-right">{line.bar.workdays}</td>
                  <td className="num text-right">{formatPercent(line.bar.progressBps)}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="relative" style={{ width: chartWidth }}>
            <div className="flex h-7">
              {model.days.map((day) => (
                <div key={day.date} className={`shrink-0 truncate mac-t11 text-[var(--mac-secondary)] ${day.date === model.today ? "text-[var(--mac-accent)]" : ""}`} style={{ width }} data-off={day.off ? day.date : undefined}>
                  {dayHeading(day.date, model.zoom)}
                  {day.label ? <span className="block truncate">{day.label}</span> : null}
                </div>
              ))}
            </div>
            <div className="relative" style={{ height: chartHeight }}>
              {model.days.map((day, index) =>
                day.off ? <div key={day.date} className="gantt-off pointer-events-none absolute bottom-0 top-0" style={{ left: index * width, width }} /> : null,
              )}
              {model.days.some((day) => day.date === model.today) ? (
                <div className="gantt-today pointer-events-none" data-today-line style={{ left: xOf(model.today) + width / 2 }} />
              ) : null}
              {lines.map((line, index) => {
                if (line.kind === "group") {
                  return (
                    <div key={`roll-${line.group.id}`} className="absolute left-0 right-0" style={{ top: index * ROW, height: ROW }}>
                      <div className="gantt-roll absolute top-2" style={{ left: xOf(line.group.start), width: wOf(line.group.start, line.group.end) }}>
                        <span style={{ width: `${line.group.progressBps / 100}%` }} />
                      </div>
                    </div>
                  );
                }
                const spot = placed(line.bar);
                return (
                  <div key={line.bar.id} className="absolute left-0 right-0" style={{ top: index * ROW, height: ROW }}>
                    {line.bar.baselineStart && line.bar.baselineEnd ? (
                      <span className="gantt-base absolute" style={{ left: xOf(line.bar.baselineStart), width: Math.max(4, wOf(line.bar.baselineStart, line.bar.baselineEnd)) }} />
                    ) : null}
                    <button
                      type="button"
                      data-bar={line.bar.id}
                      data-critical={line.bar.critical ? "1" : "0"}
                      data-start={spot.start}
                      data-end={spot.end}
                      title={`Float ${line.bar.float} wd`}
                      disabled={!model.canEdit}
                      className="gantt-bar absolute top-1.5"
                      style={{ left: xOf(spot.start), width: wOf(spot.start, spot.end) }}
                      onPointerDown={(event) => begin(event, line.bar, "move")}
                      onKeyDown={(event) => onKey(event, line.bar)}
                    >
                      <span className="gantt-progress" style={{ width: `${line.bar.progressBps / 100}%` }} />
                      {model.canEdit ? (
                        <span data-resize={line.bar.id} className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={(event) => begin(event, line.bar, "resize")} />
                      ) : null}
                    </button>
                  </div>
                );
              })}
              <svg className="pointer-events-none absolute left-0 top-0" width={chartWidth} height={chartHeight} aria-hidden>
                {model.links.map((link) => {
                  const from = indexOf.get(link.from);
                  const to = indexOf.get(link.to);
                  if (from == null || to == null) return null;
                  const source = lines[from];
                  const target = lines[to];
                  if (!source || source.kind !== "bar" || !target || target.kind !== "bar") return null;
                  const fromSpot = placed(source.bar);
                  const toSpot = placed(target.bar);
                  const x1 = xOf(fromSpot.end) + wOf(fromSpot.start, fromSpot.end);
                  const y1 = from * ROW + ROW / 2;
                  const x2 = xOf(toSpot.start);
                  const y2 = to * ROW + ROW / 2;
                  const mid = x1 + 8;
                  return <path key={`${link.from}-${link.to}`} data-link={`${link.from}-${link.to}`} d={`M${x1} ${y1} H${mid} V${y2} H${x2}`} fill="none" stroke="var(--mac-secondary)" strokeWidth="1" />;
                })}
              </svg>
            </div>
          </div>
        </div>
      </div>
      {delay ? (
        <aside role="dialog" aria-label="Delay" className="flex max-w-sm flex-col gap-2">
          <p className="num mac-t22">+{delay.days ?? 0} wd</p>
          {delay.label ? <p className="mac-t13">{delay.label}</p> : null}
          <label className="text-[13px]">
            Reason
            <select aria-label="Reason" className="field mt-1" value={reason} onChange={(event) => setReason(event.target.value)}>
              <option value="">Reason</option>
              {DELAY_REASONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[13px]">
            Note
            <input aria-label="Note" className="field mt-1" value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          {error ? <p role="alert" className="text-[13px] text-[var(--mac-danger)]">{error}</p> : null}
          <span className="flex gap-2">
            <button type="button" className="mac-primary" disabled={busy} onClick={() => void stage(delay.id, delay.startDate, delay.endDate, { reason, note, confirmShift: true })}>
              Save
            </button>
            <button type="button" className="mac-glass-btn" onClick={clearDrafts}>
              Cancel
            </button>
          </span>
        </aside>
      ) : null}
    </div>
  );
}
