"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUpRight, Circle, Hand, Minus, MousePointer2, Pencil, Plus, Redo2, Square, Trash2, Type, Undo2, MapPin } from "lucide-react";
import { MARKUP_COLOR_HEX, MARKUP_COLORS, type MarkupColor, type MarkupLayer, type MarkupShape, type MarkupTool } from "@/lib/markup/layer";

export type StagePin = {
  id: string;
  number: number;
  xMilli: number;
  yMilli: number;
  title: string;
  statusLabel: string;
  tone: "open" | "done" | "verified";
  linkType: "punch" | "rfi" | "todo";
  href: string;
  note: string;
};

type Candidate = { id: string; title: string };

type Props = {
  mode: "photo" | "plan";
  src: string;
  kind: "image" | "pdf";
  title: string;
  initial: MarkupLayer;
  readOnly: boolean;
  saveAction?: (formData: FormData) => void | Promise<void>;
  pins?: StagePin[];
  pinAction?: (formData: FormData) => void | Promise<void>;
  punches?: Candidate[];
  rfis?: Candidate[];
  todos?: Candidate[];
  unreviewed?: number;
  reviewAction?: (formData: FormData) => void | Promise<void>;
};

function rid() {
  return Math.random().toString(36).slice(2, 10);
}

function drawShape(ctx: CanvasRenderingContext2D, shape: MarkupShape, width: number, height: number, selected: boolean) {
  const color = MARKUP_COLOR_HEX[shape.color];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, width / 280);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const pts = shape.points.map((point) => ({ x: point.x * width, y: point.y * height }));
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (!first || !last) {
    ctx.restore();
    return;
  }
  if (shape.tool === "pen") {
    ctx.beginPath();
    pts.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
    ctx.stroke();
  } else if (shape.tool === "arrow") {
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    const angle = Math.atan2(last.y - first.y, last.x - first.x);
    const head = Math.max(10, width / 50);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(last.x - head * Math.cos(angle - 0.4), last.y - head * Math.sin(angle - 0.4));
    ctx.lineTo(last.x - head * Math.cos(angle + 0.4), last.y - head * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
  } else if (shape.tool === "rect") {
    ctx.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
  } else if (shape.tool === "ellipse") {
    ctx.beginPath();
    ctx.ellipse((first.x + last.x) / 2, (first.y + last.y) / 2, Math.max(1, Math.abs(last.x - first.x) / 2), Math.max(1, Math.abs(last.y - first.y) / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.font = `${Math.max(14, width / 48)}px sans-serif`;
    ctx.fillText(shape.text ?? "", first.x, first.y);
  }
  if (selected) {
    const xs = pts.map((point) => point.x);
    const ys = pts.map((point) => point.y);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "#0f766e";
    ctx.strokeRect(Math.min(...xs) - 4, Math.min(...ys) - 4, Math.max(...xs) - Math.min(...xs) + 8, Math.max(...ys) - Math.min(...ys) + 8);
  }
  ctx.restore();
}

function paint(canvas: HTMLCanvasElement | null, shapes: MarkupShape[], selected: string | null) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const shape of shapes) drawShape(ctx, shape, canvas.width, canvas.height, shape.id === selected);
}

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
  ctx.strokeRect(450, 180, 360, 400);
  ctx.strokeRect(100, 640, 710, 430);
  ctx.fillStyle = "#1c1917";
  ctx.font = "28px sans-serif";
  ctx.fillText(title, 100, 120);
  ctx.font = "16px sans-serif";
  ctx.fillText("Shower", 116, 210);
  ctx.fillText("Vanity", 466, 210);
  ctx.fillText("Bath", 116, 670);
}

