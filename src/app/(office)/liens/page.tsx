import Link from "next/link";
import { notFound } from "next/navigation";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { LIEN_PILL_LABEL, type LienStatus } from "@/lib/liens/deadlines";
import { formatMoney } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { filterJobs, lienJobs } from "@/lib/services/liens";

const STATUSES: LienStatus[] = ["protected", "due", "at-risk", "lapsed", "missing", "paid"];

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LiensPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) notFound();
  const query = await searchParams;
  const status = one(query.status) ?? "";
  const state = (one(query.state) ?? "").toUpperCase();
  const all = lienJobs(session);
  const rows = filterJobs(all, { status, state });
  const states = [...new Set(all.map((row) => row.state))].sort();
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Lien deadlines" subtitle={String(rows.length)} search={false} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Lien deadlines</h1>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <select name="status" aria-label="Status" defaultValue={status} className="field w-auto">
            <option value="">All</option>
            {STATUSES.map((item) => (
              <option key={item} value={item}>
                {LIEN_PILL_LABEL[item]}
              </option>
            ))}
          </select>
          <select name="state" aria-label="State" defaultValue={state} className="field w-auto">
            <option value="">All</option>
            {states.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button type="submit" className="ctl h-9">
            Show
          </button>
          <Link href={`/api/export/liens?status=${encodeURIComponent(status)}&state=${encodeURIComponent(state)}`} className="text-[var(--mac-accent)]">
            CSV
          </Link>
        </form>
        <table aria-label="Lien deadlines" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-1 font-medium">Job</th>
              <th className="py-1 font-medium">State</th>
              <th className="py-1 font-medium">Status</th>
              <th className="py-1 font-medium">Open</th>
              <th className="py-1 font-medium">Preliminary</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.projectId} data-job={row.projectId} data-status={row.status}>
                <td className="py-1">
                  <Link href={`/projects/${row.projectId}`}>{row.name}</Link>
                </td>
                <td className="py-1">{row.state}</td>
                <td className="py-1">{LIEN_PILL_LABEL[row.status] || "—"}</td>
                <td className="num py-1">{formatMoney(row.openCents)}</td>
                <td className="num py-1">{row.deadlines.find((item) => item.kind === "prelim")?.date || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
