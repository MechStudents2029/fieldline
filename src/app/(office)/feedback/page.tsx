import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { canManageSettings } from "@/lib/permissions";
import { listTesterFeedback } from "@/lib/services/read";

export default async function FeedbackPage() {
  const session = await requireSession();
  const allowed = canManageSettings(session.role);
  const notes = allowed ? listTesterFeedback(session.orgId) : [];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-3xl">Feedback</h1>
        <p className="text-sm text-muted-foreground">
          Notes testers save from Send feedback. They stay in this company. Nothing is emailed.
        </p>
      </div>
      {allowed ? null : (
        <p className="text-sm text-muted-foreground">An owner or admin can read these notes. You can still send one from the header.</p>
      )}
      {allowed && notes.length === 0 ? (
        <EmptyState
          title="No tester notes yet"
          why="Notes you save with Send feedback show up here for an owner or admin. Nothing is emailed. This company has none yet."
        >
          <FeedbackDialog />
        </EmptyState>
      ) : null}
      <ul className="flex flex-col gap-3">
        {notes.map((note) => (
          <li key={note.id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <p className="text-xs text-muted-foreground">
              {note.author || "Someone"} · {formatDateTime(note.createdAt)}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{note.body}</p>
            {note.context ? <p className="mt-2 text-sm text-muted-foreground">{note.context}</p> : null}
            <p className="mt-2 text-xs">
              <Link href={note.path} className="underline">
                {note.path}
              </Link>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
