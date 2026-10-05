import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PipelineBoard } from "@/components/pipeline-board";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { canSeeMoney } from "@/lib/permissions";
import { pipelineBoard } from "@/lib/services/read";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; source?: string }>;
}) {
  const session = await requireSession();
  const query = await searchParams;
  const board = pipelineBoard(session.orgId, { q: query.q, source: query.source });
  const filtered = Boolean(query.q?.trim() || query.source);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl">Pipeline</h1>
          <p className="text-sm text-muted-foreground">Drag a card, or use Move on a phone.</p>
        </div>
        <Button asChild className="h-11">
          <Link href="/leads/new">New lead</Link>
        </Button>
      </div>
      <form className="grid gap-2 sm:grid-cols-[1fr_180px_auto]" aria-label="Filter the pipeline">
        <label className="text-sm">
          Search
          <input name="q" defaultValue={query.q} placeholder="Name, title, or source" className="field mt-1" />
        </label>
        <label className="text-sm">
          Source
          <select name="source" defaultValue={query.source || ""} className="field mt-1">
          <option value="">All sources</option>
          {board.sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
          </select>
        </label>
        <Button type="submit" variant="outline" className="h-11 self-end">
          Filter
        </Button>
      </form>
      {board.cards.length === 0 && filtered ? <p className="text-sm text-muted-foreground">Nothing matches that search.</p> : null}
      {board.cards.length === 0 && !filtered ? (
        <EmptyState
          title="No leads in the pipeline"
          why="Leads you add show up here by stage, from the first call through won or lost. This company has no leads yet."
          href="/leads/new"
          action="New lead"
        />
      ) : null}
      <PipelineBoard
        showMoney={canSeeMoney(session.role)}
        stages={board.stages.map((stage) => ({ id: stage.id, name: stage.name }))}
        cards={board.cards.map((card) => ({
          id: card.lead.id,
          title: card.lead.title,
          stageId: card.lead.stageId,
          source: card.lead.source,
          valueEstCents: card.lead.valueEstCents,
          contactName: card.contact.name,
          updatedAt: card.lead.updatedAt,
        }))}
      />
    </div>
  );
}
