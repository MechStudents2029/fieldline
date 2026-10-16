import Link from "next/link";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatWhole } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { changeEventTotals, listChangeEvents } from "@/lib/services/change-events";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const FILTERS = [
  ["", "All"],
  ["open", "Open"],
  ["pricing", "Pricing"],
  ["ready", "Ready"],
  ["converted", "Converted"],
  ["voided", "Void"],
  ["age", "Age"],
  ["due", "Due"],
];

export default async function ChangeEventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const filter = one(query.filter) ?? "";
  const rows = listChangeEvents(session, { filter });
  const totals = changeEventTotals(rows);
  const money = canSeeMoney(session.role);
  const csv = `/api/export/change-events?filter=${encodeURIComponent(filter)}`;
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Change events" subtitle={String(rows.length)} search={false} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Change events</h1>
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
        <table aria-label="Change events" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-2 pr-3 font-medium">Job</th>
              <th className="py-2 pr-3 font-medium">No.</th>
              <th className="py-2 pr-3 font-medium">Title</th>
              <th className="py-2 pr-3 font-medium">Reason</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 text-right font-medium">ROM</th>
              <th className="py-2 pr-3 text-right font-medium">Priced</th>
              <th className="py-2 text-right font-medium">Days</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[var(--mac-separator)]">
                <td className="py-2 pr-3">{row.job}</td>
                <td className="py-2 pr-3 num">{row.number}</td>
                <td className="py-2 pr-3">
                  <Link href={`/change-events/${row.id}`} className="text-[var(--mac-accent)]">
                    {row.title}
                  </Link>
                </td>
                <td className="py-2 pr-3">{row.reasonLabel}</td>
                <td className="py-2 pr-3">
                  <span className="fl-pill" data-status={row.status}>
                    {row.statusLabel}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right num">{money ? formatWhole(row.romPriceCents) : ""}</td>
                <td className="py-2 pr-3 text-right num">{money ? formatWhole(row.pricedCents) : ""}</td>
                <td className="py-2 text-right num">{row.scheduleDays}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--mac-separator)]">
              <td className="py-2 pr-3 num">{totals.count}</td>
              <td />
              <td />
              <td />
              <td />
              <td className="py-2 pr-3 text-right num">{money ? formatWhole(totals.romPriceCents) : ""}</td>
              <td className="py-2 pr-3 text-right num">{money ? formatWhole(totals.pricedCents) : ""}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
