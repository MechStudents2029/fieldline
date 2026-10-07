"use client";

import { useState } from "react";
import { createRfiAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";

export function RfiCreateForm({
  projectId,
  canClose,
  assignees,
  related,
}: {
  projectId: string;
  canClose: boolean;
  assignees: { value: string; label: string }[];
  related: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="mac-primary w-fit" onClick={() => setOpen(true)}>
        New RFI
      </button>
    );
  }
  return (
    <ActionForm action={createRfiAction.bind(null, projectId)} className="grid gap-2 md:grid-cols-2">
      <label className="text-sm">
        Title
        <input name="title" aria-label="RFI title" className="field mt-1" required />
      </label>
      <label className="text-sm">
        Due
        <input name="due" type="date" aria-label="RFI due" className="field mt-1" required />
      </label>
      <label className="text-sm md:col-span-2">
        Question
        <textarea name="question" aria-label="Question" rows={2} className="field mt-1" required />
      </label>
      <label className="text-sm">
        Assignee
        <select name="assignee" aria-label="Assignee" className="field mt-1" required defaultValue="">
          <option value="" disabled>
            Assignee
          </option>
          {assignees.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Link
        <select name="related" aria-label="Link" className="field mt-1" defaultValue="">
          <option value="">None</option>
          {related.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {canClose ? (
        <label className="text-sm md:col-span-2">
          Internal note
          <input name="internalNote" aria-label="Internal note" className="field mt-1" />
        </label>
      ) : null}
      <label className="text-sm">
        Photo
        <input className="mt-1 block" type="file" name="photo" accept="image/jpeg,image/png,image/webp" aria-label="RFI photo" />
      </label>
      <div className="md:col-span-2">
        <button type="submit" className="mac-primary">
          Create RFI
        </button>
      </div>
    </ActionForm>
  );
}
