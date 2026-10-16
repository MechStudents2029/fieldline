import { declineDocumentAction, signDocumentAction } from "@/app/(office)/signatures/actions";
import { ActionForm } from "@/components/action-form";
import { SignaturePad } from "@/components/signature-pad";
import { publicSignature } from "@/lib/services/doc-signatures";

export const dynamic = "force-dynamic";

function signStarted() {
  return Date.now();
}

export default async function PublicSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = publicSignature(token);
  if (page.state === "missing") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-16">
        <h1 className="font-heading text-2xl">Signature</h1>
        <p className="mt-3 text-base">That request is not here.</p>
      </main>
    );
  }
  if (page.state !== "open") {
    const status = page.state === "done" ? page.status : page.state;
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-16" data-status={status}>
        <div className="mb-6 h-1 w-10 bg-[var(--fl-accent)]" />
        <h1 className="font-heading text-2xl">{page.orgName}</h1>
        <p className="mt-2 text-sm">{page.title}</p>
        <p className="mt-3 text-base">{page.state === "wait" ? "Waiting." : page.line}</p>
      </main>
    );
  }
  const started = signStarted();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-10" data-status="open">
      <div className="h-1 w-10 bg-[var(--fl-accent)]" />
      <h1 className="mt-6 font-heading text-2xl">{page.orgName}</h1>
      <p className="mt-2 text-sm">{page.title}</p>
      {page.note ? <p className="mt-1 text-sm">{page.note}</p> : null}
      <a href={`/sign/${page.token}/file`} className="mt-3 text-sm text-[var(--mac-accent)]">
        {page.filename || "Document"}
      </a>
      <ActionForm action={signDocumentAction.bind(null, page.token)} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="startedAt" value={String(started)} />
        <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden>
          <input name="hp_field" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>
        <label className="text-sm">
          Name
          <input name="typedName" aria-label="Name" required className="field mt-1" />
        </label>
        <SignaturePad name="drawn" label="Draw your signature" />
        <button type="submit" className="ctl h-9 w-fit">
          Sign
        </button>
      </ActionForm>
      <ActionForm action={declineDocumentAction.bind(null, page.token)} className="mt-6 flex flex-col gap-2">
        <input type="hidden" name="startedAt" value={String(started)} />
        <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden>
          <input name="hp_field" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>
        <label className="text-sm">
          Reason
          <input name="reason" aria-label="Reason" className="field mt-1" />
        </label>
        <button type="submit" className="ctl h-9 w-fit">
          Decline
        </button>
      </ActionForm>
    </main>
  );
}
