"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MousePointer2, Redo2, Square, Trash2, Undo2, Ruler, Spline, Box, Hash } from "lucide-react";
import { deleteTakeoffAction, reviewTakeoffsAction, savePlanScaleAction, saveTakeoffAction } from "@/app/(office)/projects/[id]/plans/actions";
import { formatQty } from "@/lib/money";
import type { TakeoffBoard, TakeoffRow } from "@/lib/services/takeoff";
import {
  SCALE_PRESETS,
  formatFeetInches,
  measureQuantity,
  parseFeetInches,
  sheetAspect,
  snapPoint,
  type Pt,
  type Scale,
  type TakeoffKind,
} from "@/lib/takeoff/geometry";

const COLOR_HEX: Record<string, string> = {
  teal: "#0f766e",
  blue: "#2563eb",
  orange: "#ea580c",
  purple: "#7c3aed",
};

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: "select", label: "Select", key: "V" },
  { id: "scale", label: "Scale", key: "S" },
  { id: "linear", label: "Linear", key: "L" },
  { id: "wall", label: "Wall", key: "W" },
  { id: "area", label: "Area", key: "A" },
  { id: "count", label: "Count", key: "C" },
];

type Tool = "select" | "scale" | "linear" | "wall" | "area" | "count";

type Hist =
  | { type: "draft"; points: Pt[] }
  | { type: "move"; id: string; points: Pt[] }
  | { type: "delete"; row: TakeoffRow };

function drawPlan(canvas: HTMLCanvasElement, title: string) {
  canvas.width = 918;
  canvas.height = 1188;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#1c1917";
  ctx.lineWidth = 2;
  ctx.strokeRect(48, 48, 820, 1090);
  ctx.strokeRect(100, 180, 300, 400);
  ctx.fillStyle = "#1c1917";
  ctx.font = "28px sans-serif";
  ctx.fillText(title, 100, 120);
}

function pagePoint(canvas: HTMLCanvasElement, clientX: number, clientY: number, vertices: Pt[]): Pt {
  const rect = canvas.getBoundingClientRect();
  const x = Math.round(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * 100_000);
  const y = Math.round(Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)) * 100_000);
  return snapPoint({ x, y }, vertices, 1200);
}

function ready(kind: TakeoffKind, points: Pt[]) {
  if (kind === "count") return points.length >= 1;
  if (kind === "area") return points.length >= 3;
  return points.length >= 2;
}

function typing(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function totals(rows: TakeoffRow[]) {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.qtyMilli == null || !row.unit) continue;
    map.set(row.unit, (map.get(row.unit) ?? 0) + row.qtyMilli);
  }
  return [...map.entries()];
}

