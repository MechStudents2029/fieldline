import Link from "next/link";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { canManageMoney, canSeeMoney } from "@/lib/permissions";
import { listAgreements } from "@/lib/services/agreements";

const FILTERS = [
  ["", "All"],
  ["draft", "Draft"],
  ["active", "Active"],
  ["expiring", "Expiring soon"],
  ["pending_renewal", "Pending renewal"],
  ["renewed", "Renewed"],
  ["expired", "Expired"],
  ["cancelled", "Cancelled"],
] as const;

export default async function AgreementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const status = typeof query.status === "string" ? query.status : "";
  const attention = typeof query.attention === "string" ? query.attention : "";
  const seeMoney = canSeeMoney(session.role);
  const rows = listAgreements(session, { status, attention });
  const subtitle = `${rows.length}`;
  const csv = `/api/export/agreements?status=${encodeURIComponent(status)}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="hidden md:block">
        <Toolbar
          title="Agreements"
          subtitle={subtitle}
          search={false}
          trailing={
            <span className="inline-flex items-center gap-3">
              <a href={csv}>CSV</a>
              {canManageMoney(session.role) ? <Link href="/agreements/new">New</Link> : null}
            </span>
          }
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 md:hidden">
        <h1 className="fl-large-title">Agreements</h1>
        <span className="inline-flex gap-3">
          <a href={csv} className="ctl">
            CSV
          </a>
          {canManageMoney(session.role) ? (
            <Link href="/agreements/new" className="ctl">
              New
            </Link>
          ) : null}
        </span>
      </div>
      <form method="get" action="/agreements" className="flex flex-wrap items-end gap-2 px-4">
        <label className="text-sm">
          Status
          <select name="status" aria-label="Status" className="field mt-1" defaultValue={status}>
            {FILTERS.map(([value, label]) => (
              <option key={value || "all"} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {attention ? <input type="hidden" name="attention" value={attention} /> : null}
        <button type="submit" className="ctl">
          Show
        </button>
      </form>
      <div className="overflow-x-auto px-4">
        <table className="mac-table" aria-label="Agreements">
          <thead>
            <tr>
              <th>Agreement</th>
              <th>Client</th>
              <th>Job</th>
              <th>Status</th>
              <th>Next</th>
              {seeMoney ? <th className="text-right">Monthly</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={seeMoney ? 6 : 5}>No agreements</td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/agreements/${row.id}`}>{row.name}</Link>
                </td>
                <td>{row.client}</td>
                <td className="clip">{row.job}</td>
                <td>
                  <span className="fl-pill">{row.statusLabel}</span>
                </td>
                <td className="num">{row.nextOn ? formatDate(row.nextOn) : "—"}</td>
                {seeMoney ? <td className="num text-right">{formatMoney(row.monthlyCents)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
