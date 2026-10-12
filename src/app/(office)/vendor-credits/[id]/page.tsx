import Link from "next/link";
import { issueCreditAction, voidCreditAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CommentThread } from "@/components/comment-thread";
import { DetailFacts, DetailHeader } from "@/components/detail-header";
import { MissingRecord } from "@/components/missing-record";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { canManageMoney, canSeeMoney } from "@/lib/permissions";
import { vendorCreditDetail } from "@/lib/services/vendor-credits";

export default async function VendorCreditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const credit = vendorCreditDetail(session, id);
  if (!credit) return <MissingRecord orgName={session.orgName} kind="credit" />;
  const office = canManageMoney(session.role);
  const seeMoney = canSeeMoney(session.role);
  return (
    <div className="flex flex-col gap-4 pb-6">
      <DetailHeader
        title={credit.number}
        status={credit.statusLabel}
        meta={
          <>
            {credit.vendorName} · <Link href={`/projects/${credit.projectId}`}>{credit.projectName}</Link>
          </>
        }
      />
      <DetailFacts
        label="Credit"
        rows={[
          { label: "Reason", value: credit.reason },
          ...(seeMoney ? [{ label: "Amount", value: <span className="num">{formatMoney(credit.amountCents)}</span> }] : []),
          ...(seeMoney && credit.appliedCents ? [{ label: "Applied", value: <span className="num">{formatMoney(credit.appliedCents)}</span> }] : []),
          ...(seeMoney ? [{ label: "Remaining", value: <span className="num">{formatMoney(credit.remainingCents)}</span> }] : []),
          ...(credit.costCode ? [{ label: "Cost code", value: credit.costCode }] : []),
          ...(credit.disputeNote ? [{ label: "Dispute", value: credit.disputeNote }] : []),
          ...(credit.voidReason ? [{ label: "Void", value: credit.voidReason }] : []),
          ...(credit.purchaseOrderId ? [{ label: "Order", value: <Link href={`/purchase-orders/${credit.purchaseOrderId}`}>Purchase order</Link> }] : []),
        ]}
      />
      {credit.documentId ? (
        <p className="px-4">
          <a href={`/api/files/${credit.documentId}`}>Photo</a>
        </p>
      ) : null}
      {seeMoney && credit.applications.length ? (
        <section className="px-4" aria-label="Applications">
          <h2 className="mac-t13 text-[var(--mac-secondary)]">Applied</h2>
          <ul>
            {credit.applications.map((row) => (
              <li key={row.id} className="mac-t13">
                <Link href={`/bills/${row.billId}`}>{row.billNumber}</Link> · <span className="num">{formatMoney(row.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {office && credit.status === "draft" ? (
        <ActionForm action={issueCreditAction.bind(null, credit.id)} className="flex flex-wrap items-end gap-2 px-4">
          <label className="text-sm">
            Amount
            <input name="amount" aria-label="Amount" inputMode="decimal" className="field mt-1" required />
          </label>
          <button type="submit" className="mac-primary">
            Issue
          </button>
        </ActionForm>
      ) : null}
      {office && credit.status !== "void" && credit.appliedCents === 0 ? (
        <ActionForm action={voidCreditAction.bind(null, credit.id)} className="flex flex-wrap items-end gap-2 px-4">
          <input name="reason" aria-label="Void reason" placeholder="Reason" className="ctl" required />
          <button type="submit" className="ctl">
            Void
          </button>
        </ActionForm>
      ) : null}
      <div className="max-w-md px-4">
        <CommentThread entityType="vendor_credit" entityId={credit.id} />
      </div>
    </div>
  );
}
