import Link from "next/link";
import { notFound } from "next/navigation";
import {
  adjustStockAction,
  issueStockAction,
  reorderStockAction,
  returnStockAction,
  transferJobStockAction,
  transferStockAction,
  voidMovementAction,
} from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { SourceKey } from "@/components/source-key";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { formatQty } from "@/lib/receiving/match";
import { stockDetail } from "@/lib/services/inventory";

const TYPE_LABEL: Record<string, string> = {
  receive: "Received",
  adjust: "Adjusted",
  issue: "Issued",
  return: "Returned",
  transfer: "Transferred",
  job_transfer: "Job transfer",
};

export default async function InventoryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (session.role === "viewer") return <h1 className="fl-large-title">Inventory</h1>;
  const item = stockDetail(session, id);
  if (!item) notFound();
  const qty = (milli: number) => `${formatQty(milli)} ${item.unit}`;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="hidden md:block">
        <Toolbar title={item.name} subtitle={item.sku || item.code} search={false} leading={<Link href="/inventory">Inventory</Link>} />
      </div>
      <div className="px-4 pt-3 md:hidden">
        <Link href="/inventory" className="mac-t13 text-[var(--mac-secondary)]">
          Inventory
        </Link>
        <h1 className="fl-large-title">{item.name}</h1>
        <p className="mac-t13 text-[var(--mac-secondary)]">{item.sku || item.code}</p>
      </div>
      <div className="grid gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <table className="mac-table" aria-label="Locations">
            <thead>
              <tr>
                <th>Location</th>
                <th>On hand</th>
                <th>Allocated</th>
                <th>Available</th>
                {item.money ? <th>Value</th> : null}
              </tr>
            </thead>
            <tbody>
              {item.balances.length === 0 ? (
                <tr>
                  <td colSpan={item.money ? 5 : 4}>No stock</td>
                </tr>
              ) : (
                item.balances.map((row) => (
                  <tr key={row.locationId}>
                    <td>{row.name}</td>
                    <td className="num">{qty(row.onHandMilli)}</td>
                    <td className="num">{formatQty(row.allocatedMilli)}</td>
                    <td className="num">{formatQty(row.availableMilli)}</td>
                    {item.money ? <td className="num">{formatMoney(row.valueCents ?? 0)}</td> : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <table className="mac-table" aria-label="Movements">
            <thead>
              <tr>
                <th>When</th>
                <th>Movement</th>
                <th>Qty</th>
                <th>From</th>
                <th>To</th>
                {item.money ? <th>Cost</th> : null}
                {item.office ? <th></th> : null}
              </tr>
            </thead>
            <tbody>
              {item.movements.map((row) => (
                <tr key={row.id}>
                  <td className="num">{formatCalendarDay(row.createdAt.slice(0, 10))}</td>
                  <td>
                    {row.number} · {TYPE_LABEL[row.type] || row.type}
                    {row.status === "void" ? <span className="pill ml-2">Void</span> : null}
                  </td>
                  <td className="num">{qty(row.qtyMilli)}</td>
                  <td>{row.fromName}</td>
                  <td>{row.toName}</td>
                  {item.money ? <td className="num">{formatMoney(row.costCents ?? 0)}</td> : null}
                  {item.office ? (
                    <td>
                      {row.status === "posted" ? (
                        <ActionForm action={voidMovementAction} className="flex items-center gap-1">
                          <input type="hidden" name="movementId" value={row.id} />
                          <input name="reason" aria-label={`Reason ${row.number}`} className="field w-24" />
                          <button type="submit" className="ctl" aria-label={`Void ${row.number}`}>
                            Void
                          </button>
                        </ActionForm>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-4">
          {item.low && item.office && item.vendorReady && item.jobs[0] ? (
            <ActionForm action={reorderStockAction} className="flex items-center gap-2">
              <input type="hidden" name="stockItemId" value={item.id} />
              <input type="hidden" name="projectId" value={item.jobs.find((job) => job.id === "proj_okonkwo")?.id || item.jobs[0].id} />
              <span className="pill">Low</span>
              <button type="submit" className="mac-primary">
                Order
              </button>
            </ActionForm>
          ) : null}
          <ActionForm action={issueStockAction} className="grid gap-2">
            <input type="hidden" name="stockItemId" value={item.id} />
            <SourceKey scope={`issue-${item.id}`} />
            <p className="mac-t13">Issue</p>
            <label className="text-sm">
              From
              <select name="fromLocationId" aria-label="Issue from" className="field mt-1">
                {[...item.places, ...item.jobPlaces].map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Job
              <select name="projectId" aria-label="Issue job" className="field mt-1">
                {item.jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Qty
              <input name="qty" aria-label="Issue qty" className="field mt-1" inputMode="decimal" />
            </label>
            <button type="submit" className="mac-primary w-fit">
              Issue
            </button>
          </ActionForm>
          <ActionForm action={returnStockAction} className="grid gap-2">
            <input type="hidden" name="stockItemId" value={item.id} />
            <SourceKey scope={`return-${item.id}`} />
            <p className="mac-t13">Return</p>
            <label className="text-sm">
              From
              <select name="fromLocationId" aria-label="Return from" className="field mt-1">
                {item.jobPlaces.map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              To
              <select name="toLocationId" aria-label="Return to" className="field mt-1">
                {item.places.map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Qty
              <input name="qty" aria-label="Return qty" className="field mt-1" inputMode="decimal" />
            </label>
            <button type="submit" className="mac-primary w-fit">
              Return
            </button>
          </ActionForm>
          {item.office ? (
            <>
              <ActionForm action={transferStockAction} className="grid gap-2">
                <input type="hidden" name="stockItemId" value={item.id} />
                <SourceKey scope={`transfer-${item.id}`} />
                <p className="mac-t13">Transfer</p>
                <label className="text-sm">
                  From
                  <select name="fromLocationId" aria-label="Transfer from" className="field mt-1">
                    {item.places.map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  To
                  <select name="toLocationId" aria-label="Transfer to" className="field mt-1">
                    {item.places.map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Qty
                  <input name="qty" aria-label="Transfer qty" className="field mt-1" inputMode="decimal" />
                </label>
                <button type="submit" className="ctl w-fit">
                  Transfer
                </button>
              </ActionForm>
              <ActionForm action={transferJobStockAction} className="grid gap-2">
                <input type="hidden" name="stockItemId" value={item.id} />
                <SourceKey scope={`job-${item.id}`} />
                <p className="mac-t13">Job to job</p>
                <label className="text-sm">
                  From
                  <select name="fromProjectId" aria-label="From job" className="field mt-1">
                    {item.jobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  To
                  <select name="toProjectId" aria-label="To job" className="field mt-1">
                    {item.jobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Qty
                  <input name="qty" aria-label="Job qty" className="field mt-1" inputMode="decimal" />
                </label>
                <button type="submit" className="ctl w-fit">
                  Move
                </button>
              </ActionForm>
              <ActionForm action={adjustStockAction} className="grid gap-2">
                <input type="hidden" name="stockItemId" value={item.id} />
                <SourceKey scope={`adjust-${item.id}`} />
                <p className="mac-t13">Adjust</p>
                <label className="text-sm">
                  Location
                  <select name="locationId" aria-label="Adjust location" className="field mt-1">
                    {[...item.places, ...item.jobPlaces].map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Reason
                  <select name="reason" aria-label="Adjust reason" className="field mt-1" defaultValue="count">
                    <option value="count">Count</option>
                    <option value="damage">Damage</option>
                    <option value="loss">Loss</option>
                  </select>
                </label>
                <label className="text-sm">
                  Direction
                  <select name="direction" aria-label="Adjust direction" className="field mt-1" defaultValue="out">
                    <option value="out">Out</option>
                    <option value="in">In</option>
                  </select>
                </label>
                <label className="text-sm">
                  Qty
                  <input name="qty" aria-label="Adjust qty" className="field mt-1" inputMode="decimal" />
                </label>
                <button type="submit" className="ctl w-fit">
                  Adjust
                </button>
              </ActionForm>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
