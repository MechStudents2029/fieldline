import Link from "next/link";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { listProjects } from "@/lib/services/read";
import { orgRfis } from "@/lib/services/rfis";

export default async function RfisPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; assignee?: string; status?: string; overdue?: string }>;
}) {
  const session = await requireSession();
  const query = await searchParams;
  const items = orgRfis(session, {
    projectId: query.job || null,
    assignee: query.assignee || null,
    status: query.status || null,
    overdue: query.overdue === "1",
  });
  const jobs = listProjects(session.orgId).map((row) => ({ id: row.project.id, name: row.project.name }));
  const assignees = [...new Map(items.map((item) => [item.assigneeName, item.assigneeName])).keys()];
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="RFIs" search={false} trailing={<a href="/api/export/rfis">CSV</a>} />
      </div>
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <h1 className="fl-large-title md:hidden">RFIs</h1>
        <form className="flex flex-wrap gap-2" method="get">
          <label className="text-sm">
            Job
            <select name="job" aria-label="Job" defaultValue={query.job || ""} className="field mt-1">
              <option value="">All jobs</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Status
            <select name="status" aria-label="Status" defaultValue={query.status || ""} className="field mt-1">
              <option value="">Any</option>
              <option value="open">Open</option>
              <option value="answered">Answered</option>
              <option value="closed">Closed</option>
              <option value="void">Void</option>
            </select>
          </label>
          <label className="text-sm">
            <input type="checkbox" name="overdue" value="1" defaultChecked={query.overdue === "1"} aria-label="Overdue" /> Overdue
          </label>
          {query.assignee ? <input type="hidden" name="assignee" value={query.assignee} /> : null}
          <button type="submit" className="self-end text-sm">
            Filter
          </button>
        </form>
        <p className="sr-only">{assignees.join(", ")}</p>
        <table className="mac-table" aria-label="RFIs">
          <thead>
            <tr>
              <th>Number</th>
              <th>Title</th>
              <th>Assignee</th>
              <th>Due</th>
              <th>Age</th>
              <th>Status</th>
              <th>Impact</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="num">{item.label}</td>
                <td>
                  <Link href={item.href}>{item.title}</Link>
                </td>
                <td>{item.assigneeName}</td>
                <td>{item.dueOn ? formatCalendarDay(item.dueOn) : "—"}</td>
                <td className="num">{item.ageDays}</td>
                <td>
                  <span className="fl-pill">{item.statusLabel}</span>
                </td>
                <td>{item.impact}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
