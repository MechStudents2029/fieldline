"use client";

import { useEffect, useRef } from "react";

export function SignaturePad() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const points = useRef<{ x: number; y: number }[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    function resize() {
      const current = canvasRef.current;
      const ctx = current?.getContext("2d");
      if (!current || !ctx) return;
      const rect = current.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (current.width !== width || current.height !== height) {
        current.width = width;
        current.height = height;
        draw(ctx);
      }
    }

    function draw(ctx: CanvasRenderingContext2D) {
      const current = canvasRef.current;
      if (!current) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, current.width, current.height);
      const ink = points.current;
      if (ink.length === 0) return;
      ctx.strokeStyle = "#1c1917";
      ctx.fillStyle = "#1c1917";
      ctx.lineWidth = Math.max(2.5, (window.devicePixelRatio || 1) * 2.25);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(ink[0].x, ink[0].y);
      for (const point of ink.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
      const last = ink[ink.length - 1];
      ctx.beginPath();
      ctx.arc(last.x, last.y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    function locate(event: PointerEvent) {
      const current = canvasRef.current!;
      const rect = current.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      return {
        x: (event.clientX - rect.left) * ratio,
        y: (event.clientY - rect.top) * ratio,
      };
    }

    function commit() {
      const current = canvasRef.current;
      if (current && hiddenRef.current && points.current.length > 0) {
        hiddenRef.current.value = current.toDataURL("image/png");
      }
    }

    function down(event: PointerEvent) {
      const current = canvasRef.current;
      const ctx = current?.getContext("2d");
      if (!current || !ctx) return;
      try {
        current.setPointerCapture(event.pointerId);
      } catch {
        /* A synthetic pointer is not active. The stroke still records. */
      }
      drawing.current = true;
      points.current.push(locate(event));
      draw(ctx);
      commit();
    }

    function move(event: PointerEvent) {
      if (!drawing.current) return;
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      points.current.push(locate(event));
      draw(ctx);
    }

    function up() {
      if (!drawing.current) return;
      drawing.current = false;
      commit();
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      observer.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, []);

  function clear() {
    points.current = [];
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (hiddenRef.current) hiddenRef.current.value = "";
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="mt-1 h-28 w-full touch-none rounded-lg border border-input bg-white"
        aria-label="Draw your signature"
      />
      <input ref={hiddenRef} type="hidden" name="drawn" />
      <button type="button" onClick={clear} className="mt-1 text-xs text-muted-foreground underline">
        Clear drawing
      </button>
    </div>
  );
}
