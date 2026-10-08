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
import { orgSubmittals } from "@/lib/services/submittals";
import { SUBMITTAL_STATUSES, SUBMITTAL_STATUS_LABEL, pendingSubmittal } from "@/lib/submittals/format";

export default async function SubmittalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const keys = LIST_FILTERS.submittals ?? [];
  const views = listSavedViews(session, "submittals");
  const target = pinnedTarget("/submittals", query, views.find((view) => view.pinned) ?? null, keys);
  if (target) redirect(target);
  const filters = readQuery(query, keys);
  const items = orgSubmittals(session, {
    projectId: filters.job || null,
    assignee: filters.assignee || null,
    status: filters.status || null,
    overdue: filters.overdue === "1",
    division: filters.division || null,
    waiting: filters.waiting === "1",
  });
  const needle = (filters.q || "").toLowerCase();
  const shown = needle ? items.filter((item) => `${item.title} ${item.projectName} ${item.label} ${item.division}`.toLowerCase().includes(needle)) : items;
  const catalog = orgSubmittals(session, {});
  const jobs = listProjects(session.orgId).map((row) => ({ id: row.project.id, name: row.project.name }));
  const assignees = [...new Map(catalog.filter((item) => item.assigneeValue).map((item) => [item.assigneeValue, item.assigneeName])).entries()].map(([value, label]) => ({ value, label }));
  const divisions = [...new Set(catalog.map((item) => item.division).filter(Boolean))].sort();
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar
          title="Submittals"
          subtitle={`${shown.length}`}
          search={false}
          trailing={
            <span className="flex gap-3 text-sm">
              <Link href="/submittals/print">Print</Link>
              <a href="/api/export/submittals">CSV</a>
            </span>
          }
        />
      </div>
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <h1 className="fl-large-title md:hidden">Submittals</h1>
        <ListToolbar
          path="/submittals"
          list="submittals"
          search={filters.q || ""}
          query={filters}
          activeId={views.some((view) => view.id === one(query.view)) ? one(query.view) : ""}
          canShare={canEditCrm(session.role)}
          clearHref={Object.keys(filters).length ? "/submittals?view=none" : null}
          views={views.map((view) => ({ id: view.id, name: view.name, href: viewHref(view), pinned: view.pinned, mine: view.mine, shared: view.shared }))}
          filters={[
            { name: "job", label: "Job", value: filters.job || "", any: "Any", options: jobs.map((job) => ({ value: job.id, label: job.name })) },
            { name: "assignee", label: "Assignee", value: filters.assignee || "", any: "Any", options: assignees },
            { name: "status", label: "Status", value: filters.status || "", any: "Any", options: SUBMITTAL_STATUSES.map((status) => ({ value: status, label: SUBMITTAL_STATUS_LABEL[status] ?? status })) },
            { name: "division", label: "Division", value: filters.division || "", any: "Any", options: divisions.map((division) => ({ value: division, label: division })) },
            { name: "overdue", label: "Overdue", value: filters.overdue || "", any: "Any", options: [{ value: "1", label: "Yes" }] },
            { name: "waiting", label: "Review", value: filters.waiting || "", any: "Any", options: [{ value: "1", label: "Waiting" }] },
          ]}
        />
        <div className="hidden overflow-x-auto md:block">
          <table className="mac-table" aria-label="Submittals">
            <thead>
              <tr>
                <th>Number</th>
                <th>Title</th>
                <th>Job</th>
                <th>Division</th>
                <th>Assignee</th>
                <th>Due</th>
                <th>Age</th>
                <th>Status</th>
                <th>Rev</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => (
                <tr key={item.id}>
                  <td className="num">{item.label}</td>
                  <td>
                    <Link href={item.href}>{item.title}</Link>
                  </td>
                  <td className="clip" title={item.projectName}>
                    {item.projectName}
                  </td>
                  <td>{item.division}</td>
                  <td>{item.assigneeName}</td>
                  <td className={`num ${item.overdue ? "text-[var(--mac-danger)]" : ""}`}>{item.dueOn ? formatCalendarDay(item.dueOn) : "—"}</td>
                  <td className="num">{item.ageDays}</td>
                  <td>{pendingSubmittal(item.status) ? <span className="fl-pill">{item.statusLabel}</span> : <span className="text-[var(--mac-secondary)]">{item.statusLabel}</span>}</td>
                  <td className="num">{item.revision}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="fl-group md:hidden" aria-label="Submittal list">
          {shown.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="fl-cell">
                <span className="min-w-0 flex-1">
                  <span className="fl-body block truncate">
                    {item.label} · {item.title}
                  </span>
                  <span className="fl-footnote block truncate text-[var(--fl-secondary)]">
                    {[item.projectName, item.division, item.dueOn ? formatCalendarDay(item.dueOn) : ""].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="num">{item.revision}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
