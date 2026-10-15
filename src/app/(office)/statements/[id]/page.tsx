import Link from "next/link";
import { notFound } from "next/navigation";
import { markStatementSentAction } from "@/app/(office)/fees/actions";
import { ActionForm } from "@/components/action-form";
import { NecCopy } from "@/components/nec-copy";
import { StatementSheet } from "@/components/statement-sheet";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { canManageMoney, canSeeMoney } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import { openStatement } from "@/lib/services/late-fees";

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) notFound();
  const { id } = await params;
  let view: ReturnType<typeof openStatement>;
  try {
    view = openStatement(session, id);
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/statements">Statements</Link>
        <Link href={`/statements/${view.id}/print`}>Print</Link>
        <NecCopy url={view.path} />
      </div>
      <StatementSheet view={view} />
      {view.sentAt ? (
        <p data-sent>
          {view.sentByName} · {view.sentAt.slice(0, 10)}
        </p>
      ) : canManageMoney(session.role) ? (
        <ActionForm action={markStatementSentAction.bind(null, view.id)}>
          <Button type="submit" variant="outline" className="h-11">
            Mark sent
          </Button>
        </ActionForm>
      ) : null}
    </div>
  );
}
