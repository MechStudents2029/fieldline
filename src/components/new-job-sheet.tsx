"use client";

import { useState } from "react";
import { createJobFromTemplateAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";

type TemplateOption = {
  id: string;
  name: string;
  jobType: string;
  counts: { schedule: number; estimate: number | null; draws: number | null; selections: number | null; punch: number };
  trades: string[];
};

const PARTS = [
  ["schedule", "Schedule"],
  ["estimate", "Estimate"],
  ["draws", "Draws"],
  ["selections", "Selections"],
  ["punch", "Punch"],
] as const;

export function NewJobSheet({
  templates,
  clients,
  people,
  vendors,
  startDate,
  actorId,
}: {
  templates: TemplateOption[];
  clients: { id: string; name: string }[];
  people: { id: string; name: string }[];
  vendors: { id: string; name: string }[];
  startDate: string;
  actorId: string;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const template = templates.find((row) => row.id === templateId) ?? templates[0];
  if (!template) return null;
  return (
    <aside role="dialog" aria-label="New job" className="flex w-full flex-col gap-3 border border-[var(--mac-separator)] bg-[var(--mac-window)] p-4 md:absolute md:inset-y-0 md:right-0 md:z-20 md:w-[380px] md:border-y-0 md:border-r-0">
      <h2 className="mac-t15">New job</h2>
      <ActionForm key={template.id} action={createJobFromTemplateAction} className="flex flex-col gap-3">
        <label className="text-[13px]">
          Template
          <select name="templateId" aria-label="Template" className="field mt-1" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
            {templates.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[13px]">
          Job
          <input name="name" aria-label="Job" defaultValue={template.name} required className="field mt-1" />
        </label>
        <label className="text-[13px]">
          Client
          <select name="contactId" aria-label="Client" className="field mt-1" required defaultValue={clients[0]?.id}>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[13px]">
          Start
          <input name="startDate" type="date" aria-label="Start" required defaultValue={startDate} className="field mt-1" />
        </label>
        <label className="text-[13px]">
          PM
          <select name="pmUserId" aria-label="PM" className="field mt-1" defaultValue={actorId}>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-[13px]">Parts</legend>
          {PARTS.map(([key, label]) => {
            const count = template.counts[key];
            if (count == null) return null;
            return (
              <label key={key} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="part" value={key} defaultChecked={count > 0} />
                <span className="flex-1">{label}</span>
                <span className="num text-[var(--mac-secondary)]">{count}</span>
              </label>
            );
          })}
        </fieldset>
        {template.trades.length ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px]">Trades</legend>
            {template.trades.map((trade) => (
              <label key={trade} className="text-[13px]">
                {trade}
                <select name={`trade:${trade}`} aria-label={trade} className="field mt-1" defaultValue="">
                  <option value="">Unassigned</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>
        ) : null}
        <button type="submit" data-mac-primary className="mac-primary">
          Create
        </button>
      </ActionForm>
    </aside>
  );
}
