import type { ReactNode } from "react";
import Link from "next/link";
import { PrintButton } from "@/components/print-button";
import { ReportChart } from "@/components/report-chart";
import { ReportTable } from "@/components/report-table";
import { Toolbar } from "@/components/mac/toolbar";
import { DateRangeBar } from "@/components/date-range-bar";
import type { ReportView } from "@/lib/services/reports";

export function ReportScreen({ view, csvHref, actions, range }: { view: ReportView; csvHref: string; actions?: ReactNode; range?: { from: string; to: string } | null }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title={view.name}
        subtitle={`${view.result.groups.reduce((sum, group) => sum + group.rows.length, 0)}`}
        search={false}
        trailing={
          <span className="no-print flex items-center gap-2">
            <Link href="/reports" className="ctl">
              Reports
            </Link>
            <a className="ctl" href={csvHref}>
              CSV
            </a>
            <PrintButton />
            {actions}
          </span>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-8">
        {range ? <DateRangeBar from={range.from} to={range.to} /> : null}
        {view.result.chart.length > 0 && view.query.chart ? <ReportChart kind={view.query.chart} points={view.result.chart} /> : null}
        <ReportTable result={view.result} />
      </div>
    </div>
  );
}
