import Link from "next/link";
import { notFound } from "next/navigation";
import { saveCashSettingsAction } from "@/app/(office)/reports/cash/actions";
import { ActionForm } from "@/components/action-form";
import { CashChart } from "@/components/cash-chart";
import { CashTable } from "@/components/cash-table";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { formatWhole } from "@/lib/money";
import { canSeeCash } from "@/lib/permissions";
import { cashForecast } from "@/lib/services/cash";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || "";
}

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

export default async function CashPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!canSeeCash(session.role)) notFound();
  const params = await searchParams;
  const projected = one(params.projected) === "1";
  const jobId = one(params.job);
  const customerId = one(params.customer);
  const cell = one(params.cell);
  const board = cashForecast(session, { projected, jobId, customerId });
  const base = new URLSearchParams();
  if (projected) base.set("projected", "1");
  if (jobId) base.set("job", jobId);
  if (customerId) base.set("customer", customerId);
  const withCell = (rowId: string, columnKey: string) => {
    const next = new URLSearchParams(base);
    next.set("cell", `${rowId}:${columnKey}`);
    return `/reports/cash?${next.toString()}`;
  };
  const close = base.toString() ? `/reports/cash?${base.toString()}` : "/reports/cash";
  const projectedParams = new URLSearchParams(base);
  if (projected) projectedParams.delete("projected");
  else projectedParams.set("projected", "1");
  const projectedHref = projectedParams.toString() ? `/reports/cash?${projectedParams.toString()}` : "/reports/cash";
  const csv = `/api/export/cash?${base.toString()}`;
  const print = `/reports/cash/print?${base.toString()}`;
  const [rowId, columnKey] = cell.split(":");
  const row = board.forecast.rows.find((item) => item.id === rowId);
  const index = board.forecast.columns.findIndex((column) => column.key === columnKey);
  const lines = row && index >= 0 ? row.cells[index]?.lines ?? [] : null;
  const column = index >= 0 ? board.forecast.columns[index] : undefined;
  const ending = board.forecast.rows.find((item) => item.id === "balance")?.cells.at(-1)?.cents ?? board.openingCents;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Toolbar
        title="Cash"
        subtitle={formatWhole(ending)}
        search={false}
        trailing={
          <span className="flex items-center gap-2">
            <Link href={projectedHref} className="mac-glass-btn" aria-pressed={projected}>
              Projected
            </Link>
            <a className="mac-glass-btn" href={csv}>
              CSV
            </a>
            <a className="mac-glass-btn" href={print}>
              Print
            </a>
          </span>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <details>
            <summary className="mac-glass-btn inline-flex w-fit cursor-pointer list-none">Balance {formatWhole(board.openingCents)}</summary>
            <ActionForm action={saveCashSettingsAction} className="mt-2 flex max-w-xl flex-wrap items-end gap-2">
              <label className="text-[13px]">
                Starting
                <input name="opening" aria-label="Starting balance" defaultValue={dollars(board.openingCents)} className="field mt-1 w-28" />
              </label>
              <label className="text-[13px]">
                Low
                <input name="low" aria-label="Low balance" defaultValue={dollars(board.lowCents)} className="field mt-1 w-28" />
              </label>
              <label className="text-[13px]">
                Customer
                <select name="contactId" aria-label="Customer" className="field mt-1" defaultValue="">
                  <option value=""> </option>
                  {board.customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                      {customer.daysLate != null ? ` ${customer.daysLate}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[13px]">
                Days
                <input name="daysLate" aria-label="Days late" className="field mt-1 w-16" />
              </label>
              <button type="submit" className="ctl">
                Save
              </button>
            </ActionForm>
          </details>
          <form className="flex flex-wrap items-center gap-2" method="get">
            {projected ? <input type="hidden" name="projected" value="1" /> : null}
            <select name="job" aria-label="Job" className="ctl" defaultValue={jobId}>
              <option value="">Job</option>
              {board.jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>
            <select name="customer" aria-label="Customer" className="ctl" defaultValue={customerId}>
              <option value="">Customer</option>
              {board.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
            <button type="submit" className="ctl">
              Filter
            </button>
          </form>
        </div>
        <CashChart points={board.forecast.chart} />
        <CashTable forecast={board.forecast} hrefFor={withCell} />
      </div>
      {lines ? (
        <aside role="dialog" aria-label="Cash" data-cash-pane className="absolute inset-y-0 right-0 z-20 flex w-[320px] flex-col gap-3 overflow-auto border-l border-[var(--mac-separator)] bg-[var(--mac-window)] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="mac-t15">
              {row?.label} · {column?.label}
            </p>
            <Link href={close} className="mac-t13 text-[var(--mac-secondary)]">
              Close
            </Link>
          </div>
          <ul className="flex flex-col">
            {lines.length === 0 ? <li className="mac-t13 text-[var(--mac-secondary)]">0</li> : null}
            {lines.map((line) => (
              <li key={line.id} className={`flex flex-col gap-0.5 border-b border-[var(--mac-separator)] py-2 ${line.kind === "projected" ? "opacity-60" : ""}`}>
                <a href={line.href} className="mac-t13">
                  {line.doc}
                </a>
                <span className="mac-t11 text-[var(--mac-secondary)]">{[line.job, line.customer].filter(Boolean).join(" · ")}</span>
                <span className="num mac-t13">
                  {formatWhole(line.direction === "out" ? -line.cents : line.cents)} · {formatCalendarDay(line.date)}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
