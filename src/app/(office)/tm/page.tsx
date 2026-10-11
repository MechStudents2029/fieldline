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
        <form className="flex flex-wrap items-center gap-2" method="get">
          <select name="status" aria-label="Status" className="ctl" defaultValue={status}>
            <option value="">Status</option>
            <option value="draft">Draft</option>
            <option value="ready">Ready for review</option>
            <option value="verified">Field verified</option>
            <option value="billed">Billed</option>
            <option value="void">Void</option>
          </select>
          <select name="job" aria-label="Job" className="ctl" defaultValue={projectId}>
            <option value="">Job</option>
            {board.jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
          <button type="submit" className="ctl">
            Filter
          </button>
        </form>
        <TmBoard rows={board.rows} canBill={board.canBill} />
      </div>
    </div>
  );
}
