import Link from "next/link";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { listMeetings } from "@/lib/services/meetings";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const FILTERS = [
  ["", "All"],
  ["upcoming", "Upcoming"],
  ["minutes", "Needs minutes"],
  ["actions", "Open actions"],
  ["overdue", "Overdue"],
];

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const filter = one(query.filter) ?? "";
  const rows = listMeetings(session, { filter });
  const csv = `/api/export/meetings?filter=${encodeURIComponent(filter)}`;
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Meetings" subtitle={String(rows.length)} search={false} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Meetings</h1>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <select name="filter" aria-label="Filter" defaultValue={filter} className="field w-auto">
            {FILTERS.map(([value, label]) => (
              <option key={value || "all"} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="submit" className="mac-glass-btn">
            Show
          </button>
          <Link href={csv} className="text-[var(--mac-accent)]">
            CSV
          </Link>
        </form>
        <table aria-label="Meetings" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-2 pr-3 font-medium">Job</th>
              <th className="py-2 pr-3 font-medium">Meeting</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Date</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 font-medium">Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[var(--mac-separator)]">
                <td className="py-2 pr-3">{row.job}</td>
                <td className="py-2 pr-3">
                  <Link href={`/meetings/${row.id}`} className="text-[var(--mac-accent)]">
                    {row.title} #{row.number}
                  </Link>
                </td>
                <td className="py-2 pr-3">{row.kindLabel}</td>
                <td className="py-2 pr-3 num">{row.meetOn}</td>
                <td className="py-2 pr-3">
                  <span className="fl-pill" data-status={row.status}>
                    {row.statusLabel}
                  </span>
                </td>
                <td className="py-2 num">{row.openActions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
