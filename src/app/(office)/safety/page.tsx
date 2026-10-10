import Link from "next/link";
import { SafetyFilters } from "@/components/safety-filters";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { canAddFieldNotes } from "@/lib/permissions";
import { listSafety, safetyJobs } from "@/lib/services/safety";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || "";
}

export default async function SafetyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const type = one(query.type);
  const status = one(query.status);
  const job = one(query.job);
  const rows = listSafety(session, { type, status, job });
  const jobs = safetyJobs(session.orgId);
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (status) params.set("status", status);
  if (job) params.set("job", job);
  const suffix = params.toString();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title="Safety"
        subtitle={`${rows.length}`}
        search={false}
        trailing={
          <span className="flex items-center gap-2">
            <Link href={`/safety/print${suffix ? `?${suffix}` : ""}`} className="ctl">
              Print
            </Link>
            <Link href={`/api/export/safety${suffix ? `?${suffix}` : ""}`} className="ctl">
              CSV
            </Link>
            {canAddFieldNotes(session.role) ? (
              <Link href="/projects" className="ctl">
                Job
              </Link>
            ) : null}
          </span>
        }
      />
      <SafetyFilters path="/safety" type={type} status={status} job={job} jobs={jobs} />
      <div className="min-h-0 flex-1 overflow-auto px-4">
        {rows.length === 0 ? <p className="mac-t13 text-[var(--mac-secondary)]">No records</p> : null}
        <table className="mac-table hidden w-full md:table" aria-label="Safety">
          <thead>
            <tr>
              <th>Type</th>
              <th>Name</th>
              <th>Status</th>
              <th>Job</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.type}-${row.id}`} data-mac-row={`${row.title} ${row.projectName}`}>
                <td>{row.typeLabel}</td>
                <td>
                  <Link href={row.href}>{row.title}</Link>
                </td>
                <td>
                  <span className="fl-pill" data-status={row.status}>
                    {row.statusLabel}
                  </span>
                </td>
                <td className="wrap">{row.projectName}</td>
                <td className="num">{formatCalendarDay(row.when)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="fl-group md:hidden">
          {rows.map((row) => (
            <li key={`${row.type}-${row.id}`}>
              <Link href={row.href} className="flex items-center gap-2 px-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{row.title}</span>
                  <span className="block mac-t11 text-[var(--mac-secondary)]">{row.projectName}</span>
                </span>
                <span className="fl-pill">{row.statusLabel}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
