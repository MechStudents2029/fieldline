"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions";
import { submitPublicLeadAction } from "@/app/actions";
import { BUDGET_BANDS, TIMELINES, type FieldFlags } from "@/lib/lead-form/rules";

export function PublicLeadForm({
  token,
  thanks,
  fields,
  projectTypes,
  startedAt,
  source,
  utmSource,
  utmMedium,
  utmCampaign,
}: {
  token: string;
  thanks: string;
  fields: FieldFlags;
  projectTypes: string[];
  startedAt: number;
  source: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
}) {
  const [state, action, pending] = useActionState(submitPublicLeadAction.bind(null, token), null as ActionState);
  if (state?.ok) return <p className="text-base">{thanks}</p>;
  return (
    <form action={action} className="mt-6 flex flex-col gap-3" aria-label="Project request">
      <input type="hidden" name="startedAt" value={String(startedAt)} />
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="utm_source" value={utmSource} />
      <input type="hidden" name="utm_medium" value={utmMedium} />
      <input type="hidden" name="utm_campaign" value={utmCampaign} />
      <div className="absolute left-[-9999px] h-0 overflow-hidden" aria-hidden="true">
        <input name="hp_field" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <label className="text-sm">
        Name
        <input name="name" required autoComplete="name" className="field mt-1" />
      </label>
      <label className="text-sm">
        Email
        <input name="email" type="email" autoComplete="email" className="field mt-1" />
      </label>
      <label className="text-sm">
        Phone
        <input name="phone" type="tel" autoComplete="tel" className="field mt-1" />
      </label>
      {fields.address ? (
        <label className="text-sm">
          Address
          <input name="address" autoComplete="street-address" className="field mt-1" />
        </label>
      ) : null}
      {fields.projectType ? (
        <label className="text-sm">
          Project type
          <select name="projectType" className="field mt-1" defaultValue="">
            <option value="">Choose</option>
            {projectTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {fields.budget ? (
        <label className="text-sm">
          Budget
          <select name="budget" className="field mt-1" defaultValue="">
            <option value="">Choose</option>
            {BUDGET_BANDS.map((band) => (
              <option key={band} value={band}>
                {band}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {fields.timeline ? (
        <label className="text-sm">
          Timeline
          <select name="timeline" className="field mt-1" defaultValue="">
            <option value="">Choose</option>
            {TIMELINES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {fields.description ? (
        <label className="text-sm">
          Description
          <textarea name="description" rows={4} className="mt-1 w-full rounded-lg border border-input bg-background p-3" />
        </label>
      ) : null}
      {fields.photos ? (
        <label className="text-sm">
          Photos
          <input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple className="mt-1 block w-full text-sm" />
        </label>
      ) : null}
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="h-11 rounded-lg bg-[var(--fl-accent)] text-base font-semibold text-white disabled:opacity-60">
        Send
      </button>
    </form>
  );
}
