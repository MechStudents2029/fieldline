import { submitPublicFormAction, submitSignedFormAction } from "@/app/(office)/forms/actions";
import { FormFill } from "@/components/form-fill";
import { getSession } from "@/lib/auth/session";
import { publicForm } from "@/lib/services/forms";

export const dynamic = "force-dynamic";

function formStarted() {
  return Date.now();
}

export default async function PublicFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getSession();
  const form = publicForm(token, session);
  if (form.state !== "open") {
    const title = form.state === "missing" ? "Form" : form.title;
    const line = form.state === "closed" ? "This form is closed." : form.state === "signin" ? "Sign in to fill this." : form.state === "missing" ? "That form is not here." : "Sign out to fill this.";
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-16">
        <div className="mb-6 h-1 w-10 bg-[var(--fl-accent)]" />
        <h1 className="font-heading text-2xl">{title}</h1>
        <p className="mt-3 text-base">{line}</p>
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-10">
      <div className="h-1 w-10 bg-[var(--fl-accent)]" />
      <h1 className="mt-6 font-heading text-2xl">{form.orgName}</h1>
      <p className="mt-2 text-sm">{form.title}</p>
      {form.description ? <p className="mt-1 text-sm text-[var(--mac-secondary)]">{form.description}</p> : null}
      <FormFill action={form.signed ? submitSignedFormAction.bind(null, form.templateId) : submitPublicFormAction.bind(null, form.token)} fields={form.fields} startedAt={form.signed ? undefined : formStarted()} />
    </main>
  );
}
