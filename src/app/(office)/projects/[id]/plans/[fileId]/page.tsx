import Link from "next/link";
import { notFound } from "next/navigation";
import { placePinAction, reviewPinsAction, saveMarkupAction } from "@/app/actions";
import { MarkupStage } from "@/components/markup-stage";
import { TakeoffStage } from "@/components/takeoff-stage";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { emptyMarkupLayer } from "@/lib/markup/layer";
import { planBoard } from "@/lib/services/markup";
import { takeoffBoard } from "@/lib/services/takeoff";

export const dynamic = "force-dynamic";

export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; fileId: string }>;
  searchParams: Promise<{ takeoff?: string; estimate?: string }>;
}) {
  const { id, fileId } = await params;
  const query = await searchParams;
  const takeoffOn = query.takeoff === "1";
  const session = await requireSession();
  const board = planBoard(session, id, fileId);
  if (!board) notFound();
  const takeoff = takeoffOn ? takeoffBoard(session, id, fileId) : null;
  if (takeoffOn && !takeoff) notFound();
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <Toolbar
        title={board.name}
        subtitle={takeoff ? `Rev ${board.revision} · ${takeoff.scaleText}` : `Rev ${board.revision}`}
        search={false}
        leading={
          <Link href={`/projects/${id}/files`} className="mac-t13 text-[var(--mac-accent)]">
            ‹ Files
          </Link>
        }
        trailing={
          <>
            {takeoff ? (
              <Link href={`/projects/${id}/plans/${fileId}`} className="mac-glass-btn">
                Markup
              </Link>
            ) : (
              <Link href={`/projects/${id}/plans/${fileId}?takeoff=1`} className="mac-glass-btn">
                Takeoff
              </Link>
            )}
            {board.readOnly ? <span className="fl-pill">Superseded</span> : !takeoff && board.markup ? <span className="fl-pill">Marked up</span> : null}
            {!takeoff && !board.readOnly && board.canEdit ? (
              <button type="submit" form="markup-save" className="mac-primary">
                Save
              </button>
            ) : null}
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4">
        {!takeoff && board.markup ? (
          <p className="mac-t11 text-[var(--mac-secondary)]">
            {board.markup.author} · {formatDateTime(board.markup.at)}
          </p>
        ) : null}
        {takeoff ? (
          <TakeoffStage
            key={`${takeoff.scaleText}:${takeoff.unreviewed}:${takeoff.sheets.map((sheet) => sheet.rows.map((row) => `${row.id}:${row.qtyMilli}:${row.points.length}:${row.reviewed}`).join(",")).join("|")}`}
            board={takeoff}
            estimateId={query.estimate ?? null}
          />
        ) : (
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
        )}
      </div>
    </div>
  );
}
