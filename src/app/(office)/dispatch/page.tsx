import { DispatchBoard } from "@/components/dispatch-board";
import { Segmented, Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { dispatchBoard } from "@/lib/services/dispatch";

export const dynamic = "force-dynamic";

export default async function DispatchPage({ searchParams }: { searchParams: Promise<{ on?: string }> }) {
  const session = await requireSession();
  const query = await searchParams;
  const board = dispatchBoard(session, query.on);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title="Dispatch"
        subtitle={`${board.open} open`}
        search={false}
        center={
          <span className="inline-flex items-center gap-2">
            <a href={`/dispatch?on=${board.prev}`} className="mac-glass-btn">Prev</a>
            <a href="/dispatch" className="mac-glass-btn">Today</a>
            <a href={`/dispatch?on=${board.next}`} className="mac-glass-btn">Next</a>
            <span className="mac-t13">{board.label}</span>
            <Segmented
              items={[
                { href: `/dispatch?on=${board.day}`, label: "Day", current: true },
                { href: "/schedule", label: "Week" },
              ]}
            />
          </span>
        }
      />
      <DispatchBoard board={board} />
    </div>
  );
}
