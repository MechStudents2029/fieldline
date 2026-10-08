"use client";

import { useState } from "react";
import Link from "next/link";
import { createSubmittalAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FileButton } from "@/components/file-button";
import { formatCalendarDay } from "@/lib/format";
import type { JobSubmittalBoard } from "@/lib/services/submittals";

function Status({ pending, label }: { pending: boolean; label: string }) {
  return pending ? <span className="fl-pill">{label}</span> : <span className="mac-t13 text-[var(--mac-secondary)]">{label}</span>;
}

export function SubmittalSection({ board }: { board: JobSubmittalBoard }) {
  const [open, setOpen] = useState(false);
  return (
    <section id="submittals" aria-label="Submittals" className="mb-6 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="fl-section">Submittals</h2>
        <span className="flex gap-3 text-sm">
          <Link href={`/projects/${board.projectId}/submittals/print`}>Print</Link>
          <a href={`/api/export/submittals?project=${board.projectId}`}>CSV</a>
        </span>
      </div>
      <div className="hidden md:block">
        <table className="mac-table" aria-label="Submittal log">
          <thead>
            <tr>
              <th>Number</th>
              <th>Title</th>
              <th>Division</th>
              <th>Assignee</th>
              <th>Due</th>
              <th>Age</th>
              <th>Status</th>
              <th>Rev</th>
            </tr>
          </thead>
          <tbody>
            {board.items.map((item) => (
              <tr key={item.id}>
                <td className="num">{item.label}</td>
                <td>
                  <Link href={item.href}>{item.title}</Link>
                </td>
                <td>{item.division}</td>
                <td>{item.assigneeName}</td>
                <td className={`num ${item.overdue ? "text-[var(--mac-danger)]" : ""}`}>{item.dueOn ? formatCalendarDay(item.dueOn) : "—"}</td>
                <td className="num">{item.ageDays}</td>
                <td>
                  <Status pending={item.pending} label={item.statusLabel} />
                </td>
                <td className="num">{item.revision}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="fl-group md:hidden" aria-label="Submittal list">
        {board.items.map((item) => (
          <li key={item.id}>
            <Link href={item.href} className="fl-cell">
              <span className="min-w-0 flex-1">
                <span className="fl-body block truncate">
                  {item.label} · {item.title}
                </span>
                <span className="fl-footnote block truncate text-[var(--fl-secondary)]">
                  {[item.division, item.assigneeName, item.dueOn ? formatCalendarDay(item.dueOn) : "", `${item.ageDays}d`].filter(Boolean).join(" · ")}
                </span>
              </span>
              <Status pending={item.pending} label={item.statusLabel} />
            </Link>
          </li>
        ))}
      </ul>
      {board.canAdd && !open ? (
        <button type="button" className="mac-primary w-fit" onClick={() => setOpen(true)}>
          New submittal
        </button>
      ) : null}
      {board.canAdd && open ? (
        <ActionForm action={createSubmittalAction.bind(null, board.projectId)} className="grid gap-2 md:grid-cols-2">
          <label className="text-sm">
            Title
            <input name="title" aria-label="Submittal title" className="field mt-1" required />
          </label>
          <label className="text-sm">
            Division
            <input name="division" aria-label="Division" className="field mt-1" />
          </label>
          <label className="text-sm md:col-span-2">
            Spec
            <textarea name="spec" aria-label="Spec" rows={2} className="field mt-1" required />
          </label>
          <label className="text-sm">
            Due
            <input name="dueOn" type="date" aria-label="Submittal due" className="field mt-1" required />
          </label>
          <label className="text-sm">
            Assignee
            <select name="assignee" aria-label="Assignee" className="field mt-1" required defaultValue="">
              <option value="">Choose</option>
              {board.assignees.map((person) => (
                <option key={person.value} value={person.value}>
                  {person.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            Link
            <select name="related" aria-label="Link" className="field mt-1" defaultValue="">
              <option value="">None</option>
              {board.related.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {board.canReview ? (
            <label className="text-sm md:col-span-2">
              Internal note
              <input name="internalNote" aria-label="Internal note" className="field mt-1" />
            </label>
          ) : null}
          <div className="md:col-span-2">
            <FileButton name="file" label="Submittal file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" multiple empty="File" />
          </div>
          <div className="md:col-span-2">
            <button type="submit" className="mac-primary">
              Create submittal
            </button>
          </div>
        </ActionForm>
      ) : null}
    </section>
  );
}