export function TakeoffStage({ board, estimateId }: { board: TakeoffBoard; estimateId?: string | null }) {
  const router = useRouter();
  const baseRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const past = useRef<Hist[]>([]);
  const future = useRef<Hist[]>([]);
  const fitted = useRef(false);
  const [bitmap, setBitmap] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>("select");
  const [rows, setRows] = useState<TakeoffRow[]>(() => board.sheets.find((sheet) => sheet.id === board.fileId)?.rows ?? []);
  const [scaleText, setScaleText] = useState(board.scaleText);
  const [hasScale, setHasScale] = useState(Boolean(board.scale));
  const [draft, setDraft] = useState<Pt[]>([]);
  const [scalePoints, setScalePoints] = useState<Pt[]>([]);
  const [lengthText, setLengthText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [color, setColor] = useState("teal");
  const [estimate, setEstimate] = useState(estimateId || board.estimates.find((row) => !row.locked)?.id || "");
  const [measurementId, setMeasurementId] = useState("new");
  const [heightText, setHeightText] = useState("8'");
  const [pitchRise, setPitchRise] = useState("");
  const [pitchRun, setPitchRun] = useState("");
  const [depthText, setDepthText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const kind: TakeoffKind | null = tool === "linear" || tool === "wall" || tool === "area" || tool === "count" ? tool : selected?.kind ?? null;

  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas) return;
    let cancel = false;
    drawPlan(canvas, board.name);
    fitted.current = false;
    setBitmap({ w: canvas.width, h: canvas.height });
    if (board.kind === "pdf") {
      void (async () => {
        try {
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
          const response = await fetch(board.documentHref);
          const data = new Uint8Array(await response.arrayBuffer());
          const pdf = await pdfjs.getDocument({ data }).promise;
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 1.5 });
          if (cancel) return;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          await page.render({ canvasContext: ctx, viewport }).promise;
          fitted.current = false;
          setBitmap({ w: canvas.width, h: canvas.height });
        } catch {
          if (!cancel) drawPlan(canvas, board.name);
        }
      })();
    }
    return () => {
      cancel = true;
    };
  }, [board.documentHref, board.kind, board.name]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const apply = () => {
      if (!bitmap || fitted.current || frame.clientWidth < 8 || frame.clientHeight < 8) return;
      const next = Math.min(frame.clientWidth / bitmap.w, frame.clientHeight / bitmap.h);
      if (!Number.isFinite(next) || next <= 0) return;
      fitted.current = true;
      setZoom(Number(next.toFixed(3)));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [bitmap]);

  useEffect(() => {
    const canvas = drawRef.current;
    if (!canvas || !bitmap) return;
    canvas.width = bitmap.w;
    canvas.height = bitmap.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const drawPath = (points: Pt[], stroke: string, close: boolean, width: number) => {
      if (points.length === 0) return;
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = (point.x / 100_000) * canvas.width;
        const y = (point.y / 100_000) * canvas.height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (close) ctx.closePath();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.stroke();
      if (close) {
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = stroke;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    };
    for (const row of rows) {
      const stroke = COLOR_HEX[row.color] ?? COLOR_HEX.teal;
      const on = row.id === selectedId;
      if (row.kind === "count") {
        for (const point of row.points) {
          ctx.beginPath();
          ctx.fillStyle = stroke;
          ctx.arc((point.x / 100_000) * canvas.width, (point.y / 100_000) * canvas.height, on ? 8 : 5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        drawPath(row.points, stroke, row.kind === "area", on ? 4 : 2);
      }
    }
    if (draft.length) drawPath(draft, COLOR_HEX[color] ?? COLOR_HEX.teal, false, 2);
    if (scalePoints.length) drawPath(scalePoints, "#0f766e", false, 2);
  }, [bitmap, rows, draft, scalePoints, selectedId, color]);

  function loadRow(row: TakeoffRow) {
    setSelectedId(row.id);
    setTool("select");
    setName(row.name);
    setRoom(row.room);
    setColor(row.color);
    setEstimate(row.estimateId ?? estimateId ?? "");
    setMeasurementId(row.measurementId ?? "new");
    setHeightText(row.heightInches ? formatFeetInches(row.heightInches) : "8'");
    setPitchRise(row.pitchRise != null ? String(row.pitchRise) : "");
    setPitchRun(row.pitchRun != null ? String(row.pitchRun) : "");
    setDepthText(row.depthInches ? String(row.depthInches) : "");
  }

  function vertices(except?: Pt) {
    return rows.flatMap((row) => row.points).filter((point) => point !== except);
  }

  function push(item: Hist) {
    past.current.push(item);
    if (past.current.length > 40) past.current.shift();
    future.current = [];
  }

  async function applyMove(id: string, points: Pt[]) {
    const row = rows.find((item) => item.id === id);
    if (!row) return;
    setRows((currentRows) => currentRows.map((item) => (item.id === id ? { ...item, points } : item)));
    const result = await saveTakeoffAction(payload(row, points));
    if (result.error) setError(result.error);
    else {
      setError(null);
      if (result.frozen) setNotice("Estimate is locked.");
      router.refresh();
    }
  }

  function payload(row: TakeoffRow, points: Pt[]) {
    return {
      id: row.id,
      projectId: board.projectId,
      jobFileId: board.fileId,
      kind: row.kind,
      name: row.name,
      color: row.color,
      room: row.room,
      points,
      heightInches: row.heightInches,
      pitchRise: row.pitchRise,
      pitchRun: row.pitchRun,
      depthInches: row.depthInches,
      estimateId: row.estimateId,
      measurementId: row.measurementId,
    };
  }

  async function undo() {
    const item = past.current.pop();
    if (!item) return;
    if (item.type === "draft") {
      future.current.push({ type: "draft", points: draft });
      setDraft(item.points);
      return;
    }
    if (item.type === "move") {
      const row = rows.find((entry) => entry.id === item.id);
      if (row) future.current.push({ type: "move", id: row.id, points: row.points });
      await applyMove(item.id, item.points);
      return;
    }
    future.current.push({ type: "delete", row: item.row });
    setBusy(true);
    const result = await saveTakeoffAction({
      projectId: board.projectId,
      jobFileId: board.fileId,
      kind: item.row.kind,
      name: item.row.name,
      color: item.row.color,
      room: item.row.room,
      points: item.row.points,
      heightInches: item.row.heightInches,
      pitchRise: item.row.pitchRise,
      pitchRun: item.row.pitchRun,
      depthInches: item.row.depthInches,
      estimateId: item.row.estimateId,
      measurementId: item.row.measurementId,
    });
    setBusy(false);
    if (result.error) setError(result.error);
    else router.refresh();
  }

  async function redo() {
    const item = future.current.pop();
    if (!item) return;
    if (item.type === "draft") {
      past.current.push({ type: "draft", points: draft });
      setDraft(item.points);
      return;
    }
    if (item.type === "move") {
      const row = rows.find((entry) => entry.id === item.id);
      if (row) past.current.push({ type: "move", id: row.id, points: row.points });
      await applyMove(item.id, item.points);
      return;
    }
    past.current.push({ type: "delete", row: item.row });
    await remove(item.row.id, false);
  }

  function onCanvasClick(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!board.canEdit || busy) return;
    const point = pagePoint(event.currentTarget, event.clientX, event.clientY, vertices());
    if (tool === "select") {
      const hit = [...rows].reverse().find((row) => row.points.some((vertex) => Math.hypot(vertex.x - point.x, vertex.y - point.y) < 2500));
      if (hit) loadRow(hit);
      else setSelectedId(null);
      return;
    }
    if (tool === "scale") {
      setScalePoints((currentPoints) => (currentPoints.length >= 2 ? [point] : [...currentPoints, point]));
      return;
    }
    setDraft((currentPoints) => {
      push({ type: "draft", points: currentPoints });
      return [...currentPoints, point];
    });
  }

  function startDrag(event: React.PointerEvent<HTMLButtonElement>, index: number) {
    if (!board.canEdit || !selected) return;
    event.stopPropagation();
    event.preventDefault();
    const origin = selected.points.map((point) => ({ ...point }));
    const rowId = selected.id;
    push({ type: "move", id: rowId, points: origin });
    const move = (ev: PointerEvent) => {
      const canvas = drawRef.current;
      if (!canvas) return;
      const point = pagePoint(canvas, ev.clientX, ev.clientY, vertices());
      setRows((currentRows) =>
        currentRows.map((row) => (row.id === rowId ? { ...row, points: row.points.map((item, itemIndex) => (itemIndex === index ? point : item)) } : row)),
      );
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const canvas = drawRef.current;
      if (!canvas) return;
      const point = pagePoint(canvas, ev.clientX, ev.clientY, origin.filter((_, itemIndex) => itemIndex !== index));
      const next = origin.map((item, itemIndex) => (itemIndex === index ? point : item));
      void applyMove(rowId, next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  async function setScale(event: React.FormEvent) {
    event.preventDefault();
    if (scalePoints.length < 2) return;
    setBusy(true);
    const result = await savePlanScaleAction({
      projectId: board.projectId,
      jobFileId: board.fileId,
      mode: "segment",
      ax: scalePoints[0]!.x,
      ay: scalePoints[0]!.y,
      bx: scalePoints[1]!.x,
      by: scalePoints[1]!.y,
      length: lengthText,
      aspectBps: bitmap ? sheetAspect(bitmap.w, bitmap.h) : 10_000,
      paperWidthInches: 36,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    setScalePoints([]);
    setLengthText("");
    if (result.scaleText) setScaleText(result.scaleText);
    setHasScale(true);
    router.refresh();
  }

  async function pickPreset(preset: string) {
    if (!preset || !board.canEdit) return;
    setBusy(true);
    const result = await savePlanScaleAction({
      projectId: board.projectId,
      jobFileId: board.fileId,
      mode: "preset",
      preset,
      aspectBps: bitmap ? sheetAspect(bitmap.w, bitmap.h) : board.scale && "aspectBps" in board.scale ? board.scale.aspectBps : 10_000,
      paperWidthInches: 36,
    });
    setBusy(false);
    if (result.error) setError(result.error);
    else {
      setError(null);
      if (result.scaleText) setScaleText(result.scaleText);
      setHasScale(true);
      router.refresh();
    }
  }

  function numbers() {
    const rise = pitchRise.trim() ? Number(pitchRise) : null;
    const run = pitchRun.trim() ? Number(pitchRun) : null;
    const depth = depthText.trim() ? Number(depthText) : null;
    let height: number | null = null;
    if (kind === "wall") {
      try {
        height = parseFeetInches(heightText);
      } catch (caught) {
        throw new Error(caught instanceof Error ? caught.message : "Enter the wall height.");
      }
    }
    return { height, rise, run, depth };
  }

  async function saveDrawing(event?: React.FormEvent) {
    event?.preventDefault();
    const useKind = selected && tool === "select" ? selected.kind : kind;
    const points = selected && tool === "select" ? selected.points : draft;
    if (!useKind || !ready(useKind, points)) {
      setError(useKind === "area" ? "Close the area." : useKind === "count" ? "Drop a marker." : "Draw a line.");
      return;
    }
    let height: number | null = null;
    let rise: number | null = null;
    let run: number | null = null;
    let depth: number | null = null;
    try {
      const parsed = numbers();
      height = parsed.height;
      rise = parsed.rise;
      run = parsed.run;
      depth = parsed.depth;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Check the measurement.");
      return;
    }
    setBusy(true);
    const result = await saveTakeoffAction({
      id: selected && tool === "select" ? selected.id : null,
      projectId: board.projectId,
      jobFileId: board.fileId,
      kind: useKind,
      name,
      color,
      room,
      points,
      heightInches: height,
      pitchRise: rise,
      pitchRun: run,
      depthInches: depth,
      estimateId: estimate || null,
      measurementId: measurementId === "new" ? null : measurementId,
      createMeasurement: measurementId === "new" && Boolean(estimate),
    });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    setNotice(result.frozen ? "Estimate is locked." : result.qtyMilli != null ? `${formatQty(result.qtyMilli)} ${result.unit ?? ""}`.trim() : null);
    setDraft([]);
    setSelectedId(null);
    setName("");
    router.refresh();
  }

  async function remove(id: string, record = true) {
    const row = rows.find((item) => item.id === id);
    if (record && row) push({ type: "delete", row });
    setBusy(true);
    const result = await deleteTakeoffAction({ projectId: board.projectId, jobFileId: board.fileId, id });
    setBusy(false);
    if (result.error) setError(result.error);
    else {
      setSelectedId(null);
      setError(null);
      router.refresh();
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!board.canEdit) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) void redo();
        else void undo();
        return;
      }
      if (typing(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "escape") {
        setDraft([]);
        setScalePoints([]);
        return;
      }
      if (key === "enter") {
        event.preventDefault();
        if (draft.length) void saveDrawing();
        return;
      }
      if (key === "backspace" || key === "delete") {
        if (draft.length) {
          push({ type: "draft", points: draft });
          setDraft((currentPoints) => currentPoints.slice(0, -1));
          return;
        }
        if (selectedId) void remove(selectedId);
        return;
      }
      const next = TOOLS.find((item) => item.key.toLowerCase() === key);
      if (next) setTool(next.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const showForm = (selected && tool === "select") || (kind != null && ready(kind, draft));
  const measures = board.measurements.filter((row) => row.estimateId === estimate);
  const planBox = bitmap ? { width: Math.max(1, Math.round(bitmap.w * zoom)), height: Math.max(1, Math.round(bitmap.h * zoom)) } : null;
  const live = preview(kind, draft.length ? draft : selected?.points ?? [], board.scale, heightText, pitchRise, pitchRun, depthText);

  return (
    <div className="grid h-full min-h-0 flex-1 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-h-0 min-w-0 flex-col gap-2">
        <div data-bar="takeoff" className="flex flex-nowrap items-center gap-1 overflow-x-auto">
          {TOOLS.map((item) => (
            <button key={item.id} type="button" className="ctl" aria-label={item.label} title={`${item.label} (${item.key})`} aria-pressed={tool === item.id} disabled={!board.canEdit && item.id !== "select"} onClick={() => setTool(item.id)}>
              <ToolIcon id={item.id} />
            </button>
          ))}
          {Object.keys(COLOR_HEX).map((item) => (
            <button key={item} type="button" className="ctl" aria-label={item} aria-pressed={color === item} disabled={!board.canEdit} onClick={() => setColor(item)}>
              <span className="inline-block size-3 rounded-full" style={{ background: COLOR_HEX[item] }} />
            </button>
          ))}
          <button type="button" className="ctl" aria-label="Undo" title="Undo" disabled={!board.canEdit} onClick={() => void undo()}>
            <Undo2 size={14} />
          </button>
          <button type="button" className="ctl" aria-label="Redo" title="Redo" disabled={!board.canEdit} onClick={() => void redo()}>
            <Redo2 size={14} />
          </button>
          <button type="button" className="ctl" aria-label="Delete" title="Delete" disabled={!board.canEdit || !selectedId} onClick={() => selectedId && void remove(selectedId)}>
            <Trash2 size={14} />
          </button>
          <select aria-label="Standard scale" className="ctl" disabled={!board.canEdit} value={board.scale?.mode === "preset" ? board.scale.preset : ""} onChange={(event) => void pickPreset(event.target.value)}>
            <option value="">Scale</option>
            {SCALE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <span data-scale className="fl-pill fl-pill-sm" style={hasScale ? undefined : { color: "var(--fl-danger)" }}>
            {hasScale ? scaleText : "No scale"}
          </span>
          {live ? <span className="mac-t13 tabular-nums text-[var(--mac-secondary)]">{live}</span> : null}
        </div>
        {tool === "scale" && scalePoints.length === 2 ? (
          <form className="flex items-center gap-2" onSubmit={(event) => void setScale(event)}>
            <input aria-label="Length" className="ctl w-28" value={lengthText} placeholder={`10'`} onChange={(event) => setLengthText(event.target.value)} />
            <button type="submit" className="mac-primary" disabled={busy}>
              Set
            </button>
          </form>
        ) : null}
        {error ? <p role="alert" className="mac-t13" style={{ color: "var(--fl-danger)" }}>{error}</p> : null}
        {notice ? <p className="mac-t13 text-[var(--mac-secondary)]">{notice}</p> : null}
        <div ref={frameRef} className="relative min-h-0 flex-1 overflow-auto rounded-md bg-[var(--mac-box)]">
          <div className="relative" style={planBox ? { width: planBox.width, height: planBox.height } : undefined}>
            <canvas ref={baseRef} className="absolute inset-0 h-full w-full" />
            <canvas ref={drawRef} data-canvas="takeoff" className="absolute inset-0 h-full w-full" onPointerDown={onCanvasClick} />
            {tool === "select" && selected
              ? selected.points.map((point, index) => (
                  <button
                    key={`${selected.id}-${index}`}
                    type="button"
                    data-vertex
                    aria-label={`Vertex ${index + 1}`}
                    className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-[var(--mac-accent)]"
                    style={{ left: `${point.x / 1000}%`, top: `${point.y / 1000}%` }}
                    onPointerDown={(event) => startDrag(event, index)}
                  />
                ))
              : null}
          </div>
        </div>
      </div>
      <aside data-takeoff-pane data-pane="takeoff" aria-label="Measurements" className="min-h-0 overflow-auto border-t border-[var(--mac-separator)] pt-3 lg:border-t-0 lg:border-l lg:pl-3 lg:pt-0">
        {showForm ? (
          <form className="mb-3 flex flex-col gap-2" onSubmit={(event) => void saveDrawing(event)}>
            <input aria-label="Name" className="ctl" value={name} onChange={(event) => setName(event.target.value)} />
            <input aria-label="Room" className="ctl" value={room} placeholder="Room" onChange={(event) => setRoom(event.target.value)} />
            {kind === "wall" || selected?.kind === "wall" ? <input aria-label="Height" className="ctl" value={heightText} onChange={(event) => setHeightText(event.target.value)} /> : null}
            {(kind === "area" || selected?.kind === "area") && (
              <>
                <input aria-label="Pitch rise" className="ctl" inputMode="numeric" value={pitchRise} placeholder="Rise" onChange={(event) => setPitchRise(event.target.value)} />
                <input aria-label="Pitch run" className="ctl" inputMode="numeric" value={pitchRun} placeholder="Run" onChange={(event) => setPitchRun(event.target.value)} />
                <input aria-label="Depth" className="ctl" inputMode="decimal" value={depthText} placeholder="Depth" onChange={(event) => setDepthText(event.target.value)} />
              </>
            )}
            <select aria-label="Estimate" className="ctl" value={estimate} onChange={(event) => { setEstimate(event.target.value); setMeasurementId("new"); }}>
              <option value="">Estimate</option>
              {board.estimates.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title}
                </option>
              ))}
            </select>
            <select aria-label="Measurement" className="ctl" value={measurementId} onChange={(event) => setMeasurementId(event.target.value)}>
              <option value="new">New</option>
              {measures.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
            <button type="submit" className="mac-primary" disabled={busy || !board.canEdit}>
              Use
            </button>
          </form>
        ) : null}
        {board.sheets.map((sheet) => (
          <section key={sheet.id} className="mb-4">
            <p className="mac-t11 text-[var(--mac-secondary)]">
              {sheet.name} · Rev {sheet.revision}
              {sheet.current ? "" : " · Superseded"}
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {(sheet.id === board.fileId ? rows : sheet.rows).map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    data-qty={row.qtyMilli ?? ""}
                    data-unit={row.unit ?? ""}
                    aria-label={row.name}
                    aria-pressed={row.id === selectedId}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left"
                    style={row.id === selectedId ? { background: "var(--mac-box)" } : undefined}
                    onClick={() => loadRow(row)}
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ background: COLOR_HEX[row.color] ?? COLOR_HEX.teal }} />
                    <span className="min-w-0 flex-1 truncate mac-t13">
                      {row.name}
                      {row.room ? <span className="text-[var(--mac-secondary)]"> {row.room}</span> : null}
                    </span>
                    <span className="tabular-nums mac-t13">
                      {row.qtyMilli != null ? formatQty(row.qtyMilli) : "—"} {row.unit ?? ""}
                    </span>
                    {!row.reviewed ? <span className="fl-pill fl-pill-sm">Review</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1 mac-t11 tabular-nums text-[var(--mac-secondary)]">
              {totals(sheet.id === board.fileId ? rows : sheet.rows)
                .map(([unit, milli]) => `${formatQty(milli)} ${unit}`)
                .join(" · ") || "0"}
            </p>
          </section>
        ))}
        {board.unreviewed > 0 && board.canEdit ? (
          <button
            type="button"
            className="mac-primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void reviewTakeoffsAction({ projectId: board.projectId, jobFileId: board.fileId }).then((result) => {
                setBusy(false);
                if (result.error) setError(result.error);
                else router.refresh();
              });
            }}
          >
            Review
          </button>
        ) : null}
      </aside>
    </div>
  );
}

function preview(kind: TakeoffKind | null, points: Pt[], scale: Scale | null, heightText: string, riseText: string, runText: string, depthText: string) {
  if (!kind || !scale || points.length === 0) return null;
  try {
    const qty = measureQuantity({
      kind,
      points,
      scale,
      heightInches: kind === "wall" ? parseFeetInches(heightText) : null,
      pitchRise: riseText.trim() ? Number(riseText) : null,
      pitchRun: runText.trim() ? Number(runText) : null,
      depthInches: depthText.trim() ? Number(depthText) : null,
    });
    return `${formatQty(qty.qtyMilli)} ${qty.unit}`;
  } catch {
    return null;
  }
}

function ToolIcon({ id }: { id: Tool }) {
  if (id === "select") return <MousePointer2 size={14} />;
  if (id === "scale") return <Ruler size={14} />;
  if (id === "linear") return <Spline size={14} />;
  if (id === "wall") return <Box size={14} />;
  if (id === "area") return <Square size={14} />;
  return <Hash size={14} />;
}
