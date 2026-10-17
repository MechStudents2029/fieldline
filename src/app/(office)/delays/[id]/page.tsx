import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addDelayLaborAction,
  applyDelayDaysAction,
  attachDelayFileAction,
  convertDelayAction,
  documentDelayAction,
  linkDelayItemAction,
  markDelaySharedAction,
  removeDelayLaborAction,
  saveDelayAction,
  voidDelayAction,
  waiveDelayAction,
} from "@/app/(office)/delays/actions";
import { ActionForm } from "@/components/action-form";
import { CopyDelayLink } from "@/components/copy-delay-link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { DELAY_REASONS } from "@/lib/schedule/delays";
import { DELAY_IMPACTS, delayDetail } from "@/lib/services/delays";

export default async function DelayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const detail = delayDetail(session, id);
  if (!detail) notFound();
  return (
    <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
      <p className="text-sm">
        <Link href={`/projects/${detail.projectId}/delays`} className="text-[var(--mac-accent)]">
          {detail.job}
        </Link>
        <span className="num"> · {detail.number}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="fl-large-title">{detail.title}</h1>
        <span className="fl-pill" data-status={detail.status}>
          {detail.statusLabel}
        </span>
      </div>
      <p className="text-sm text-[var(--mac-secondary)]">
        {detail.causeLabel} · {detail.impactLabel} · {detail.startedAt} – {detail.endedAt} · {detail.scheduleDays}d · {detail.lostHours}h lost · {detail.idleHours}h idle
      </p>
      {detail.weatherNote ? <p className="text-sm">{detail.weatherNote}</p> : null}
      {detail.voidReason ? <p className="text-sm">{detail.voidReason}</p> : null}
      {detail.changeEventId ? (
        <p className="text-sm">
          <Link href={`/change-events/${detail.changeEventId}`} className="text-[var(--mac-accent)]" data-event={detail.changeEventNumber ?? ""}>
            CE {detail.changeEventNumber}
          </Link>
        </p>
      ) : null}
      <table aria-label="Lost hours" className="w-full text-left text-sm">
        <thead>
          <tr className="text-[var(--mac-secondary)]">
            <th className="py-2 pr-3 font-medium">Cost code</th>
            <th className="py-2 pr-3 font-medium">Trade</th>
            <th className="py-2 text-right font-medium">Hours</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {detail.labor.map((row) => (
            <tr key={row.id} className="border-t border-[var(--mac-separator)]">
              <td className="py-2 pr-3">{row.costCode}</td>
              <td className="py-2 pr-3">{row.trade}</td>
              <td className="py-2 text-right num">{row.hours}</td>
              <td className="py-2 pl-3 text-right">
                {detail.canEdit ? (
                  <ActionForm action={removeDelayLaborAction.bind(null, row.id)}>
                    <input type="hidden" name="claimId" value={detail.id} />
                    <input type="hidden" name="projectId" value={detail.projectId} />
                    <Button type="submit" variant="secondary">
                      Remove
                    </Button>
                  </ActionForm>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--mac-separator)]">
            <td className="py-2 pr-3">Total</td>
            <td />
            <td className="py-2 text-right num">{detail.lostHours}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      {detail.canEdit ? (
        <ActionForm action={addDelayLaborAction.bind(null, detail.id)} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="projectId" value={detail.projectId} />
          <label className="text-sm">
            Cost code
            <input name="costCode" aria-label="Labor cost code" className="field mt-1" />
          </label>
          <label className="text-sm">
            Trade
            <input name="trade" aria-label="Labor trade" className="field mt-1" />
          </label>
          <label className="text-sm">
            Hours
            <input name="hours" aria-label="Labor hours" className="field mt-1" />
          </label>
          <Button type="submit">Add</Button>
        </ActionForm>
      ) : null}
      <ul className="flex flex-col gap-1 text-sm">
        {detail.items.map((row) => (
          <li key={row.id} data-item={row.scheduleItemId}>
            {row.title} · <span className="num">{row.daysClaimed}</span>d
          </li>
        ))}
      </ul>
      {detail.canEdit && detail.scheduleChoices.length > 0 ? (
        <ActionForm action={linkDelayItemAction.bind(null, detail.id)} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="projectId" value={detail.projectId} />
          <label className="text-sm">
            Schedule item
            <select name="scheduleItemId" aria-label="Schedule item" defaultValue="" className="field mt-1">
              <option value="">Select</option>
              {detail.scheduleChoices.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit">Link</Button>
        </ActionForm>
      ) : null}
      {detail.canEdit && detail.items.length > 0 ? (
        <ActionForm action={applyDelayDaysAction.bind(null, detail.id)}>
          <input type="hidden" name="projectId" value={detail.projectId} />
          <Button type="submit" variant="secondary">
            Apply days
          </Button>
        </ActionForm>
      ) : null}
      {detail.files.length > 0 ? (
        <ul className="text-sm">
          {detail.files.map((file) => (
            <li key={file.id}>{file.filename}</li>
          ))}
        </ul>
      ) : null}
      {detail.canEdit && detail.documents.length > 0 ? (
        <ActionForm action={attachDelayFileAction.bind(null, detail.id)} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="projectId" value={detail.projectId} />
          <label className="text-sm">
            Photo
            <select name="documentId" aria-label="Photo" defaultValue="" className="field mt-1">
              <option value="">Select</option>
              {detail.documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit">Attach</Button>
        </ActionForm>
      ) : null}
      {detail.canEdit ? (
        <ActionForm action={saveDelayAction.bind(null, detail.id)} className="flex flex-col gap-2">
          <input type="hidden" name="projectId" value={detail.projectId} />
          <label className="text-sm">
            Title
            <input name="title" aria-label="Title" defaultValue={detail.title} className="field mt-1" />
          </label>
          <label className="text-sm">
            Cause
            <select name="cause" aria-label="Cause" defaultValue={detail.cause} className="field mt-1">
              {DELAY_REASONS.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Impact
            <select name="impact" aria-label="Impact" defaultValue={detail.impact} className="field mt-1">
              {DELAY_IMPACTS.map((row) => (
                <option key={row.value} value={row.value}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Started
            <input name="startedAt" aria-label="Started" type="datetime-local" defaultValue={detail.startedAt} className="field mt-1" />
          </label>
          <label className="text-sm">
            Ended
            <input name="endedAt" aria-label="Ended" type="datetime-local" defaultValue={detail.endedAt} className="field mt-1" />
          </label>
          <label className="text-sm">
            Weather
            <input name="weatherNote" aria-label="Weather" defaultValue={detail.weatherNote} className="field mt-1" />
          </label>
          <label className="text-sm">
            Idle hours
            <input name="idleHours" aria-label="Idle hours" defaultValue={detail.idleHours} className="field mt-1" />
          </label>
          <label className="text-sm">
            Days
            <input name="scheduleDays" aria-label="Days" defaultValue={String(detail.scheduleDays)} className="field mt-1" />
          </label>
          <Button type="submit">Save</Button>
        </ActionForm>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {detail.canDocument ? (
          <ActionForm action={documentDelayAction.bind(null, detail.id)}>
            <input type="hidden" name="projectId" value={detail.projectId} />
            <Button type="submit">Document</Button>
          </ActionForm>
        ) : null}
        {detail.canConvert ? (
          <ActionForm action={convertDelayAction.bind(null, detail.id)}>
            <input type="hidden" name="projectId" value={detail.projectId} />
            <Button type="submit">Convert</Button>
          </ActionForm>
        ) : null}
        {detail.canWaive ? (
          <ActionForm action={waiveDelayAction.bind(null, detail.id)}>
            <input type="hidden" name="projectId" value={detail.projectId} />
            <Button type="submit" variant="secondary">
              Waive
            </Button>
          </ActionForm>
        ) : null}
        {detail.canShare ? <CopyDelayLink claimId={detail.id} url={detail.shareUrl} /> : null}
        {detail.canShare && !detail.sharedAt ? (
          <ActionForm action={markDelaySharedAction.bind(null, detail.id)}>
            <input type="hidden" name="projectId" value={detail.projectId} />
            <Button type="submit" variant="secondary">
              Mark shared
            </Button>
          </ActionForm>
        ) : null}
        {detail.sharedAt ? (
          <a href={detail.shareUrl} className="text-[var(--mac-accent)]" data-share={detail.shareUrl}>
            Package
          </a>
        ) : null}
      </div>
      {detail.canVoid ? (
        <ActionForm action={voidDelayAction.bind(null, detail.id)} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="projectId" value={detail.projectId} />
          <label className="text-sm">
            Reason
            <input name="reason" aria-label="Void reason" className="field mt-1" />
          </label>
          <Button type="submit" variant="secondary">
            Void
          </Button>
        </ActionForm>
      ) : null}
    </div>
  );
}
