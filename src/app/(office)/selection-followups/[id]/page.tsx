import Link from "next/link";
import { notFound } from "next/navigation";
import { markSelectionFollowUpAction, saveSelectionFollowTagsAction } from "@/app/(office)/selection-followups/actions";
import { ActionForm } from "@/components/action-form";
import { SelectionFollowCopy } from "@/components/selection-follow-copy";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { selectionFollowDetail } from "@/lib/services/selection-followups";

export default async function SelectionFollowUpDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const row = selectionFollowDetail(session, id);
  if (!row) notFound();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar title={row.selection} subtitle={row.statusLabel} search={false} leading={<Link href="/selection-followups">Selection follow-ups</Link>} />
      <div className="flex flex-col gap-6 overflow-auto px-4 pb-10 md:px-6">
        <p className="text-[13px]">
          {row.client} · {row.due} · {row.cadence}d · <span className="fl-pill">{row.statusLabel}</span>
        </p>
        <SelectionFollowCopy id={row.id} url={row.url} message={row.message} canCopy={row.canEdit} />
        {row.skipReason ? <p className="text-[13px]">{row.skipReason}</p> : null}
        {row.canEdit ? (
          <>
            <ActionForm action={markSelectionFollowUpAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="action" value="sent" />
              <button type="submit" className="mac-glass-btn">
                Mark sent
              </button>
            </ActionForm>
            <ActionForm action={markSelectionFollowUpAction} className="flex flex-wrap items-end gap-2">
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
            <ActionForm action={markSelectionFollowUpAction}>
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="action" value="void" />
              <button type="submit" className="mac-glass-btn">
                Void
              </button>
            </ActionForm>
            <ActionForm action={saveSelectionFollowTagsAction} className="flex flex-wrap items-end gap-2">
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
