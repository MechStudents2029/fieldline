import Link from "next/link";
import { notFound } from "next/navigation";
import { archiveFormTemplateAction, markFormLinkSentAction, updateFormTemplateAction } from "@/app/(office)/forms/actions";
import { ActionForm } from "@/components/action-form";
import { AudienceChecks, FieldSlots } from "@/components/form-template-fields";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formTemplate } from "@/lib/services/forms";

export default async function FormTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (session.role === "field") notFound();
  const { id } = await params;
  const row = formTemplate(session, id);
  if (!row) notFound();
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col" data-status={row.status}>
      <div className="hidden md:block">
        <Toolbar title={row.title} subtitle={row.status === "archived" ? "Archived" : String(row.fields.length)} search={false} leading={<Link href="/settings/forms">‹</Link>} />
      </div>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4">
        <h1 className="fl-large-title md:hidden">{row.title}</h1>
        {row.description ? <p className="text-sm text-[var(--mac-secondary)]">{row.description}</p> : null}
        <label className="text-sm">
          Fill link
          <input aria-label="Fill link" readOnly value={row.link} className="field mt-1" />
        </label>
        {row.sentAt ? (
          <p className="num text-sm" data-sent={row.sentAt}>
            Sent {row.sentAt.slice(0, 10)}
          </p>
        ) : null}
        {row.canLink && row.status === "active" ? (
          <ActionForm action={markFormLinkSentAction.bind(null, row.id)}>
            <button type="submit" className="ctl h-9">
              Mark sent
            </button>
          </ActionForm>
        ) : null}
        {row.canEdit && row.status === "active" ? (
          <ActionForm action={updateFormTemplateAction.bind(null, row.id)} className="flex flex-col gap-3">
            <label className="text-sm">
              Title
              <input name="title" aria-label="Title" required defaultValue={row.title} className="field mt-1" />
            </label>
            <label className="text-sm">
              Description
              <input name="description" aria-label="Description" defaultValue={row.description} className="field mt-1" />
            </label>
            <AudienceChecks selected={row.audiences} />
            <FieldSlots fields={row.fields} />
            <button type="submit" className="ctl h-9 w-fit">
              Save
            </button>
          </ActionForm>
        ) : null}
        {row.canEdit && row.status === "active" ? (
          <ActionForm action={archiveFormTemplateAction.bind(null, row.id)}>
            <button type="submit" className="ctl h-9">
              Archive
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
