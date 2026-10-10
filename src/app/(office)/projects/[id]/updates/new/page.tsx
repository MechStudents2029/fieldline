import Link from "next/link";
import { createClientUpdateAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { jobSectionTabs } from "@/components/job-section-tabs";
import { Toolbar } from "@/components/mac/toolbar";
import { MissingRecord } from "@/components/missing-record";
import { requireSession } from "@/lib/auth/session";
import { canEditCrm } from "@/lib/permissions";
import { calendarForOrg } from "@/lib/services/time";
import { defaultRange } from "@/lib/updates/range";

export const dynamic = "force-dynamic";

function defaultWindow(timeZone: string) {
  return defaultRange(Date.now(), timeZone);
}

export default async function NewClientUpdatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!canEditCrm(session.role)) return <MissingRecord orgName={session.orgName} kind="job" />;
  const range = defaultWindow(calendarForOrg(session.orgId).timeZone);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar title="New client update" search={false} leading={<Link href={`/projects/${id}/updates`}>‹</Link>} center={jobSectionTabs(id, "updates")} />
      <ActionForm action={createClientUpdateAction.bind(null, id)} className="flex max-w-md flex-col gap-3 px-4 py-4">
        <label className="flex flex-col gap-1 mac-t13">
          Start
          <input className="field" type="date" name="rangeStart" aria-label="Start" defaultValue={range.start} required />
        </label>
        <label className="flex flex-col gap-1 mac-t13">
          End
          <input className="field" type="date" name="rangeEnd" aria-label="End" defaultValue={range.end} required />
        </label>
        <button className="ctl" type="submit">
          Draft
        </button>
      </ActionForm>
    </div>
  );
}
