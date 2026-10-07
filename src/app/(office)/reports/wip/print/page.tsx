import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { formatPercent, formatWhole } from "@/lib/money";
import { canEditCrm } from "@/lib/permissions";
import { wipQuery, wipReport, wipSearch, type WipReport } from "@/lib/services/wip";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function cell(cents: number, danger = false) {
  return <td className="num py-1 pl-2 text-right" style={danger ? { color: "#c8372d" } : undefined}>{formatWhole(cents)}</td>;
}

export default async function WipPrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!canEditCrm(session.role)) notFound();
  const params = await searchParams;
  const query = wipQuery({
    asof: one(params.asof),
    pm: one(params.pm),
    status: one(params.status),
    sort: one(params.sort),
    dir: one(params.dir),
  });
  const report = wipReport(session, query);
  return (
    <div className="bg-white px-6 py-6 text-[12px] text-black">
      <style>{`
        @page { size: letter landscape; margin: 0.45in; }
        @media print {
          #fieldline-office-shell { display: block !important; height: auto !important; overflow: visible !important; background: white !important; }
          #fieldline-office-shell > a,
          #fieldline-office-shell > div:first-of-type,
          #fieldline-office-shell nav,
          #fieldline-office-shell .mac-glass { display: none !important; }
          #fieldline-office-shell > div { margin: 0 !important; overflow: visible !important; height: auto !important; background: white !important; border-radius: 0 !important; }
          #main { overflow: visible !important; height: auto !important; padding: 0 !important; }
        }
      `}</style>
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/reports/wip${wipSearch({ ...query, asOf: report.asOf })}`} className="text-[var(--mac-accent)]">
          WIP
        </Link>
        <PrintButton />
      </div>
      <header className="mb-4">
        <p className="text-[11px] uppercase tracking-wide">{session.orgName}</p>
        <h1 className="text-[22px] font-semibold">WIP</h1>
        <p>
          {formatCalendarDay(report.asOf)} · {report.rows.length} jobs
        </p>
      </header>
      <WipPrintTable report={report} />
    </div>
  );
}

function WipPrintTable({ report }: { report: WipReport }) {
  return (
    <table className="w-full border-collapse text-left" aria-label="WIP">
      <thead>
        <tr className="border-b border-black">
          <th className="py-1 pr-2">Job</th>
          <th className="py-1 pl-2 text-right">Contract</th>
          <th className="py-1 pl-2 text-right">Projected cost</th>
          <th className="py-1 pl-2 text-right">Cost to date</th>
          <th className="py-1 pl-2 text-right">% complete</th>
          <th className="py-1 pl-2 text-right">Earned revenue</th>
          <th className="py-1 pl-2 text-right">Billed to date</th>
          <th className="py-1 pl-2 text-right">Over/under billing</th>
          <th className="py-1 pl-2 text-right">Projected gross profit</th>
          <th className="py-1 pl-2 text-right">GP</th>
          <th className="py-1 pl-2 text-right">Cost to complete</th>
        </tr>
      </thead>
      <tbody>
        {report.rows.map((row) => (
          <tr key={row.projectId} className="border-b border-neutral-300">
            <td className="py-1 pr-2">{row.name}</td>
            {cell(row.contractCents)}
            {cell(row.projectedCents)}
            {cell(row.costToDateCents)}
            <td className="num py-1 pl-2 text-right">{formatPercent(row.percentBps)}</td>
            {cell(row.earnedCents)}
            {cell(row.billedCents)}
            {cell(row.overUnderCents, row.overUnderCents < 0)}
            {cell(row.profitCents, row.profitCents < 0)}
            <td className="num py-1 pl-2 text-right" style={row.profitCents < 0 ? { color: "#c8372d" } : undefined}>
              {formatPercent(row.profitBps)}
            </td>
            {cell(row.costToCompleteCents)}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-black font-semibold">
          <td className="py-1 pr-2">Total</td>
          {cell(report.totals.contractCents)}
          {cell(report.totals.projectedCents)}
          {cell(report.totals.costToDateCents)}
          <td className="num py-1 pl-2 text-right">{formatPercent(report.totals.percentBps)}</td>
          {cell(report.totals.earnedCents)}
          {cell(report.totals.billedCents)}
          {cell(report.totals.overUnderCents, report.totals.overUnderCents < 0)}
          {cell(report.totals.profitCents, report.totals.profitCents < 0)}
          <td className="num py-1 pl-2 text-right" style={report.totals.profitCents < 0 ? { color: "#c8372d" } : undefined}>
            {formatPercent(report.totals.profitBps)}
          </td>
          {cell(report.totals.costToCompleteCents)}
        </tr>
      </tfoot>
    </table>
  );
}
