import Link from "next/link";
import { ScheduleBoard } from "@/components/mac/schedule-board";
import { requireSession } from "@/lib/auth/session";
import { scheduleBoard } from "@/lib/services/schedule";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ on?: string; span?: string; new?: string; job?: string }> }) {
  const session = await requireSession();
  const query = await searchParams;
  const board = scheduleBoard(session, { on: query.on, span: query.span });
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-5 md:max-w-none md:h-full md:gap-0">
      <div className="hidden md:flex md:min-h-0 md:flex-1 md:flex-col">
        <ScheduleBoard key={`${query.new ?? ""}-${query.job ?? ""}-${query.on ?? ""}-${query.span ?? ""}`} board={board} openJobId={query.new === "1" ? query.job || "" : null} />
      </div>
      <div className="flex flex-col gap-4 md:hidden">
        <h1 className="fl-large-title">Schedule</h1>
        <p className="fl-footnote text-[var(--fl-secondary)]">{board.label}</p>
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
