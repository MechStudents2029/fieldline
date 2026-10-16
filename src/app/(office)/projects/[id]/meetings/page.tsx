import Link from "next/link";
import { notFound } from "next/navigation";
import { createMeetingAction } from "@/app/(office)/meetings/actions";
import { ActionForm } from "@/components/action-form";
import { jobSectionTabs } from "@/components/job-section-tabs";
import { Toolbar } from "@/components/mac/toolbar";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { canEditCrm } from "@/lib/permissions";
import { listMeetings, meetingForm } from "@/lib/services/meetings";

export default async function JobMeetingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const form = meetingForm(session, id);
  if (!form) notFound();
  const rows = listMeetings(session, { projectId: id });
  const office = canEditCrm(session.role);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title={form.project.name} subtitle={String(rows.length)} search={false} leading={<Link href={`/projects/${id}`}>‹</Link>} center={jobSectionTabs(id, "meetings")} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Meetings</h1>
        {office ? (
          <ActionForm action={createMeetingAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="projectId" value={id} />
            <select name="kind" aria-label="Type" defaultValue="oac" className="field w-auto">
              <option value="oac">OAC</option>
              <option value="sub">Sub coordination</option>
              <option value="precon">Pre-con</option>
              <option value="internal">Internal</option>
            </select>
            <input name="title" aria-label="Title" className="field w-40" />
            <input type="date" name="meetOn" aria-label="Date" required className="field w-auto" />
            <input type="time" name="startTime" aria-label="Time" className="field w-auto" />
            <input name="location" aria-label="Location" className="field w-36" />
            <select name="userId" aria-label="Team" defaultValue="" className="field w-auto">
              <option value="">Team</option>
              {form.team.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
            <select name="vendorId" aria-label="Vendor" defaultValue="" className="field w-auto">
              <option value="">Vendor</option>
              {form.vendors.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
            <select name="clientId" aria-label="Client" defaultValue="" className="field w-auto">
              <option value="">Client</option>
              {form.clients.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
            <Button type="submit">Create</Button>
          </ActionForm>
        ) : null}
        <table aria-label="Job meetings" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-2 pr-3 font-medium">Meeting</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Date</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[var(--mac-separator)]">
                <td className="py-2 pr-3">
                  <Link href={`/meetings/${row.id}`} className="text-[var(--mac-accent)]">
                    {row.title} #{row.number}
                  </Link>
                </td>
                <td className="py-2 pr-3">{row.kindLabel}</td>
                <td className="py-2 pr-3 num">{row.meetOn}</td>
                <td className="py-2">
                  <span className="fl-pill" data-status={row.status}>
                    {row.statusLabel}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
