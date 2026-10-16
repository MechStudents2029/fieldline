import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { createChangeEventAction } from "@/app/(office)/change-events/actions";
import { ActionForm } from "@/components/action-form";
import { jobSectionTabs } from "@/components/job-section-tabs";
import { Toolbar } from "@/components/mac/toolbar";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatWhole } from "@/lib/money";
import { canAddFieldNotes, canSeeMoney } from "@/lib/permissions";
import { CHANGE_REASONS, listChangeEvents } from "@/lib/services/change-events";

export default async function JobChangesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const project = getDb().select().from(projects).where(and(eq(projects.id, id), eq(projects.orgId, session.orgId))).get();
  if (!project) notFound();
  const rows = listChangeEvents(session, { projectId: id });
  const money = canSeeMoney(session.role);
  const canCreate = canAddFieldNotes(session.role);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title={project.name} subtitle={String(rows.length)} search={false} leading={<Link href={`/projects/${id}`}>‹</Link>} center={jobSectionTabs(id, "changes")} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Changes</h1>
        <table aria-label="Change events" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-2 pr-3 font-medium">No.</th>
              <th className="py-2 pr-3 font-medium">Title</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 text-right font-medium">ROM</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[var(--mac-separator)]">
                <td className="py-2 pr-3 num">{row.number}</td>
                <td className="py-2 pr-3">
                  <Link href={`/change-events/${row.id}`} className="text-[var(--mac-accent)]">
                    {row.title}
                  </Link>
                </td>
                <td className="py-2 pr-3">
                  <span className="fl-pill" data-status={row.status}>
                    {row.statusLabel}
                  </span>
                </td>
                <td className="py-2 text-right num">{money ? formatWhole(row.romPriceCents) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canCreate ? (
          <ActionForm action={createChangeEventAction} className="flex flex-col gap-2">
            <input type="hidden" name="projectId" value={id} />
            <label className="text-sm">
              Title
              <input name="title" aria-label="Title" className="field mt-1" />
            </label>
            <label className="text-sm">
              Reason
              <select name="reason" aria-label="Reason" defaultValue="owner" className="field mt-1">
                {CHANGE_REASONS.map((row) => (
                  <option key={row.value} value={row.value}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Cost code
              <input name="costCode" aria-label="Cost code" className="field mt-1" />
            </label>
            {money ? (
              <>
                <label className="text-sm">
                  ROM cost
                  <input name="romCost" aria-label="ROM cost" className="field mt-1" />
                </label>
                <label className="text-sm">
                  ROM price
                  <input name="romPrice" aria-label="ROM price" className="field mt-1" />
                </label>
              </>
            ) : null}
            <label className="text-sm">
              Schedule days
              <input name="scheduleDays" aria-label="Schedule days" className="field mt-1" />
            </label>
            <label className="text-sm">
              Source
              <select name="sourceKind" aria-label="Source" defaultValue="" className="field mt-1">
                <option value="">None</option>
                <option value="rfi">RFI</option>
                <option value="meeting_action">Meeting</option>
                <option value="daily_log">Daily log</option>
                <option value="punch">Punch</option>
                <option value="inspection">Inspection</option>
              </select>
            </label>
            <label className="text-sm">
              Source id
              <input name="sourceId" aria-label="Source id" className="field mt-1" />
            </label>
            <Button type="submit">Log</Button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
