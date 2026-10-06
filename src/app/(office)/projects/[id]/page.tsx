import Link from "next/link";
import { addCostAction, createCoAction, draftCoAction, issueInvoiceAction, noteAction, photoAction, taskAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { GroupedList, GroupedRow, NumberStrip } from "@/components/ios";
import { JobList, type JobListItem } from "@/components/mac/job-list";
import { Segmented, Toolbar } from "@/components/mac/toolbar";
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
import { captionFromMetadata, listPriceBook, listProjects, pipelineBoard, projectDetail } from "@/lib/services/read";
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
  const paid = detail.invoices.reduce((sum, invoice) => sum + invoice.amountPaidCents, 0);
  const projectRows = listProjects(session.orgId);
  const openLeads = pipelineBoard(session.orgId).cards.filter((card) => card.stage.kind === "open");
  const where = (address: string | null | undefined) => {
    if (!address) return "";
    const parts = address.split(",").map((part) => part.trim());
    return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? "");
  };
  const items: JobListItem[] = [
    ...projectRows.filter((row) => row.project.status === "active").map((row) => ({ href: `/projects/${row.project.id}`, title: row.project.name, subtitle: where(row.project.address), group: "In progress" })),
    ...openLeads.filter((card) => card.stage.name === "Estimate sent" || card.stage.name === "Negotiation").map((card) => ({ href: `/leads/${card.lead.id}`, title: card.lead.title, subtitle: card.contact.name, group: "Up next" })),
    ...openLeads.filter((card) => card.stage.name !== "Estimate sent" && card.stage.name !== "Negotiation").map((card) => ({ href: `/leads/${card.lead.id}`, title: card.lead.title, subtitle: card.contact.name, group: "Estimating" })),
    ...projectRows.filter((row) => row.project.status === "complete").map((row) => ({ href: `/projects/${row.project.id}`, title: row.project.name, subtitle: where(row.project.address), group: "Completed" })),
  ];
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-7 pb-8 md:mx-0 md:max-w-none md:flex-row md:gap-0 md:pb-0">
      <div className="hidden w-[300px] shrink-0 lg:block">
        <JobList items={items} selected={`/projects/${detail.project.id}`} />
      </div>
      <div className="min-w-0 flex-1 md:flex md:flex-col">
      <div className="hidden md:block">
        <Toolbar
          title={detail.project.name}
          subtitle={detail.contact.name}
          search={false}
          center={
            <Segmented
              items={[
                { href: "#overview", label: "Overview", current: true },
                { href: "#budget", label: "Budget" },
                { href: `/projects/${detail.project.id}/logs`, label: "Logs" },
                { href: "#photos", label: "Docs" },
              ]}
            />
          }
          trailing={
            money ? (
              <span className="hidden md:inline">
                <button type="submit" form="new-change-order" data-mac-primary className="mac-primary">
                  New change order
                </button>
              </span>
            ) : null
          }
        />
      </div>
      <div className="md:px-6 md:pb-8">
      <div className="fl-safe-top md:hidden">
        <Link href="/projects" className="fl-body text-[var(--fl-accent)]">
          ‹ Jobs
        </Link>
        <h1 className="fl-title mt-2">{detail.project.name}</h1>
        <p className="fl-secondary-text text-[var(--fl-secondary)]">{detail.project.address}</p>
      </div>
      {money ? (
        <div className="md:hidden">
          <NumberStrip
            items={[
              { label: "Contract", value: formatWhole(money.contractCents) },
              { label: "Spent", value: formatWhole(money.actualCents) },
              { label: "Margin", value: formatPercent(money.marginBps), tone: money.alert ? "late" : "neutral" },
            ]}
          />
        </div>
      ) : null}
      <span className="sr-only">Contract {money ? formatMoney(money.contractCents) : ""}</span>
      <span className="sr-only">cost {money ? formatMoney(money.actualCents) : ""}</span>
      {money ? (
        <div className="mac-strip mb-5 hidden md:flex">
          <div>
            <p className="mac-t22 num">{formatWhole(money.contractCents)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Contract</p>
          </div>
          <div>
            <p className="mac-t22 num">{formatWhole(money.actualCents)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Spent</p>
          </div>
          <div>
            <p className={`mac-t22 num ${money.alert ? "text-[var(--mac-danger)]" : ""}`}>{formatPercent(money.marginBps)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Margin</p>
          </div>
          <div>
            <p className="mac-t22 num">{formatWhole(paid)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Paid</p>
          </div>
        </div>
      ) : null}
      <nav aria-label="Job sections" className="grid grid-cols-4 rounded-[10px] bg-[var(--fl-fill)] p-1 md:hidden">
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
          <div className="md:hidden">
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
          </div>
          <div id="codes" className="mt-4 overflow-x-auto md:mt-0">
            <p className="mb-2 hidden mac-t11 font-semibold text-[var(--mac-secondary)] md:block">Budget by cost code</p>
            <table className="mac-table w-full min-w-[40rem] text-left">
              <thead>
                <tr>
                  <th className="px-2">Cost code</th>
                  <th className="px-2 text-right">Budget</th>
                  <th className="px-2 text-right">Committed</th>
                  <th className="px-2 text-right">Spent</th>
                  <th className="px-2 text-right">Projected</th>
                  <th className="px-2 text-right">To complete</th>
                  <th className="px-2 text-right">Variance</th>
                  <th className="px-2">Used</th>
                </tr>
              </thead>
              <tbody>
                {money.byCode.map((row) => (
                  <tr key={row.code} id={`code-${row.code}`} data-code={row.code}>
                    <th scope="row" className={`px-2 font-normal ${codeTone(row.percentOfBudget, row.level)}`}>
                      {row.code}
                    </th>
                    <td className="px-2 text-right num" data-kind="budget">{formatMoney(row.budgetCents)}</td>
                    <td className="px-2 text-right num" data-kind="committed">{formatMoney(row.committedOpenCents)}</td>
                    <td className="px-2 text-right num" data-kind="actual">{formatMoney(row.actualCents)}</td>
                    <td className="px-2 text-right num" data-kind="projected">{formatMoney(row.projectedCents)}</td>
                    <td className="px-2 text-right num" data-kind="remaining">{formatMoney(row.costToCompleteCents)}</td>
                    <td className="px-2 text-right num" data-kind="variance">{formatMoney(row.varianceCents)}</td>
                    <td className="px-2">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--mac-fill)]">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${Math.min(100, Math.round(row.percentOfBudget ?? 0))}%`,
                              background: row.percentOfBudget != null && row.percentOfBudget >= 90 ? "var(--mac-warning)" : "var(--mac-secondary)",
                            }}
                          />
                        </span>
                        <span className={`num ${codeTone(row.percentOfBudget, row.level)}`}>{row.percentOfBudget == null ? "—" : `${Math.round(row.percentOfBudget)}%`}</span>
                      </span>
                    </td>
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
          <ActionForm id="new-change-order" action={createCoAction.bind(null, detail.project.id)} className="grid gap-2">
            <input name="title" aria-label="Change order title" placeholder="Title" className="field" required />
            <textarea name="description" aria-label="What changed" placeholder="What changed" rows={2} className="field" />
            <input name="name" aria-label="Line name" placeholder="Line name" className="field" required />
            <input name="costCode" aria-label="Cost code" placeholder="Cost code" defaultValue="PLB-SINK" className="field" />
            <input name="qty" defaultValue="1" className="field" aria-label="Quantity" />
            <input name="unit" defaultValue="ea" className="field" aria-label="Unit" />
            <input name="unitCost" aria-label="Unit cost in dollars" placeholder="Unit cost" inputMode="decimal" className="field" required />
            <input name="markup" defaultValue="35" className="field" aria-label="Markup percent" />
            <div className="md:hidden">
              <Button type="submit" className="fl-primary">
                New change order
              </Button>
            </div>
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
      </div>
      <aside className="mac-inspector" aria-label="Inspector">
        <p className="mac-t11 font-semibold text-[var(--mac-secondary)]">Details</p>
        <p className="mac-t13">Status {detail.project.status}</p>
        <p className="mac-t13">Start {detail.project.startDate || "—"}</p>
        <p className="mac-t13">Finish {detail.project.endDate || "—"}</p>
        <p className="mac-t11 font-semibold text-[var(--mac-secondary)]">Client</p>
        <p className="mac-t13">{detail.contact.name}</p>
        <p className="mac-t13 text-[var(--mac-secondary)]">{detail.contact.email}</p>
        <p className="mac-t13 text-[var(--mac-secondary)]">{detail.project.address}</p>
        {money ? (
          <>
            <p className="mac-t11 font-semibold text-[var(--mac-secondary)]">Contract</p>
            <p className="mac-t13 num">Total {formatWhole(money.contractCents)}</p>
            {detail.orders.map((order) => (
              <p key={order.id} className="mac-t13 text-[var(--mac-secondary)]">
                CO {order.number} {formatWhole(order.priceDeltaCents)}
              </p>
            ))}
            <p className="mac-t11 font-semibold text-[var(--mac-secondary)]">Payments</p>
            {detail.invoices.map((invoice) => (
              <p key={invoice.id} className="mac-t13">
                {invoice.type} {formatWhole(invoice.amountPaidCents || invoice.totalCents)} {invoice.status}
              </p>
            ))}
          </>
        ) : null}
        <a className="mac-glass-btn" href={`/portal/${detail.project.portalToken}`}>
          Open portal
        </a>
      </aside>
    </div>
  );
}

function prettyCode(code: string) {
  const name = code.split("-")[0]?.toLowerCase() ?? code;
  return name.charAt(0).toUpperCase() + name.slice(1);
}
