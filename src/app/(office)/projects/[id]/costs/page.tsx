import Link from "next/link";
import { createCostInvoiceAction, saveCostMarkupsAction, setCostBillableAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { formatMoney, formatWhole } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { costPlusBoard } from "@/lib/services/cost-plus";
import { presentCostLines } from "@/lib/invoice/cost-plus";
import { calendarForOrg } from "@/lib/services/time";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

export const dynamic = "force-dynamic";

function stateLabel(state: string) {
  if (state === "billed") return "Billed";
  if (state === "nonbillable") return "Non-billable";
  return "Unbilled";
}

function todayIn(zone: string) {
  return localDay(Date.now(), zone);
}

export default async function CostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) return null;
  const board = costPlusBoard(session, id);
  if (!board) return null;
  const zone = calendarForOrg(session.orgId).timeZone;
  const today = todayIn(zone);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || "") ? query.from! : addCalendarDays(today, -60);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || "") ? query.to! : today;
  const shown = board.costs.filter((cost) => cost.occurredOn >= from && cost.occurredOn <= to);
  const preview = presentCostLines(
    shown.filter((cost) => cost.state === "unbilled"),
    "grouped",
    "baked",
  );
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Costs" subtitle={board.projectName} search={false} leading={<Link href={`/projects/${id}`}>‹</Link>} />
      </div>
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <div className="mac-strip">
          <div>
            <p className="mac-t22 num">{formatWhole(board.unbilledCostCents)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Unbilled</p>
          </div>
          <div>
            <p className="mac-t22 num">{formatWhole(board.billedCents)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Billed</p>
          </div>
          <div>
            <p className="mac-t22 num">{(board.markupBps / 100).toFixed(1)}%</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Markup</p>
          </div>
        </div>
        <form className="flex flex-wrap items-end gap-2" method="get">
          <label className="mac-t11">
            From
            <input className="field mt-1" type="date" name="from" defaultValue={from} aria-label="From" />
          </label>
          <label className="mac-t11">
            To
            <input className="field mt-1" type="date" name="to" defaultValue={to} aria-label="To" />
          </label>
          <button className="ctl" type="submit">
            Show
          </button>
        </form>
        {board.canEdit ? (
          <ActionForm action={saveCostMarkupsAction.bind(null, id)} className="flex flex-wrap items-end gap-2">
            <label className="mac-t11">
              Markup %
              <input className="field mt-1 w-20" name="markup" aria-label="Default markup" defaultValue={(board.markupBps / 100).toFixed(1)} />
            </label>
            <label className="mac-t11">
              Tax %
              <input className="field mt-1 w-20" name="tax" aria-label="Tax" defaultValue={(board.taxBps / 100).toFixed(2)} />
            </label>
            {board.codes.map((code) => (
              <label key={code.costCode} className="mac-t11">
                {code.costCode}
                <input type="hidden" name="code" value={code.costCode} />
                <input className="field mt-1 w-20" name={`markup_${code.costCode}`} aria-label={`${code.costCode} markup`} defaultValue={(code.markupBps / 100).toFixed(1)} />
              </label>
            ))}
            <button className="ctl" type="submit">
              Save
            </button>
          </ActionForm>
        ) : null}
        <ActionForm action={createCostInvoiceAction.bind(null, id)} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="mac-t11">
              Lines
              <select className="ctl ml-2" name="presentAs" aria-label="Lines" defaultValue="grouped">
                <option value="grouped">Grouped</option>
                <option value="itemized">Itemized</option>
              </select>
            </label>
            <label className="mac-t11">
              Markup
              <select className="ctl ml-2" name="markupDisplay" aria-label="Markup display" defaultValue="baked">
                <option value="baked">In each line</option>
                <option value="separate">Separate line</option>
              </select>
            </label>
            {board.canEdit ? (
              <button className="mac-primary" type="submit">
                Create invoice
              </button>
            ) : null}
          </div>
          <table className="mac-table w-full text-left" aria-label="Costs">
            <thead>
              <tr>
                <th />
                <th>Cost</th>
                <th>Date</th>
                <th>Code</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((cost) => (
                <tr key={cost.key} data-state={cost.state}>
                  <td>
                    {cost.state === "unbilled" ? (
                      <input type="checkbox" name="cost" value={cost.key} defaultChecked aria-label={cost.label} />
                    ) : null}
                  </td>
                  <th scope="row" className="font-normal">
                    {cost.label}
                    {cost.billRateCents != null ? <span className="ml-2 text-[var(--mac-secondary)]">{formatMoney(cost.billRateCents)}/h</span> : null}
                  </th>
                  <td>{formatCalendarDay(cost.occurredOn)}</td>
                  <td>{cost.costCode}</td>
                  <td className="num text-right">{formatMoney(cost.costCents)}</td>
                  <td>
                    <span className="fl-pill fl-pill-sm">{stateLabel(cost.state)}</span>
                    {cost.invoiceId && cost.invoiceNumber ? (
                      <Link className="ml-2" href={`/projects/${id}/invoices/${cost.invoiceId}`}>
                        {cost.invoiceNumber}
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ActionForm>
        {shown
          .filter((cost) => cost.state === "unbilled" && board.canEdit)
          .map((cost) => (
            <ActionForm key={`nb-${cost.key}`} action={setCostBillableAction.bind(null, id)}>
              <input type="hidden" name="key" value={cost.key} />
              <input type="hidden" name="billable" value="0" />
              <button className="ctl" type="submit" aria-label={`Non-billable ${cost.label}`}>
                Non-billable
              </button>
            </ActionForm>
          ))}
        <section aria-label="Grouped">
          <h2 className="mac-t11 font-semibold text-[var(--mac-secondary)]">Grouped</h2>
          <ul>
            {preview.map((line) => (
              <li key={line.description} className="flex justify-between mac-t13">
                <span>{line.description}</span>
                <span className="num">{formatMoney(line.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
