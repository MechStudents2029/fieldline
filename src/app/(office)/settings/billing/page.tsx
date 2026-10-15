import Link from "next/link";
import { notFound } from "next/navigation";
import { saveLatePolicyAction } from "@/app/(office)/fees/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { billingPolicy } from "@/lib/services/late-fees";

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export default async function BillingSettingsPage() {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) notFound();
  const board = billingPolicy(session);
  const { policy, line } = board;
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Billing" subtitle={policy.enabled ? "On" : "Off"} search={false} leading={<Link href="/settings">‹</Link>} />
      </div>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4">
        <h1 className="fl-large-title md:hidden">Billing</h1>
        {line ? (
          <p className="num" data-late-policy>
            {line}
          </p>
        ) : (
          <p className="num" data-late-policy>
            Off
          </p>
        )}
        {board.canEdit ? (
          <ActionForm action={saveLatePolicyAction} className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" value="1" defaultChecked={policy.enabled} />
              On
            </label>
            <label className="text-sm">
              Flat
              <input name="flat" aria-label="Flat" inputMode="decimal" defaultValue={dollars(policy.flatCents)} className="field mt-1" />
            </label>
            <label className="text-sm">
              Monthly %
              <input name="percent" aria-label="Monthly %" inputMode="decimal" defaultValue={(policy.monthlyBps / 100).toFixed(2)} className="field mt-1" />
            </label>
            <label className="text-sm">
              Grace days
              <input name="grace" aria-label="Grace days" type="number" min={0} max={90} defaultValue={policy.graceDays} className="field mt-1 w-24" />
            </label>
            <label className="text-sm">
              Minimum
              <input name="minimum" aria-label="Minimum" inputMode="decimal" defaultValue={dollars(policy.minimumCents)} className="field mt-1" />
            </label>
            <label className="text-sm">
              Cap
              <input name="cap" aria-label="Cap" inputMode="decimal" defaultValue={dollars(policy.capCents)} className="field mt-1" />
            </label>
            <label className="text-sm">
              Mode
              <select name="mode" aria-label="Mode" className="field mt-1" defaultValue={policy.mode}>
                <option value="review">Review first</option>
                <option value="apply">Apply</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="excludeRetainage" value="1" defaultChecked={policy.excludeRetainage} />
              Skip retainage
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="excludeDraws" value="1" defaultChecked={policy.excludeDraws} />
              Skip draws
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="excludeAgreements" value="1" defaultChecked={policy.excludeAgreements} />
              Skip agreements
            </label>
            <button type="submit" className="ctl h-9">
              Save
            </button>
          </ActionForm>
        ) : (
          <p className="num">
            {policy.enabled ? "On" : "Off"} · {formatMoney(policy.flatCents)} · {(policy.monthlyBps / 100).toFixed(2)}% · {policy.graceDays}
          </p>
        )}
      </div>
    </div>
  );
}
