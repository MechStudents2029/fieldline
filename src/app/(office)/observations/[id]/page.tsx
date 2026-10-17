import Link from "next/link";
import { notFound } from "next/navigation";
import {
  backchargeObservationAction,
  closeObservationAction,
  notAcceptObservationAction,
  noteObservationAction,
  openObservationAction,
  readyObservationAction,
  saveObservationAction,
  shareObservationAction,
  voidObservationAction,
} from "@/app/(office)/observations/actions";
import { ActionForm } from "@/components/action-form";
import { CopyObservationLink } from "@/components/copy-observation-link";
import { FileButton } from "@/components/file-button";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { observationDetail } from "@/lib/services/observations";

export default async function ObservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const detail = observationDetail(session, id);
  if (!detail) notFound();
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar
          title={detail.title}
          subtitle={String(detail.number)}
          search={false}
          leading={<Link href="/observations">‹</Link>}
        />
      </div>
      <div className="grid gap-6 px-1 py-2 md:grid-cols-[minmax(0,1fr)_280px] md:px-6 md:py-4">
        <div className="flex flex-col gap-4">
          <h1 className="fl-large-title md:hidden">{detail.title}</h1>
          <p className="text-sm text-[var(--mac-secondary)]">
            {detail.job} · {detail.number}
          </p>
          <span className="fl-pill w-fit" data-status={detail.status}>
            {detail.statusLabel}
          </span>
          {detail.rejectNote ? <p className="text-sm">{detail.rejectNote}</p> : null}
          {detail.voidReason ? <p className="text-sm">{detail.voidReason}</p> : null}
          {detail.canEdit ? (
            <ActionForm action={saveObservationAction.bind(null, detail.id)} className="grid max-w-xl gap-2">
              <input type="hidden" name="projectId" value={detail.projectId} />
              <label className="text-sm">
                Title
                <input name="title" aria-label="Title" defaultValue={detail.title} className="field mt-1" />
              </label>
              <label className="text-sm">
                Type
                <select name="type" aria-label="Type" defaultValue={detail.type} className="field mt-1">
                  {detail.types.map((row) => (
                    <option key={row.value} value={row.value}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Priority
                <select name="priority" aria-label="Priority" defaultValue={detail.priority} className="field mt-1">
                  {detail.priorities.map((row) => (
                    <option key={row.value} value={row.value}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Hazard
                <input name="hazard" aria-label="Hazard" defaultValue={detail.hazard} className="field mt-1" />
              </label>
              <label className="text-sm">
                Room
                <input name="location" aria-label="Room" defaultValue={detail.location} className="field mt-1" />
              </label>
              <label className="text-sm">
                Cost code
                <input name="costCode" aria-label="Cost code" defaultValue={detail.costCode ?? ""} className="field mt-1" />
              </label>
              <label className="text-sm">
                Trade
                <input name="trade" aria-label="Trade" defaultValue={detail.trade} className="field mt-1" />
              </label>
              <label className="text-sm">
                Vendor
                <select name="assigneeContactId" aria-label="Vendor" defaultValue={detail.assigneeContactId ?? ""} className="field mt-1">
                  <option value="">None</option>
                  {detail.vendors.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Crew
                <select name="assigneeUserId" aria-label="Crew" defaultValue={detail.assigneeUserId ?? ""} className="field mt-1">
                  <option value="">None</option>
                  {detail.crew.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Due
                <input name="dueDate" type="date" aria-label="Due" defaultValue={detail.dueDate ?? ""} className="field mt-1" />
              </label>
              <label className="text-sm">
                Description
                <textarea name="description" aria-label="Description" defaultValue={detail.description} className="field mt-1" />
              </label>
              <label className="text-sm">
                Plan pin
                <select name="planPinId" aria-label="Plan pin" defaultValue={detail.planPinId ?? ""} className="field mt-1">
                  <option value="">None</option>
                  {detail.pins.map((pin) => (
                    <option key={pin.id} value={pin.id}>
                      {pin.number}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Schedule
                <select name="scheduleItemId" aria-label="Schedule" defaultValue={detail.scheduleItemId ?? ""} className="field mt-1">
                  <option value="">None</option>
                  {detail.schedule.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Inspection
                <select name="inspectionId" aria-label="Inspection" defaultValue={detail.inspectionId ?? ""} className="field mt-1">
                  <option value="">None</option>
                  {detail.inspections.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Checklist
                <select name="safetyCheckItemId" aria-label="Checklist" defaultValue={detail.safetyCheckItemId ?? ""} className="field mt-1">
                  <option value="">None</option>
                  {detail.checks.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="mac-glass-btn w-fit">
                Save
              </button>
            </ActionForm>
          ) : (
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
              <dt>Type</dt>
              <dd>{detail.typeLabel}</dd>
              <dt>Priority</dt>
              <dd>{detail.priorityLabel}</dd>
              <dt>Vendor</dt>
              <dd>{detail.vendor || detail.assignee}</dd>
              <dt>Due</dt>
              <dd className="tabular-nums">{detail.dueDate ?? ""}</dd>
              <dt>Room</dt>
              <dd>{detail.location}</dd>
              <dt>Hazard</dt>
              <dd>{detail.hazard}</dd>
            </dl>
          )}
          <ul className="flex flex-wrap gap-3">
            {detail.photos.map((photo) => (
              <li key={photo.id}>
                <img src={`/api/files/${photo.documentId}`} alt="" className="h-24 w-36 rounded-lg object-cover" />
              </li>
            ))}
          </ul>
          {detail.canReady || !detail.locked ? (
            <ActionForm action={noteObservationAction.bind(null, detail.id)} className="grid max-w-xl gap-2">
              <label className="text-sm">
                Note
                <textarea name="note" aria-label="Note" className="field mt-1" />
              </label>
              <FileButton name="photo" label="Photo" accept="image/jpeg,image/png,image/webp" empty="Photo" />
              <button type="submit" className="mac-glass-btn w-fit">
                Add note
              </button>
            </ActionForm>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {detail.canOpen ? (
              <ActionForm action={openObservationAction.bind(null, detail.id)}>
                <button type="submit" className="mac-glass-btn">
                  Open
                </button>
              </ActionForm>
            ) : null}
            {detail.canReady ? (
              <ActionForm action={readyObservationAction.bind(null, detail.id)}>
                <button type="submit" className="mac-glass-btn">
                  Ready for review
                </button>
              </ActionForm>
            ) : null}
            {detail.canClose ? (
              <ActionForm action={closeObservationAction.bind(null, detail.id)}>
                <button type="submit" className="mac-glass-btn">
                  Close
                </button>
              </ActionForm>
            ) : null}
            {detail.canBackcharge ? (
              detail.backcharge ? (
                <Link href={`/vendor-credits/${detail.backcharge.id}`} className="text-[var(--mac-accent)]">
                  {detail.backcharge.number}
                </Link>
              ) : (
                <ActionForm action={backchargeObservationAction.bind(null, detail.id)}>
                  <button type="submit" className="mac-glass-btn">
                    Create backcharge
                  </button>
                </ActionForm>
              )
            ) : null}
            {detail.portalUrl ? <CopyObservationLink observationId={detail.id} url={detail.portalUrl} /> : null}
            {detail.canEdit ? (
              <ActionForm action={shareObservationAction.bind(null, detail.id)}>
                <button type="submit" className="mac-glass-btn">
                  Mark shared
                </button>
              </ActionForm>
            ) : null}
            <Link href={`/observations/${detail.id}/print`} className="text-[var(--mac-accent)]">
              Print
            </Link>
          </div>
          {detail.canReject ? (
            <ActionForm action={notAcceptObservationAction.bind(null, detail.id)} className="flex flex-wrap items-center gap-2">
              <input name="note" aria-label="Return note" className="field w-auto" />
              <button type="submit" className="mac-glass-btn">
                Not accepted
              </button>
            </ActionForm>
          ) : null}
          {detail.canVoid ? (
            <ActionForm action={voidObservationAction.bind(null, detail.id)} className="flex flex-wrap items-center gap-2">
              <input name="reason" aria-label="Void reason" className="field w-auto" />
              <button type="submit" className="mac-glass-btn">
                Void
              </button>
            </ActionForm>
          ) : null}
        </div>
        <aside aria-label="History" className="flex flex-col gap-2 text-sm">
          <h2 className="font-medium">History</h2>
          <ol className="flex flex-col gap-2">
            {detail.events.map((event) => (
              <li key={event.id}>
                <span>{event.label}</span>
                <span className="block text-[var(--mac-secondary)]">
                  {event.actorName} · {event.createdAt.slice(0, 16).replace("T", " ")}
                </span>
                {event.note ? <span className="block">{event.note}</span> : null}
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
