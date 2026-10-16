import Link from "next/link";
import { notFound } from "next/navigation";
import { submitSignedFormAction } from "@/app/(office)/forms/actions";
import { FormFill } from "@/components/form-fill";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { signedForm } from "@/lib/services/forms";

export default async function UseFormPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const form = signedForm(session, id);
  if (!form) notFound();
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title={form.title} subtitle={String(form.fields.length)} search={false} leading={<Link href="/forms">‹</Link>} />
      </div>
      <div className="mx-auto flex w-full max-w-md flex-col px-4 py-4">
        <h1 className="fl-large-title md:hidden">{form.title}</h1>
        {form.description ? <p className="text-sm text-[var(--mac-secondary)]">{form.description}</p> : null}
        <FormFill action={submitSignedFormAction.bind(null, id)} fields={form.fields} />
      </div>
    </div>
  );
}
