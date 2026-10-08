import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { ListToolbar } from "@/components/list-toolbar";
import { Toolbar } from "@/components/mac/toolbar";
import { PipelineBoard } from "@/components/pipeline-board";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { one, pinnedTarget, readQuery } from "@/lib/lists/query";
import { canEditCrm, canSeeMoney } from "@/lib/permissions";
import { pipelineBoard } from "@/lib/services/read";
import { LIST_FILTERS, listSavedViews, viewHref } from "@/lib/services/saved-views";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const query = await searchParams;
  const keys = LIST_FILTERS.leads ?? [];
  const views = listSavedViews(session, "leads");
  const target = pinnedTarget("/pipeline", query, views.find((view) => view.pinned) ?? null, keys);
  if (target) redirect(target);
  const filters = readQuery(query, keys);
  const board = pipelineBoard(session.orgId, { q: filters.q, source: filters.source });
  const filtered = Boolean(filters.q || filters.source);
  return (
    <div className="flex flex-col gap-4">
      <div className="hidden md:block">
        <Toolbar title="Leads" subtitle={`${board.cards.length} open`} primary="New lead" primaryHref="/leads/new" search={false} />
      </div>
      <div className="flex items-end justify-between gap-3 md:hidden">
        <div>
          <h1 className="font-heading text-3xl md:hidden">Leads</h1>
          <p className="mac-t13 text-[var(--mac-secondary)]">{board.cards.length} open</p>
        </div>
        <Button asChild className="h-11">
          <Link href="/leads/new">New lead</Link>
        </Button>
      </div>
      <ListToolbar
        path="/pipeline"
        list="leads"
        search={filters.q || ""}
        query={filters}
        activeId={views.some((view) => view.id === one(query.view)) ? one(query.view) : ""}
        canShare={canEditCrm(session.role)}
        clearHref={filtered ? "/pipeline?view=none" : null}
        views={views.map((view) => ({ id: view.id, name: view.name, href: viewHref(view), pinned: view.pinned, mine: view.mine, shared: view.shared }))}
        filters={[{ name: "source", label: "Source", value: filters.source || "", any: "Any", options: board.sources.map((source) => ({ value: source, label: source })) }]}
      />
      {board.cards.length === 0 && filtered ? <p className="text-sm text-muted-foreground">Nothing matches that search.</p> : null}
      {board.cards.length === 0 && !filtered ? (
        <EmptyState
          title="No leads in the pipeline"
          why="No leads yet."
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
