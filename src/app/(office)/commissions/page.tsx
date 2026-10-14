import Link from "next/link";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatWhole } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { listCommissions } from "@/lib/services/commissions";
import { staff } from "@/lib/services/read";

const FILTERS = [
  ["", "Open"],
  ["owed", "Owed"],
  ["paid", "Paid"],
  ["draft", "Draft"],
  ["void", "Void"],
] as const;

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const status = typeof query.status === "string" ? query.status : "";
  const userId = typeof query.user === "string" ? query.user : "";
  const projectId = typeof query.job === "string" ? query.job : "";
  const rows = listCommissions(session, { status, userId, projectId });
  const owed = rows.filter((row) => row.status === "owed").reduce((sum, row) => sum + row.earnedCents, 0);
  const paid = rows.filter((row) => row.status === "paid").reduce((sum, row) => sum + row.earnedCents, 0);
  const people = canSeeMoney(session.role) ? staff(session.orgId) : [];
  const jobs = [...new Map(rows.map((row) => [row.projectId, row.job])).entries()];
  const csv = `/api/export/commissions?status=${encodeURIComponent(status)}&user=${encodeURIComponent(userId)}&job=${encodeURIComponent(projectId)}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="hidden md:block">
        <Toolbar title="Commissions" subtitle={String(rows.length)} search={false} trailing={<a href={csv}>CSV</a>} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 md:hidden">
        <h1 className="fl-large-title">Commissions</h1>
        <a href={csv} className="ctl">
          CSV
        </a>
      </div>
      <dl aria-label="Totals" className="flex flex-wrap gap-6 px-4 text-[13px]">
        <div>
          <dt>Owed</dt>
          <dd className="num">{formatWhole(owed)}</dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd className="num">{formatWhole(paid)}</dd>
        </div>
      </dl>
      <form method="get" action="/commissions" className="flex flex-wrap items-end gap-2 px-4">
        <label className="text-sm">
          Status
          <select name="status" aria-label="Status" className="field mt-1" defaultValue={status}>
            {FILTERS.map(([value, label]) => (
              <option key={value || "open"} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {people.length > 0 ? (
          <label className="text-sm">
            Person
            <select name="user" aria-label="Person" className="field mt-1" defaultValue={userId}>
              <option value="">All</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {jobs.length > 1 ? (
          <label className="text-sm">
            Job
            <select name="job" aria-label="Job" className="field mt-1" defaultValue={projectId}>
              <option value="">All</option>
              {jobs.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className="ctl">
          Show
        </button>
      </form>
      <div className="overflow-x-auto px-4">
        <table className="mac-table" aria-label="Commissions">
          <thead>
            <tr>
              <th>Person</th>
              <th>Job</th>
              <th>Milestone</th>
              <th>Earned</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5}>No commission</td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/commissions/${row.id}`}>{row.person}</Link>
                  {row.seat ? <span className="ml-2 mac-t11 text-[var(--mac-secondary)]">{row.seat}</span> : null}
                </td>
                <td>{row.job}</td>
                <td>{row.milestone}</td>
                <td className="num">{formatWhole(row.earnedCents)}</td>
                <td>
                  <span className="fl-pill">{row.statusLabel}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
