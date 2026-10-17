import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { createObservationAction } from "@/app/(office)/observations/actions";
import { ActionForm } from "@/components/action-form";
import { jobSectionTabs } from "@/components/job-section-tabs";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { canAddFieldNotes } from "@/lib/permissions";
import { listObservations, observationChoices } from "@/lib/services/observations";

export default async function JobObservationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const project = getDb().select().from(projects).where(and(eq(projects.id, id), eq(projects.orgId, session.orgId))).get();
  if (!project) notFound();
  const rows = listObservations(session, { projectId: id });
  const choices = observationChoices(session);
  const canCreate = canAddFieldNotes(session.role);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title={project.name} subtitle={String(rows.length)} search={false} leading={<Link href={`/projects/${id}`}>‹</Link>} center={jobSectionTabs(id, "observations")} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Observations</h1>
        <table aria-label="Observations" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-2 pr-3 font-medium">No.</th>
              <th className="py-2 pr-3 font-medium">Title</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Priority</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 font-medium">Due</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[var(--mac-separator)]">
                <td className="py-2 pr-3 tabular-nums">{row.number}</td>
                <td className="py-2 pr-3">
                  <Link href={`/observations/${row.id}`} className="text-[var(--mac-accent)]">
                    {row.title}
                  </Link>
                </td>
                <td className="py-2 pr-3">{row.typeLabel}</td>
                <td className="py-2 pr-3">{row.priorityLabel}</td>
                <td className="py-2 pr-3">
                  <span className="fl-pill" data-status={row.status}>
                    {row.statusLabel}
                  </span>
                </td>
                <td className="py-2 tabular-nums">{row.dueDate ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canCreate ? (
          <ActionForm action={createObservationAction} className="grid max-w-xl gap-2">
            <input type="hidden" name="projectId" value={id} />
            <label className="text-sm">
              Title
              <input name="title" aria-label="Title" className="field mt-1" />
            </label>
            <label className="text-sm">
              Type
              <select name="type" aria-label="Type" className="field mt-1" defaultValue="quality">
                {choices.types.map((row) => (
                  <option key={row.value} value={row.value}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Priority
              <select name="priority" aria-label="Priority" className="field mt-1" defaultValue="high">
                {choices.priorities.map((row) => (
                  <option key={row.value} value={row.value}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Vendor
              <select name="assigneeContactId" aria-label="Vendor" className="field mt-1" defaultValue="">
                <option value="">None</option>
                {choices.vendors.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Due
              <input name="dueDate" type="date" aria-label="Due" className="field mt-1" />
            </label>
            <label className="text-sm">
              Description
              <textarea name="description" aria-label="Description" className="field mt-1" />
            </label>
            <button type="submit" className="mac-glass-btn w-fit">
              Add observation
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
