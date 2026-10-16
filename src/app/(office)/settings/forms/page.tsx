import Link from "next/link";
import { notFound } from "next/navigation";
import { createFormTemplateAction } from "@/app/(office)/forms/actions";
import { ActionForm } from "@/components/action-form";
import { AudienceChecks, FieldSlots } from "@/components/form-template-fields";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { canEditCrm } from "@/lib/permissions";
import { formTemplateList } from "@/lib/services/forms";

export default async function FormsSettingsPage() {
  const session = await requireSession();
  if (session.role === "field") notFound();
  const rows = formTemplateList(session);
  const canCreate = canEditCrm(session.role);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Forms" subtitle={String(rows.length)} search={false} leading={<Link href="/settings">‹</Link>} />
      </div>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4">
        <h1 className="fl-large-title md:hidden">Forms</h1>
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li key={row.id} className="border-b border-[var(--mac-separator)] py-2" data-template={row.id} data-status={row.status}>
              <Link href={`/settings/forms/${row.id}`}>{row.title}</Link>
              <p className="mac-t11 text-[var(--mac-secondary)]">{row.status === "archived" ? "Archived" : row.audiences.join(", ")}</p>
            </li>
          ))}
        </ul>
        {canCreate ? (
          <ActionForm action={createFormTemplateAction} className="flex flex-col gap-3">
            <label className="text-sm">
              Title
              <input name="title" aria-label="Title" required className="field mt-1" />
            </label>
            <label className="text-sm">
              Description
              <input name="description" aria-label="Description" className="field mt-1" />
            </label>
            <AudienceChecks selected={[]} />
            <FieldSlots fields={[]} />
            <button type="submit" className="ctl h-9 w-fit">
              Create
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
