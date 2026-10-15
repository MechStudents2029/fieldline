import { notFound } from "next/navigation";
import { StatementSheet } from "@/components/statement-sheet";
import { statementByToken } from "@/lib/services/late-fees";

export const dynamic = "force-dynamic";

export default async function PublicStatementPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = statementByToken(token);
  if (!view) notFound();
  return (
    <main className="home mx-auto min-h-screen w-full max-w-3xl px-4 py-8">
      <StatementSheet view={view} />
    </main>
  );
}
