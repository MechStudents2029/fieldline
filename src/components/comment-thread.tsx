import Link from "next/link";
import { deleteCommentAction, editCommentAction, postCommentAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CommentComposer } from "@/components/comment-composer";
import { requireSession } from "@/lib/auth/session";
import { commentThread } from "@/lib/services/comments";

export async function CommentThread({ entityType, entityId, projectId }: { entityType: string; entityId: string; projectId?: string }) {
  const session = await requireSession();
  const thread = commentThread(session, entityType, entityId);
  if (!thread) return null;
  return (
    <section id="comments" aria-label="Comments" className="mb-6 flex flex-col gap-2">
      <h2 className="mac-t13 font-semibold">Comments</h2>
      <ul className="flex flex-col gap-3">
        {thread.comments.map((comment) => (
          <li key={comment.id} id={`comment-${comment.id}`} className="border-b border-[var(--mac-separator)] pb-3">
            <p className="mac-t11 text-[var(--mac-secondary)]">
              {comment.author} · <span className="num">{comment.age}</span>
              {comment.edited ? " · Edited" : ""}
            </p>
            <p className="mac-t13 whitespace-pre-wrap">
              {comment.parts.map((part, index) =>
                part.kind === "pill" ? (
                  <span key={index} className="mention-pill" data-mention={part.text}>
                    {part.text}
                  </span>
                ) : (
                  <span key={index}>{part.text}</span>
                ),
              )}
            </p>
            {comment.files.map((file) => (
              <span key={file.id} className="flex items-center gap-2">
                <a className="mac-t13 text-[var(--mac-accent)]" href={`/api/files/${file.id}`}>
                  {file.filename}
                </a>
                {projectId ? (
                  <Link href={`/projects/${projectId}/markup/${file.id}`} className="mac-t13 text-[var(--mac-accent)]">
                    Mark up
                  </Link>
                ) : null}
              </span>
            ))}
            {comment.canEdit ? (
              <details className="mt-1">
                <summary className="mac-t13 text-[var(--mac-accent)]">Edit</summary>
                <ActionForm action={editCommentAction.bind(null, comment.id)} className="mt-2 grid gap-2">
                  <textarea name="body" aria-label={`Edit ${comment.author}`} defaultValue={comment.plain} rows={2} className="field" />
                  <button type="submit" className="mac-primary w-fit">
                    Save
                  </button>
                </ActionForm>
              </details>
            ) : null}
            {comment.canDelete ? (
              <ActionForm action={deleteCommentAction.bind(null, comment.id)} className="mt-1">
                <button type="submit" className="mac-t13 text-[var(--mac-secondary)]">
                  Delete
                </button>
              </ActionForm>
            ) : null}
          </li>
        ))}
      </ul>
      {thread.canPost ? <CommentComposer action={postCommentAction.bind(null, entityType, entityId)} people={thread.people} /> : null}
    </section>
  );
}
