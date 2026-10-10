import Link from "next/link";
import { notFound } from "next/navigation";
import { saveMarkupAction } from "@/app/actions";
import { MarkupStage } from "@/components/markup-stage";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { emptyMarkupLayer } from "@/lib/markup/layer";
import { photoBoard } from "@/lib/services/markup";

export const dynamic = "force-dynamic";

export default async function PhotoMarkupPage({ params }: { params: Promise<{ id: string; documentId: string }> }) {
  const { id, documentId } = await params;
  const session = await requireSession();
  const board = photoBoard(session, id, documentId);
  if (!board) notFound();
  const save = saveMarkupAction.bind(null, id, "photo", documentId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title={board.name}
        subtitle={board.projectName}
        search={false}
        leading={
          <Link href={`/projects/${id}`} className="mac-t13 text-[var(--mac-accent)]">
            ‹ {board.projectName}
          </Link>
        }
        trailing={board.markup ? <span className="fl-pill">Marked up</span> : null}
      />
      <div className="flex flex-col gap-3 px-4 pb-8">
        {board.markup ? (
          <p className="mac-t11 text-[var(--mac-secondary)]">
            {board.markup.author} · {formatDateTime(board.markup.at)}
          </p>
        ) : null}
        <MarkupStage
          mode="photo"
          src={board.href}
          kind="image"
          title={board.name}
          initial={board.markup?.layer ?? emptyMarkupLayer()}
          readOnly={!board.canEdit}
          saveAction={board.canEdit ? save : undefined}
        />
      </div>
    </div>
  );
}
