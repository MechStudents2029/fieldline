import Link from "next/link";
import { CommentThread } from "@/components/comment-thread";
import { MissingRecord } from "@/components/missing-record";
import { requireSession } from "@/lib/auth/session";
import { canSeeMoney } from "@/lib/permissions";
import { recordHeading } from "@/lib/services/comments";

export default async function ChangeOrderPage({ params }: { params: Promise<{ id: string; orderId: string }> }) {
  const { id, orderId } = await params;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) return <h1 className="fl-large-title">Change order</h1>;
  const heading = recordHeading(session, "change_order", orderId);
  if (!heading || heading.projectId !== id) return <MissingRecord orgName={session.orgName} kind="change order" />;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <Link href={`/projects/${id}`} className="text-sm text-[var(--fl-accent)]">
        ‹ {heading.job}
      </Link>
      <h1 className="fl-title">{heading.title}</h1>
      <p className="mac-t13 text-[var(--mac-secondary)]">{heading.job}</p>
      <CommentThread entityType="change_order" entityId={orderId} />
    </div>
  );
}
