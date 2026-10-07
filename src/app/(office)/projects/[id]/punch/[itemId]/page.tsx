import Link from "next/link";
import { CommentThread } from "@/components/comment-thread";
import { MissingRecord } from "@/components/missing-record";
import { requireSession } from "@/lib/auth/session";
import { recordHeading } from "@/lib/services/comments";

export default async function PunchItemPage({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const session = await requireSession();
  const heading = recordHeading(session, "punch_item", itemId);
  if (!heading || heading.projectId !== id) return <MissingRecord orgName={session.orgName} kind="punch item" />;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <Link href={`/projects/${id}#punch`} className="text-sm text-[var(--fl-accent)]">
        ‹ {heading.job}
      </Link>
      <h1 className="fl-title">{heading.title}</h1>
      <CommentThread entityType="punch_item" entityId={itemId} />
    </div>
  );
}
