import { CopilotPanel } from "@/components/copilot-panel";
import { EmptyState } from "@/components/empty-state";
import { requireSession } from "@/lib/auth/session";
import { canSeeMoney } from "@/lib/permissions";
import { askCopilot, listInvoices, listProjects, pipelineBoard } from "@/lib/services/read";

export default async function CopilotPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return <p>Copilot reads receivables and margins, so it is hidden for the field role.</p>;
  }
  const question = (await searchParams).q?.trim() ?? "";
  const result = question ? askCopilot(session.orgId, question) : null;
  const sourcesEmpty =
    pipelineBoard(session.orgId).cards.length === 0 &&
    listProjects(session.orgId).length === 0 &&
    listInvoices(session.orgId).length === 0;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="font-heading text-3xl">Ask the business</h1>
        <p className="text-sm text-muted-foreground">Read-only. It calls typed tools, not free-form SQL, and it does not change money.</p>
      </div>
      {sourcesEmpty ? (
        <EmptyState
          title="No business records yet"
          why="Answers come from this company's leads, jobs, and invoices. The list is empty because those records do not exist yet."
          href="/leads/new"
          action="Add a lead"
        />
      ) : (
        <CopilotPanel question={question} result={result} />
      )}
    </div>
  );
}
