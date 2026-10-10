import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { GroupedList, GroupedRow, LargeTitle } from "@/components/ios";
import { DataTable, type TableRow } from "@/components/mac/data-table";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { canEditCrm } from "@/lib/permissions";
import { formatWorkdayVariance } from "@/lib/schedule/delays";
import { scheduleVariance } from "@/lib/services/schedule-plan";

export const dynamic = "force-dynamic";

function varianceCell(days: number | null) {
  return { text: days == null ? "—" : formatWorkdayVariance(days), sort: days ?? -9999, tone: days != null && days >= 5 ? ("late" as const) : undefined };
}

export default async function ScheduleVariancePage() {
  const session = await requireSession();
  if (!canEditCrm(session.role)) notFound();
  const report = scheduleVariance(session);
  const columns = [
    { key: "job", header: "Job", clip: true },
    { key: "baseline", header: "Baseline" },
    { key: "current", header: "Current" },
    { key: "variance", header: "Variance", align: "right" as const },
    { key: "weather", header: "Weather", align: "right" as const },
    { key: "client", header: "Client", align: "right" as const },
    { key: "change", header: "Change order", align: "right" as const },
    { key: "material", header: "Material", align: "right" as const },
    { key: "sub", header: "Sub", align: "right" as const },
    { key: "inspection", header: "Inspection", align: "right" as const },
    { key: "other", header: "Other", align: "right" as const },
  ];
  const rows: TableRow[] = report.rows.map((row) => ({
    id: row.projectId,
    href: `/projects/${row.projectId}#schedule`,
    cells: {
      job: { text: row.name, sort: row.name },
      baseline: { text: row.baselineFinish ? formatCalendarDay(row.baselineFinish) : "—", sort: row.baselineFinish ?? "" },
      current: { text: row.currentFinish ? formatCalendarDay(row.currentFinish) : "—", sort: row.currentFinish ?? "" },
      variance: varianceCell(row.variance),
      weather: { text: String(row.delays.weather), sort: row.delays.weather },
      client: { text: String(row.delays.client), sort: row.delays.client },
      change: { text: String(row.delays.change_order), sort: row.delays.change_order },
      material: { text: String(row.delays.material), sort: row.delays.material },
      sub: { text: String(row.delays.sub), sort: row.delays.sub },
      inspection: { text: String(row.delays.inspection), sort: row.delays.inspection },
      other: { text: String(row.delays.other), sort: row.delays.other },
    },
  }));
  return (
    <>
      <div className="mx-auto flex max-w-lg flex-col gap-4 md:hidden">
        <LargeTitle title="Schedule variance" subtitle={`${report.rows.length} jobs`} />
        <div className="flex gap-3 text-[13px]">
          <Link href="/api/export/schedule">CSV</Link>
          <Link href="/reports/schedule/print">Print</Link>
        </div>
        {report.rows.length === 0 ? (
          <EmptyState title="No jobs" />
        ) : (
          <GroupedList label="Jobs">
            {report.rows.map((row) => (
              <GroupedRow
                key={row.projectId}
                href={`/projects/${row.projectId}#schedule`}
                title={row.name}
                subtitle={row.baselineFinish ? formatCalendarDay(row.baselineFinish) : "No baseline"}
                trailing={<span className="num">{row.variance == null ? "—" : formatWorkdayVariance(row.variance)}</span>}
              />
            ))}
          </GroupedList>
        )}
      </div>
      <div className="hidden min-h-0 flex-1 flex-col md:flex">
        <Toolbar
          title="Schedule variance"
          subtitle={`${report.rows.length} jobs`}
          search={false}
          trailing={
            <span className="flex items-center gap-2">
              <a href="/api/export/schedule" className="mac-glass-btn">
                CSV
              </a>
              <a href="/reports/schedule/print" className="mac-glass-btn">
                Print
              </a>
            </span>
          }
        />
        {report.rows.length === 0 ? (
          <EmptyState title="No jobs" />
        ) : (
          <DataTable columns={columns} rows={rows} initialSort={{ key: "variance", dir: "desc" }} status={`${report.rows.length} jobs`} />
        )}
      </div>
    </>
  );
}
