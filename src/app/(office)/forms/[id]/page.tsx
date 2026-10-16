import Link from "next/link";
import { notFound } from "next/navigation";
import { attachFormAction, reviewFormAction } from "@/app/(office)/forms/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { attachChoices, formSubmission } from "@/lib/services/forms";

export default async function FormSubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const row = formSubmission(session, id);
  if (!row) notFound();
  const choices = row.canReview ? attachChoices(session) : { jobs: [], contacts: [] };
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col" data-status={row.status} data-submission={row.id}>
      <div className="hidden md:block">
        <Toolbar title={row.templateTitle} subtitle={row.status === "reviewed" ? "Reviewed" : "New"} search={false} leading={<Link href="/forms">‹</Link>} />
      </div>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4">
        <h1 className="fl-large-title md:hidden">{row.templateTitle}</h1>
        <p className="num text-sm">{row.createdAt.slice(0, 10)}</p>
        <dl className="flex flex-col gap-3">
          {row.answers.map((answer) => (
            <div key={answer.fieldId}>
              <dt className="text-sm text-[var(--mac-secondary)]">{answer.label}</dt>
              <dd className="text-sm">
                {answer.documentId ? (
                  <a href={`/api/files/${answer.documentId}`} className="text-[var(--mac-accent)]">
                    {answer.filename || "File"}
                  </a>
                ) : (
                  answer.text || "—"
                )}
                {answer.image && answer.documentId ? <img src={`/api/files/${answer.documentId}`} alt={answer.label} className="mt-2 max-h-40" /> : null}
              </dd>
            </div>
          ))}
        </dl>
        {row.canReview && row.status === "new" ? (
          <ActionForm action={reviewFormAction.bind(null, row.id)}>
            <button type="submit" className="ctl h-9">
              Mark reviewed
            </button>
          </ActionForm>
        ) : null}
        {row.canReview ? (
          <ActionForm action={attachFormAction.bind(null, row.id)} className="flex flex-col gap-2">
            <label className="text-sm">
              Job
              <select name="projectId" aria-label="Job" defaultValue={row.projectId ?? ""} className="field mt-1">
                <option value="">None</option>
                {choices.jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Contact
              <select name="contactId" aria-label="Contact" defaultValue={row.contactId ?? ""} className="field mt-1">
                <option value="">None</option>
                {choices.contacts.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="ctl h-9 w-fit">
              Save
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
