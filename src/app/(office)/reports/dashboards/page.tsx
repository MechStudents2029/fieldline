import { redirect } from "next/navigation";
import { addTileAction, assignDashboardAction, createDashboardAction, orderTilesAction } from "@/app/(office)/reports/actions";
import { TileOrder } from "@/components/tile-order";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { canManageSettings, roleLabel } from "@/lib/permissions";
import { listDashboards, reportChoices } from "@/lib/services/dashboards";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || "";
}

const ROLES = ["owner", "admin", "estimator", "field", "viewer"];

export default async function DashboardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!canManageSettings(session.role)) redirect("/reports");
  const query = await searchParams;
  const boards = listDashboards(session);
  const reports = reportChoices(session);
  const current = boards.find((board) => board.id === one(query.board)) ?? boards[0];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar title="Dashboards" subtitle={`${boards.length}`} search={false} />
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-8">
        <ul className="mb-4 flex flex-wrap gap-2">
          {boards.map((board) => (
            <li key={board.id}>
              <a href={`/reports/dashboards?board=${board.id}`} className="ctl">
                {board.name}
              </a>
            </li>
          ))}
        </ul>
        <form action={createDashboardAction} className="mb-6 flex gap-2">
          <input name="name" aria-label="Dashboard name" className="field h-7 w-48" />
          <button type="submit" className="ctl">
            New
          </button>
        </form>
        {current ? (
          <section aria-label={current.name} className="flex max-w-xl flex-col gap-4">
            <h2 className="mac-t15">{current.name}</h2>
            <p className="mac-t13 text-[var(--mac-secondary)]">{current.roles.map((role) => roleLabel(role)).join(", ")}</p>
            <TileOrder dashboardId={current.id} tiles={current.tiles.map((tile) => ({ id: tile.id, title: tile.title, kind: tile.kind }))} orderAction={orderTilesAction} />
            <form action={addTileAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="dashboardId" value={current.id} />
              <input name="title" aria-label="Tile title" className="field h-7 w-40" />
              <select name="reportKey" aria-label="Report" className="ctl" defaultValue={reports[0]?.id}>
                {reports.map((report) => (
                  <option key={report.id} value={report.id}>
                    {report.name}
                  </option>
                ))}
              </select>
              <select name="kind" aria-label="Tile" className="ctl" defaultValue="number">
                <option value="number">Number</option>
                <option value="list">List</option>
                <option value="chart">Chart</option>
              </select>
              <select name="metric" aria-label="Metric" className="ctl" defaultValue="count">
                <option value="count">Count</option>
                <option value="sum">Sum</option>
                <option value="avg">Average</option>
              </select>
              <input name="metricColumn" aria-label="Column" className="field h-7 w-28" />
              <button type="submit" className="ctl">
                Add
              </button>
            </form>
            <form action={assignDashboardAction} className="flex items-center gap-2">
              <input type="hidden" name="dashboardId" value={current.id} />
              <select name="role" aria-label="Role" className="ctl" defaultValue="owner">
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
              <button type="submit" className="ctl">
                Assign
              </button>
            </form>
          </section>
        ) : null}
      </div>
    </div>
  );
}
