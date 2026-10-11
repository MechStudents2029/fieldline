import Link from "next/link";
import { ReportChart } from "@/components/report-chart";
import type { DashTile } from "@/lib/services/dashboards";

export function DashboardStrip({ name, tiles }: { name: string; tiles: DashTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <section aria-label={name} data-dashboard={name} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => (
        <Link key={tile.id} href={tile.href} data-tile={tile.title} className="flex min-h-24 flex-col gap-2 rounded-xl bg-[var(--mac-under)] px-3 py-3">
          <span className="mac-t11 text-[var(--mac-secondary)]">{tile.title}</span>
          {tile.kind === "number" ? <span className="mac-t22 num">{tile.value}</span> : null}
          {tile.kind === "list" ? (
            <ul className="flex flex-col gap-1">
              {tile.rows.map((row) => (
                <li key={row.id} className="flex items-baseline justify-between gap-2 mac-t13">
                  <span className="truncate">{row.title}</span>
                  <span className="num text-[var(--mac-secondary)]">{row.trailing}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {tile.kind === "chart" ? <ReportChart kind={tile.chartKind} points={tile.chart} /> : null}
        </Link>
      ))}
    </section>
  );
}
