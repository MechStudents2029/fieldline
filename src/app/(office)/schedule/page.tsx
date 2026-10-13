import Link from "next/link";
import { GanttBoard } from "@/components/gantt-board";
import { ScheduleBoard } from "@/components/mac/schedule-board";
import { Segmented, Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { cleanZoom } from "@/lib/schedule/gantt";
import { orgGantt } from "@/lib/services/gantt";
import { getPref, setPref } from "@/lib/services/prefs";
import { scheduleBoard } from "@/lib/services/schedule";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ on?: string; span?: string; new?: string; job?: string; view?: string; zoom?: string; critical?: string }> }) {
  const session = await requireSession();
  const query = await searchParams;
  const zoom = cleanZoom(query.zoom) ?? cleanZoom(getPref(session, "ganttZoom")) ?? "week";
  if (cleanZoom(query.zoom)) setPref(session, "ganttZoom", query.zoom!);
  const requested = query.view === "gantt" || query.view === "grid" ? query.view : null;
  if (requested) setPref(session, "scheduleView", requested);
  const view = requested ?? (getPref(session, "scheduleView") === "gantt" ? "gantt" : "grid");
  if (view === "gantt") {
    const model = orgGantt(session, zoom);
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Toolbar
          title="Schedule"
          subtitle={`Finish ${model.finishLabel}`}
          mark={model.finishLabel}
          search={false}
          center={
            <span className="inline-flex items-center gap-2">
              <Segmented
                items={[
                  { href: "/schedule?view=grid", label: "Grid", current: false },
                  { href: "/schedule?view=gantt", label: "Gantt", current: true },
                  { href: "/dispatch", label: "Day", current: false },
                ]}
              />
              <Segmented
                items={[
                  { href: "/schedule?view=gantt&zoom=week", label: "Week", current: zoom === "week" },
                  { href: "/schedule?view=gantt&zoom=month", label: "Month", current: zoom === "month" },
                  { href: "/schedule?view=gantt&zoom=quarter", label: "Quarter", current: zoom === "quarter" },
                ]}
              />
            </span>
          }
        />
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          <GanttBoard model={model} critical={query.critical === "1"} printHref="/schedule/print" />
        </div>
      </div>
    );
  }
  const board = scheduleBoard(session, { on: query.on, span: query.span });
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-5 md:max-w-none md:h-full md:gap-0">
      <div className="hidden md:flex md:min-h-0 md:flex-1 md:flex-col">
        <ScheduleBoard key={`${query.new ?? ""}-${query.job ?? ""}-${query.on ?? ""}-${query.span ?? ""}`} board={board} openJobId={query.new === "1" ? query.job || "" : null} />
      </div>
      <div className="flex flex-col gap-4 md:hidden">
        <h1 className="fl-large-title">Schedule</h1>
        <p className="fl-footnote text-[var(--fl-secondary)]">{board.label}</p>
        <Link href="/schedule?view=gantt" className="fl-footnote text-[var(--fl-accent)]">
          Gantt
        </Link>
        <Link href="/dispatch" className="fl-footnote text-[var(--fl-accent)]">
          Day
        </Link>
        <ul className="fl-group">
          {board.phone.length === 0 ? <li className="fl-cell">No items this week</li> : null}
          {board.phone.map((item) => (
            <li key={item.id} className="fl-cell">
              <Link href={`/schedule/items/${item.id}`} className="min-w-0 flex-1">
                <span className="fl-body block truncate">{item.jobName}</span>
                <span className="fl-footnote block truncate text-[var(--fl-secondary)]">
                  {item.title} · {item.who} · {item.when}
                </span>
              </Link>
              {item.conflict ? <span className="fl-pill">Conflict</span> : null}
              {item.rfiDue ? <span className="text-[11px] text-[var(--fl-secondary)]">RFI</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
