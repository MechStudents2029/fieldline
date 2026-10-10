import Link from "next/link";
import { billDrawAction, releaseRetainageAction, setBillingModeAction, voidBillingAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { DrawEditor } from "@/components/draw-editor";
import { SovEditor } from "@/components/sov-editor";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { formatPercent, formatWhole } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { drawSchedule, progressSheet } from "@/lib/services/draws";

export default async function DrawsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) return null;
  const board = drawSchedule(session, id);
  const progress = progressSheet(session, id);
  if (!board || !progress) return null;
  const gap = board.billingMode === "progress" ? progress.billing : board.billing;
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Draws" subtitle={formatWhole(board.contractCents)} search={false} leading={<Link href={`/projects/${id}`}>‹</Link>} />
      </div>
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <div className="md:hidden">
          <Link href={`/projects/${id}`} className="text-[var(--fl-accent)]">
            ‹ Job
          </Link>
          <h1 className="fl-title mt-2">Draws</h1>
        </div>
        <div className="mac-strip">
          <div>
            <p className="mac-t22 num">{formatWhole(gap.billedCents)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Billed</p>
          </div>
          <div>
            <p className="mac-t22 num">{formatPercent(gap.billedBps)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Billed</p>
          </div>
          <div>
            <p className="mac-t22 num">{formatPercent(gap.completeBps)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Complete</p>
          </div>
          <div>
            <p className={`mac-t22 num ${gap.state === "even" ? "" : "text-[var(--mac-danger)]"}`}>{formatWhole(Math.abs(gap.gapCents))}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">{gap.label}</p>
          </div>
        </div>
        {board.canEdit ? (
          <ActionForm action={setBillingModeAction.bind(null, id)} className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              Billing
              <select name="mode" defaultValue={board.billingMode} aria-label="Billing" className="field mt-1">
                <option value="draws">Draws</option>
                <option value="progress">Progress</option>
                <option value="cost_plus">Cost-plus</option>
              </select>
            </label>
            <label className="text-sm">
              Retainage %
              <input name="retainage" defaultValue={(board.retainageBps / 100).toFixed(0)} aria-label="Retainage" className="field mt-1 w-20" />
            </label>
            <label className="text-sm">
              Markup %
              <input name="markup" defaultValue={(board.markupBps / 100).toFixed(1)} aria-label="Markup" className="field mt-1 w-20" />
            </label>
            <label className="text-sm">
              Tax %
              <input name="tax" defaultValue={(board.taxBps / 100).toFixed(2)} aria-label="Tax" className="field mt-1 w-20" />
            </label>
            <button type="submit" className="mac-glass-btn">
              Apply
            </button>
          </ActionForm>
        ) : null}
        {board.billingMode === "cost_plus" ? (
          <p className="mac-t13">
            <Link href={`/projects/${id}/costs`}>Costs</Link>
          </p>
        ) : null}
        {board.billingMode === "draws" ? (
          <>
            <table className="mac-table w-full text-left" aria-label="Schedule">
              <thead>
                <tr>
                  <th>Draw</th>
                  <th className="text-right">Amount</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {board.draws.map((draw) => (
                  <tr key={draw.id} data-phase={draw.phase}>
                    <th scope="row" className="font-normal">
                      {draw.title}
                    </th>
                    <td className="num text-right">{formatWhole(draw.amountCents)}</td>
                    <td>{draw.dueOn ? formatCalendarDay(draw.dueOn) : "—"}</td>
                    <td>
                      <span className="fl-pill">{draw.label}</span>
                    </td>
                    <td>
                      {board.canEdit && draw.phase === "ready" ? (
                        <ActionForm action={billDrawAction.bind(null, draw.id, id)}>
                          <button type="submit" className="mac-primary" aria-label={`Bill ${draw.title}`}>
                            Bill
                          </button>
                        </ActionForm>
                      ) : null}
                      {draw.invoiceNumber ? <span className="mac-t13">{draw.invoiceNumber}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {board.canEdit ? (
              <DrawEditor
                projectId={id}
                contractCents={board.contractCents}
                schedule={board.schedule}
                initial={board.draws.map((draw) => ({
                  key: draw.id,
                  id: draw.id,
                  title: draw.title,
                  basis: draw.basis,
                  percent: (draw.bps / 100).toFixed(0),
                  dollars: (draw.amountCents / 100).toFixed(2),
                  scheduleItemId: draw.scheduleItemId ?? "",
                  dueOn: draw.dueOn ?? "",
                  locked: draw.locked,
                }))}
              />
            ) : null}
          </>
        ) : (
          <>
            {progress.canEdit ? <SovEditor projectId={id} lines={progress.lines} retainageBps={progress.retainageBps} /> : null}
            <ul className="flex flex-col gap-2">
              {progress.applications.map((invoice) => (
                <li key={invoice.id} className="flex flex-wrap items-center gap-3">
                  <Link href={`/applications/${invoice.id}`} className="mac-t13 font-semibold text-[var(--mac-accent)]">
                    {invoice.number}
                  </Link>
                  <span className="fl-pill">{invoice.status === "draft" ? "Draft" : invoice.status === "void" ? "Void" : invoice.status === "paid" ? "Paid" : "Open"}</span>
                  <span className="num">{formatWhole(invoice.totalCents)}</span>
                  {progress.canEdit && invoice.status !== "void" && invoice.status !== "paid" ? (
                    <ActionForm action={voidBillingAction.bind(null, invoice.id, id)}>
                      <button type="submit" className="mac-glass-btn" aria-label={`Void ${invoice.number}`}>
                        Void
                      </button>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
            {progress.canEdit && progress.closed && progress.heldCents > 0 ? (
              <ActionForm action={releaseRetainageAction.bind(null, id)}>
                <button type="submit" className="mac-primary">
                  Release retainage {formatWhole(progress.heldCents)}
                </button>
              </ActionForm>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
