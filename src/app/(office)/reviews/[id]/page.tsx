import Link from "next/link";
import { notFound } from "next/navigation";
import { markReviewAction, saveReviewTagsAction } from "@/app/(office)/reviews/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { ReviewCopy } from "@/components/review-copy";
import { requireSession } from "@/lib/auth/session";
import { reviewDetail } from "@/lib/services/reviews";

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const row = reviewDetail(session, id);
  if (!row) notFound();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar title={row.job} subtitle={row.statusLabel} search={false} leading={<Link href="/reviews">Reviews</Link>} />
      <div className="flex flex-col gap-6 overflow-auto px-4 pb-10 md:px-6">
        <p className="text-[13px]">
          {row.client} · <span className="fl-pill">{row.statusLabel}</span>
        </p>
        <ReviewCopy id={row.id} url={row.url} message={row.message} canCopy={row.canEdit} />
        {row.skipReason ? <p className="text-[13px]">{row.skipReason}</p> : null}
        {row.canEdit ? (
          <>
            <ActionForm action={markReviewAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="action" value="sent" />
              <button type="submit" className="mac-glass-btn">
                Mark sent
              </button>
            </ActionForm>
            <ActionForm action={markReviewAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="action" value="skip" />
              <label className="text-[13px]">
                Reason
                <input name="reason" aria-label="Skip reason" className="field mt-1" />
              </label>
              <button type="submit" className="mac-glass-btn">
                Skip
              </button>
            </ActionForm>
            <ActionForm action={markReviewAction}>
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="action" value="decline" />
              <button type="submit" className="mac-glass-btn">
                Void
              </button>
            </ActionForm>
            <ActionForm action={saveReviewTagsAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={row.id} />
              <label className="text-[13px]">
                Job tags
                <input name="tags" aria-label="Job tags" defaultValue={row.tags} className="field mt-1" />
              </label>
              <button type="submit" className="mac-glass-btn">
                Save
              </button>
            </ActionForm>
          </>
        ) : null}
      </div>
    </div>
  );
}
