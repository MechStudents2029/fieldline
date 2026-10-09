import Link from "next/link";
import { CommentThread } from "@/components/comment-thread";
import { DetailFacts, DetailHeader } from "@/components/detail-header";
import { MissingRecord } from "@/components/missing-record";
import { requireSession } from "@/lib/auth/session";
import { formatMoney, formatQty } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { changeOrderRecord } from "@/lib/services/purchase-orders";

export default async function ChangeOrderPage({ params }: { params: Promise<{ id: string; orderId: string }> }) {
  const { id, orderId } = await params;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) return <h1 className="fl-large-title">Change order</h1>;
  const order = changeOrderRecord(session.orgId, orderId, session.role);
  if (!order || order.projectId !== id) return <MissingRecord orgName={session.orgName} kind="change order" />;
  return (
    <div className="flex flex-col gap-4 pb-6">
      <DetailHeader
        title={`CO ${order.number}`}
        status={order.status}
        meta={
          <>
            {order.title} · <Link href={`/projects/${order.projectId}`}>{order.projectName}</Link>
          </>
        }
      />
      <DetailFacts
        label="Change order"
        rows={[
          { label: "Price", value: <span className="num">{formatMoney(order.priceDeltaCents)}</span> },
          { label: "Cost", value: <span className="num">{formatMoney(order.costDeltaCents)}</span> },
          ...(order.description ? [{ label: "Scope", value: order.description }] : []),
        ]}
      />
      {order.lines.length > 0 ? (
        <div className="overflow-x-auto px-4">
          <table className="mac-table" aria-label="Lines">
            <thead>
              <tr>
                <th>Cost code</th>
                <th>Description</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.costCode}</td>
                  <td>{line.name}</td>
                  <td className="fit num text-right" data-fit="amount">{formatQty(line.qtyMilli)} {line.unit}</td>
                  <td className="fit num text-right" data-fit="amount">{formatMoney(line.priceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="px-4">
        <CommentThread entityType="change_order" entityId={order.id} />
      </div>
    </div>
  );
}
