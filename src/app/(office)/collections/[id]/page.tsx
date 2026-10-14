import Link from "next/link";
import { notFound } from "next/navigation";
import { markFollowUpAction, saveFollowUpTagsAction } from "@/app/(office)/collections/actions";
import { ActionForm } from "@/components/action-form";
import { CollectCopy } from "@/components/collect-copy";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { followUpDetail } from "@/lib/services/collections";

export default async function FollowUpDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const row = followUpDetail(session, id);
  if (!row) notFound();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar title={row.invoice} subtitle={row.statusLabel} search={false} leading={<Link href="/collections">Collections</Link>} />
      <div className="flex flex-col gap-6 overflow-auto px-4 pb-10 md:px-6">
        <p className="text-[13px]">
          {row.client} · {row.amount} · {row.cadence}d · <span className="fl-pill">{row.statusLabel}</span>
        </p>
        <CollectCopy id={row.id} url={row.url} message={row.message} canCopy={row.canEdit} />
        {row.skipReason ? <p className="text-[13px]">{row.skipReason}</p> : null}
        {row.canEdit ? (
          <>
            <ActionForm action={markFollowUpAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="action" value="sent" />
              <button type="submit" className="mac-glass-btn">
                Mark sent
              </button>
            </ActionForm>
            <ActionForm action={markFollowUpAction} className="flex flex-wrap items-end gap-2">
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
            <ActionForm action={markFollowUpAction}>
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="action" value="void" />
              <button type="submit" className="mac-glass-btn">
                Void
              </button>
            </ActionForm>
            <ActionForm action={saveFollowUpTagsAction} className="flex flex-wrap items-end gap-2">
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
