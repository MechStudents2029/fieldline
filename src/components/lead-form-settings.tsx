"use client";

import { useState } from "react";
import { useActionState } from "react";
import type { ActionState } from "@/app/actions";
import { regenerateLeadFormAction, saveLeadFormAction } from "@/app/actions";
import type { LeadFormBoard } from "@/lib/services/lead-form";

function CopyBlock({ label, value, rows }: { label: string; value: string; rows: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm">
        {label}
        {rows > 1 ? (
          <textarea key={value} readOnly defaultValue={value} rows={rows} aria-label={label} className="mt-1 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs" />
        ) : (
          <input key={value} readOnly defaultValue={value} aria-label={label} className="field mt-1 font-mono text-xs" />
        )}
      </label>
      <button
        type="button"
        className="h-11 rounded-lg bg-[var(--fl-fill)] text-sm font-semibold"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => setCopied(true));
        }}
      >
        {copied ? "Copied" : label === "Embed" ? "Copy embed" : "Copy link"}
      </button>
    </div>
  );
}

export function LeadFormSettings({ board, url, embed }: { board: LeadFormBoard; url: string; embed: string }) {
  const [saved, save, saving] = useActionState(saveLeadFormAction, null as ActionState);
  const [rotated, rotate, rotating] = useActionState(regenerateLeadFormAction, null as ActionState);
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <form action={save} className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={board.enabled} />
          Accept requests
        </label>
        <label className="text-sm">
          Intro
          <input name="intro" defaultValue={board.intro} className="field mt-1" />
        </label>
        <label className="text-sm">
          Thanks
          <input name="thanks" defaultValue={board.thanks} className="field mt-1" />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold">Fields</legend>
          {(
            [
              ["address", "Address"],
              ["projectType", "Project type"],
              ["budget", "Budget"],
              ["timeline", "Timeline"],
              ["description", "Description"],
              ["photos", "Photos"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={key} defaultChecked={board.fields[key]} />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="text-sm">
          Project types
          <textarea
            name="projectTypes"
            rows={4}
            defaultValue={board.projectTypes.join("\n")}
            className="mt-1 w-full rounded-lg border border-input bg-background p-3"
          />
        </label>
        {saved?.error ? (
          <p role="alert" className="text-sm text-destructive">
            {saved.error}
          </p>
        ) : null}
        {saved?.ok ? <p className="text-sm">{saved.ok}</p> : null}
        <button type="submit" disabled={saving} className="h-11 rounded-lg bg-[var(--fl-accent)] text-sm font-semibold text-white disabled:opacity-60">
          Save
        </button>
      </form>
      <div className="flex flex-col gap-6">
        <CopyBlock label="Public link" value={url} rows={1} />
        <CopyBlock label="Embed" value={embed} rows={4} />
        <form action={rotate}>
          <button type="submit" disabled={rotating} className="text-sm font-semibold text-[var(--fl-accent)] underline">
            New link
          </button>
          {rotated?.ok ? <p className="mt-2 text-sm">{rotated.ok}</p> : null}
          {rotated?.error ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {rotated.error}
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
