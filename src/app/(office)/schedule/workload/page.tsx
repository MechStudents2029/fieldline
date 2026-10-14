import Link from "next/link";
import { Segmented, Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatHours } from "@/lib/workload/hours";
import { workloadBoard, type WorkloadBoard } from "@/lib/services/workload";

function query(board: WorkloadBoard, patch: { on?: string; who?: string; week?: string } = {}) {
  const params = new URLSearchParams();
  params.set("on", patch.on ?? board.anchor);
  if (board.role) params.set("role", board.role);
  if (board.crew) params.set("crew", board.crew);
  if (board.vendors) params.set("vendors", "1");
  if (patch.who) params.set("who", patch.who);
  if (patch.week) params.set("week", patch.week);
  return `/schedule/workload?${params.toString()}`;
}

function csvHref(board: WorkloadBoard) {
  const params = new URLSearchParams();
  params.set("on", board.anchor);
  if (board.role) params.set("role", board.role);
  if (board.crew) params.set("crew", board.crew);
  if (board.vendors) params.set("vendors", "1");
  return `/api/export/workload?${params.toString()}`;
}

export default async function WorkloadPage({
  searchParams,
}: {
  searchParams: Promise<{ on?: string; role?: string; crew?: string; vendors?: string; who?: string; week?: string }>;
}) {
  const session = await requireSession();
  const queryParams = await searchParams;
  const board = workloadBoard(session, {
    on: queryParams.on,
    role: queryParams.role,
    crew: queryParams.crew,
    vendors: queryParams.vendors === "1",
    who: queryParams.who,
    week: queryParams.week,
  });
  const csv = csvHref(board);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="hidden md:block">
        <Toolbar
          title="Workload"
          subtitle={board.label}
          search={false}
          center={
            <Segmented
              items={[
                { href: "/schedule?view=grid", label: "Grid", current: false },
                { href: "/schedule?view=gantt", label: "Gantt", current: false },
                { href: "/schedule/workload", label: "Workload", current: true },
                { href: "/dispatch", label: "Day", current: false },
              ]}
            />
          }
          trailing={
            <a href={csv} className="mac-glass-btn">
              CSV
            </a>
          }
        />
      </div>
      <div className="flex items-center justify-between gap-3 px-4 pt-4 md:hidden">
        <h1 className="fl-large-title">Workload</h1>
        <a href={csv} className="ctl">
          CSV
        </a>
      </div>
      <form method="get" action="/schedule/workload" className="flex flex-wrap items-end gap-2 px-4 py-3">
        <a href={query(board, { on: board.prev })} className="mac-glass-btn">
          Prev
        </a>
        <a href={query(board, { on: board.next })} className="mac-glass-btn">
          Next
        </a>
        <label className="text-[13px]">
          Week
          <input type="date" name="on" aria-label="Week" defaultValue={board.anchor} className="field mt-1" />
        </label>
        <label className="text-[13px]">
          Role
          <select name="role" aria-label="Role" defaultValue={board.role} className="field mt-1">
            <option value="">All</option>
            <option value="office">Office</option>
            <option value="field">Field</option>
          </select>
        </label>
        <label className="text-[13px]">
          Crew
          <select name="crew" aria-label="Crew" defaultValue={board.crew} className="field mt-1">
            <option value="">All</option>
            {board.crews.map((crew) => (
              <option key={crew.id} value={crew.id}>
                {crew.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-[13px]">
          <input type="checkbox" name="vendors" value="1" defaultChecked={board.vendors} />
          Crews
        </label>
        <button type="submit" className="mac-glass-btn">
          Show
        </button>
      </form>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-8">
        <table className="mac-table wl-table" aria-label="Workload">
          <thead>
            <tr>
              <th>Person</th>
              {board.weeks.map((week) => (
                <th key={week.start}>{week.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => (
              <tr key={row.id}>
                <th>
                  <span className="block truncate">{row.name}</span>
                  <span className="block mac-t11 text-[var(--mac-secondary)]">{row.roleLabel}</span>
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.week}>
                    <Link
                      href={query(board, { who: row.id, week: cell.week })}
                      data-person={row.id}
                      data-week={cell.week}
                      data-over={cell.over ? "1" : "0"}
                      className={cell.over ? "wl-cell is-over" : "wl-cell"}
                    >
                      <span className="num">
                        {formatHours(cell.booked)} / {formatHours(cell.capacity)}
                      </span>
                      <span className={cell.over ? "fl-pill fl-pill-sm wl-pill is-over" : "fl-pill fl-pill-sm wl-pill"}>
                        {cell.percent == null ? "—" : `${cell.percent}%`}
                      </span>
                    </Link>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {board.focus ? (
          <section className="mt-6 max-w-lg">
            <h2 className="mac-t15">{board.focus.name}</h2>
            <p className="mac-t11 text-[var(--mac-secondary)]">{board.focus.label}</p>
            <ul className="mt-2 flex flex-col">
              {board.focus.items.map((item) => (
                <li key={`${item.key}-${item.source}`} className="flex items-baseline justify-between gap-3 border-b border-[var(--mac-separator)] py-2 text-[13px]">
                  <a href={item.href} className="min-w-0 truncate text-[var(--mac-accent)]">
                    {item.title}
                    {item.job ? <span className="text-[var(--mac-secondary)]"> · {item.job}</span> : null}
                  </a>
                  <span className="num shrink-0">{formatHours(item.minutes)}</span>
                </li>
              ))}
            </ul>
            {board.focus.pto > 0 ? <p className="mt-2 text-[13px]">PTO {formatHours(board.focus.pto)}</p> : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
