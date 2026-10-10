import Link from "next/link";
import { notFound } from "next/navigation";
import { placePinAction, reviewPinsAction, saveMarkupAction } from "@/app/actions";
import { MarkupStage } from "@/components/markup-stage";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { emptyMarkupLayer } from "@/lib/markup/layer";
import { planBoard } from "@/lib/services/markup";

export const dynamic = "force-dynamic";

export default async function PlanPage({ params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const session = await requireSession();
  const board = planBoard(session, id, fileId);
  if (!board) notFound();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title={board.name}
        subtitle={`Rev ${board.revision}`}
        search={false}
        leading={
          <Link href={`/projects/${id}/files`} className="mac-t13 text-[var(--mac-accent)]">
            ‹ Files
          </Link>
        }
        trailing={board.readOnly ? <span className="fl-pill">Superseded</span> : board.markup ? <span className="fl-pill">Marked up</span> : null}
      />
      <div className="flex flex-col gap-3 px-4 pb-8">
        {board.markup ? (
          <p className="mac-t11 text-[var(--mac-secondary)]">
            {board.markup.author} · {formatDateTime(board.markup.at)}
          </p>
        ) : null}
        <MarkupStage
          mode="plan"
          src={board.documentHref}
          kind={board.kind}
          title={board.name}
          initial={board.markup?.layer ?? emptyMarkupLayer()}
          readOnly={!board.canEdit}
          saveAction={board.canEdit ? saveMarkupAction.bind(null, id, "plan", fileId) : undefined}
          pins={board.pins}
          pinAction={board.canEdit ? placePinAction.bind(null, id, fileId) : undefined}
          punches={board.punches}
          rfis={board.rfis}
          todos={board.todos}
          unreviewed={board.unreviewed}
          reviewAction={board.canEdit ? reviewPinsAction.bind(null, id, fileId) : undefined}
        />
      </div>
    </div>
  );
}
