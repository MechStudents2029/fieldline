import Link from "next/link";
import { addCostAction, createCoAction, draftCoAction, issueInvoiceAction, photoAction, receiptAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { MissingRecord } from "@/components/missing-record";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { overBudgetPercent } from "@/lib/margin/category";
import { formatBps, formatMoney } from "@/lib/money";
import { projectDetail } from "@/lib/services/read";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const detail = projectDetail(session.orgId, id, session.role);
  if (!detail?.contact) return <MissingRecord orgName={session.orgName} kind="job" />;
  const money = detail.financials;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{detail.project.status}</p>
        <h1 className="font-heading text-3xl">{detail.project.name}</h1>
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
          <ul className="mt-4 space-y-3">
            {money.byCode.map((row) => {
              const hot = row.level !== "ok";
              const overPercent = overBudgetPercent(row);
              return (
                <li key={row.code} className={`text-sm ${hot ? "rounded-lg bg-background/70 p-2" : ""}`}>
                  <div className="flex justify-between gap-2">
                    <span className={hot ? "font-medium text-copper" : undefined}>{row.code}</span>
                    <span>
                      {formatMoney(row.actualCents)} / {formatMoney(row.budgetCents)}
                      {row.percentOfBudget != null ? ` · ${row.percentOfBudget}%` : ""}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted">
                    <div
                      className={`h-1.5 rounded-full ${hot ? "bg-copper" : "bg-pine"}`}
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={Math.max(row.budgetCents, row.actualCents, 1)}
                      aria-valuenow={row.actualCents}
                      aria-label={`${row.code} spent against budget`}
                      style={{ width: `${Math.min(100, row.budgetCents === 0 ? 100 : (row.actualCents / row.budgetCents) * 100)}%` }}
                    />
                  </div>
                  {row.level === "watch" ? <p className="mt-1 text-xs text-copper">{row.percentOfBudget}% of this cost code’s budget. Not over yet.</p> : null}
                  {row.level === "over" && row.covered ? <p className="mt-1 text-xs">A change order already covers this overrun.</p> : null}
                  {row.suggestDraft && overPercent != null ? (
                    <ActionForm action={draftCoAction.bind(null, detail.project.id)} className="mt-2">
                      <input type="hidden" name="title" value={`${row.code} ${overPercent}% over budget`} />
                      <input type="hidden" name="description" value={`${row.code} is ${formatMoney(row.overageCents)} over its ${formatMoney(row.budgetCents)} budget. Draft only — not sent to the client.`} />
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
          <ul className="mt-2 space-y-1 text-sm">
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
          <ActionForm action={receiptAction.bind(null, detail.project.id)} className="mt-4 flex flex-col gap-2 border-t border-border pt-3">
            <p className="text-sm font-medium">Receipt photo</p>
            <input name="file" type="file" accept="image/*,.svg,.txt" className="text-sm" />
            <label className="text-sm">
              Or use a sample
              <select name="sample" className="field mt-1" defaultValue="">
                <option value="">Upload instead</option>
                <option value="casa-tile.svg">Casa Tile · $864.50</option>
                <option value="harbor-plumbing.svg">Harbor Plumbing · $426.00</option>
                <option value="summit-lumber.svg">Summit Lumber · $18,425.00</option>
              </select>
            </label>
            <input name="costCode" placeholder="Cost code to post" defaultValue="TILE-BACK" className="field" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="post" defaultChecked />
              Post to the job if the read is confident
            </label>
            <Button type="submit" variant="outline" className="h-11">
              Read receipt
            </Button>
          </ActionForm>
        </section>
      ) : null}
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">Photos</h2>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {detail.photos.filter((photo) => photo.type === "photo").map((photo) => (
            <img key={photo.id} src={photo.storagePath.startsWith("/") ? photo.storagePath : `/api/files/${photo.id}`} alt={photo.filename} className="aspect-square w-full rounded-lg object-cover" />
          ))}
        </div>
        <ActionForm action={photoAction.bind(null, detail.project.id)} className="mt-3 flex flex-col gap-2">
          <input name="caption" className="field" placeholder="Caption, e.g. Opened the sink wall" />
          <Button type="submit" variant="outline">
            Save a photo note
          </Button>
        </ActionForm>
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
