import Link from "next/link";
import { addCostAction, addWorkExceptionAction, createCoAction, draftCoAction, issueInvoiceAction, noteAction, photoAction, removeWorkExceptionAction, setBaselineAction, taskAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { GroupedList, GroupedRow, NumberStrip } from "@/components/ios";
import { JobList, type JobListItem } from "@/components/mac/job-list";
import { jobSectionTabs } from "@/components/job-section-tabs";
import { Toolbar } from "@/components/mac/toolbar";
import { MissingRecord } from "@/components/missing-record";
import { PhotoCapture } from "@/components/photo-capture";
import { ReceiptCapture } from "@/components/receipt-capture";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay, formatDateTime, formatWarrantyDay } from "@/lib/format";
import { formatWorkdayVariance } from "@/lib/schedule/delays";
import { overBudgetPercent } from "@/lib/margin/category";
import { formatMoney, formatPercent, formatWhole } from "@/lib/money";
import { canEditCrm, canEditSchedule } from "@/lib/permissions";
import { projectBills } from "@/lib/services/bills";
import { projectPurchaseOrders } from "@/lib/services/purchase-orders";
import { captionFromMetadata, listPriceBook, listProjects, pipelineBoard, projectDetail } from "@/lib/services/read";
import { jobInspectionMarks, scheduleGateLabels } from "@/lib/services/permits";
import { jobSchedule } from "@/lib/services/schedule";
import { scheduleCompare } from "@/lib/services/schedule-plan";
import { listWorkExceptions } from "@/lib/services/work-calendar";
import { LinkedRfis } from "@/components/linked-rfis";
import { CommentThread } from "@/components/comment-thread";
import { PunchSection } from "@/components/punch-section";
import { RfiSection } from "@/components/rfi-section";
import { SubmittalSection } from "@/components/submittal-section";
import { punchBoard } from "@/lib/services/punch";
import { projectVisuals } from "@/lib/services/markup";
import { jobRfis } from "@/lib/services/rfis";
import { jobSubmittals } from "@/lib/services/submittals";
import { bidComposer } from "@/lib/services/bids";
import { costPlusSummary } from "@/lib/services/cost-plus";
import { drawSchedule } from "@/lib/services/draws";
import { selectionBoard } from "@/lib/services/selections";
import { timeBoard } from "@/lib/services/time";
import { localDay } from "@/lib/time/calendar";

function officeToday(timeZone: string) {
  return localDay(Date.now(), timeZone);
}

