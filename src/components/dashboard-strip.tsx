import { KpiTile } from "@/components/kpi-tile";
import { ReportChart } from "@/components/report-chart";
import type { DashTile } from "@/lib/services/dashboards";

export function DashboardStrip({ name, tiles }: { name: string; tiles: DashTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <section aria-label={name} data-dashboard={name} className="flex shrink-0 gap-3">
      {tiles.map((tile) => (
        <KpiTile key={tile.id} label={tile.title} href={tile.href} tile={tile.title} value={tile.kind === "number" ? tile.value : undefined}>
          {tile.kind === "list" ? (
            <ul className="flex w-full flex-col gap-1 overflow-hidden">
              {tile.rows.slice(0, 3).map((row) => (
                <li key={row.id} className="flex items-baseline justify-between gap-2 mac-t13">
                  <span className="truncate">{row.title}</span>
                  <span className="num text-[var(--mac-secondary)]">{row.trailing}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {tile.kind === "chart" ? <ReportChart kind={tile.chartKind} points={tile.chart} /> : null}
        </KpiTile>
      ))}
    </section>
  );
}
