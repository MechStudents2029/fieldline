import Link from "next/link";
import { CommentThread } from "@/components/comment-thread";
import { MarkedPhoto } from "@/components/marked-photo";
import { MissingRecord } from "@/components/missing-record";
import { requireSession } from "@/lib/auth/session";
import { recordHeading } from "@/lib/services/comments";
import { recordVisual } from "@/lib/services/markup";

export default async function PunchItemPage({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const session = await requireSession();
  const heading = recordHeading(session, "punch_item", itemId);
  if (!heading || heading.projectId !== id) return <MissingRecord orgName={session.orgName} kind="punch item" />;
  const visual = recordVisual(session, id, "punch", itemId);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <Link href={`/projects/${id}#punch`} className="text-sm text-[var(--fl-accent)]">
        ‹ {heading.job}
      </Link>
      <h1 className="fl-title">{heading.title}</h1>
      {visual.cropHref ? (
        <figure className="flex w-40 flex-col gap-1">
          <img src={visual.cropHref} alt="" className="h-28 w-40 rounded-lg object-cover" data-plan-crop={visual.pinNumber ?? ""} />
          {visual.planHref ? (
            <Link href={visual.planHref} className="mac-t11 text-[var(--mac-accent)]">
              Pin {visual.pinNumber}
            </Link>
          ) : null}
        </figure>
      ) : null}
      {visual.marked && visual.flatHref && visual.sourceHref ? <MarkedPhoto markedSrc={visual.flatHref} originalSrc={visual.sourceHref} alt={heading.title} /> : null}
      {visual.photoDocumentId ? (
        <Link href={`/projects/${id}/markup/${visual.photoDocumentId}`} className="ctl w-fit">
          Mark up
        </Link>
      ) : null}
      <CommentThread entityType="punch_item" entityId={itemId} projectId={id} />
    </div>
  );
}
