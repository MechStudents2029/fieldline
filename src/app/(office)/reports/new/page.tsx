import Link from "next/link";
import { saveReportAction } from "@/app/(office)/reports/actions";
import { ReportChart } from "@/components/report-chart";
import { ReportTable } from "@/components/report-table";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { BUILDER_SOURCES } from "@/lib/reports/catalog";
import { sourceAllowed } from "@/lib/reports/engine";
import type { Role } from "@/lib/permissions";
import { builderColumns, parseQuery, previewReport } from "@/lib/services/reports";
import { ServiceError } from "@/lib/services/errors";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || "";
}

function many(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

export default async function NewReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const params = await searchParams;
  const source = one(params.source);
  const sources = BUILDER_SOURCES.filter((item) => sourceAllowed(session.role as Role, item.id));
  const columns = source ? builderColumns(session, source) : [];
  const picked = many(params.columns).flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  const selected = picked.length ? picked : columns.slice(0, 4).map((column) => column.key);
  const query = parseQuery({
    columns: selected,
    filters: [0, 1, 2]
      .map((index) => ({ column: one(params[`f${index}`]), op: (one(params[`op${index}`]) || "eq") as "eq", value: one(params[`v${index}`]) }))
      .filter((filter) => filter.column && filter.value),
    dateColumn: one(params.date),
    from: one(params.from),
    to: one(params.to),
    sort: one(params.sort) || selected[0] || "",
    dir: one(params.dir) === "desc" ? "desc" : "asc",
    groupBy: one(params.group),
    chart: one(params.chart) === "bar" || one(params.chart) === "line" ? (one(params.chart) as "bar" | "line") : "",
    chartColumn: one(params.chartColumn),
  });
  let preview = null as ReturnType<typeof previewReport> | null;
  if (source && columns.length) {
    try {
      preview = previewReport(session, source, query);
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
    }
  }
  const hidden = selected.join(",");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar title="New report" search={false} trailing={<Link href="/reports" className="ctl">Reports</Link>} />
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-8">
        {!source ? (
          <ul className="flex flex-col">
            {sources.map((item) => (
              <li key={item.id}>
                <Link href={`/reports/new?source=${item.id}`} className="mac-t13">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <form method="get" className="mb-4 flex flex-col gap-3" data-builder={source}>
            <input type="hidden" name="source" value={source} />
            <div className="flex flex-wrap gap-2">
              {columns.map((column) => (
                <label key={column.key} className="mac-t13">
                  <input type="checkbox" name="columns" value={column.key} defaultChecked={selected.includes(column.key)} /> {column.label}
                </label>
              ))}
            </div>
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex flex-wrap gap-2">
                <select name={`f${index}`} aria-label={`Filter ${index + 1}`} defaultValue={one(params[`f${index}`])} className="ctl">
                  <option value="">Filter</option>
                  {columns.map((column) => (
                    <option key={column.key} value={column.key}>
                      {column.label}
                    </option>
                  ))}
                </select>
                <select name={`op${index}`} aria-label={`Operator ${index + 1}`} defaultValue={one(params[`op${index}`]) || "eq"} className="ctl">
                  <option value="eq">is</option>
                  <option value="contains">contains</option>
                  <option value="gt">above</option>
                  <option value="lt">below</option>
                  <option value="in">one of</option>
                </select>
                <input name={`v${index}`} aria-label={`Value ${index + 1}`} defaultValue={one(params[`v${index}`])} className="field h-7 w-40" />
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <select name="date" aria-label="Date column" defaultValue={one(params.date)} className="ctl">
                <option value="">Date</option>
                {columns.filter((column) => column.kind === "date").map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.label}
                  </option>
                ))}
              </select>
              <input name="from" aria-label="From" type="date" defaultValue={one(params.from)} className="ctl" />
              <input name="to" aria-label="To" type="date" defaultValue={one(params.to)} className="ctl" />
              <select name="sort" aria-label="Sort" defaultValue={query.sort} className="ctl">
                {columns.map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.label}
                  </option>
                ))}
              </select>
              <select name="dir" aria-label="Direction" defaultValue={query.dir} className="ctl">
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <select name="group" aria-label="Group" defaultValue={query.groupBy} className="ctl">
                <option value="">Group</option>
                {columns.map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.label}
                  </option>
                ))}
              </select>
              <select name="chart" aria-label="Chart" defaultValue={query.chart} className="ctl">
                <option value="">Chart</option>
                <option value="bar">Bar</option>
                <option value="line">Line</option>
              </select>
            </div>
            <button type="submit" className="ctl w-fit">
              Show
            </button>
          </form>
        )}
        {preview ? (
          <>
            {preview.chart.length > 0 && query.chart ? <ReportChart kind={query.chart} points={preview.chart} /> : null}
            <ReportTable result={preview} />
            <form action={saveReportAction} className="mt-4 flex flex-wrap items-center gap-2">
              <input type="hidden" name="source" value={source} />
              <input type="hidden" name="columns" value={hidden} />
              {[0, 1, 2].map((index) => (
                <span key={index}>
                  <input type="hidden" name={`f${index}`} value={one(params[`f${index}`])} />
                  <input type="hidden" name={`op${index}`} value={one(params[`op${index}`])} />
                  <input type="hidden" name={`v${index}`} value={one(params[`v${index}`])} />
                </span>
              ))}
              <input type="hidden" name="date" value={query.dateColumn} />
              <input type="hidden" name="from" value={query.from} />
              <input type="hidden" name="to" value={query.to} />
              <input type="hidden" name="sort" value={query.sort} />
              <input type="hidden" name="dir" value={query.dir} />
              <input type="hidden" name="group" value={query.groupBy} />
              <input type="hidden" name="chart" value={query.chart} />
              <input name="name" aria-label="Report name" required className="field h-7 w-48" />
              <select name="share" aria-label="Share" defaultValue="private" className="ctl">
                <option value="private">Private</option>
                <option value="office">Office</option>
                <option value="everyone">Everyone</option>
              </select>
              <button type="submit" className="mac-primary">
                Save
              </button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
