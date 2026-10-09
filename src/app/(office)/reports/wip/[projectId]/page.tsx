import Link from "next/link";
import { notFound } from "next/navigation";
import { WipOverrideForm } from "@/components/wip-override-form";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { formatPercent, formatWhole } from "@/lib/money";
import { canEditCrm } from "@/lib/permissions";
import { wipJob } from "@/lib/services/wip";

function dollars(cents: number) {
  const whole = Math.trunc(cents / 100);
  const rem = Math.abs(cents % 100);
  return rem ? `${whole}.${String(rem).padStart(2, "0")}` : String(whole);
}

export default async function WipJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  if (!canEditCrm(session.role)) notFound();
  const { projectId } = await params;
  const query = await searchParams;
  const asof = Array.isArray(query.asof) ? query.asof[0] : query.asof;
  const row = wipJob(session, projectId, asof);
  if (!row) notFound();
  const back = asof ? `/reports/wip?asof=${asof}` : "/reports/wip";
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 md:px-6">
      <Link href={back} className="text-[13px] text-[var(--mac-accent)]">
        WIP
      </Link>
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="mac-t15">{row.name}</h1>
        {row.override ? <span className="inline-flex h-4 items-center rounded bg-[var(--mac-fill)] px-1.5 text-[11px] font-medium text-[var(--mac-secondary)]">Override</span> : null}
        {asof && /^\d{4}-\d{2}-\d{2}$/.test(asof) ? <span className="text-[13px] text-[var(--mac-secondary)]">{formatCalendarDay(asof)}</span> : null}
      </div>
      {row.override ? <p className="text-[13px] text-[var(--mac-secondary)]">{row.override.note}</p> : null}
      <div className="overflow-auto">
        <table className="mac-table" aria-label="Cost codes">
          <thead>
            <tr>
              <th className="px-2.5 text-left">Code</th>
              <th className="px-2.5 text-right">Budget</th>
              <th className="px-2.5 text-right">Committed</th>
              <th className="px-2.5 text-right">Cost</th>
              <th className="px-2.5 text-right">Projected</th>
              <th className="px-2.5 text-right">%</th>
              <th className="px-2.5 text-right">To complete</th>
            </tr>
          </thead>
          <tbody>
            {row.codes.map((code) => (
              <tr key={code.code}>
                <td className="px-2.5">{code.code}</td>
                <td className="fit num px-2.5 text-right" data-fit="amount">{formatWhole(code.revisedBudgetCents)}</td>
                <td className="fit num px-2.5 text-right" data-fit="amount">{formatWhole(code.committedOpenCents)}</td>
                <td className="fit num px-2.5 text-right" data-fit="amount">{formatWhole(code.costToDateCents)}</td>
                <td className="fit num px-2.5 text-right" data-fit="amount">{formatWhole(code.projectedCents)}</td>
                <td className="fit num px-2.5 text-right" data-fit="amount">{formatPercent(code.percentBps)}</td>
                <td className="fit num px-2.5 text-right" data-fit="amount">{formatWhole(code.costToCompleteCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="px-2.5 font-semibold">Job</td>
              <td className="num px-2.5 text-right" />
              <td className="num px-2.5 text-right" />
              <td className="num px-2.5 text-right font-semibold">{formatWhole(row.costToDateCents)}</td>
              <td className="num px-2.5 text-right font-semibold">{formatWhole(row.projectedCents)}</td>
              <td className="num px-2.5 text-right font-semibold">{formatPercent(row.percentBps)}</td>
              <td className={`num px-2.5 text-right font-semibold ${row.profitCents < 0 ? "text-[var(--mac-danger)]" : ""}`}>{formatWhole(row.costToCompleteCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <WipOverrideForm projectId={row.projectId} asOf={asof || ""} amount={dollars(row.projectedCents)} note={row.override?.note ?? ""} />
    </div>
  );
}
