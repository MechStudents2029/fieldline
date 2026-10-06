import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
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
        <h1 className="fl-large-title">Feedback</h1>
      </div>
      {allowed ? null : (
        <p className="text-sm text-muted-foreground">An owner or admin can read these notes. You can still send one from the header.</p>
      )}
      {allowed && notes.length === 0 ? (
        <EmptyState title="No notes yet" why="Send one from the header." />
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
