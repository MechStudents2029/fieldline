import Link from "next/link";
import { notFound } from "next/navigation";
import { markSignatureSentAction, voidSignatureRequestAction } from "@/app/(office)/signatures/actions";
import { ActionForm } from "@/components/action-form";
import { CopyField } from "@/components/copy-field";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { signatureRequest } from "@/lib/services/doc-signatures";

export default async function SignatureDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const row = signatureRequest(session, id);
  if (!row) notFound();
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col" data-status={row.status} data-request={row.id}>
      <div className="hidden md:block">
        <Toolbar title={row.title} subtitle={row.statusLabel} search={false} leading={<Link href="/signatures">‹</Link>} />
      </div>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4">
        <h1 className="fl-large-title md:hidden">{row.title}</h1>
        <p className="text-sm">
          <span className="fl-pill">{row.statusLabel}</span>
          {row.dueOn ? <span className="num ml-2">{row.dueOn}</span> : null}
          {row.version > 1 ? <span className="num ml-2">v{row.version}</span> : null}
        </p>
        {row.note ? <p className="text-sm">{row.note}</p> : null}
        {row.documentId ? (
          <a href={`/api/files/${row.documentId}`} className="text-sm text-[var(--mac-accent)]">
            {row.filename || "Document"}
          </a>
        ) : null}
        {row.docHash ? <p className="num break-all text-xs">{row.docHash}</p> : null}
        {row.sentAt ? <p className="num text-sm" data-sent={row.sentAt}>Sent {row.sentAt.slice(0, 10)}</p> : null}
        {row.declineReason ? <p className="text-sm">{row.declineReason}</p> : null}
        {row.voidReason ? <p className="text-sm">{row.voidReason}</p> : null}
        <ul className="flex flex-col gap-3">
          {row.signers.map((signer, index) => (
            <li key={signer.id} className="flex flex-col gap-1">
              <span className="text-sm">
                {signer.name} <span className="fl-pill">{signer.status}</span>
              </span>
              {row.status === "out" ? <CopyField label={index === 0 ? "Sign link" : `Sign link ${index + 1}`} value={signer.link} /> : null}
            </li>
          ))}
        </ul>
        {row.status === "signed" ? (
          <Link href={`/signatures/${row.id}/certificate`} className="text-sm text-[var(--mac-accent)]">
            Certificate
          </Link>
        ) : null}
        {row.canSend ? (
          <ActionForm action={markSignatureSentAction.bind(null, row.id)}>
            <button type="submit" className="ctl h-9">
              Mark sent
            </button>
          </ActionForm>
        ) : null}
        {row.canVoid ? (
          <ActionForm action={voidSignatureRequestAction.bind(null, row.id)} className="flex flex-col gap-2">
            <label className="text-sm">
              Reason
              <input name="reason" aria-label="Void reason" className="field mt-1" />
            </label>
            <button type="submit" className="ctl h-9 w-fit">
              Void
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
