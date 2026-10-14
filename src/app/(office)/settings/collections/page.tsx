import Link from "next/link";
import { saveCollectSettingsAction } from "@/app/(office)/settings/collections/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { collectSettings } from "@/lib/services/collections";

export default async function CollectSettingsPage() {
  const session = await requireSession();
  const board = collectSettings(session);
  if (!board) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-2 px-6">
        <h1 className="font-heading text-3xl">Collections</h1>
        <p className="text-sm">Only an owner or admin can change collections.</p>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar title="Collections" subtitle={board.enabled ? "On" : "Off"} search={false} leading={<Link href="/settings">Settings</Link>} />
      <div className="flex flex-col gap-6 overflow-auto px-4 pb-10 md:px-6">
        <ActionForm action={saveCollectSettingsAction} className="flex max-w-xl flex-col gap-3">
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="enabled" defaultChecked={board.enabled} />
            On
          </label>
          <label className="text-[13px]">
            First reminder
            <input name="first" aria-label="First reminder" type="number" min={1} max={90} defaultValue={board.first} className="field mt-1" />
          </label>
          <label className="text-[13px]">
            Second reminder
            <input name="second" aria-label="Second reminder" type="number" min={0} max={90} defaultValue={board.second} className="field mt-1" />
          </label>
          <label className="text-[13px]">
            Exclude tags
            <input name="exclude" aria-label="Exclude tags" defaultValue={board.exclude} className="field mt-1" />
          </label>
          <label className="text-[13px]">
            Message
            <textarea name="template" aria-label="Message" defaultValue={board.template} className="field mt-1" rows={3} />
          </label>
          <button type="submit" className="mac-primary w-fit">
            Save
          </button>
        </ActionForm>
      </div>
    </div>
  );
}
