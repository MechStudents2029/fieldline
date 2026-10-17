import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { createDelayAction } from "@/app/(office)/delays/actions";
import { ActionForm } from "@/components/action-form";
import { jobSectionTabs } from "@/components/job-section-tabs";
import { Toolbar } from "@/components/mac/toolbar";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { canAddFieldNotes } from "@/lib/permissions";
import { DELAY_REASONS } from "@/lib/schedule/delays";
import { DELAY_IMPACTS, formatClaimHours, listDelays } from "@/lib/services/delays";

export default async function JobDelaysPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const project = getDb().select().from(projects).where(and(eq(projects.id, id), eq(projects.orgId, session.orgId))).get();
  if (!project) notFound();
  const rows = listDelays(session, { projectId: id });
  const canCreate = canAddFieldNotes(session.role);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title={project.name} subtitle={String(rows.length)} search={false} leading={<Link href={`/projects/${id}`}>‹</Link>} center={jobSectionTabs(id, "delays")} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Delays</h1>
        <table aria-label="Delays" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-2 pr-3 font-medium">No.</th>
              <th className="py-2 pr-3 font-medium">Title</th>
              <th className="py-2 pr-3 font-medium">Cause</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 text-right font-medium">Lost h</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[var(--mac-separator)]">
                <td className="py-2 pr-3 num">{row.number}</td>
                <td className="py-2 pr-3">
                  <Link href={`/delays/${row.id}`} className="text-[var(--mac-accent)]">
                    {row.title}
                  </Link>
                </td>
                <td className="py-2 pr-3">{row.causeLabel}</td>
                <td className="py-2 pr-3">
                  <span className="fl-pill" data-status={row.status}>
                    {row.statusLabel}
                  </span>
                </td>
                <td className="py-2 text-right num">{formatClaimHours(row.lostHoursMilli)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canCreate ? (
          <ActionForm action={createDelayAction} className="flex flex-col gap-2">
            <input type="hidden" name="projectId" value={id} />
            <label className="text-sm">
              Title
              <input name="title" aria-label="Title" className="field mt-1" />
            </label>
            <label className="text-sm">
              Cause
              <select name="cause" aria-label="Cause" defaultValue="weather" className="field mt-1">
                {DELAY_REASONS.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Impact
              <select name="impact" aria-label="Impact" defaultValue="partial" className="field mt-1">
                {DELAY_IMPACTS.map((row) => (
                  <option key={row.value} value={row.value}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Started
              <input name="startedAt" aria-label="Started" type="datetime-local" className="field mt-1" />
            </label>
            <label className="text-sm">
              Ended
              <input name="endedAt" aria-label="Ended" type="datetime-local" className="field mt-1" />
            </label>
            <label className="text-sm">
              Weather
              <input name="weatherNote" aria-label="Weather" className="field mt-1" />
            </label>
            <label className="text-sm">
              Cost code
              <input name="costCode" aria-label="Cost code" className="field mt-1" />
            </label>
            <label className="text-sm">
              Hours
              <input name="hours" aria-label="Hours" className="field mt-1" />
            </label>
            <Button type="submit">Log</Button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
