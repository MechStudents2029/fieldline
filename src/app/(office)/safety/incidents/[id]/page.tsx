import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { updateIncidentAction, voidIncidentAction } from "@/app/(office)/safety/actions";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { incidentView } from "@/lib/services/safety";
import { calendarForOrg } from "@/lib/services/time";

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const incident = incidentView(session, id);
  if (!incident) {
    return (
      <div className="px-6 py-6">
        <h1 className="mac-t15">Not found</h1>
      </div>
    );
  }
  const zone = calendarForOrg(session.orgId).timeZone;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title={incident.kindLabel}
        subtitle={incident.projectName}
        search={false}
        leading={
          <Link href={`/projects/${incident.projectId}/safety`} className="ctl">
            Safety
          </Link>
        }
      />
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-4" data-detail="incident">
        <div className="flex items-center gap-2">
          <span className="fl-pill">{incident.voided ? "Void" : incident.actions.some((action) => action.open) ? "Open" : "Completed"}</span>
          <span className="num mac-t13">{formatDateTime(incident.occurredAt, zone)}</span>
        </div>
        <p className="mac-t15">{incident.description}</p>
        {incident.factors ? <p className="mac-t13">{incident.factors}</p> : null}
        <p className="mac-t13">{incident.people.join(", ")}</p>
        {incident.equipment ? (
          <p className="mac-t13">
            <Link href={`/equipment?item=${incident.equipment.id}`}>{incident.equipment.name}</Link>
            <span className="fl-pill ml-2">In service</span>
          </p>
        ) : null}
        {incident.photos.length > 0 ? (
          <div className="flex gap-2">
            {incident.photos.map((photo) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={photo} src={`/api/files/${photo}`} alt="" className="h-24 w-24 rounded-lg object-cover" />
            ))}
          </div>
        ) : null}
        <ul className="flex flex-col gap-2" aria-label="Corrective actions">
          {incident.actions.map((action) => (
            <li key={action.id} className="flex items-center justify-between gap-2">
              <Link href="/todos">{action.title}</Link>
              <span className="mac-t13 text-[var(--mac-secondary)]">{action.assignee}</span>
              <span className="fl-pill">{action.open ? "Open" : "Done"}</span>
            </li>
          ))}
        </ul>
        {incident.canEdit ? (
          <ActionForm action={updateIncidentAction.bind(null, incident.id)} className="flex flex-col gap-2">
            <label className="text-[13px]">
              Description
              <textarea name="description" aria-label="Description" defaultValue={incident.description} className="field mt-1" rows={3} />
            </label>
            <label className="text-[13px]">
              Factors
              <textarea name="factors" aria-label="Factors" defaultValue={incident.factors} className="field mt-1" rows={2} />
            </label>
            <div className="flex gap-2">
              <button type="submit" className="mac-primary w-fit">
                Save
              </button>
            </div>
          </ActionForm>
        ) : null}
        {incident.canEdit && !incident.voided ? (
          <form action={voidIncidentAction.bind(null, incident.id)}>
            <button type="submit" className="ctl">
              Void
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
