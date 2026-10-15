import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { StatementSheet } from "@/components/statement-sheet";
import { requireSession } from "@/lib/auth/session";
import { canSeeMoney } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import { openStatement } from "@/lib/services/late-fees";

export const dynamic = "force-dynamic";

export default async function StatementPrintPage({ params }: { params: Promise<{ id: string }> }) {
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
    <main className="mx-auto min-h-screen max-w-[8.5in] bg-[var(--mac-window)] px-8 py-8 text-[13px] text-[var(--mac-label)] print:bg-white print:text-black">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/statements/${view.id}`}>‹</Link>
        <PrintButton />
      </div>
      <p>{session.orgName}</p>
      <StatementSheet view={view} />
    </main>
  );
}
