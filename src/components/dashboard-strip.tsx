import Link from "next/link";
import { ReportChart } from "@/components/report-chart";
import type { DashTile } from "@/lib/services/dashboards";

export function DashboardStrip({ name, tiles }: { name: string; tiles: DashTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <section aria-label={name} data-dashboard={name} className="flex shrink-0 gap-3">
      {tiles.map((tile) => (
        <Link key={tile.id} href={tile.href} data-tile={tile.title} className="flex h-28 w-44 shrink-0 flex-col gap-1 overflow-hidden rounded-xl bg-[var(--mac-under)] px-3 py-2">
          <span className="mac-t11 text-[var(--mac-secondary)]">{tile.title}</span>
          {tile.kind === "number" ? <span className="mac-t22 num">{tile.value}</span> : null}
          {tile.kind === "list" ? (
            <ul className="flex flex-col gap-1 overflow-hidden">
              {tile.rows.slice(0, 3).map((row) => (
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
