import Link from "next/link";
import { redirect } from "next/navigation";
import { ListToolbar } from "@/components/list-toolbar";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { one, pinnedTarget, readQuery } from "@/lib/lists/query";
import { canEditCrm } from "@/lib/permissions";
import { LIST_FILTERS, listSavedViews, viewHref } from "@/lib/services/saved-views";
import { listProjects } from "@/lib/services/read";
import { orgRfis } from "@/lib/services/rfis";

export default async function RfisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const query = await searchParams;
  const keys = LIST_FILTERS.rfis ?? [];
  const views = listSavedViews(session, "rfis");
  const target = pinnedTarget("/rfis", query, views.find((view) => view.pinned) ?? null, keys);
  if (target) redirect(target);
  const filters = readQuery(query, keys);
  const items = orgRfis(session, {
    projectId: filters.job || null,
    assignee: filters.assignee || null,
    status: filters.status || null,
    overdue: filters.overdue === "1",
  });
  const jobs = listProjects(session.orgId).map((row) => ({ id: row.project.id, name: row.project.name }));
  const needle = (filters.q || "").toLowerCase();
  const shown = needle ? items.filter((item) => `${item.title} ${item.projectName} ${item.label}`.toLowerCase().includes(needle)) : items;
  const catalog = orgRfis(session, {});
  const assignees = [...new Map(catalog.filter((item) => item.assigneeValue).map((item) => [item.assigneeValue, item.assigneeName])).entries()].map(([value, label]) => ({ value, label }));
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="RFIs" search={false} trailing={<a href="/api/export/rfis">CSV</a>} />
      </div>
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <h1 className="fl-large-title md:hidden">RFIs</h1>
        <ListToolbar
          path="/rfis"
          list="rfis"
          search={filters.q || ""}
          query={filters}
          activeId={views.some((view) => view.id === one(query.view)) ? one(query.view) : ""}
          canShare={canEditCrm(session.role)}
          clearHref={Object.keys(filters).length ? "/rfis?view=none" : null}
          views={views.map((view) => ({ id: view.id, name: view.name, href: viewHref(view), pinned: view.pinned, mine: view.mine, shared: view.shared }))}
          filters={[
            { name: "job", label: "Job", value: filters.job || "", any: "Any", options: jobs.map((job) => ({ value: job.id, label: job.name })) },
            { name: "assignee", label: "Assignee", value: filters.assignee || "", any: "Any", options: assignees },
            { name: "status", label: "Status", value: filters.status || "", any: "Any", options: [{ value: "open", label: "Open" }, { value: "answered", label: "Answered" }, { value: "closed", label: "Closed" }, { value: "void", label: "Void" }] },
            { name: "overdue", label: "Overdue", value: filters.overdue || "", any: "Any", options: [{ value: "1", label: "Yes" }] },
          ]}
        />
        <div className="overflow-x-auto">
        <table className="mac-table" aria-label="RFIs">
          <thead>
            <tr>
              <th>Number</th>
              <th>Title</th>
              <th>Job</th>
              <th>Assignee</th>
              <th>Due</th>
              <th>Age</th>
              <th>Status</th>
              <th>Impact</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((item) => (
              <tr key={item.id}>
                <td className="num">{item.label}</td>
                <td>
                  <Link href={item.href}>{item.title}</Link>
                </td>
                <td className="clip" title={item.projectName}>{item.projectName}</td>
                <td>{item.assigneeName}</td>
                <td className="num">{item.dueOn ? formatCalendarDay(item.dueOn) : "—"}</td>
                <td className="num">{item.ageDays}</td>
                <td>
                  <span className="fl-pill">{item.statusLabel}</span>
                </td>
                <td className="num">{item.impact}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
