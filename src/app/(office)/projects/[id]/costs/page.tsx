import Link from "next/link";
import { CostsBoard } from "@/components/costs-board";
import { DateRangeBar } from "@/components/date-range-bar";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatWhole } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { costPlusBoard } from "@/lib/services/cost-plus";
import { calendarForOrg } from "@/lib/services/time";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

export const dynamic = "force-dynamic";

function todayIn(zone: string) {
  return localDay(Date.now(), zone);
}

export default async function CostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) return null;
  const board = costPlusBoard(session, id);
  if (!board) return null;
  const zone = calendarForOrg(session.orgId).timeZone;
  const today = todayIn(zone);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || "") ? query.from! : addCalendarDays(today, -60);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || "") ? query.to! : today;
  const shown = board.costs.filter((cost) => cost.occurredOn >= from && cost.occurredOn <= to);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Costs" subtitle={board.projectName} search={false} leading={<Link href={`/projects/${id}`}>‹</Link>} />
      </div>
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <div className="mac-strip">
          <div>
            <p className="mac-t22 num">{formatWhole(board.unbilledCostCents)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Unbilled</p>
          </div>
          <div>
            <p className="mac-t22 num">{formatWhole(board.billedCents)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Billed</p>
          </div>
          <div>
            <p className="mac-t22 num">{(board.markupBps / 100).toFixed(1)}%</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Markup</p>
          </div>
        </div>
        <DateRangeBar from={from} to={to} />
        <CostsBoard
          projectId={id}
          markupBps={board.markupBps}
          taxBps={board.taxBps}
          canEdit={board.canEdit}
          costs={shown}
          codes={board.codes.map((code) => ({ costCode: code.costCode, name: code.name, markupBps: code.markupBps }))}
        />
      </div>
    </div>
  );
}
