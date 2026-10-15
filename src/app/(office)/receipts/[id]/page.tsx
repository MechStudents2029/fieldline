import Link from "next/link";
import { notFound } from "next/navigation";
import { codeCostReceiptAction, postCostReceiptAction, rejectCostReceiptAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { ReceiptFrame } from "@/components/receipt-frame";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { costReceiptDetail, listCostReceipts, receiptJobs, receiptOptions } from "@/lib/services/cost-receipts";
import { ServiceError } from "@/lib/services/errors";

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  let receipt: ReturnType<typeof costReceiptDetail>;
  try {
    receipt = costReceiptDetail(session, id);
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
  const rows = listCostReceipts(session, receipt.status);
  const jobs = receipt.canCode ? receiptJobs(session.orgId) : [];
  const options = receipt.canCode ? receiptOptions(session) : { vendors: [], orders: [] };
  const dollars = (receipt.amountCents / 100).toFixed(2);
  const open = receipt.status === "new" || receipt.status === "coded";
  return (
    <ReceiptFrame title="Receipts" status={receipt.status} rows={rows}>
      <article className="flex flex-col gap-4" data-receipt-detail={receipt.id} data-status={receipt.status}>
        <Link href={`/receipts?status=${receipt.status}`} className="text-sm md:hidden">
          Receipts
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="fl-title">{receipt.vendorName}</h1>
          <span className="num">{formatMoney(receipt.amountCents)}</span>
          <span className="fl-pill">{receipt.statusLabel}</span>
          <span className="fl-pill">{receipt.payLabel}</span>
          {receipt.duplicateId ? (
            <Link href={`/receipts/${receipt.duplicateId}`} className="fl-pill" data-duplicate={receipt.duplicateId}>
              Duplicate
            </Link>
          ) : null}
        </div>
        <p className="text-sm text-[var(--fl-secondary)]">
          {[receipt.projectName, receipt.purchasedOn, receipt.submitterName].filter(Boolean).join(" · ")}
        </p>
        {receipt.note ? <p className="text-sm">{receipt.note}</p> : null}
        {receipt.rejectNote ? (
          <p className="text-sm" data-reject-note>
            {receipt.rejectNote}
          </p>
        ) : null}
        {receipt.reimbursedAt ? (
          <p className="text-sm">
            <span className="fl-pill">Reimbursed</span> <span className="num">{receipt.reimbursedAt.slice(0, 10)}</span>
            {receipt.reimbursedByName ? ` · ${receipt.reimbursedByName}` : ""}
          </p>
        ) : null}
        {receipt.billId ? (
          <Link href={`/bills/${receipt.billId}`} className="text-sm">
            Bill
          </Link>
        ) : null}
        {receipt.splits.length > 0 ? (
          <ul className="fl-group">
            {receipt.splits.map((split) => (
              <li key={split.id} className="fl-cell">
                <span className="flex-1">{split.costCode}</span>
                <span className="num">{formatMoney(split.amountCents)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {receipt.canCode && open ? (
          <ActionForm action={codeCostReceiptAction.bind(null, receipt.id)} className="grid gap-2">
            <label className="text-sm">
              Job
              <select name="projectId" aria-label="Job" className="field mt-1" defaultValue={receipt.projectId ?? ""} required>
                <option value="">Job</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Store
              <input name="vendor" aria-label="Store" defaultValue={receipt.vendorName} className="field mt-1" required />
            </label>
            <label className="text-sm">
              Date
              <input name="purchasedOn" aria-label="Date" type="date" defaultValue={receipt.purchasedOn ?? ""} className="field mt-1" required />
            </label>
            <label className="text-sm">
              Total
              <input name="amount" aria-label="Total" defaultValue={dollars} inputMode="decimal" className="field mt-1" required />
            </label>
            <label className="text-sm">
              Note
              <input name="note" aria-label="Note" defaultValue={receipt.note ?? ""} className="field mt-1" />
            </label>
            {[0, 1, 2].map((index) => (
              <div key={index} className="grid grid-cols-2 gap-2">
                <input name={`splitCode${index}`} aria-label={`Cost code ${index + 1}`} defaultValue={receipt.splits[index]?.costCode ?? ""} placeholder="Cost code" className="field" />
                <input
                  name={`splitAmount${index}`}
                  aria-label={`Amount ${index + 1}`}
                  defaultValue={receipt.splits[index] ? (receipt.splits[index].amountCents / 100).toFixed(2) : ""}
                  inputMode="decimal"
                  placeholder="Amount"
                  className="field"
                />
              </div>
            ))}
            <label className="text-sm">
              Vendor
              <select name="vendorContactId" aria-label="Vendor" className="field mt-1" defaultValue={receipt.vendorContactId ?? ""}>
                <option value="">Job cost</option>
                {options.vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              PO
              <select name="purchaseOrderId" aria-label="PO" className="field mt-1" defaultValue={receipt.purchaseOrderId ?? ""}>
                <option value="">No PO</option>
                {options.orders
                  .filter((order) => !receipt.projectId || order.projectId === receipt.projectId)
                  .map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.label}
                    </option>
                  ))}
              </select>
            </label>
            <Button type="submit" variant="outline" className="h-11">
              Save
            </Button>
          </ActionForm>
        ) : null}
        {receipt.canCode && receipt.status === "coded" ? (
          <ActionForm action={postCostReceiptAction.bind(null, receipt.id)}>
            <Button type="submit" className="h-11">
              Post
            </Button>
          </ActionForm>
        ) : null}
        {receipt.canCode && open ? (
          <ActionForm action={rejectCostReceiptAction.bind(null, receipt.id)} className="grid gap-2">
            <input name="note" aria-label="Reject note" placeholder="Note" className="field" />
            <Button type="submit" variant="outline" className="h-11">
              Reject
            </Button>
          </ActionForm>
        ) : null}
      </article>
    </ReceiptFrame>
  );
}
