import Link from "next/link";
import { completeTodosAction, createTodoAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { EmptyState } from "@/components/empty-state";
import { Toolbar } from "@/components/mac/toolbar";
import { TodoPane } from "@/components/todo-pane";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { canAddFieldNotes, canEditCrm } from "@/lib/permissions";
import { deadlinePhrase, type DeadlineEdge } from "@/lib/todos/deadline";
import { listTodos, todoDetail, todoPeople, type TodoFilter, type TodoRow } from "@/lib/services/todos";
import { calendarForOrg } from "@/lib/services/time";
import { localDay } from "@/lib/time/calendar";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || "";
}

function phraseFor(row: TodoRow) {
  if (row.unlinked) return "Unlinked";
  if (row.scheduleItemId && (row.deadlineEdge === "start" || row.deadlineEdge === "finish") && row.deadlineOffset != null) {
    return `${deadlinePhrase(row.deadlineEdge as DeadlineEdge, row.deadlineOffset)} · ${row.scheduleTitle}`;
  }
  return "";
}

function keep(params: Record<string, string>, task?: string) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  if (task) search.set("task", task);
  const text = search.toString();
  return text ? `/todos?${text}` : "/todos";
}

export default async function TodosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const filter: TodoFilter = {
    assignee: one(query.assignee) || null,
    projectId: one(query.job) || null,
    priority: one(query.priority) || null,
    due: one(query.due) || null,
    status: one(query.status) || null,
  };
  const rows = listTodos(session, filter);
  const people = todoPeople(session);
  const visibleJobIds = session.role === "field" ? new Set(listTodos(session).map((row) => row.projectId)) : null;
  const jobs = visibleJobIds ? people.jobs.filter((job) => visibleJobIds.has(job.id)) : people.jobs;
  const selectedId = one(query.task);
  const selected = selectedId ? todoDetail(session, selectedId) : null;
  const today = localDay(Date.now(), calendarForOrg(session.orgId).timeZone);
  const openCount = rows.filter((row) => row.status === "open").length;
  const office = canEditCrm(session.role);
  const params = {
    assignee: filter.assignee || "",
    job: filter.projectId || "",
    priority: filter.priority || "",
    due: filter.due || "",
    status: filter.status || "",
  };
  const filters = (
    <form method="get" className="flex flex-wrap items-center gap-2">
      <select name="assignee" aria-label="Assignee" defaultValue={params.assignee} className="field h-7 w-auto">
        <option value="">Assignee</option>
        {people.users.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
        {people.vendors.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
      <select name="job" aria-label="Job" defaultValue={params.job} className="field h-7 w-auto">
        <option value="">Job</option>
        {jobs.map((job) => (
          <option key={job.id} value={job.id}>
            {job.name}
          </option>
        ))}
      </select>
      <select name="priority" aria-label="Priority" defaultValue={params.priority} className="field h-7 w-auto">
        <option value="">Priority</option>
        <option value="low">Low</option>
        <option value="normal">Normal</option>
        <option value="high">High</option>
      </select>
      <select name="due" aria-label="Due" defaultValue={params.due} className="field h-7 w-auto">
        <option value="">Due</option>
        <option value="overdue">Overdue</option>
        <option value="week">This week</option>
        <option value="later">Later</option>
      </select>
      <select name="status" aria-label="Status" defaultValue={params.status} className="field h-7 w-auto">
        <option value="">Open</option>
        <option value="done">Done</option>
        <option value="all">All</option>
      </select>
      <button type="submit" className="mac-primary">
        Show
      </button>
    </form>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="hidden md:block">
        <Toolbar title="To-dos" subtitle={`${openCount} open`} search={false} trailing={office ? <Link href={keep({ ...params, new: "1" })} className="mac-primary">New</Link> : null} />
      </div>
      <div className="flex flex-col gap-3 px-4 pb-2 md:hidden">
        <h1 className="fl-title">To-dos</h1>
        <p className="mac-t13 text-[var(--mac-secondary)]">{openCount} open</p>
        {office ? (
          <Link href={keep({ ...params, new: "1" })} className="mac-primary w-fit">
            New
          </Link>
        ) : null}
      </div>
      <div className="px-4 pb-3">{filters}</div>
      {one(query.new) && office ? (
        <div role="dialog" aria-label="New to-do" className="mx-4 mb-3 max-w-xl rounded-md border border-[var(--mac-separator)] p-3">
        <ActionForm action={createTodoAction} className="flex flex-col gap-2">
          <h2 className="mac-t15">New to-do</h2>
          <label className="mac-t13">
            Title
            <input name="title" aria-label="Title" required className="field mt-1" />
          </label>
          <label className="mac-t13">
            Job
            <select name="projectId" aria-label="Job" required className="field mt-1" defaultValue={params.job}>
              {people.jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mac-t13">
            Priority
            <select name="priority" aria-label="Priority" className="field mt-1" defaultValue="normal">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="mac-t13">
            Notes
            <textarea name="notes" aria-label="Notes" rows={2} className="field mt-1" />
          </label>
          <label className="mac-t13">
            Tags
            <input name="tags" aria-label="Tags" className="field mt-1" />
          </label>
          <label className="mac-t13">
            Due
            <input name="dueAt" type="date" aria-label="Due" className="field mt-1" />
          </label>
          <label className="mac-t13">
            Schedule item
            <select name="scheduleItemId" aria-label="Schedule item" className="field mt-1" defaultValue="">
              <option value="">Fixed date</option>
              {people.items.filter((item) => !params.job || item.projectId === params.job).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <label className="mac-t13 flex-1">
              Edge
              <select name="deadlineEdge" aria-label="Edge" className="field mt-1" defaultValue="finish">
                <option value="finish">Finish</option>
                <option value="start">Start</option>
              </select>
            </label>
            <label className="mac-t13 flex-1">
              Workdays
              <input name="deadlineOffset" type="number" aria-label="Workdays" defaultValue="-1" className="field mt-1" />
            </label>
            <label className="mac-t13 flex-1">
              Remind
              <input name="remindDays" type="number" aria-label="Remind days" className="field mt-1" />
            </label>
          </div>
          <label className="mac-t13">
            Assignees
            <select name="userId" aria-label="Assignees" multiple className="field mt-1">
              {people.users.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mac-t13">
            Vendors
            <select name="contactId" aria-label="Vendors" multiple className="field mt-1">
              {people.vendors.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mac-t13">
            Checklist
            <textarea name="checks" aria-label="Checklist" rows={4} className="field mt-1" />
          </label>
          <button type="submit" className="mac-primary w-fit">
            Save
          </button>
        </ActionForm>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title="No to-dos" />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="min-w-0 flex-1 overflow-auto px-4">
            <ActionForm action={completeTodosAction} className="flex flex-col gap-2">
              <div className="hidden md:block">
                <table className="mac-table" aria-label="To-dos">
                  <thead>
                    <tr>
                      <th />
                      <th>Title</th>
                      <th>Job</th>
                      <th>Due</th>
                      <th>Priority</th>
                      <th>Progress</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const late = row.status === "open" && Boolean(row.dueAt) && (row.dueAt as string) < today;
                      return (
                        <tr key={row.id} className={row.id === selected?.id ? "is-selected" : undefined}>
                          <td>
                            <input type="checkbox" name="taskId" value={row.id} aria-label={`Select ${row.title}`} />
                          </td>
                          <td>
                            <Link href={keep(params, row.id)}>{row.title}</Link>
                          </td>
                          <td>{row.projectName}</td>
                          <td className={`num ${late ? "text-[var(--mac-danger)]" : ""}`} style={late ? { color: "var(--mac-danger)" } : undefined}>
                            {row.dueAt ? formatCalendarDay(row.dueAt) : ""}
                          </td>
                          <td>
                            <span className="rounded-full border border-[var(--mac-separator)] px-1.5 mac-t11">{row.priority}</span>
                          </td>
                          <td className="num">{row.progress}</td>
                          <td>{row.status === "done" ? "Done" : "Open"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="fl-group md:hidden">
                {rows.map((row) => (
                  <li key={row.id} className="flex items-center gap-2 border-b border-[var(--mac-separator)] px-3 py-3">
                    <input type="checkbox" name="taskId" value={row.id} aria-label={`Select ${row.title}`} />
                    <Link href={keep(params, row.id)} className="min-w-0 flex-1">
                      <span className="block truncate">{row.title}</span>
                      <span className="block mac-t11 text-[var(--mac-secondary)]">{[row.projectName, row.progress, row.dueAt].filter(Boolean).join(" · ")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {office || session.role === "field" ? (
                <button type="submit" className="mb-3 w-fit mac-t13">
                  Complete
                </button>
              ) : null}
            </ActionForm>
          </div>
          {selected ? (
            <TodoPane
              todo={selected}
              phrase={phraseFor(selected)}
              users={people.users}
              vendors={people.vendors}
              canEdit={office}
              canTick={canAddFieldNotes(session.role)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
