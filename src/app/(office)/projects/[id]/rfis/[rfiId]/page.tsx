import Link from "next/link";
import { notFound } from "next/navigation";
import { answerRfiAction, closeRfiAction, draftRfiChangeAction, shiftRfiAction, voidRfiAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CommentThread } from "@/components/comment-thread";
import { FileButton } from "@/components/file-button";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay, formatDateTime } from "@/lib/format";
import { rfiDetail } from "@/lib/services/rfis";

export default async function RfiPage({ params }: { params: Promise<{ id: string; rfiId: string }> }) {
  const { id, rfiId } = await params;
  const session = await requireSession();
  const rfi = rfiDetail(session, rfiId);
  if (!rfi || !rfi.href.includes(`/projects/${id}/`)) notFound();
  const dollars = rfi.costCents == null ? "" : (rfi.costCents / 100).toFixed(2);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <Link href={`/projects/${id}#rfis`} className="text-sm text-[var(--fl-accent)]">
        ‹ RFIs
      </Link>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="fl-title">
          {rfi.label} · {rfi.title}
        </h1>
        <span className="fl-pill">{rfi.statusLabel}</span>
      </header>
      <p className="text-sm text-[var(--mac-secondary)]">
        {rfi.assigneeName}
        {rfi.dueOn ? ` · ${formatCalendarDay(rfi.dueOn)}` : ""} · {rfi.ageDays}d
        {rfi.relatedLabel ? ` · ${rfi.relatedLabel}` : ""}
        {rfi.impact ? ` · ${rfi.impact}` : ""}
      </p>
      <p>{rfi.question}</p>
      {rfi.internalNote ? <p className="text-sm text-[var(--mac-secondary)]">Internal · {rfi.internalNote}</p> : null}
      {rfi.changeOrderLabel ? <p className="text-sm">{rfi.changeOrderLabel} · Draft</p> : null}
      <ul className="flex flex-col gap-2">
        {rfi.messages.map((message) => (
          <li key={message.id} className="rounded-md bg-[var(--mac-fill)] px-3 py-2">
            <p className="text-sm">
              {message.authorName} · {formatDateTime(message.createdAt)}
            </p>
            <p>{message.body}</p>
          </li>
        ))}
      </ul>
      {rfi.canAnswer ? (
        <ActionForm action={answerRfiAction.bind(null, rfi.id)} className="grid gap-2">
          <label className="text-sm">
            Answer
            <textarea name="body" aria-label={`Answer ${rfi.title}`} rows={3} className="field mt-1" required />
          </label>
          <FileButton name="photo" label={`Photo ${rfi.title}`} accept="image/jpeg,image/png,image/webp" empty="Photo" />
          {rfi.canClose ? (
            <label className="text-sm">
              <input type="checkbox" name="internal" value="1" /> Internal note
            </label>
          ) : null}
          <button type="submit" className="mac-primary w-fit">
            Send answer
          </button>
        </ActionForm>
      ) : null}
      {rfi.canClose ? (
        <ActionForm action={closeRfiAction.bind(null, rfi.id)} className="grid gap-2">
          <label className="text-sm">
            <input type="checkbox" name="costImpact" value="1" defaultChecked={rfi.costImpact} aria-label="Cost impact" /> Cost impact
          </label>
          {rfi.showMoney ? (
            <label className="text-sm">
              Amount
              <input name="cost" aria-label="Cost amount" defaultValue={dollars} inputMode="decimal" className="field mt-1" />
            </label>
          ) : null}
          <label className="text-sm">
            Schedule days
            <input name="days" aria-label="Schedule days" defaultValue={rfi.scheduleImpactDays ?? ""} inputMode="numeric" className="field mt-1" />
          </label>
          <button type="submit" className="mac-primary w-fit">
            Close RFI
          </button>
        </ActionForm>
      ) : null}
      {rfi.canDraft ? (
        <ActionForm action={draftRfiChangeAction.bind(null, rfi.id)}>
          <button type="submit">Draft change order</button>
        </ActionForm>
      ) : null}
      {rfi.canShift ? (
        <ActionForm action={shiftRfiAction.bind(null, rfi.id)}>
          <button type="submit">{rfi.shiftLabel ?? "Shift schedule"}</button>
        </ActionForm>
      ) : null}
      {rfi.canClose ? (
        <ActionForm action={voidRfiAction.bind(null, rfi.id)}>
          <button type="submit">Void</button>
        </ActionForm>
      ) : null}
      <CommentThread entityType="rfi" entityId={rfi.id} />
    </div>
  );
}
