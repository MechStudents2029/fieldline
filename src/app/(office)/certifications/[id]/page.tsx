import Link from "next/link";
import { notFound } from "next/navigation";
import { markCredentialRequestedAction, revokeCredentialAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CredentialForm } from "@/components/credential-form";
import { NecCopy } from "@/components/nec-copy";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { canManageMoney } from "@/lib/permissions";
import { credentialDetail, credentialPeople, credentialTypesFor } from "@/lib/services/certifications";
import { ServiceError } from "@/lib/services/errors";

export default async function CredentialDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  let card: ReturnType<typeof credentialDetail>;
  try {
    card = credentialDetail(session, id);
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
  const office = canManageMoney(session.role);
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4 md:px-6">
      <Link href="/certifications" className="text-sm">
        Certifications
      </Link>
      <article className="flex flex-col gap-3" data-cert-detail={card.id} data-status={card.status} data-window={card.bucket}>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="fl-title">{card.typeName}</h1>
          <span className="fl-pill">{card.statusLabel}</span>
          {card.requestedAt ? <span className="fl-pill">Requested</span> : null}
        </div>
        <p className="text-sm text-[var(--fl-secondary)]">{card.personName}</p>
        {card.numberLabel ? <p className="num" data-number>{card.numberLabel}</p> : null}
        <p className="num">
          {card.issuedOn} · {card.expiresOn ?? "—"}
        </p>
        {card.requestedAt ? (
          <p className="text-sm" data-requested>
            {card.requestedAt.slice(0, 10)}
            {card.requestedByName ? ` · ${card.requestedByName}` : ""}
          </p>
        ) : null}
        {card.documentId ? <a href={`/api/files/${card.documentId}`}>Card</a> : null}
        <NecCopy url={card.selfPath} />
        {card.canRequest ? (
          <ActionForm action={markCredentialRequestedAction.bind(null, card.id)}>
            <Button type="submit" variant="outline" className="h-11">
              Mark requested
            </Button>
          </ActionForm>
        ) : null}
        {card.canRevoke ? (
          <ActionForm action={revokeCredentialAction.bind(null, card.id)}>
            <Button type="submit" variant="outline" className="h-11">
              Revoke
            </Button>
          </ActionForm>
        ) : null}
      </article>
      {card.canEdit ? (
        <CredentialForm types={credentialTypesFor(session)} people={office ? credentialPeople(session) : undefined} credential={card} />
      ) : null}
    </div>
  );
}
