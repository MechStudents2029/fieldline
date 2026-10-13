import Link from "next/link";
import { saveReviewSettingsAction } from "@/app/(office)/settings/reviews/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { reviewSettings } from "@/lib/services/reviews";

export default async function ReviewSettingsPage() {
  const session = await requireSession();
  const board = reviewSettings(session);
  if (!board) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-2 px-6">
        <h1 className="font-heading text-3xl">Reviews</h1>
        <p className="text-sm">Only an owner or admin can change reviews.</p>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar title="Reviews" subtitle={board.enabled ? "On" : "Off"} search={false} leading={<Link href="/settings">Settings</Link>} />
      <div className="flex flex-col gap-6 overflow-auto px-4 pb-10 md:px-6">
        <ActionForm action={saveReviewSettingsAction} className="flex max-w-xl flex-col gap-3">
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="enabled" defaultChecked={board.enabled} />
            On
          </label>
          <label className="text-[13px]">
            Timing
            <select name="timing" aria-label="Timing" defaultValue={board.timing} className="field mt-1">
              <option value="complete">Job completed</option>
              <option value="paid">Job fully paid</option>
            </select>
          </label>
          <label className="text-[13px]">
            Google
            <input name="google" aria-label="Google review URL" defaultValue={board.google} className="field mt-1" />
          </label>
          <label className="text-[13px]">
            Facebook
            <input name="facebook" aria-label="Facebook review URL" defaultValue={board.facebook} className="field mt-1" />
          </label>
          <label className="text-[13px]">
            Website
            <input name="website" aria-label="Website review URL" defaultValue={board.website} className="field mt-1" />
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
