import Link from "next/link";
import { notFound } from "next/navigation";
import {
  approvePayApplicationAction,
  markPayRequestedAction,
  reviewPayApplicationAction,
  revisePayApplicationAction,
  savePayApplicationAction,
  submitPayApplicationAction,
  voidPayApplicationAction,
} from "@/app/(office)/pay-applications/actions";
import { ActionForm } from "@/components/action-form";
import { CopyPayLink } from "@/components/copy-pay-link";
import { requireSession } from "@/lib/auth/session";
import { formatPercent, formatWhole } from "@/lib/money";
import { canManageMoney } from "@/lib/permissions";
import { payApplicationDetail } from "@/lib/services/pay-applications";

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

function percent(bps: number) {
  return (bps / 100).toFixed(1);
}

export default async function PayApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (session.role === "field") notFound();
  const detail = payApplicationDetail(session, id);
  if (!detail) notFound();
  const office = canManageMoney(session.role);
  return (
    <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="fl-large-title">
          {detail.poNumber} {detail.number}
        </h1>
        <span className="fl-pill" data-status={detail.status}>
          {detail.statusLabel}
        </span>
        <span className="num text-sm text-[var(--mac-secondary)]">{detail.version}</span>
      </div>
      <p className="text-sm">
        {detail.job} · {detail.vendor} · <span className="num">{detail.periodStart}</span> – <span className="num">{detail.periodEnd}</span>
      </p>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href={`/pay-applications/${detail.id}/print`} className="text-[var(--mac-accent)]">
          Print
        </Link>
        <Link href={`/purchase-orders/${detail.purchaseOrderId}`} className="text-[var(--mac-accent)]">
          {detail.poNumber}
        </Link>
        {detail.billId ? (
          <Link href={`/bills/${detail.billId}`} className="text-[var(--mac-accent)]" data-bill={detail.billNumber ?? ""}>
            {detail.billNumber}
          </Link>
        ) : null}
        {office && detail.portalUrl ? <CopyPayLink applicationId={detail.id} url={detail.portalUrl} /> : null}
        {office ? (
          <ActionForm action={markPayRequestedAction.bind(null, detail.id)}>
            <button type="submit" className="mac-glass-btn">
              Mark requested
            </button>
          </ActionForm>
        ) : null}
      </div>
      <table aria-label="Schedule of values" className="w-full text-left text-sm">
        <thead>
          <tr className="text-[var(--mac-secondary)]">
            <th className="py-2 pr-2 font-medium">Code</th>
            <th className="py-2 pr-2 text-right font-medium">Scheduled</th>
            <th className="py-2 pr-2 text-right font-medium">Previous</th>
            <th className="py-2 pr-2 text-right font-medium">This period</th>
            <th className="py-2 pr-2 text-right font-medium">Stored</th>
            <th className="py-2 pr-2 text-right font-medium">Total</th>
            <th className="py-2 pr-2 text-right font-medium">%</th>
            <th className="py-2 pr-2 text-right font-medium">Balance</th>
            <th className="py-2 pr-2 text-right font-medium">Retainage</th>
            <th className="py-2 pr-2 text-right font-medium">Released</th>
            <th className="py-2 text-right font-medium">Held</th>
          </tr>
        </thead>
        <tbody>
          {detail.lines.map((line) => (
            <tr key={line.id} className="border-t border-[var(--mac-separator)]" data-line={line.costCode}>
              <td className="py-2 pr-2">
                {line.costCode}
                {line.description ? <span className="block text-[var(--mac-secondary)]">{line.description}</span> : null}
                {line.rejectNote ? <span className="block">{line.rejectNote}</span> : null}
              </td>
              <td className="py-2 pr-2 text-right num">{formatWhole(line.scheduledCents)}</td>
              <td className="py-2 pr-2 text-right num" data-previous={line.previousCents}>
                {formatWhole(line.previousCents)}
              </td>
              <td className="py-2 pr-2 text-right num">{formatWhole(line.thisPeriodCents)}</td>
              <td className="py-2 pr-2 text-right num">{formatWhole(line.storedCents)}</td>
              <td className="py-2 pr-2 text-right num">{formatWhole(line.completedCents)}</td>
              <td className="py-2 pr-2 text-right num">{formatPercent(line.percentBps)}</td>
              <td className="py-2 pr-2 text-right num">{formatWhole(line.balanceCents)}</td>
              <td className="py-2 pr-2 text-right num">{formatWhole(line.retainageCents)}</td>
              <td className="py-2 pr-2 text-right num">{formatWhole(line.releasedCents)}</td>
              <td className="py-2 text-right num">{formatWhole(line.heldCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--mac-separator)]">
            <td className="py-2 pr-2 num">{detail.lines.length}</td>
            <td />
            <td />
            <td className="py-2 pr-2 text-right num">{formatWhole(detail.totals.grossCents)}</td>
            <td />
            <td />
            <td />
            <td />
            <td className="py-2 pr-2 text-right num">{formatWhole(detail.totals.retainageCents)}</td>
            <td className="py-2 pr-2 text-right num">{formatWhole(detail.totals.releasedCents)}</td>
            <td className="py-2 text-right num">{formatWhole(detail.totals.netCents)}</td>
          </tr>
        </tfoot>
      </table>
      {office && detail.canAmounts ? (
        <ActionForm action={savePayApplicationAction.bind(null, detail.id)} className="flex flex-col gap-3">
          {detail.lines.map((line) => (
            <div key={line.id} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="lineId" value={line.purchaseOrderLineId} />
              <span className="w-24 text-sm">{line.costCode}</span>
              <label className="text-sm">
                This period
                <input name={`this_${line.purchaseOrderLineId}`} aria-label={`This period ${line.costCode}`} defaultValue={dollars(line.thisPeriodCents)} className="field w-28" />
              </label>
              <label className="text-sm">
                Stored
                <input name={`stored_${line.purchaseOrderLineId}`} aria-label={`Stored ${line.costCode}`} defaultValue={dollars(line.storedCents)} className="field w-28" />
              </label>
              <label className="text-sm">
                Released
                <input name={`released_${line.purchaseOrderLineId}`} aria-label={`Released ${line.costCode}`} defaultValue={dollars(line.releasedCents)} className="field w-28" />
              </label>
              <label className="text-sm">
                Retainage %
                <input name={`bps_${line.purchaseOrderLineId}`} aria-label={`Retainage ${line.costCode}`} defaultValue={percent(line.retainageBps)} className="field w-24" />
              </label>
            </div>
          ))}
          <button type="submit" className="mac-glass-btn w-fit">
            Save
          </button>
        </ActionForm>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {office && (detail.status === "draft" || detail.status === "revise") ? (
          <ActionForm action={submitPayApplicationAction.bind(null, detail.id)}>
            <button type="submit" className="mac-glass-btn">
              Submit
            </button>
          </ActionForm>
        ) : null}
        {office && detail.status === "submitted" ? (
          <ActionForm action={reviewPayApplicationAction.bind(null, detail.id)}>
            <button type="submit" className="mac-glass-btn">
              Under review
            </button>
          </ActionForm>
        ) : null}
        {office && detail.status === "under_review" ? (
          <ActionForm action={approvePayApplicationAction.bind(null, detail.id)}>
            <button type="submit" className="mac-glass-btn">
              Approve
            </button>
          </ActionForm>
        ) : null}
      </div>
      {office && detail.status === "under_review" ? (
        <ActionForm action={revisePayApplicationAction.bind(null, detail.id)} className="flex flex-col gap-2">
          {detail.lines.map((line) => (
            <label key={line.id} className="text-sm">
              {line.costCode}
              <input type="hidden" name="lineId" value={line.purchaseOrderLineId} />
              <input name={`note_${line.purchaseOrderLineId}`} aria-label={`Note ${line.costCode}`} defaultValue={line.rejectNote} className="field" />
            </label>
          ))}
          <button type="submit" className="mac-glass-btn w-fit">
            Revise & resubmit
          </button>
        </ActionForm>
      ) : null}
      {office && detail.status !== "void" ? (
        <ActionForm action={voidPayApplicationAction.bind(null, detail.id)} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Reason
            <input name="reason" aria-label="Reason" required className="field" />
          </label>
          <button type="submit" className="mac-glass-btn">
            Void
          </button>
        </ActionForm>
      ) : null}
      {detail.versions.length > 0 ? (
        <p className="num text-sm text-[var(--mac-secondary)]">{detail.versions.map((row) => row.version).join(" ")}</p>
      ) : null}
    </div>
  );
}
