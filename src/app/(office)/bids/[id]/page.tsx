import Link from "next/link";
import { awardBidAction, saveBidLinesAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { MissingRecord } from "@/components/missing-record";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { formatMoney, formatQty, formatWhole } from "@/lib/money";
import { bidComparison } from "@/lib/services/bids";

function signed(cents: number) {
  if (cents === 0) return formatWhole(0);
  const text = formatWhole(Math.abs(cents));
  return cents > 0 ? `+${text}` : `−${text}`;
}

export default async function BidPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const bid = bidComparison(session, id);
  if (!bid) return <MissingRecord orgName={session.orgName} kind="bid" />;
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar
          title={bid.title}
          subtitle={`${bid.statusLabel} · ${formatCalendarDay(bid.dueOn)}`}
          search={false}
          leading={<Link href={`/projects/${bid.projectId}/bids`}>‹</Link>}
        />
      </div>
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <div className="md:hidden">
          <Link href={`/projects/${bid.projectId}/bids`} className="text-[var(--fl-accent)]">
            ‹ Bids
          </Link>
          <h1 className="fl-title mt-2">{bid.title}</h1>
          <p className="fl-footnote text-[var(--fl-secondary)]">
            {bid.statusLabel} · {formatCalendarDay(bid.dueOn)}
          </p>
        </div>
        {bid.scope ? <p className="mac-t13">{bid.scope}</p> : null}
        {bid.purchaseOrders.length > 0 ? (
          <ul className="flex flex-wrap gap-3">
            {bid.purchaseOrders.map((order) => (
              <li key={order.id}>
                <Link href={`/purchase-orders/${order.id}`} className="mac-t13 font-semibold text-[var(--mac-accent)]">
                  {order.number}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <ActionForm action={awardBidAction.bind(null, bid.id)} className="flex flex-col gap-4">
        <div className="overflow-x-auto">
          <table className="mac-table w-full text-left" aria-label="Comparison" data-status={bid.statusLabel}>
            <thead>
              <tr>
                <th>Cost code</th>
                <th className="text-right">Qty</th>
                {bid.showMoney ? <th className="text-right">Budget</th> : null}
                {bid.vendors.map((vendor) => (
                  <th key={vendor.contactId} data-vendor={vendor.name}>
                    <span className="block">{vendor.name}</span>
                    <span className="fl-pill" data-compliance={vendor.compliance.state}>
                      {vendor.compliance.label}
                    </span>
                    {bid.showMoney && vendor.totalCents != null ? <span className="num mt-1 block">{formatMoney(vendor.totalCents)}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bid.lines.map((line) => (
                <tr key={line.id} data-line={line.costCode}>
                  <th scope="row" className="font-normal">
                    {line.costCode}
                    <span className="block text-[var(--mac-secondary)]">{line.description}</span>
                  </th>
                  <td className="num text-right">
                    {formatQty(line.qtyMilli)} {line.unit}
                  </td>
                  {bid.showMoney ? <td className="num text-right">{line.budgetCents == null ? "—" : formatWhole(line.budgetCents)}</td> : null}
                  {bid.vendors.map((vendor) => {
                    const price = vendor.prices.find((row) => row.lineId === line.id);
                    return (
                      <td key={vendor.contactId} className={price?.low ? "bid-low num text-right" : "num text-right"} data-vendor={vendor.name} data-low={price?.low ? "1" : undefined} data-price={price?.amountCents ?? ""}>
                        {price?.noBid ? "No bid" : price?.amountCents == null ? "—" : formatMoney(price.amountCents)}
                        {price?.varianceCents != null ? <span className="block mac-t11 text-[var(--mac-secondary)]">{signed(price.varianceCents)}</span> : null}
                        {bid.canEdit && vendor.status === "submitted" && !vendor.blocked && price && !price.noBid && price.amountCents != null ? (
                          <label className="mt-1 block text-left font-normal">
                            <input type="radio" name={`award_${line.id}`} value={vendor.contactId} aria-label={`Award ${line.costCode} ${vendor.name}`} />
                          </label>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {bid.showMoney ? (
                <tr>
                  <th scope="row">Total</th>
                  <td />
                  <td />
                  {bid.vendors.map((vendor) => (
                    <td key={vendor.contactId} className="num text-right font-semibold">
                      {vendor.totalCents == null ? "—" : formatMoney(vendor.totalCents)}
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {bid.canEdit ? (
          <div className="flex flex-wrap items-center gap-4">
            {bid.lines.map((line) => (
              <input key={line.id} type="hidden" name="lineId" value={line.id} />
            ))}
            <label className="text-sm">
              <input type="checkbox" name="createPo" defaultChecked aria-label="Purchase orders" /> Purchase orders
            </label>
            <label className="text-sm">
              <input type="checkbox" name="updateBudget" aria-label="Update budget" /> Update budget
            </label>
            <button type="submit" className="mac-primary">
              Award
            </button>
          </div>
        ) : null}
        </ActionForm>
        {bid.canEdit ? (
          <ActionForm action={saveBidLinesAction.bind(null, bid.id)} className="flex flex-col gap-2">
            {bid.lines.map((line) => (
              <div key={line.id} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="lineId" value={line.id} />
                <input type="hidden" name={`code_${line.id}`} value={line.costCode} />
                <input type="hidden" name={`name_${line.id}`} value={line.description} />
                <input type="hidden" name={`budget_${line.id}`} value={line.budgetLineId ?? ""} />
                <span className="text-sm">{line.costCode}</span>
                <input name={`qty_${line.id}`} defaultValue={formatQty(line.qtyMilli)} aria-label={`Qty ${line.costCode}`} className="field w-20" />
                <input name={`unit_${line.id}`} defaultValue={line.unit} aria-label={`Unit ${line.costCode}`} className="field w-20" />
              </div>
            ))}
            <button type="submit" className="mac-glass-btn w-fit">
              Save lines
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
