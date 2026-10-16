import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { createTransmittalAction } from "@/app/(office)/transmittals/actions";
import { ActionForm } from "@/components/action-form";
import { jobSectionTabs } from "@/components/job-section-tabs";
import { Toolbar } from "@/components/mac/toolbar";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/session";
import { canEditCrm } from "@/lib/permissions";
import { TRANSMITTAL_PURPOSES, listTransmittals, transmittalOptions } from "@/lib/services/transmittals";

export default async function JobTransmittalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const project = getDb().select().from(projects).where(and(eq(projects.id, id), eq(projects.orgId, session.orgId))).get();
  if (!project) notFound();
  const rows = listTransmittals(session, { projectId: id });
  const options = transmittalOptions(session, id);
  const office = canEditCrm(session.role);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title={project.name} subtitle={String(rows.length)} search={false} leading={<Link href={`/projects/${id}`}>‹</Link>} center={jobSectionTabs(id, "transmittals")} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Transmittals</h1>
        <table aria-label="Transmittals" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-2 pr-3 font-medium">No.</th>
              <th className="py-2 pr-3 font-medium">Subject</th>
              <th className="py-2 pr-3 font-medium">To</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[var(--mac-separator)]">
                <td className="py-2 pr-3 num">{row.number}</td>
                <td className="py-2 pr-3">
                  <Link href={`/transmittals/${row.id}`} className="text-[var(--mac-accent)]">
                    {row.subject}
                  </Link>
                </td>
                <td className="py-2 pr-3">{row.toName}</td>
                <td className="py-2">
                  <span className="fl-pill" data-status={row.status}>
                    {row.statusLabel}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {office && options ? (
          <ActionForm action={createTransmittalAction} className="flex flex-col gap-2">
            <input type="hidden" name="projectId" value={id} />
            <label className="text-sm">
              Subject
              <input name="subject" aria-label="Subject" className="field mt-1" />
            </label>
            <label className="text-sm">
              To
              <select name="to" aria-label="To" className="field mt-1" defaultValue="">
                <option value="">Select</option>
                {options.recipients.map((row) => (
                  <option key={row.value} value={row.value}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Purpose
              <select name="purpose" aria-label="Purpose" defaultValue="information" className="field mt-1">
                {TRANSMITTAL_PURPOSES.map((row) => (
                  <option key={row.value} value={row.value}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Due
              <input name="dueOn" aria-label="Due" type="date" className="field mt-1" />
            </label>
            <Button type="submit">Create</Button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
