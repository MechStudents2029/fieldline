import Link from "next/link";
import { notFound } from "next/navigation";
import { reviewSubmittalAction, submitSubmittalAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FileButton } from "@/components/file-button";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay, formatDateTime } from "@/lib/format";
import { submittalDetail } from "@/lib/services/submittals";
import { pendingSubmittal } from "@/lib/submittals/format";

export default async function SubmittalPage({ params }: { params: Promise<{ id: string; submittalId: string }> }) {
  const { id, submittalId } = await params;
  const session = await requireSession();
  const item = submittalDetail(session, submittalId);
  if (!item || item.projectId !== id) notFound();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <Link href={`/projects/${id}#submittals`} className="text-sm text-[var(--fl-accent)]">
        ‹ Submittals
      </Link>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="fl-title">
          {item.label} · {item.title}
        </h1>
        {pendingSubmittal(item.status) ? <span className="fl-pill">{item.statusLabel}</span> : <span className="text-sm text-[var(--mac-secondary)]">{item.statusLabel}</span>}
      </header>
      <p className="text-sm text-[var(--mac-secondary)]">
        {[item.projectName, item.division, item.assigneeName, item.dueOn ? formatCalendarDay(item.dueOn) : "", `${item.ageDays}d`, `Rev ${item.revision}`, item.relatedLabel].filter(Boolean).join(" · ")}
      </p>
      <p>{item.specNote}</p>
      {item.internalNote ? <p className="text-sm text-[var(--mac-secondary)]">Internal · {item.internalNote}</p> : null}
      <ol className="flex flex-col gap-2" aria-label="Revisions">
        {item.revisions.map((revision) => (
          <li key={revision.id} className="rounded-md bg-[var(--mac-fill)] px-3 py-2">
            <p className="text-sm">
              Rev {revision.revision} · {revision.authorName} · {formatDateTime(revision.createdAt)}
            </p>
            {revision.note ? <p>{revision.note}</p> : null}
            {revision.reviewNote ? (
              <p className="text-sm text-[var(--mac-secondary)]">
                {revision.reviewerName} · {revision.reviewedAt ? formatDateTime(revision.reviewedAt) : ""} · {revision.reviewNote}
              </p>
            ) : null}
            <ul>
              {revision.files.map((file) => (
                <li key={file.id}>
                  <a href={`/api/files/${file.id}`}>{file.filename}</a>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {item.canSubmit ? (
        <ActionForm action={submitSubmittalAction.bind(null, id, item.id)} className="grid gap-2">
          <label className="text-sm">
            Note
            <textarea name="note" aria-label="Submit note" rows={2} className="field mt-1" />
          </label>
          <FileButton name="file" label="Submittal file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" multiple empty="File" />
          <button type="submit" className="mac-primary w-fit">
            Submit
          </button>
        </ActionForm>
      ) : null}
      {item.canReview ? (
        <ActionForm action={reviewSubmittalAction.bind(null, id, item.id)} className="grid gap-2">
          <label className="text-sm">
            Status
            <select name="status" aria-label="Review status" className="field mt-1" defaultValue={item.decisions[0]?.value}>
              {item.decisions.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Note
            <textarea name="note" aria-label="Review note" rows={2} className="field mt-1" />
          </label>
          <button type="submit" className="mac-primary w-fit">
            Save review
          </button>
        </ActionForm>
      ) : null}
      {item.canVoid ? (
        <ActionForm action={reviewSubmittalAction.bind(null, id, item.id)}>
          <input type="hidden" name="status" value="void" />
          <button type="submit">Void</button>
        </ActionForm>
      ) : null}
    </div>
  );
}
