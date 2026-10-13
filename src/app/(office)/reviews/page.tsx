import Link from "next/link";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { listReviews, reviewMonth } from "@/lib/services/reviews";

const FILTERS = [
  ["", "All"],
  ["draft", "Draft"],
  ["ready", "Ready"],
  ["copied", "Copied"],
  ["sent", "Marked sent"],
  ["skipped", "Skipped"],
  ["declined", "Declined"],
] as const;

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const status = typeof query.status === "string" ? query.status : "";
  if (session.role === "field") {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-2 px-6">
        <h1 className="font-heading text-3xl">Reviews</h1>
        <p className="text-sm">Ask for review is on My day.</p>
      </div>
    );
  }
  const rows = listReviews(session, status);
  const month = reviewMonth(session.orgId);
  const csv = `/api/export/reviews?status=${encodeURIComponent(status)}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="hidden md:block">
        <Toolbar
          title="Reviews"
          subtitle={`${rows.length}`}
          search={false}
          trailing={
            <a href={csv}>CSV</a>
          }
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 md:hidden">
        <h1 className="fl-large-title">Reviews</h1>
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
          <dt>Marked sent</dt>
          <dd className="num">{month.sent}</dd>
        </div>
        <div>
          <dt>Skipped</dt>
          <dd className="num">{month.skipped}</dd>
        </div>
      </dl>
      <form method="get" action="/reviews" className="flex flex-wrap items-end gap-2 px-4">
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
        <table className="mac-table" aria-label="Reviews">
          <thead>
            <tr>
              <th>Job</th>
              <th>Client</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3}>No review requests</td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/reviews/${row.id}`}>{row.job}</Link>
                </td>
                <td>{row.client}</td>
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