function codeTone(percent: number | null, level: string) {
  if (level === "over" || (percent != null && percent >= 100)) return "fl-late";
  if (percent != null && percent >= 90) return "fl-close";
  return "text-[var(--fl-secondary)]";
}

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const created = (await searchParams).created;
  const createdCount = created && /^\d+$/.test(created) ? created : null;
  const session = await requireSession();
  const detail = projectDetail(session.orgId, id, session.role);
  if (!detail?.contact) return <MissingRecord orgName={session.orgName} kind="job" />;
  const costCodes = detail.money ? listPriceBook(session.orgId).map((item) => item.code) : [];
  const jobBills = detail.money ? projectBills(session.orgId, detail.project.id, session.role) : [];
  const jobOrders = detail.money ? projectPurchaseOrders(session.orgId, detail.project.id, session.role) : [];
  const money = detail.financials;
  const board = timeBoard(session);
  const crew = board.office?.clockedIn.filter((row) => row.projectName === detail.project.name) ?? [];
  const todayKey = officeToday(board.timeZone);
  const schedule = jobSchedule(session, detail.project.id);
  const marks = jobInspectionMarks(session, detail.project.id);
  const gates = scheduleGateLabels(session.orgId);
  const compare = scheduleCompare(session, detail.project.id);
  const compareById = new Map(compare.items.map((item) => [item.id, item]));
  const jobDays = listWorkExceptions(session, detail.project.id);
  const picks = selectionBoard(session, detail.project.id, todayKey);
  const punch = punchBoard(session, detail.project.id);
  const rfiBoard = jobRfis(session, detail.project.id);
  const submittalBoard = jobSubmittals(session, detail.project.id);
  const bidCount = detail.money ? (bidComposer(session, detail.project.id)?.bids.length ?? 0) : 0;
  const billing = detail.money && detail.project.billingMode !== "cost_plus" ? drawSchedule(session, detail.project.id)?.billing : null;
  const costPlus = detail.money && detail.project.billingMode === "cost_plus" ? costPlusSummary(session.orgId, detail.project.id) : null;
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
          subtitle={`${detail.contact.name}${detail.project.address ? ` · ${detail.project.address}` : ""}`}
          search={false}
          center={jobSectionTabs(detail.project.id, "overview")}
          trailing={
            money ? (
              <span className="hidden md:inline">
                <button type="submit" form="new-change-order" data-mac-primary className="mac-primary">
                  <span aria-hidden="true">+</span>
                  Change order
                </button>
              </span>
            ) : null
          }
        />
      </div>
      <div className="md:px-6 md:pb-8">
      {detail.project.templateName ? (
        <p className="mb-3 hidden mac-t11 text-[var(--mac-secondary)] md:block">
          {detail.project.templateName} v{detail.project.templateVersion}
        </p>
      ) : null}
      {createdCount ? <p role="status">Created {createdCount} items</p> : null}
      <p className="mb-3 flex gap-3">
        <Link href={`/todos?job=${detail.project.id}`} className="text-sm text-[var(--fl-accent)]">
          To-dos
        </Link>
        {canEditCrm(session.role) ? (
          <Link href={`/projects/${detail.project.id}/template`} className="text-sm text-[var(--fl-accent)]">
            Template
          </Link>
        ) : null}
      </p>
      <div className="fl-safe-top md:hidden">
        <Link href="/projects" className="fl-body text-[var(--fl-accent)]">
          ‹ Jobs
        </Link>
        <h1 className="fl-title mt-2">{detail.project.name}</h1>
        {detail.project.templateName ? (
          <p className="mac-t11 text-[var(--fl-secondary)]">
            {detail.project.templateName} v{detail.project.templateVersion}
          </p>
        ) : null}
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
      <CommentThread entityType="project" entityId={detail.project.id} />
      {punch ? (
        <PunchSection
          board={punch}
          rfis={Object.fromEntries(
            punch.items.map((item) => [item.id, (rfiBoard?.items ?? []).filter((rfi) => rfi.relatedType === "punch" && rfi.relatedId === item.id && rfi.status !== "void")]),
          )}
          visuals={Object.fromEntries(projectVisuals(session, detail.project.id).filter((row) => row.linkType === "punch").map((row) => [row.linkId, row.visual]))}
        />
      ) : null}
      {rfiBoard ? <RfiSection board={rfiBoard} /> : null}
      {submittalBoard ? <SubmittalSection board={submittalBoard} /> : null}
      <nav aria-label="Job sections" className="grid grid-cols-5 rounded-[10px] bg-[var(--fl-fill)] p-1 md:hidden">
        <a href="#overview" className="rounded-lg bg-card py-1.5 text-center fl-footnote">
          Overview
        </a>
        <a href="#budget" className="py-1.5 text-center fl-footnote text-[var(--fl-secondary)]">
          Budget
        </a>
        <Link href={`/projects/${detail.project.id}/logs`} className="py-1.5 text-center fl-footnote text-[var(--fl-secondary)]">
          Logs
        </Link>
        <Link href={`/projects/${detail.project.id}/files`} className="py-1.5 text-center fl-footnote text-[var(--fl-secondary)]">
          Files
        </Link>
        <Link href={`/projects/${detail.project.id}/selections`} className="py-1.5 text-center fl-footnote text-[var(--fl-secondary)]">
          Selections
        </Link>
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
            <table className="mac-table mac-budget w-full text-left">
              <thead>
                <tr>
                  <th className="px-2">Cost code</th>
                  <th className="px-2">Code</th>
                  <th className="px-2 text-right">Budget</th>
                  <th className="mac-budget-extra px-2 text-right">Committed</th>
                  <th className="px-2 text-right">Spent</th>
                  <th className="mac-budget-extra px-2 text-right">Projected</th>
                  <th className="mac-budget-extra px-2 text-right">To complete</th>
                  <th className="mac-budget-extra px-2 text-right">Variance</th>
                  <th className="px-2">Used</th>
                </tr>
              </thead>
              <tbody>
                {money.byCode.map((row) => (
                  <tr key={row.code} id={`code-${row.code}`} data-code={row.code}>
                    <th scope="row" className="mac-name px-2 font-normal" title={codeName(detail.budget, row.code)}>
                      {codeName(detail.budget, row.code)}
                    </th>
                    <td className="px-2 text-[var(--mac-secondary)]" title={row.code}>{row.code}</td>
                    <td className="px-2 text-right num" data-kind="budget">{formatWhole(row.budgetCents)}</td>
                    <td className="mac-budget-extra px-2 text-right num" data-kind="committed">{formatWhole(row.committedOpenCents)}</td>
                    <td className="px-2 text-right num" data-kind="actual">{formatWhole(row.actualCents)}</td>
                    <td className="mac-budget-extra px-2 text-right num" data-kind="projected">{formatWhole(row.projectedCents)}</td>
                    <td className="mac-budget-extra px-2 text-right num" data-kind="remaining">{formatWhole(row.costToCompleteCents)}</td>
                    <td className="mac-budget-extra px-2 text-right num" data-kind="variance">{formatWhole(row.varianceCents)}</td>
                    <td className="px-2">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--mac-fill)]">
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
          <ul className="mt-3 flex flex-col gap-2 md:hidden">
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
              href={money ? `/projects/${detail.project.id}/orders/${order.id}` : undefined}
              title={`CO-${order.number} · ${order.title} · ${order.status}`}
              trailing={money ? formatWhole(order.priceDeltaCents) : undefined}
              chevron={Boolean(money)}
            />
          ))}
        </GroupedList>
        {picks && picks.rows.length > 0 ? (
          <GroupedList label="Selections">
            {picks.rows.map((row) => (
              <GroupedRow
                key={row.id}
                href={`/projects/${detail.project.id}/selections`}
                title={row.title}
                subtitle={row.chosenName ? `${row.area} · ${row.chosenName}` : row.area || undefined}
                trailing={<span className={row.overdue ? "fl-late" : undefined}>{row.statusLabel}</span>}
              />
            ))}
          </GroupedList>
        ) : null}
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
      <section className="flex flex-col gap-3 md:hidden">
        <h2 className="fl-section">Change orders</h2>
        <ul className="fl-group">
          {detail.orders.map((order) => (
            <li key={order.id} className="fl-cell flex-col items-stretch">
              <span className="flex w-full items-center gap-2">
                <span className="fl-body flex-1">{order.title}</span>
                {money ? <span className="tabular-nums">{formatWhole(order.priceDeltaCents)}</span> : null}
              </span>
              <LinkedRfis rows={(rfiBoard?.items ?? []).filter((item) => item.relatedType === "change_order" && item.relatedId === order.id && item.status !== "void")} />
            </li>
          ))}
        </ul>
      </section>
      {money ? (
        <div className="md:sr-only">
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
        </div>
      ) : null}
      <div className="flex flex-col gap-7">
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
      </div>
      {money ? (
        <>
          <GroupedList label="Bids">
            <GroupedRow href={`/projects/${detail.project.id}/bids`} title="Bid requests" trailing={String(bidCount)} />
          </GroupedList>
          <GroupedList label="Draws">
            <GroupedRow
              href={`/projects/${detail.project.id}/draws`}
              title="Draw schedule"
              trailing={billing ? <span className="num">{formatPercent(billing.billedBps)}</span> : undefined}
            />
          </GroupedList>
        </>
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
              <span className="tabular-nums">{formatWhole(cost.amountCents)}<span className="sr-only">{formatMoney(cost.amountCents)}</span></span>
            </li>
          ))}
        </GroupedList>
      ) : null}
      <div className="flex flex-col gap-7 md:hidden">
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
      </div>
      <section id="schedule" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="fl-section">Schedule</h2>
          <span className="flex items-center gap-2">
            {compare.variance != null ? <span className="num mac-t13">{formatWorkdayVariance(compare.variance)}</span> : null}
            {canEditSchedule(session.role) ? (
              <ActionForm action={setBaselineAction.bind(null, detail.project.id)}>
                <button className="ctl" type="submit">
                  Set baseline
                </button>
              </ActionForm>
            ) : null}
            {canEditSchedule(session.role) ? (
              <Link href={`/schedule?job=${detail.project.id}&new=1`} aria-label="Add schedule">
                Add
              </Link>
            ) : null}
          </span>
        </div>
        {marks.length > 0 ? (
          <ul className="fl-group" aria-label="Inspections">
            {marks.map((mark) => (
              <li key={mark.id}>
                <Link href={`/projects/${detail.project.id}/permits?inspection=${mark.id}`} className="fl-cell fl-press">
                  <span className="min-w-0 flex-1">
                    <span className="fl-body block truncate">
                      {mark.name}
                      {mark.attempt > 1 ? ` ${mark.attempt}` : ""}
                    </span>
                    <span className="fl-footnote text-[var(--fl-secondary)]">{mark.date ? formatCalendarDay(mark.date) : "—"}</span>
                  </span>
                  <span className="fl-pill">{mark.resultLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <ul className="fl-group">
          {schedule.length === 0 ? <li className="fl-cell">No items</li> : null}
          {schedule.map((item) => {
            const late = (rfiBoard?.items ?? []).some((rfi) => rfi.relatedType === "schedule" && rfi.relatedId === item.id && rfi.overdue);
            const base = compareById.get(item.id);
            return (
            <li key={item.id} className="fl-cell">
              <span className="min-w-0 flex-1">
                <span className="fl-body block truncate">{item.title}</span>
                <span className="fl-footnote block truncate text-[var(--fl-secondary)]">
                  {formatCalendarDay(item.startDate)}
                  {item.endDate !== item.startDate ? ` – ${formatCalendarDay(item.endDate)}` : ""} · {item.who}
                  {base?.baselineEnd ? ` · Baseline ${formatCalendarDay(base.baselineStart || base.baselineEnd)}${base.baselineEnd !== base.baselineStart ? ` – ${formatCalendarDay(base.baselineEnd)}` : ""}` : ""}
                  {base?.variance != null && base.variance !== 0 ? ` · ${formatWorkdayVariance(base.variance)}` : ""}
                  {gates.get(item.id) ? ` · ${gates.get(item.id)}` : ""}
                </span>
                <LinkedRfis rows={(rfiBoard?.items ?? []).filter((rfi) => rfi.relatedType === "schedule" && rfi.relatedId === item.id && rfi.status !== "void")} />
              </span>
              {late ? <span className="text-[11px] text-[var(--mac-secondary)]">RFI</span> : null}
              <span className="fl-pill">{item.status === "planned" ? "Planned" : item.status === "confirmed" ? "Confirmed" : item.status === "done" ? "Done" : item.status}</span>
            </li>
            );
          })}
        </ul>
        {jobDays.length > 0 || canEditSchedule(session.role) ? (
          <div className="flex flex-col gap-2">
            {jobDays.map((day) => (
              <div key={day.id} className="flex items-center gap-2 mac-t13">
                <span className="min-w-0 flex-1 truncate">
                  {day.title} · {formatCalendarDay(day.startDate)}
                  {day.endDate !== day.startDate ? ` – ${formatCalendarDay(day.endDate)}` : ""}
                </span>
                <span className="fl-pill fl-pill-sm">{day.kind === "work" ? "Work" : "Off"}</span>
                {canEditSchedule(session.role) ? (
                  <ActionForm action={removeWorkExceptionAction.bind(null, detail.project.id)}>
                    <input type="hidden" name="id" value={day.id} />
                    <button className="ctl" type="submit" aria-label={`Remove ${day.title}`}>
                      Remove
                    </button>
                  </ActionForm>
                ) : null}
              </div>
            ))}
            {canEditSchedule(session.role) ? (
              <ActionForm action={addWorkExceptionAction.bind(null, detail.project.id)} className="flex flex-wrap items-center gap-2">
                <input name="title" aria-label="Exception title" placeholder="Title" className="ctl" required maxLength={60} />
                <input name="startDate" type="date" aria-label="Exception date" className="ctl" required />
                <select name="kind" aria-label="Exception kind" className="ctl" defaultValue="off">
                  <option value="off">Off</option>
                  <option value="work">Work</option>
                </select>
                <button className="ctl" type="submit">
                  Add day
                </button>
              </ActionForm>
            ) : null}
          </div>
        ) : null}
      </section>
      <section id="photos" className="mac-docs flex flex-col gap-3">
        <h2 className="fl-section">Photos</h2>
        <div className="grid grid-cols-3 gap-2">
          {detail.photos
            .filter((photo) => photo.type === "photo")
            .map((photo) => (
              <a key={photo.id} href={`/projects/${detail.project.id}/markup/${photo.id}`} className="relative block" aria-label={`Mark up ${captionFromMetadata(photo.metadataJson) || "photo"}`}>
                <img
                  src={photo.storagePath.startsWith("/") ? photo.storagePath : `/api/files/${photo.id}`}
                  alt={captionFromMetadata(photo.metadataJson) || "Job photo"}
                  className="aspect-square w-full rounded-lg object-cover"
                />
              </a>
            ))}
        </div>
        {session.role !== "viewer" ? <PhotoCapture action={photoAction.bind(null, detail.project.id)} label="Take a job photo" submitLabel="Save photo" /> : null}
      </section>
      <div className="md:hidden">
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
      </div>
      <aside className="mac-inspector" aria-label="Inspector">
        <p className="mac-t11 font-semibold text-[var(--mac-secondary)]">Details</p>
        <dl className="mac-kv">
          <div><dt>Status</dt><dd>{punch?.closeout.closed ? "Closed" : punch?.closeout.substantial ? "Substantial" : titleCase(detail.project.status)}</dd></div>
          {punch?.closeout.endsOn ? <div><dt>Warranty</dt><dd>{formatWarrantyDay(punch.closeout.endsOn)}</dd></div> : null}
          <div><dt>Start</dt><dd>{formatCalendarDay(detail.project.startDate)}</dd></div>
          <div><dt>Finish</dt><dd>{formatCalendarDay(detail.project.endDate)}</dd></div>
          <div><dt>Lead</dt><dd>{detail.ownerName || "—"}</dd></div>
          <div><dt>Crew</dt><dd>{crew.length > 0 ? crew.map((person) => person.name).join(", ") : "—"}</dd></div>
        </dl>
        <p className="mac-t11 font-semibold text-[var(--mac-secondary)]">Client</p>
        <dl className="mac-kv">
          <div><dt>Name</dt><dd>{detail.contact.name}</dd></div>
          {detail.contact.phone ? <div><dt>Phone</dt><dd>{detail.contact.phone}</dd></div> : null}
          {detail.contact.email ? <div><dt>Email</dt><dd className="truncate">{detail.contact.email}</dd></div> : null}
          {detail.project.address ? <div><dt>Address</dt><dd>{detail.project.address}</dd></div> : null}
        </dl>
        {money ? (
          <>
            <p className="mac-t11 font-semibold text-[var(--mac-secondary)]">Contract</p>
            <dl className="mac-kv">
              <div><dt>Proposal</dt><dd className="num">{formatWhole(detail.project.originalContractCents)}</dd></div>
              {detail.orders.map((order) => (
                <div key={order.id}>
                  <dt>CO {order.number}</dt>
                  <dd className="num">+{formatWhole(order.priceDeltaCents)}</dd>
                </div>
              ))}
              <div><dt>Total</dt><dd className="num font-semibold">{formatWhole(money.contractCents)}</dd></div>
            </dl>
            {costPlus ? (
              <>
                <p className="mac-t11 font-semibold text-[var(--mac-secondary)]">Billing</p>
                <dl className="mac-kv">
                  <div><dt>Unbilled</dt><dd className="num">{formatWhole(costPlus.unbilledCostCents)}</dd></div>
                  <div><dt>Billed</dt><dd className="num">{formatWhole(costPlus.billedCents)}</dd></div>
                </dl>
                <Link href={`/projects/${detail.project.id}/costs`} className="mac-glass-btn">
                  Costs
                </Link>
              </>
            ) : null}
            {billing ? (
              <>
                <p className="mac-t11 font-semibold text-[var(--mac-secondary)]">Billing</p>
                <dl className="mac-kv">
                  <div><dt>Billed</dt><dd className="num">{formatWhole(billing.billedCents)}</dd></div>
                  <div><dt>Billed</dt><dd className="num">{formatPercent(billing.billedBps)}</dd></div>
                  <div><dt>Complete</dt><dd className="num">{formatPercent(billing.completeBps)}</dd></div>
                  <div>
                    <dt>{billing.label}</dt>
                    <dd className={billing.state === "even" ? "num" : "num text-[var(--mac-danger)]"}>{formatWhole(Math.abs(billing.gapCents))}</dd>
                  </div>
                </dl>
              </>
            ) : null}
            <p className="mac-t11 font-semibold text-[var(--mac-secondary)]">Payments</p>
            <dl className="mac-kv">
              {detail.invoices.map((invoice) => {
                const pending = invoice.status !== "paid";
                return (
                  <div key={invoice.id}>
                    <dt>{titleCase(invoice.type)}</dt>
                    <dd className="num">
                      {formatWhole(pending ? invoice.totalCents - invoice.amountPaidCents : invoice.amountPaidCents)}
                      {pending ? (
                        <span className="mac-due">{invoice.dueDate < todayKey ? "Late" : `Due ${formatCalendarDay(invoice.dueDate)}`}</span>
                      ) : (
                        <span className="ml-1.5 text-[var(--mac-secondary)]">Paid</span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </>
        ) : null}
        <a className="mac-glass-btn" href={`/portal/${detail.project.portalToken}`}>
          Copy portal link
        </a>
      </aside>
    </div>
  );
}

function prettyCode(code: string) {
  const name = code.split("-")[0]?.toLowerCase() ?? code;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function codeName(budget: { name: string; costCode: string | null }[], code: string) {
  return budget.find((line) => line.costCode === code)?.name || prettyCode(code);
}

function titleCase(value: string) {
  if (!value) return "—";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
