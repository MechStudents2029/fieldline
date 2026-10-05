import Link from "next/link";
import { addCostAction, createCoAction, draftCoAction, issueInvoiceAction, noteAction, photoAction, taskAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { MissingRecord } from "@/components/missing-record";
import { PhotoCapture } from "@/components/photo-capture";
import { ReceiptCapture } from "@/components/receipt-capture";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { overBudgetPercent } from "@/lib/margin/category";
import { formatBps, formatMoney } from "@/lib/money";
import { JobTabs } from "@/components/job-tabs";
import { projectBills } from "@/lib/services/bills";
import { projectPurchaseOrders } from "@/lib/services/purchase-orders";
import { captionFromMetadata, listPriceBook, projectDetail } from "@/lib/services/read";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const detail = projectDetail(session.orgId, id, session.role);
  if (!detail?.contact) return <MissingRecord orgName={session.orgName} kind="job" />;
  const costCodes = detail.money ? listPriceBook(session.orgId).map((item) => item.code) : [];
  const jobBills = detail.money ? projectBills(session.orgId, detail.project.id, session.role) : [];
  const jobOrders = detail.money ? projectPurchaseOrders(session.orgId, detail.project.id, session.role) : [];
  const money = detail.financials;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{detail.project.status}</p>
        <h1 className="font-heading text-3xl">{detail.project.name}</h1>
        <div className="mt-3">
          <JobTabs projectId={detail.project.id} current="job" />
        </div>
        <p className="text-sm text-muted-foreground">{detail.project.address}</p>
        <p className="text-sm">
          Client <Link href={`/contacts/${detail.contact.id}`} className="underline">{detail.contact.name}</Link>
        </p>
        <p className="mt-2 text-sm">
          Client portal <Link href={`/portal/${detail.project.portalToken}`} className="underline">/portal/{detail.project.portalToken}</Link>
        </p>
      </div>
      {money ? (
        <section className={`rounded-xl p-4 ring-1 ${money.alert ? "bg-accent ring-copper/40" : "bg-card ring-foreground/10"}`}>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Live margin</p>
          <p className="font-heading text-4xl">{formatBps(money.marginBps)}</p>
          <p className="text-sm">
            Contract {formatMoney(money.contractCents)} · cost {formatMoney(money.actualCents)} · profit {formatMoney(money.profitCents)}
          </p>
          {money.alert ? <p className="mt-2 text-sm">Under the {formatBps(money.thresholdBps)} watch line.</p> : null}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="mb-2 text-left text-xs text-muted-foreground">
                Committed is the open balance on issued purchase orders. Projected is the greater of the budget and actual plus that balance. Cost to complete is projected minus actual.
              </caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Code</th>
                  <th className="py-2 pr-3 font-medium">Budget</th>
                  <th className="py-2 pr-3 font-medium">Committed</th>
                  <th className="py-2 pr-3 font-medium">Actual</th>
                  <th className="py-2 pr-3 font-medium">Projected</th>
                  <th className="py-2 pr-3 font-medium">To complete</th>
                  <th className="py-2 font-medium">Variance</th>
                </tr>
              </thead>
              <tbody>
                {money.byCode.map((row) => (
                  <tr key={row.code} data-code={row.code} className="border-b border-border">
                    <th scope="row" className={`py-2 pr-3 font-medium ${row.level !== "ok" ? "text-copper" : ""}`}>
                      {row.code}
                    </th>
                    <td className="py-2 pr-3" data-kind="budget">{formatMoney(row.budgetCents)}</td>
                    <td className="py-2 pr-3" data-kind="committed">{formatMoney(row.committedOpenCents)}</td>
                    <td className="py-2 pr-3" data-kind="actual">{formatMoney(row.actualCents)}</td>
                    <td className="py-2 pr-3" data-kind="projected">{formatMoney(row.projectedCents)}</td>
                    <td className="py-2 pr-3" data-kind="remaining">{formatMoney(row.costToCompleteCents)}</td>
                    <td className="py-2" data-kind="variance">{formatMoney(row.varianceCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr data-code="total">
                  <th scope="row" className="py-2 pr-3">Total</th>
                  <td className="py-2 pr-3">{formatMoney(money.byCode.reduce((sum, row) => sum + row.budgetCents, 0))}</td>
                  <td className="py-2 pr-3">{formatMoney(money.byCode.reduce((sum, row) => sum + row.committedOpenCents, 0))}</td>
                  <td className="py-2 pr-3">{formatMoney(money.byCode.reduce((sum, row) => sum + row.actualCents, 0))}</td>
                  <td className="py-2 pr-3">{formatMoney(money.byCode.reduce((sum, row) => sum + row.projectedCents, 0))}</td>
                  <td className="py-2 pr-3">{formatMoney(money.byCode.reduce((sum, row) => sum + row.costToCompleteCents, 0))}</td>
                  <td className="py-2">{formatMoney(money.byCode.reduce((sum, row) => sum + row.varianceCents, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <ul className="mt-3 space-y-3">
            {money.byCode.map((row) => {
              const overPercent = overBudgetPercent(row);
              if (row.level === "ok") return null;
              return (
                <li key={row.code} className="text-sm">
                  {row.level === "watch" ? <p className="text-xs text-copper">{row.code} is at {row.percentOfBudget}% of budget, including open commitments. Not over yet.</p> : null}
                  {row.level === "over" && row.covered ? <p className="text-xs">{row.code}: a change order already covers this overrun.</p> : null}
                  {row.suggestDraft && overPercent != null ? (
                    <ActionForm action={draftCoAction.bind(null, detail.project.id)} className="mt-1">
                      <input type="hidden" name="title" value={`${row.code} ${overPercent}% over budget`} />
                      <input type="hidden" name="description" value={`${row.code} is ${formatMoney(row.overageCents)} over its ${formatMoney(row.budgetCents)} budget once open commitments are counted. Draft only — not sent to the client.`} />
                      <input type="hidden" name="name" value={row.code} />
                      <input type="hidden" name="costCode" value={row.code === "Uncoded" ? "" : row.code} />
                      <input type="hidden" name="qty" value="1" />
                      <input type="hidden" name="unit" value="ea" />
                      <input type="hidden" name="unitCost" value={(row.draftCostCents / 100).toFixed(2)} />
                      <input type="hidden" name="markup" value={(detail.org.defaultMarkupBps / 100).toFixed(0)} />
                      <Button type="submit" variant="outline" size="sm" className="h-9">
                        {row.code} {overPercent}% over budget — draft CO
                      </Button>
                    </ActionForm>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="rounded-xl bg-muted p-4 text-sm">Prices, costs, and margin are hidden for the field role.</p>
      )}
      {session.role === "field" ? (
        <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="font-medium">Field notes</h2>
          <ActionForm action={noteAction.bind(null, "project", detail.project.id)} className="mt-3 flex flex-col gap-2">
            <textarea name="summary" aria-label="Daily note" rows={3} placeholder="What happened on site" className="w-full rounded-lg border border-input bg-background p-3" />
            <Button type="submit" variant="outline" className="h-11">
              Save note
            </Button>
          </ActionForm>
          <ActionForm action={taskAction.bind(null, "project", detail.project.id)} className="mt-3 flex flex-col gap-2">
            <input name="title" aria-label="Task title" placeholder="Task for this job" className="field" />
            <Button type="submit" variant="outline" className="h-11">
              Add task
            </Button>
          </ActionForm>
          <ReceiptCapture projectId={detail.project.id} codes={listPriceBook(session.orgId).map((item) => item.code)} allowPost={false} />
        </section>
      ) : null}
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">Change orders</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {detail.orders.length === 0 ? <li className="text-muted-foreground">None yet.</li> : null}
          {detail.orders.map((order) => (
            <li key={order.id} className="flex justify-between gap-2">
              <span>
                CO {order.number} · {order.title} · {order.status}
              </span>
              {money ? <span>{formatMoney(order.priceDeltaCents)}</span> : null}
            </li>
          ))}
        </ul>
        {money ? (
          <ActionForm action={createCoAction.bind(null, detail.project.id)} className="mt-3 grid gap-2 sm:grid-cols-2">
            <input name="title" aria-label="Change order title" placeholder="Title, e.g. Relocate plumbing wall" className="field sm:col-span-2" required />
            <textarea name="description" aria-label="What changed" placeholder="What changed" rows={2} className="w-full rounded-lg border border-input bg-background p-3 sm:col-span-2" />
            <input name="name" aria-label="Line name" placeholder="Line name" className="field" required />
            <input name="costCode" aria-label="Cost code" placeholder="Cost code" defaultValue="PLB-SINK" className="field" />
            <input name="qty" defaultValue="1" className="field" aria-label="Quantity" />
            <input name="unit" defaultValue="ea" className="field" aria-label="Unit" />
            <input name="unitCost" aria-label="Unit cost in dollars" placeholder="Unit cost" inputMode="decimal" className="field" required />
            <input name="markup" defaultValue="35" className="field" aria-label="Markup percent" />
            <Button type="submit" className="h-11 sm:col-span-2">
              Price and send change order
            </Button>
          </ActionForm>
        ) : null}
      </section>
      {money ? (
        <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Invoices</h2>
            <ActionForm action={issueInvoiceAction.bind(null, detail.project.id)}>
              <Button type="submit" variant="outline" size="sm">
                Issue next draw
              </Button>
            </ActionForm>
          </div>
          <ul className="mt-2 space-y-2 text-sm">
            {detail.invoices.map((invoice) => (
              <li key={invoice.id} className="flex justify-between gap-2">
                <Link href={`/pay/${invoice.payToken}`} className="underline">
                  {invoice.number} · {invoice.type} · {invoice.status}
                </Link>
                <span>{formatMoney(invoice.totalCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {money ? (
        <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="font-medium">Costs</h2>
          <h3 className="mt-3 text-sm font-medium">Purchase orders</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {jobOrders.length === 0 ? <li className="text-muted-foreground">No purchase orders on this job.</li> : null}
            {jobOrders.map((order) => (
              <li key={order.id} className="flex justify-between gap-2">
                <Link href={`/purchase-orders/${order.id}`} className="underline">
                  {order.number} · {order.vendorName} · {order.status}
                </Link>
                <span>
                  {formatMoney(order.amountCents)}
                  {order.status === "issued" ? ` · open ${formatMoney(order.openCents)}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <h3 className="mt-3 text-sm font-medium">Bills</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {jobBills.length === 0 ? <li className="text-muted-foreground">No bills on this job.</li> : null}
            {jobBills.map((bill) => (
              <li key={bill.id} className={`flex justify-between gap-2 ${bill.timing === "overdue" ? "text-copper" : ""}`}>
                <Link href={`/bills/${bill.id}`} className="underline">
                  {bill.billNumber} · {bill.vendorName} · {bill.status}
                  {bill.timing === "overdue" ? " · Overdue" : ""}
                </Link>
                <span>{formatMoney(bill.amountCents)}</span>
              </li>
            ))}
          </ul>
          <ul className="mt-3 space-y-1 text-sm">
            {detail.costs.map((cost) => (
              <li key={cost.id} className="flex justify-between gap-2">
                <span>
                  {cost.vendorName} · {cost.costCode} {cost.aiExtracted ? "· read from receipt" : ""}
                </span>
                <span>{formatMoney(cost.amountCents)}</span>
              </li>
            ))}
          </ul>
          <ActionForm action={addCostAction.bind(null, detail.project.id)} className="mt-3 grid gap-2 sm:grid-cols-2">
            <input name="vendor" placeholder="Vendor" className="field" />
            <input name="amount" placeholder="Amount" className="field" />
            <input name="costCode" placeholder="Cost code" className="field" />
            <select name="source" className="field" defaultValue="expense">
              <option value="expense">Expense</option>
              <option value="bill">Bill</option>
              <option value="labor">Labor</option>
              <option value="receipt">Receipt</option>
            </select>
            <input name="memo" placeholder="Memo" className="field sm:col-span-2" />
            <Button type="submit" variant="outline" className="h-11">
              Post cost
            </Button>
          </ActionForm>
          <ReceiptCapture projectId={detail.project.id} codes={costCodes} />
        </section>
      ) : null}
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">Photos</h2>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {detail.photos.filter((photo) => photo.type === "photo").map((photo) => (
            <img key={photo.id} src={photo.storagePath.startsWith("/") ? photo.storagePath : `/api/files/${photo.id}`} alt={captionFromMetadata(photo.metadataJson) || "Job photo"} className="aspect-square w-full rounded-lg object-cover" />
          ))}
        </div>
        {session.role !== "viewer" ? (
          <PhotoCapture action={photoAction.bind(null, detail.project.id)} label="Take a job photo" submitLabel="Save photo" />
        ) : null}
      </section>
      <section>
        <h2 className="font-medium">Activity</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {detail.timeline.map((item) => (
            <li key={item.id}>
              <span className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>
              <p>{item.summary}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
