import Link from "next/link";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatWhole } from "@/lib/money";
import { collectMonth, listFollowUps, scanCollections } from "@/lib/services/collections";

const FILTERS = [
  ["", "All"],
  ["draft", "Draft"],
  ["ready", "Ready"],
  ["copied", "Copied"],
  ["sent", "Sent"],
  ["skipped", "Skipped"],
  ["void", "Void"],
] as const;

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const status = typeof query.status === "string" ? query.status : "";
  if (session.role === "field") {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-2 px-6">
        <h1 className="font-heading text-3xl">Collections</h1>
        <p className="text-sm">Collections stay in the office.</p>
      </div>
    );
  }
  scanCollections(session.orgId);
  const rows = listFollowUps(session, status);
  const month = collectMonth(session.orgId);
  const csv = `/api/export/collections?status=${encodeURIComponent(status)}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="hidden md:block">
        <Toolbar
          title="Collections"
          subtitle={`${rows.length}`}
          search={false}
          trailing={
            <a href={csv}>CSV</a>
          }
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 md:hidden">
        <h1 className="fl-large-title">Collections</h1>
        <a href={csv} className="ctl">
          CSV
        </a>
      </div>
      <dl aria-label="This month" className="flex flex-wrap gap-6 px-4 text-[13px]">
        <div>
          <dt>Created</dt>
          <dd className="num">{month.created}</dd>
        </div>
        <div>
          <dt>Sent</dt>
          <dd className="num">{month.sent}</dd>
        </div>
        <div>
          <dt>Skipped</dt>
          <dd className="num">{month.skipped}</dd>
        </div>
        <div>
          <dt>Open</dt>
          <dd className="num">{formatWhole(month.openCents)}</dd>
        </div>
      </dl>
      <form method="get" action="/collections" className="flex flex-wrap items-end gap-2 px-4">
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
        <button type="submit" className="ctl">
          Show
        </button>
      </form>
      <div className="overflow-x-auto px-4">
        <table className="mac-table" aria-label="Collections">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Client</th>
              <th>Status</th>
              <th>Amount</th>
              <th>Days</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5}>No follow-ups</td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/collections/${row.id}`}>{row.invoice}</Link>
                </td>
                <td>{row.client}</td>
                <td>
                  <span className="fl-pill">{row.statusLabel}</span>
                </td>
                <td className="num">{row.amount}</td>
                <td className="num">{row.cadence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
