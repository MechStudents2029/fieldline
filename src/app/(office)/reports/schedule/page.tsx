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

const REASONS = [
  ["weather", "Weather"],
  ["client", "Client"],
  ["change_order", "Change order"],
  ["material", "Material"],
  ["sub", "Sub"],
  ["inspection", "Inspection"],
  ["other", "Other"],
] as const;

export default async function ScheduleVariancePage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const session = await requireSession();
  if (!canEditCrm(session.role)) notFound();
  const all = (await searchParams).all === "1";
  const report = scheduleVariance(session);
  const shown = all ? report.rows : report.rows.filter((row) => row.baselineFinish);
  const active = REASONS.filter(([key]) => shown.some((row) => row.delays[key] > 0));
  const csvHref = all ? "/api/export/schedule?all=1" : "/api/export/schedule";
  const printHref = all ? "/reports/schedule/print?all=1" : "/reports/schedule/print";
  const columns = [
    { key: "job", header: "Job", wrap: true },
    { key: "baseline", header: "Baseline" },
    { key: "current", header: "Current" },
    { key: "variance", header: "Variance", align: "right" as const },
    ...active.map(([key, header]) => ({ key, header, align: "right" as const })),
  ];
  const rows: TableRow[] = shown.map((row) => ({
    id: row.projectId,
    href: `/projects/${row.projectId}#schedule`,
    cells: {
      job: { text: row.name, sort: row.name },
      baseline: { text: row.baselineFinish ? formatCalendarDay(row.baselineFinish) : "—", sort: row.baselineFinish ?? "" },
      current: { text: row.currentFinish ? formatCalendarDay(row.currentFinish) : "—", sort: row.currentFinish ?? "" },
      variance: varianceCell(row.variance),
      ...Object.fromEntries(active.map(([key]) => [key, { text: String(row.delays[key]), sort: row.delays[key] }])),
    },
  }));
  return (
    <>
      <div className="mx-auto flex max-w-lg flex-col gap-4 md:hidden">
        <LargeTitle title="Schedule variance" subtitle={`${shown.length} jobs`} />
        <div className="flex gap-3 text-[13px]">
          <Link href={all ? "/reports/schedule" : "/reports/schedule?all=1"}>{all ? "Baseline" : "All jobs"}</Link>
          <Link href={csvHref}>CSV</Link>
          <Link href={printHref}>Print</Link>
        </div>
        {shown.length === 0 ? (
          <EmptyState title={all ? "No jobs" : "No baseline"} />
        ) : (
          <GroupedList label="Jobs">
            {shown.map((row) => (
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
          subtitle={`${shown.length} jobs`}
          search={false}
          trailing={
            <span className="flex items-center gap-2">
              <a href={all ? "/reports/schedule" : "/reports/schedule?all=1"} className="mac-glass-btn">
                {all ? "Baseline" : "All jobs"}
              </a>
              <a href={csvHref} className="mac-glass-btn">
                CSV
              </a>
              <a href={printHref} className="mac-glass-btn">
                Print
              </a>
            </span>
          }
        />
        {shown.length === 0 ? (
          <EmptyState title={all ? "No jobs" : "No baseline"} />
        ) : (
          <DataTable columns={columns} rows={rows} initialSort={{ key: "variance", dir: "desc" }} status={`${shown.length} jobs`} />
        )}
      </div>
    </>
  );
}
