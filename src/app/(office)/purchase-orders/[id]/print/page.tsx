import Link from "next/link";
import { MissingRecord } from "@/components/missing-record";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { purchaseOrderDetail } from "@/lib/services/purchase-orders";

export default async function PurchaseOrderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return <p className="rounded-xl bg-muted p-4 text-sm">Purchase orders are for the office.</p>;
  }
  const detail = purchaseOrderDetail(session.orgId, id, session.role);
  if (!detail) return <MissingRecord orgName={session.orgName} kind="purchase order" />;
  const { po, lines } = detail;
  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-4 bg-card p-6">
      <div className="flex items-start justify-between gap-3 print:hidden">
        <Link href={`/purchase-orders/${po.id}`} className="text-sm underline">
          Back to {po.number}
        </Link>
        <PrintButton />
      </div>
      <header>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{session.orgName}</p>
        <h1 className="font-heading text-3xl">{po.number}</h1>
        <p className="text-sm capitalize">{po.status}</p>
      </header>
      <p className="text-sm">
        {po.vendorName}
        <br />
        {po.projectName}
      </p>
      {detail.scope ? <p className="text-sm">{detail.scope}</p> : null}
      {detail.changeOrderLabel ? <p className="text-sm">{detail.changeOrderLabel}</p> : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="py-2 font-medium">Cost code</th>
            <th className="py-2 font-medium">Description</th>
            <th className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b border-border">
              <td className="py-2">{line.costCode}</td>
              <td className="py-2">{line.description}</td>
              <td className="py-2 text-right">{formatMoney(line.amountCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th className="py-2 text-left" colSpan={2}>
              Total
            </th>
            <td className="py-2 text-right">{formatMoney(po.amountCents)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="text-xs text-muted-foreground">This page was not emailed or sent to the vendor.</p>
    </article>
  );
}
