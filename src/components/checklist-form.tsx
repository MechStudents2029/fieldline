"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { FileButton } from "@/components/file-button";
import { runChecklistAction } from "@/app/(office)/safety/actions";

type Template = { id: string; name: string; items: { id: string; title: string }[] };

export function ChecklistForm({ projectId, templates }: { projectId: string; templates: Template[] }) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const template = templates.find((row) => row.id === templateId) ?? templates[0];
  if (!template) return null;
  return (
    <ActionForm action={runChecklistAction} className="flex flex-col gap-3" dataSheet="checklist">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="ctl-line">
        <span>Checklist</span>
        <select name="templateId" aria-label="Checklist" className="ctl" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
          {templates.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </div>
      {template.items.map((item) => (
        <div key={item.id} className="flex flex-col gap-1">
          <input type="hidden" name="item" value={item.id} />
          <div className="ctl-line">
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            <select name={`result_${item.id}`} aria-label={item.title} className="ctl" defaultValue="pass">
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
              <option value="na">N/A</option>
            </select>
          </div>
          <FileButton name={`photo_${item.id}`} label={`Photo ${item.title}`} accept="image/jpeg,image/png,image/webp" empty="Photo" />
        </div>
      ))}
      <button type="submit" className="mac-primary w-fit">
        Save
      </button>
    </ActionForm>
  );
}