export function MarkupStage({
  mode,
  src,
  kind,
  title,
  initial,
  readOnly,
  saveAction,
  pins = [],
  pinAction,
  punches = [],
  rfis = [],
  todos = [],
  unreviewed = 0,
  reviewAction,
}: Props) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<HTMLCanvasElement>(null);
  const shapesRef = useRef<MarkupShape[]>(initial.shapes);
  const past = useRef<MarkupShape[][]>([]);
  const future = useRef<MarkupShape[][]>([]);
  const draft = useRef<MarkupShape | null>(null);
  const [shapes, setShapes] = useState<MarkupShape[]>(initial.shapes);
  const [tool, setTool] = useState<MarkupTool | "select" | "pan" | "pin">(mode === "plan" ? "pan" : "pen");
  const [color, setColor] = useState<MarkupColor>("red");
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [pending, setPending] = useState<{ xMilli: number; yMilli: number; crop: string } | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showOriginal, setShowOriginal] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const [bitmap, setBitmap] = useState<{ w: number; h: number } | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    const canvas = baseRef.current;
    const overlay = drawRef.current;
    if (!canvas || !overlay) return;
    let cancel = false;
    const fit = () => {
      overlay.width = canvas.width;
      overlay.height = canvas.height;
      paint(overlay, shapesRef.current, null);
    };
    if (kind === "image") {
      const image = new Image();
      image.onload = () => {
        if (cancel) return;
        canvas.width = image.naturalWidth || 800;
        canvas.height = image.naturalHeight || 520;
        canvas.getContext("2d")?.drawImage(image, 0, 0);
        fitted.current = false;
        setBitmap({ w: canvas.width, h: canvas.height });
        fit();
      };
      image.src = src;
    } else {
      drawPlan(canvas, title);
      fitted.current = false;
      setBitmap({ w: canvas.width, h: canvas.height });
      fit();
      void (async () => {
        try {
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
          const response = await fetch(src);
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
          fit();
        } catch {
          if (!cancel) drawPlan(canvas, title);
        }
      })();
    }
    return () => {
      cancel = true;
    };
  }, [kind, src, title]);

  useLayoutEffect(() => {
    if (mode !== "plan") return;
    const frame = frameRef.current;
    if (!frame) return;
    const apply = () => {
      if (!bitmap || fitted.current || frame.clientWidth < 8 || frame.clientHeight < 8) return;
      const scale = Math.min(frame.clientWidth / bitmap.w, frame.clientHeight / bitmap.h);
      if (!Number.isFinite(scale) || scale <= 0) return;
      fitted.current = true;
      setZoom(Number(scale.toFixed(3)));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [bitmap, mode]);

  useEffect(() => {
    shapesRef.current = shapes;
    paint(drawRef.current, shapes, selected);
  }, [shapes, selected]);

  function commit(next: MarkupShape[]) {
    past.current.push(shapes);
    if (past.current.length > 40) past.current.shift();
    future.current = [];
    setShapes(next);
  }

  function undo() {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(shapes);
    setShapes(prev);
    setSelected(null);
  }

  function redo() {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(shapes);
    setShapes(next);
  }

  function norm(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    return { x, y };
  }

  function hit(point: { x: number; y: number }) {
    for (let index = shapes.length - 1; index >= 0; index -= 1) {
      const shape = shapes[index];
      if (!shape) continue;
      const xs = shape.points.map((item) => item.x);
      const ys = shape.points.map((item) => item.y);
      if (point.x >= Math.min(...xs) - 0.03 && point.x <= Math.max(...xs) + 0.03 && point.y >= Math.min(...ys) - 0.03 && point.y <= Math.max(...ys) + 0.03) return shape.id;
    }
    return null;
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (readOnly) return;
    if (tool === "pan") {
      panStart.current = { x: event.clientX, y: event.clientY, ox: pan.x, oy: pan.y };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const point = norm(event);
    if (tool === "pin") {
      const base = baseRef.current;
      let crop = "";
      if (base) {
        const out = document.createElement("canvas");
        out.width = 180;
        out.height = 140;
        const ctx = out.getContext("2d");
        if (ctx) {
          const span = Math.min(base.width, base.height) * 0.34;
          ctx.drawImage(base, point.x * base.width - span / 2, point.y * base.height - span / 2, span, span, 0, 0, 180, 140);
          ctx.fillStyle = "#0f766e";
          ctx.beginPath();
          ctx.arc(90, 70, 8, 0, Math.PI * 2);
          ctx.fill();
          crop = out.toDataURL("image/png");
        }
      }
      setPending({ xMilli: Math.round(point.x * 1000), yMilli: Math.round(point.y * 1000), crop });
      return;
    }
    if (tool === "select") {
      setSelected(hit(point));
      return;
    }
    if (tool === "text") {
      const value = text.trim();
      if (!value) return;
      commit([...shapes, { id: rid(), tool: "text", color, points: [point], text: value }]);
      return;
    }
    draft.current = { id: rid(), tool, color, points: [point, point] };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (panStart.current) {
      setPan({ x: panStart.current.ox + event.clientX - panStart.current.x, y: panStart.current.oy + event.clientY - panStart.current.y });
      return;
    }
    if (!draft.current) return;
    const point = norm(event);
    if (draft.current.tool === "pen") draft.current = { ...draft.current, points: [...draft.current.points, point] };
    else draft.current = { ...draft.current, points: [draft.current.points[0]!, point] };
    paint(drawRef.current, [...shapes, draft.current], null);
  }

  function onPointerUp() {
    panStart.current = null;
    if (!draft.current) return;
    const next = draft.current;
    draft.current = null;
    const moved = next.points.length > 2 || (next.points[1] && (Math.abs(next.points[1].x - next.points[0]!.x) > 0.01 || Math.abs(next.points[1].y - next.points[0]!.y) > 0.01));
    if (!moved) {
      paint(drawRef.current, shapes, selected);
      return;
    }
    commit([...shapes, next]);
    setSelected(next.id);
  }

  function removeSelected() {
    if (!selected) return;
    commit(shapes.filter((shape) => shape.id !== selected));
    setSelected(null);
  }

  function prepare(event: React.FormEvent<HTMLFormElement>) {
    const canvas = document.createElement("canvas");
    const base = baseRef.current;
    const overlay = drawRef.current;
    if (!base || !overlay) {
      event.preventDefault();
      return;
    }
    canvas.width = base.width;
    canvas.height = base.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      event.preventDefault();
      return;
    }
    ctx.drawImage(base, 0, 0);
    ctx.drawImage(overlay, 0, 0);
    const form = event.currentTarget;
    (form.elements.namedItem("layer") as HTMLInputElement).value = JSON.stringify({ shapes });
    (form.elements.namedItem("flat") as HTMLInputElement).value = canvas.toDataURL("image/png");
  }

  const visiblePins = pins.filter((pin) => (typeFilter === "all" || pin.linkType === typeFilter) && (statusFilter === "all" || pin.tone === statusFilter));

  const tools: { id: MarkupTool | "select" | "pan" | "pin"; label: string; icon: React.ReactNode }[] = [
    { id: "select", label: "Select", icon: <MousePointer2 size={14} /> },
    { id: "pen", label: "Pen", icon: <Pencil size={14} /> },
    { id: "arrow", label: "Arrow", icon: <ArrowUpRight size={14} /> },
    { id: "rect", label: "Rectangle", icon: <Square size={14} /> },
    { id: "ellipse", label: "Ellipse", icon: <Circle size={14} /> },
    { id: "text", label: "Text", icon: <Type size={14} /> },
    ...(mode === "plan"
      ? [
          { id: "pan" as const, label: "Pan", icon: <Hand size={14} /> },
          { id: "pin" as const, label: "Pin", icon: <MapPin size={14} /> },
        ]
      : []),
  ];
  const planBox = mode === "plan" && bitmap ? { width: Math.max(1, Math.round(bitmap.w * zoom)), height: Math.max(1, Math.round(bitmap.h * zoom)) } : null;

  return (
    <div className={`grid min-h-0 gap-3 ${mode === "plan" ? "h-full min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_220px]" : ""}`}>
      <div className={`flex min-h-0 min-w-0 flex-col gap-2 ${mode === "plan" ? "h-full" : ""}`}>
        <div data-bar="markup" className="flex flex-nowrap items-center gap-1 overflow-x-auto">
          {tools.map((item) => (
            <button key={item.id} type="button" className="ctl" aria-label={item.label} title={item.label} aria-pressed={tool === item.id} disabled={readOnly && item.id !== "pan"} onClick={() => setTool(item.id)}>
              {item.icon}
            </button>
          ))}
          {MARKUP_COLORS.map((item) => (
            <button key={item} type="button" className="ctl" aria-label={item} aria-pressed={color === item} disabled={readOnly} onClick={() => setColor(item)}>
              <span className="inline-block size-3 rounded-full border border-[var(--mac-separator)]" style={{ background: MARKUP_COLOR_HEX[item] }} />
            </button>
          ))}
          <button type="button" className="ctl" aria-label="Undo" title="Undo" onClick={undo} disabled={readOnly}>
            <Undo2 size={14} />
          </button>
          <button type="button" className="ctl" aria-label="Redo" title="Redo" onClick={redo} disabled={readOnly}>
            <Redo2 size={14} />
          </button>
          <button type="button" className="ctl" aria-label="Delete" title="Delete" onClick={removeSelected} disabled={readOnly || !selected}>
            <Trash2 size={14} />
          </button>
          {mode === "plan" ? (
            <>
              <button type="button" className="ctl" aria-label="Zoom out" title="Zoom out" onClick={() => { fitted.current = true; setZoom((value) => Math.max(0.15, Number((value - 0.1).toFixed(2)))); }}>
                <Minus size={14} />
              </button>
              <span className="num mac-t11">{Math.round(zoom * 100)}</span>
              <button type="button" className="ctl" aria-label="Zoom in" title="Zoom in" onClick={() => { fitted.current = true; setZoom((value) => Math.min(2.4, Number((value + 0.1).toFixed(2)))); }}>
                <Plus size={14} />
              </button>
            </>
          ) : null}
          {mode === "photo" && initial.shapes.length > 0 ? (
            <button type="button" className="ctl" aria-pressed={showOriginal} onClick={() => setShowOriginal((value) => !value)}>
              {showOriginal ? "Marked up" : "Original"}
            </button>
          ) : null}
        </div>
        {tool === "text" && !readOnly ? <input aria-label="Text" value={text} onChange={(event) => setText(event.target.value)} className="field max-w-xs" placeholder="Text" /> : null}
        {!readOnly && saveAction ? (
          <form id="markup-save" action={saveAction} onSubmit={prepare} className="hidden">
            <input type="hidden" name="layer" defaultValue="" />
            <input type="hidden" name="flat" defaultValue="" />
          </form>
        ) : null}
        <div ref={frameRef} className={`overflow-hidden rounded-lg bg-[var(--mac-fill)] ${mode === "plan" ? "min-h-0 flex-1" : ""}`} data-viewport={mode}>
          <div className="relative" style={planBox ? { width: planBox.width, height: planBox.height, transform: `translate(${pan.x}px, ${pan.y}px)` } : undefined}>
            <canvas ref={baseRef} className={mode === "plan" ? "block max-w-none" : "block w-full"} style={planBox ? { width: planBox.width, height: planBox.height } : undefined} />
            <canvas
              ref={drawRef}
              data-canvas={mode}
              className="absolute inset-0 block h-full w-full"
              style={{ touchAction: "none", opacity: showOriginal ? 0 : 1 }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            {mode === "plan"
              ? pins.map((pin) => (
                  <a
                    key={pin.id}
                    href={pin.href}
                    className={`plan-pin is-${pin.tone}`}
                    style={{ left: `${pin.xMilli / 10}%`, top: `${pin.yMilli / 10}%`, pointerEvents: tool === "pin" ? "none" : "auto" }}
                    aria-label={`Pin ${pin.number} ${pin.title}`}
                  >
                    {pin.number}
                  </a>
                ))
              : null}
          </div>
        </div>
      </div>
      {mode === "plan" ? (
        <aside data-pane="pins" aria-label="Pins" className="flex min-h-0 flex-col gap-2 overflow-auto">
          {unreviewed > 0 && reviewAction ? (
            <form action={reviewAction} className="flex items-center gap-2">
              <span className="num mac-t13">{unreviewed}</span>
              <button type="submit" className="ctl">
                Review pins
              </button>
            </form>
          ) : null}
          <label className="mac-t13">
            Type
            <select aria-label="Type" className="ctl mt-1" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="punch">Punch</option>
              <option value="rfi">RFI</option>
              <option value="todo">To-do</option>
            </select>
          </label>
          <label className="mac-t13">
            Status
            <select aria-label="Status" className="ctl mt-1" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="done">Done</option>
              <option value="verified">Verified</option>
            </select>
          </label>
          <ul className="flex flex-col">
            {visiblePins.map((pin) => (
              <li key={pin.id} className="flex items-center gap-2 border-b border-[var(--mac-separator)] py-2">
                <a href={pin.href} className="min-w-0 flex-1 mac-t13">
                  <span className="num">{pin.number}</span> {pin.title}
                  {pin.note ? <span className="block mac-t11 text-[var(--mac-secondary)]">{pin.note}</span> : null}
                </a>
                <span className="fl-pill">{pin.statusLabel}</span>
              </li>
            ))}
          </ul>
          {readOnly ? <p className="mac-t11 text-[var(--mac-secondary)]">Superseded</p> : null}
        </aside>
      ) : null}
      {pending && pinAction ? (
        <form action={pinAction} data-sheet="pin" role="dialog" aria-label="Pin" className="fixed inset-y-0 right-0 z-40 flex w-[320px] flex-col gap-2 overflow-auto border-l border-[var(--mac-separator)] bg-[var(--mac-window)] p-4">
          <h2 className="mac-t15">Pin</h2>
          <input type="hidden" name="xMilli" value={pending.xMilli} />
          <input type="hidden" name="yMilli" value={pending.yMilli} />
          <input type="hidden" name="crop" value={pending.crop} />
          <label className="mac-t13">
            Link
            <select name="link" aria-label="Link" className="field mt-1" defaultValue={punches[0] ? `punch:${punches[0].id}` : ""}>
              <optgroup label="Punch">
                {punches.map((item) => (
                  <option key={item.id} value={`punch:${item.id}`}>
                    {item.title}
                  </option>
                ))}
              </optgroup>
              <optgroup label="RFI">
                {rfis.map((item) => (
                  <option key={item.id} value={`rfi:${item.id}`}>
                    {item.title}
                  </option>
                ))}
              </optgroup>
              <optgroup label="To-do">
                {todos.map((item) => (
                  <option key={item.id} value={`todo:${item.id}`}>
                    {item.title}
                  </option>
                ))}
              </optgroup>
              <option value="new:punch">New punch</option>
              <option value="new:rfi">New RFI</option>
              <option value="new:todo">New to-do</option>
            </select>
          </label>
          <label className="mac-t13">
            Title
            <input name="title" aria-label="Title" className="field mt-1" />
          </label>
          <label className="mac-t13">
            Note
            <input name="note" aria-label="Note" className="field mt-1" />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="mac-primary">
              Save
            </button>
            <button type="button" className="ctl" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
