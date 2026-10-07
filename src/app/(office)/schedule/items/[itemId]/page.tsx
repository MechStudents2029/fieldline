import Link from "next/link";
import { CommentThread } from "@/components/comment-thread";
import { ScheduleShiftForm } from "@/components/schedule-shift-form";
import { MissingRecord } from "@/components/missing-record";
import { requireSession } from "@/lib/auth/session";
import { recordHeading } from "@/lib/services/comments";
import { scheduleItemBrief } from "@/lib/services/schedule";

export default async function ScheduleItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const session = await requireSession();
  const heading = recordHeading(session, "schedule_item", itemId);
  const brief = scheduleItemBrief(session, itemId);
  if (!heading || !brief) return <MissingRecord orgName={session.orgName} kind="schedule item" />;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <Link href="/schedule" className="text-sm text-[var(--fl-accent)]">
        ‹ Schedule
      </Link>
      <h1 className="fl-title">{heading.title}</h1>
      <p className="mac-t13 text-[var(--mac-secondary)]">{heading.job}</p>
      {brief.canEdit ? <ScheduleShiftForm itemId={brief.id} startDate={brief.startDate} endDate={brief.endDate} /> : null}
      <CommentThread entityType="schedule_item" entityId={itemId} />
    </div>
  );
}
