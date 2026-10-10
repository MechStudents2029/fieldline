"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createCostInvoiceAction, saveCostMarkupsAction, setCostsBillableAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { SelectionBar } from "@/components/selection-bar";
import { formatCalendarDay } from "@/lib/format";
import { costPlusTotals, presentCostLines, type CostPlusPresent, type MarkupDisplay } from "@/lib/invoice/cost-plus";
import { formatMoney } from "@/lib/money";
import type { CostRow } from "@/lib/services/cost-plus";

function stateLabel(state: string) {
  if (state === "billed") return "Billed";
  if (state === "nonbillable") return "Non-billable";
  return "Unbilled";
}

function percent(bps: number, digits = 1) {
  return `${(bps / 100).toFixed(digits)}%`;
}

export function CostsBoard({
  projectId,
  markupBps,
  taxBps,
  canEdit,
  costs,
  codes,
}: {
  projectId: string;
  markupBps: number;
  taxBps: number;
  canEdit: boolean;
  costs: CostRow[];
  codes: { costCode: string; name: string; markupBps: number }[];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [markupOpen, setMarkupOpen] = useState(false);
  const [presentAs, setPresentAs] = useState<CostPlusPresent>("grouped");
  const [markupDisplay, setMarkupDisplay] = useState<MarkupDisplay>("baked");
  const chosen = costs.filter((cost) => selected.includes(cost.key) && cost.state === "unbilled");
  const lines = useMemo(() => presentCostLines(chosen, presentAs, markupDisplay), [chosen, presentAs, markupDisplay]);
  const totals = useMemo(() => costPlusTotals(chosen, taxBps), [chosen, taxBps]);

  function toggle(key: string, on: boolean) {
    setSelected((current) => (on ? [...current, key] : current.filter((item) => item !== key)));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mac-t13">
        <span>
          Markup <span className="num">{percent(markupBps)}</span>
        </span>
        <span>
          Tax <span className="num">{percent(taxBps, 2)}</span>
        </span>
        {codes.map((code) => (
          <span key={code.costCode}>
            {code.costCode} <span className="num">{percent(code.markupBps)}</span>
          </span>
        ))}
        {canEdit ? (
          <button type="button" className="ctl" onClick={() => setMarkupOpen(true)}>
            Edit markup
          </button>
        ) : null}
      </div>
      {markupOpen && canEdit ? (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/20 p-6" role="presentation" onClick={() => setMarkupOpen(false)}>
          <ActionForm
            action={saveCostMarkupsAction.bind(null, projectId)}
            dataSheet="markup"
            className="mac-box flex w-[320px] flex-col gap-2 p-4"
            onSubmit={(event) => {
              if (event.defaultPrevented) return;
            }}
          >
            <div role="dialog" aria-label="Markup" className="flex flex-col gap-2" onClick={(event) => event.stopPropagation()}>
              <h2 className="mac-t15">Markup</h2>
              <label className="mac-t13">
                Markup %
                <input className="field mt-1" name="markup" aria-label="Default markup" defaultValue={(markupBps / 100).toFixed(1)} />
              </label>
              <label className="mac-t13">
                Tax %
                <input className="field mt-1" name="tax" aria-label="Tax" defaultValue={(taxBps / 100).toFixed(2)} />
              </label>
              {codes.map((code) => (
                <label key={code.costCode} className="mac-t13">
                  {code.costCode}
                  <input type="hidden" name="code" value={code.costCode} />
                  <input className="field mt-1" name={`markup_${code.costCode}`} aria-label={`${code.costCode} markup`} defaultValue={(code.markupBps / 100).toFixed(1)} />
                </label>
              ))}
              <div className="flex items-center gap-2">
                <button className="mac-primary" type="submit">
                  Save
                </button>
                <button className="ctl" type="button" onClick={() => setMarkupOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </ActionForm>
        </div>
      ) : null}
      <ActionForm action={setCostsBillableAction.bind(null, projectId)} className="contents">
        {selected.map((key) => (
          <input key={key} type="hidden" name="key" value={key} />
        ))}
        <SelectionBar label="Costs" count={selected.length} onClear={() => setSelected([])}>
          {canEdit ? (
            <button className="ctl" type="submit">
              Non-billable
            </button>
          ) : null}
        </SelectionBar>
      </ActionForm>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <table className="mac-table mac-costs min-w-0 flex-1 text-left" aria-label="Costs">
          <thead>
            <tr>
              <th className="check" />
              <th>Cost</th>
              <th>Date</th>
              <th>Code</th>
              <th className="text-right">Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {costs.map((cost) => (
              <tr key={cost.key} data-state={cost.state} className={selected.includes(cost.key) ? "is-selected" : undefined}>
                <td className="check">
                  {cost.state === "unbilled" ? (
                    <input
                      type="checkbox"
                      aria-label={cost.label}
                      checked={selected.includes(cost.key)}
                      onChange={(event) => toggle(cost.key, event.target.checked)}
                    />
                  ) : null}
                </td>
                <td>
                  {cost.label}
                  {cost.billRateCents != null ? <span className="ml-2 text-[var(--mac-secondary)]">{formatMoney(cost.billRateCents)}/h</span> : null}
                </td>
                <td>{formatCalendarDay(cost.occurredOn)}</td>
                <td>{cost.costCode}</td>
                <td className="num text-right">{formatMoney(cost.costCents)}</td>
                <td>
                  <span className="fl-pill fl-pill-sm">{stateLabel(cost.state)}</span>
                  {cost.invoiceId && cost.invoiceNumber ? (
                    <Link className="ml-2" href={`/projects/${projectId}/invoices/${cost.invoiceId}`}>
                      {cost.invoiceNumber}
                    </Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <aside role="complementary" className="mac-box flex w-full shrink-0 flex-col gap-2 p-3 lg:w-[280px]" aria-label="Invoice preview">
          <h2 className="mac-t15">Invoice</h2>
          <ul className="flex flex-col gap-1">
            {lines.map((line) => (
              <li key={line.description} className="flex justify-between gap-3 mac-t13">
                <span className="min-w-0 truncate">{line.description}</span>
                <span className="num">{formatMoney(line.amountCents)}</span>
              </li>
            ))}
          </ul>
          <dl className="mac-kv">
            <div>
              <dt>Markup</dt>
              <dd className="num">{formatMoney(totals.markupCents)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd className="num">{formatMoney(totals.taxCents)}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd className="num">{formatMoney(totals.totalCents)}</dd>
            </div>
          </dl>
          <ActionForm action={createCostInvoiceAction.bind(null, projectId)} className="flex flex-col gap-2">
            {chosen.map((cost) => (
              <input key={cost.key} type="hidden" name="cost" value={cost.key} />
            ))}
            <label className="mac-t13">
              Lines
              <select
                className="ctl ml-2"
                name="presentAs"
                aria-label="Lines"
                value={presentAs}
                onChange={(event) => setPresentAs(event.target.value === "itemized" ? "itemized" : "grouped")}
              >
                <option value="grouped">Grouped</option>
                <option value="itemized">Itemized</option>
              </select>
            </label>
            <label className="mac-t13">
              Markup
              <select
                className="ctl ml-2"
                name="markupDisplay"
                aria-label="Markup display"
                value={markupDisplay}
                onChange={(event) => setMarkupDisplay(event.target.value === "separate" ? "separate" : "baked")}
              >
                <option value="baked">In each line</option>
                <option value="separate">Separate line</option>
              </select>
            </label>
            {canEdit ? (
              <button className="mac-primary w-fit" type="submit" disabled={chosen.length === 0}>
                Create invoice
              </button>
            ) : null}
          </ActionForm>
        </aside>
      </div>
    </div>
  );
}
