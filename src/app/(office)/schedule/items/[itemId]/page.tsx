import Link from "next/link";
import { assignScheduleVendorAction, requestConfirmationAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CommentThread } from "@/components/comment-thread";
import { ConfirmPropose } from "@/components/confirm-propose";
import { CopyLine } from "@/components/copy-line";
import { MissingRecord } from "@/components/missing-record";
import { ScheduleShiftForm } from "@/components/schedule-shift-form";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay, formatDateTime } from "@/lib/format";
import { recordHeading } from "@/lib/services/comments";
import { itemConfirmations, listConfirmations } from "@/lib/services/confirmations";
import { scheduleItemBrief } from "@/lib/services/schedule";

export default async function ScheduleItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const session = await requireSession();
  const heading = recordHeading(session, "schedule_item", itemId);
  const brief = scheduleItemBrief(session, itemId);
  if (!heading || !brief) return <MissingRecord orgName={session.orgName} kind="schedule item" />;
  const confirm = itemConfirmations(session, itemId);
  const vendors = listConfirmations(session).vendors;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <Link href="/schedule" className="text-sm text-[var(--fl-accent)]">
        ‹ Schedule
      </Link>
      <h1 className="fl-title">{heading.title}</h1>
      <p className="mac-t13 text-[var(--mac-secondary)]">{heading.job}</p>
      {brief.float != null ? (
        <p className="mac-t13">
          Float <span className="num" data-float>{brief.float} wd</span>
        </p>
      ) : null}
      {confirm ? (
        <section aria-label="Confirmations" className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="fl-section">Confirmations</h2>
            {confirm.pill ? <span className="fl-pill" data-confirm={confirm.status}>{confirm.pill}</span> : null}
          </div>
          {confirm.vendorName ? <p className="mac-t13">{confirm.vendorName}</p> : null}
          {confirm.status === "declined" && confirm.reason ? <p className="mac-t13">{confirm.reason}</p> : null}
          {confirm.proposed ? <p className="num mac-t13">{formatCalendarDay(confirm.proposed)}</p> : null}
          {confirm.canEdit ? (
            <ActionForm action={assignScheduleVendorAction.bind(null, confirm.id)} className="flex flex-wrap items-center gap-2">
              <select name="vendorId" aria-label="Vendor" className="ctl" defaultValue={confirm.vendorId ?? ""}>
                <option value="">Vendor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="ctl">
                Assign
              </button>
            </ActionForm>
          ) : null}
          {confirm.canEdit && confirm.vendorId ? (
            <ActionForm action={requestConfirmationAction.bind(null, confirm.id)} className="flex flex-col gap-2">
              <button type="submit" className="ctl w-fit">
                Request confirmation
              </button>
            </ActionForm>
          ) : null}
          {confirm.message ? <CopyLine label="Message" value={confirm.message} /> : null}
          {confirm.url ? <CopyLine label="Portal link" value={confirm.url} /> : null}
          {confirm.canEdit && confirm.status === "declined" && confirm.proposed ? <ConfirmPropose itemId={confirm.id} /> : null}
          <ul className="fl-group">
            {confirm.history.length === 0 ? <li className="fl-cell">No history</li> : null}
            {confirm.history.map((event) => (
              <li key={event.id} className="fl-cell">
                <span className="min-w-0 flex-1">
                  <span className="fl-body block">{event.actorName}</span>
                  <span className="fl-footnote text-[var(--fl-secondary)]">
                    {formatDateTime(event.createdAt)}
                    {event.reason ? ` · ${event.reason}` : ""}
                    {event.proposedDate ? ` · ${formatCalendarDay(event.proposedDate)}` : ""}
                  </span>
                </span>
                <span className="fl-pill fl-pill-sm">{event.label}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {brief.canEdit ? <ScheduleShiftForm itemId={brief.id} startDate={brief.startDate} endDate={brief.endDate} /> : null}
      <CommentThread entityType="schedule_item" entityId={itemId} />
    </div>
  );
}
