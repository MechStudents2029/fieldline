import Link from "next/link";
import { TmBoard } from "@/components/tm-board";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { listTickets } from "@/lib/services/tm";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || "";
}

export default async function TmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const params = await searchParams;
  const status = one(params.status);
  const projectId = one(params.job);
  const board = listTickets(session, { status, projectId });
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  if (projectId) query.set("job", projectId);
  const csv = `/api/export/tm${query.toString() ? `?${query.toString()}` : ""}`;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Toolbar
        title="T&M tickets"
        subtitle={`${board.rows.length} ${board.rows.length === 1 ? "ticket" : "tickets"}`}
        search={false}
        trailing={
          <span className="flex items-center gap-2">
            <Link className="mac-glass-btn" href="/tm/new">
              New ticket
            </Link>
            <a className="mac-glass-btn" href={csv}>
              CSV
            </a>
          </span>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4">
        <TmBoard rows={board.rows} canBill={board.canBill} jobs={board.jobs} status={status} projectId={projectId} />
      </div>
    </div>
  );
}
