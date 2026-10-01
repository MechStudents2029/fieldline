import Link from "next/link";
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
      <form className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
        <input name="q" defaultValue={query.q} placeholder="Search name, title, or source" className="field" />
        <select name="source" defaultValue={query.source || ""} className="field">
          <option value="">All sources</option>
          {board.sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" className="h-11">
          Filter
        </Button>
      </form>
      {board.cards.length === 0 ? <p className="text-sm text-muted-foreground">Nothing matches that search.</p> : null}
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
