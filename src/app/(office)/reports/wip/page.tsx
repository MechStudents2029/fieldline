import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { GroupedList, GroupedRow, LargeTitle } from "@/components/ios";
import { DataTable, type Cell, type TableRow } from "@/components/mac/data-table";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { formatPercent, formatWhole } from "@/lib/money";
import { canEditCrm } from "@/lib/permissions";
import { wipQuery, wipReport, wipSearch } from "@/lib/services/wip";

const SORTS = new Set(["job", "contract", "projected", "cost", "percent", "earned", "billed", "under", "profit", "margin", "left"]);

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function money(cents: number, danger = false): Cell {
  return { text: formatWhole(cents), sort: cents, tone: danger ? "late" : undefined };
}

function percent(bps: number, danger = false): Cell {
  return { text: formatPercent(bps), sort: bps, tone: danger ? "late" : undefined };
}

export default async function WipPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
  const screen = wipSearch({ ...query, asOf: report.asOf });
  const sortKey = query.sort && SORTS.has(query.sort) ? query.sort : "job";
  const dir = query.dir === "desc" ? "desc" : "asc";
  const columns = [
    { key: "job", header: "Job" },
    { key: "contract", header: "Contract", align: "right" as const },
    { key: "projected", header: "Projected", align: "right" as const },
    { key: "cost", header: "Cost to date", align: "right" as const },
    { key: "percent", header: "% complete", align: "right" as const },
    { key: "earned", header: "Earned", align: "right" as const },
    { key: "billed", header: "Billed", align: "right" as const },
    { key: "under", header: "Over/under", align: "right" as const },
    { key: "profit", header: "Profit", align: "right" as const },
    { key: "margin", header: "GP", align: "right" as const },
    { key: "left", header: "To complete", align: "right" as const },
  ];
  const rowFor = (row: (typeof report.rows)[number], href?: string): TableRow => ({
    id: row.projectId,
    href,
    badge: row.override ? "Override" : undefined,
    cells: {
      job: { text: row.name, sort: row.name },
      contract: money(row.contractCents),
      projected: money(row.projectedCents),
      cost: money(row.costToDateCents),
      percent: percent(row.percentBps),
      earned: money(row.earnedCents),
      billed: money(row.billedCents),
      under: money(row.overUnderCents, row.overUnderCents < 0),
      profit: money(row.profitCents, row.profitCents < 0),
      margin: percent(row.profitBps, row.profitCents < 0),
      left: money(row.costToCompleteCents),
    },
  });
  const totals = rowFor({ ...report.totals, projectId: "total", name: "Total", status: "", pmUserId: null, pmName: "", override: null, codes: [] });
  const filters = (
    <form method="get" className="flex flex-wrap items-center gap-2">
      <label className="text-[13px] text-[var(--mac-secondary)]">
        As of
        <input type="date" name="asof" aria-label="As of" defaultValue={report.asOf} className="ml-1 h-7 rounded-md border border-[var(--mac-separator)] bg-transparent px-2 text-[13px] text-[var(--mac-label)]" />
      </label>
      <label className="text-[13px] text-[var(--mac-secondary)]">
        PM
        <select name="pm" aria-label="PM" defaultValue={query.pmUserId || ""} className="ml-1 h-7 rounded-md border border-[var(--mac-separator)] bg-transparent px-2 text-[13px] text-[var(--mac-label)]">
          <option value="">All</option>
          {report.pms.map((pm) => (
            <option key={pm.id} value={pm.id}>
              {pm.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[13px] text-[var(--mac-secondary)]">
        Status
        <select name="status" aria-label="Status" defaultValue={query.status === "complete" || query.status === "all" ? query.status : "active"} className="ml-1 h-7 rounded-md border border-[var(--mac-separator)] bg-transparent px-2 text-[13px] text-[var(--mac-label)]">
          <option value="active">Active</option>
          <option value="complete">Complete</option>
          <option value="all">All</option>
        </select>
      </label>
      {query.sort && query.sort !== "job" ? <input type="hidden" name="sort" value={query.sort} /> : null}
      {query.dir === "desc" ? <input type="hidden" name="dir" value="desc" /> : null}
      <button type="submit" className="mac-primary">
        Show
      </button>
    </form>
  );
  return (
    <>
      <div className="mx-auto flex max-w-lg flex-col gap-4 md:hidden">
        <LargeTitle title="WIP" subtitle={`${formatCalendarDay(report.asOf)} · ${report.rows.length} jobs`} />
        {filters}
        <div className="flex gap-3 text-[13px]">
          <Link href={`/api/export/wip${screen}`}>CSV</Link>
          <Link href={`/reports/wip/print${screen}`}>Print</Link>
        </div>
        {report.rows.length === 0 ? (
          <EmptyState title="No jobs" />
        ) : (
          <GroupedList label="Jobs">
            {report.rows.map((row) => (
              <GroupedRow
                key={row.projectId}
                href={`/reports/wip/${row.projectId}?asof=${report.asOf}`}
                title={row.name}
                subtitle={`${formatPercent(row.percentBps)} · ${formatWhole(row.overUnderCents)}`}
                trailing={<span className={row.overUnderCents < 0 || row.profitCents < 0 ? "fl-late" : undefined}>{formatWhole(row.contractCents)}</span>}
              />
            ))}
            <GroupedRow title="Total" subtitle={formatPercent(report.totals.percentBps)} trailing={formatWhole(report.totals.contractCents)} chevron={false} />
          </GroupedList>
        )}
      </div>
      <div className="hidden min-h-0 flex-1 flex-col md:flex">
        <Toolbar
          title="WIP"
          subtitle={`${formatCalendarDay(report.asOf)} · ${report.rows.length} jobs`}
          search={false}
          trailing={
            <span className="flex items-center gap-2">
              <a href={`/api/export/wip${screen}`} className="mac-glass-btn">
                CSV
              </a>
              <a href={`/reports/wip/print${screen}`} className="mac-glass-btn">
                Print
              </a>
            </span>
          }
        />
        <div className="px-4 pb-2">{filters}</div>
        {report.rows.length === 0 ? (
          <EmptyState title="No jobs" />
        ) : (
          <DataTable
            columns={columns}
            rows={report.rows.map((row) => rowFor(row, `/reports/wip/${row.projectId}?asof=${report.asOf}`))}
            footer={totals}
            initialSort={{ key: sortKey, dir }}
            status={`${report.rows.length} jobs · ${formatWhole(report.totals.contractCents)}`}
          />
        )}
      </div>
    </>
  );
}
