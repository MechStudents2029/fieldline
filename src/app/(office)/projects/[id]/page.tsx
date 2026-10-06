import Link from "next/link";
import { addCostAction, createCoAction, draftCoAction, issueInvoiceAction, noteAction, photoAction, taskAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { GroupedList, GroupedRow, NumberStrip } from "@/components/ios";
import { MissingRecord } from "@/components/missing-record";
import { PhotoCapture } from "@/components/photo-capture";
import { ReceiptCapture } from "@/components/receipt-capture";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { overBudgetPercent } from "@/lib/margin/category";
import { formatMoney, formatPercent, formatWhole } from "@/lib/money";
import { projectBills } from "@/lib/services/bills";
import { projectPurchaseOrders } from "@/lib/services/purchase-orders";
import { captionFromMetadata, listPriceBook, projectDetail } from "@/lib/services/read";
import { timeBoard } from "@/lib/services/time";

function codeTone(percent: number | null, level: string) {
  if (level === "over" || (percent != null && percent >= 100)) return "fl-late";
  if (percent != null && percent >= 90) return "fl-close";
  return "text-[var(--fl-secondary)]";
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const detail = projectDetail(session.orgId, id, session.role);
  if (!detail?.contact) return <MissingRecord orgName={session.orgName} kind="job" />;
  const costCodes = detail.money ? listPriceBook(session.orgId).map((item) => item.code) : [];
  const jobBills = detail.money ? projectBills(session.orgId, detail.project.id, session.role) : [];
  const jobOrders = detail.money ? projectPurchaseOrders(session.orgId, detail.project.id, session.role) : [];
  const money = detail.financials;
  const board = timeBoard(session);
  const crew = board.office?.clockedIn.filter((row) => row.projectName === detail.project.name) ?? [];
  const ranked = money ? [...money.byCode].sort((a, b) => (b.percentOfBudget ?? 0) - (a.percentOfBudget ?? 0)).slice(0, 2) : [];
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-7 pb-8">
      <div className="fl-safe-top">
        <Link href="/projects" className="fl-body text-[var(--fl-accent)]">
          ‹ Jobs
        </Link>
        <h1 className="fl-title mt-2">{detail.project.name}</h1>
        <p className="fl-secondary-text text-[var(--fl-secondary)]">{detail.project.address}</p>
      </div>
      {money ? (
        <NumberStrip
          items={[
            { label: "Contract", value: formatWhole(money.contractCents) },
            { label: "Spent", value: formatWhole(money.actualCents) },
            { label: "Margin", value: formatPercent(money.marginBps), tone: money.alert ? "late" : "neutral" },
          ]}
        />
      ) : null}
      <span className="sr-only">Contract {money ? formatMoney(money.contractCents) : ""}</span>
      <span className="sr-only">cost {money ? formatMoney(money.actualCents) : ""}</span>
      <nav aria-label="Job sections" className="grid grid-cols-4 rounded-[10px] bg-[var(--fl-fill)] p-1">
        <a href="#overview" className="rounded-lg bg-card py-1.5 text-center fl-footnote">
          Overview
        </a>
        <a href="#budget" className="py-1.5 text-center fl-footnote text-[var(--fl-secondary)]">
          Budget
        </a>
        <Link href={`/projects/${detail.project.id}/logs`} className="py-1.5 text-center fl-footnote text-[var(--fl-secondary)]">
          Logs
        </Link>
        <a href="#photos" className="py-1.5 text-center fl-footnote text-[var(--fl-secondary)]">
          Photos
        </a>
      </nav>
      {money ? (
        <div id="budget">
          <GroupedList label="Budget">
            {ranked.map((row) => (
              <GroupedRow
                key={row.code}
                title={prettyCode(row.code)}
                subtitle={`${formatWhole(row.actualCents)} of ${formatWhole(row.budgetCents)}`}
                trailing={<span className={codeTone(row.percentOfBudget, row.level)}>{row.percentOfBudget == null ? "—" : `${Math.round(row.percentOfBudget)}%`}</span>}
                chevron
                href={`#code-${row.code}`}
              />
            ))}
            <GroupedRow title="All cost codes" trailing={String(money.byCode.length)} href="#codes" />
          </GroupedList>
          <div id="codes" className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left fl-footnote">
              <thead>
                <tr className="border-b border-border text-[var(--fl-secondary)]">
                  <th className="py-2 pr-3">Code</th>
                  <th className="py-2 pr-3">Budget</th>
                  <th className="py-2 pr-3">Committed</th>
                  <th className="py-2 pr-3">Actual</th>
                  <th className="py-2 pr-3">Projected</th>
                  <th className="py-2 pr-3">To complete</th>
                  <th className="py-2">Variance</th>
                </tr>
              </thead>
              <tbody>
                {money.byCode.map((row) => (
                  <tr key={row.code} id={`code-${row.code}`} data-code={row.code} className="border-b border-border">
                    <th scope="row" className={`py-2 pr-3 ${codeTone(row.percentOfBudget, row.level)}`}>
                      {row.code}
                    </th>
                    <td className="py-2 pr-3 tabular-nums" data-kind="budget">{formatMoney(row.budgetCents)}</td>
                    <td className="py-2 pr-3 tabular-nums" data-kind="committed">{formatMoney(row.committedOpenCents)}</td>
                    <td className="py-2 pr-3 tabular-nums" data-kind="actual">{formatMoney(row.actualCents)}</td>
                    <td className="py-2 pr-3 tabular-nums" data-kind="projected">{formatMoney(row.projectedCents)}</td>
                    <td className="py-2 pr-3 tabular-nums" data-kind="remaining">{formatMoney(row.costToCompleteCents)}</td>
                    <td className="py-2 tabular-nums" data-kind="variance">{formatMoney(row.varianceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {money.byCode.map((row) => {
              const overPercent = overBudgetPercent(row);
              if (!row.suggestDraft || overPercent == null) return null;
              return (
                <li key={row.code}>
                  <ActionForm action={draftCoAction.bind(null, detail.project.id)}>
                    <input type="hidden" name="title" value={`${row.code} ${overPercent}% over budget`} />
                    <input type="hidden" name="description" value={`${row.code} is ${formatMoney(row.overageCents)} over budget.`} />
                    <input type="hidden" name="name" value={row.code} />
                    <input type="hidden" name="costCode" value={row.code === "Uncoded" ? "" : row.code} />
                    <input type="hidden" name="qty" value="1" />
                    <input type="hidden" name="unit" value="ea" />
                    <input type="hidden" name="unitCost" value={(row.draftCostCents / 100).toFixed(2)} />
                    <input type="hidden" name="markup" value={(detail.org.defaultMarkupBps / 100).toFixed(0)} />
                    <Button type="submit" variant="outline" className="h-11">
                      Draft {row.code}
                    </Button>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div id="overview">
        <GroupedList label="Today">
          {crew.map((person) => (
            <GroupedRow
              key={person.entryId}
              href="/time"
              title={`${person.name.split(" ")[0]} clocked in`}
              trailing={formatDateTime(person.since, board.timeZone).split(",").pop()?.trim()}
            />
          ))}
          {detail.orders.map((order) => (
            <GroupedRow
              key={order.id}
              title={`Change order ${order.number}`}
              subtitle={order.status}
              trailing={money ? formatWhole(order.priceDeltaCents) : undefined}
              chevron={false}
            />
          ))}
          <GroupedRow href={`/contacts/${detail.contact.id}`} title={detail.contact.name} subtitle="Client" />
          <GroupedRow href={`/portal/${detail.project.portalToken}`} title="Client portal" subtitle={`/portal/${detail.project.portalToken}`} />
        </GroupedList>
      </div>
      {session.role === "field" ? (
        <section className="flex flex-col gap-3">
          <ActionForm action={noteAction.bind(null, "project", detail.project.id)} className="flex flex-col gap-2">
            <textarea name="summary" aria-label="Daily note" rows={3} placeholder="What happened on site" className="field" />
            <Button type="submit" variant="outline" className="h-11">
              Save note
            </Button>
          </ActionForm>
          <ActionForm action={taskAction.bind(null, "project", detail.project.id)} className="flex flex-col gap-2">
            <input name="title" aria-label="Task title" placeholder="Task for this job" className="field" />
            <Button type="submit" variant="outline" className="h-11">
              Add task
            </Button>
          </ActionForm>
          <ReceiptCapture projectId={detail.project.id} codes={listPriceBook(session.orgId).map((item) => item.code)} allowPost={false} />
        </section>
      ) : null}
      <section className="flex flex-col gap-3">
        <h2 className="fl-section">Change orders</h2>
        <ul className="fl-group">
          {detail.orders.map((order) => (
            <li key={order.id} className="fl-cell">
              <span className="fl-body flex-1">
                {order.title} · {order.status}
              </span>
              {money ? <span className="tabular-nums">{formatWhole(order.priceDeltaCents)}</span> : null}
            </li>
          ))}
        </ul>
        {money ? (
          <ActionForm action={createCoAction.bind(null, detail.project.id)} className="grid gap-2">
            <input name="title" aria-label="Change order title" placeholder="Title" className="field" required />
            <textarea name="description" aria-label="What changed" placeholder="What changed" rows={2} className="field" />
            <input name="name" aria-label="Line name" placeholder="Line name" className="field" required />
            <input name="costCode" aria-label="Cost code" placeholder="Cost code" defaultValue="PLB-SINK" className="field" />
            <input name="qty" defaultValue="1" className="field" aria-label="Quantity" />
            <input name="unit" defaultValue="ea" className="field" aria-label="Unit" />
            <input name="unitCost" aria-label="Unit cost in dollars" placeholder="Unit cost" inputMode="decimal" className="field" required />
            <input name="markup" defaultValue="35" className="field" aria-label="Markup percent" />
            <Button type="submit" className="fl-primary">
              New change order
            </Button>
          </ActionForm>
        ) : null}
      </section>
      {money ? (
        <GroupedList label="Invoices">
          {detail.invoices.map((invoice) => (
            <GroupedRow
              key={invoice.id}
              href={`/pay/${invoice.payToken}`}
              title={`${invoice.number} · ${invoice.type} · ${invoice.status}`}
              trailing={formatWhole(invoice.totalCents)}
            />
          ))}
          <li className="fl-cell">
            <ActionForm action={issueInvoiceAction.bind(null, detail.project.id)}>
              <Button type="submit" variant="outline" className="h-11">
                Issue next draw
              </Button>
            </ActionForm>
          </li>
        </GroupedList>
      ) : null}
      {money ? (
        <GroupedList label="Costs">
          {jobOrders.map((order) => (
            <GroupedRow
              key={order.id}
              href={`/purchase-orders/${order.id}`}
              title={`${order.number} · ${order.vendorName}`}
              subtitle={order.status}
              trailing={formatWhole(order.amountCents)}
            />
          ))}
          {jobBills.map((bill) => (
            <GroupedRow
              key={bill.id}
              href={`/bills/${bill.id}`}
              title={`${bill.billNumber} · ${bill.vendorName} · ${bill.status}${bill.timing === "overdue" ? " · Overdue" : ""}`}
              trailing={formatWhole(bill.amountCents)}
            />
          ))}
          {detail.costs.map((cost) => (
            <li key={cost.id} className="fl-cell">
              <span className="fl-body flex-1">
                {cost.vendorName} · {cost.costCode}
              </span>
              <span className="tabular-nums">{formatMoney(cost.amountCents)}</span>
            </li>
          ))}
        </GroupedList>
      ) : null}
      {money ? (
        <ActionForm action={addCostAction.bind(null, detail.project.id)} className="grid gap-2">
          <input name="vendor" placeholder="Vendor" className="field" />
          <input name="amount" placeholder="Amount" className="field" />
          <input name="costCode" placeholder="Cost code" className="field" />
          <select name="source" className="field" defaultValue="expense">
            <option value="expense">Expense</option>
            <option value="bill">Bill</option>
            <option value="labor">Labor</option>
            <option value="receipt">Receipt</option>
          </select>
          <input name="memo" placeholder="Memo" className="field" />
          <Button type="submit" variant="outline" className="h-11">
            Post cost
          </Button>
        </ActionForm>
      ) : null}
      {money ? <ReceiptCapture projectId={detail.project.id} codes={costCodes} /> : null}
      <section id="photos" className="flex flex-col gap-3">
        <h2 className="fl-section">Photos</h2>
        <div className="grid grid-cols-3 gap-2">
          {detail.photos
            .filter((photo) => photo.type === "photo")
            .map((photo) => (
              <img
                key={photo.id}
                src={photo.storagePath.startsWith("/") ? photo.storagePath : `/api/files/${photo.id}`}
                alt={captionFromMetadata(photo.metadataJson) || "Job photo"}
                className="aspect-square w-full rounded-lg object-cover"
              />
            ))}
        </div>
        {session.role !== "viewer" ? <PhotoCapture action={photoAction.bind(null, detail.project.id)} label="Take a job photo" submitLabel="Save photo" /> : null}
      </section>
      <GroupedList label="Activity">
        {detail.timeline.map((item) => (
          <li key={item.id} className="fl-cell">
            <span className="min-w-0 flex-1">
              <span className="fl-body block">{item.summary}</span>
              <span className="fl-footnote text-[var(--fl-secondary)]">{formatDateTime(item.createdAt)}</span>
            </span>
          </li>
        ))}
      </GroupedList>
    </div>
  );
}

function prettyCode(code: string) {
  const name = code.split("-")[0]?.toLowerCase() ?? code;
  return name.charAt(0).toUpperCase() + name.slice(1);
}
