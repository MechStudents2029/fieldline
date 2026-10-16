import Link from "next/link";
import { notFound } from "next/navigation";
import { createSignatureRequestAction } from "@/app/(office)/signatures/actions";
import { ActionForm } from "@/components/action-form";
import { FileButton } from "@/components/file-button";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { canEditCrm } from "@/lib/permissions";
import { signerChoices } from "@/lib/services/doc-signatures";
import { listProjects } from "@/lib/services/read";

export default async function NewSignaturePage() {
  const session = await requireSession();
  if (!canEditCrm(session.role)) notFound();
  const choices = signerChoices(session);
  const jobs = listProjects(session.orgId).map((row) => ({ id: row.project.id, name: row.project.name }));
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Request" subtitle="1" search={false} leading={<Link href="/signatures">‹</Link>} />
      </div>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4">
        <h1 className="fl-large-title md:hidden">Request</h1>
        <ActionForm action={createSignatureRequestAction} className="flex flex-col gap-3">
          <label className="text-sm">
            Title
            <input name="title" aria-label="Title" required className="field mt-1" />
          </label>
          <label className="text-sm">
            Note
            <input name="note" aria-label="Note" className="field mt-1" />
          </label>
          <label className="text-sm">
            Due
            <input name="dueOn" type="date" aria-label="Due" className="field mt-1" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="ordered" type="checkbox" aria-label="Signing order" />
            Signing order
          </label>
          <label className="text-sm">
            Job
            <select name="projectId" aria-label="Job" className="field mt-1" defaultValue="">
              <option value="">None</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Signer
            <select name="signer" aria-label="Signer" required className="field mt-1" defaultValue="">
              <option value="">Pick</option>
              {choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Signer 2
            <select name="signer_2" aria-label="Signer 2" className="field mt-1" defaultValue="">
              <option value="">None</option>
              {choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <FileButton name="file" label="Document" accept="image/jpeg,image/png,image/webp,application/pdf" empty="Document" />
          <button type="submit" className="ctl h-9 w-fit">
            Request
          </button>
        </ActionForm>
      </div>
    </div>
  );
}
