"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/app/actions";
import { Button } from "@/components/ui/button";

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

/** Shrink a camera shot in the browser. The server still checks type and size. */
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return file;
  if (typeof createImageBitmap !== "function") return file;
  const bitmap = await createImageBitmap(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (file.type === "image/jpeg" && file.size <= 500_000 && longest <= MAX_EDGE) return file;
    const scale = Math.min(1, MAX_EDGE / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) return file;
    const stem = file.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").slice(0, 80) || "photo";
    return new File([blob], `${stem}.jpg`, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

export function PhotoCapture({
  action,
  label,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
  submitLabel: string;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const file = formData.get("photo");
    if (file instanceof File && file.size > 0) {
      try {
        formData.set("photo", await compressImage(file));
      } catch {
        /* The server rejects anything that is not a small JPEG, PNG, or WebP. */
      }
    }
    return action(prev, formData);
  }, null);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2" aria-busy={pending}>
      <label className="text-sm">
        Caption
        <input name="caption" className="field mt-1" placeholder="Opened the sink wall" aria-label={`${label} caption`} />
      </label>
      <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-primary px-4 text-center text-sm font-medium text-primary-foreground">
        {label}
        <input
          name="photo"
          type="file"
          accept="image/*"
          capture="environment"
          aria-label={label}
          className="sr-only"
          onChange={(event) => setChosen(event.target.files?.[0]?.name ?? null)}
        />
      </label>
      {chosen ? <p className="text-xs text-muted-foreground">{chosen}</p> : null}
      <Button type="submit" className="h-11">
        {submitLabel}
      </Button>
      {pending ? <p className="text-xs text-muted-foreground">Working…</p> : null}
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="text-sm text-pine">
          {state.ok}
        </p>
      ) : null}
    </form>
  );
}
