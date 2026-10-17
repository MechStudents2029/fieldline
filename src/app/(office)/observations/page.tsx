import Link from "next/link";
import { createObservationAction } from "@/app/(office)/observations/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { canAddFieldNotes } from "@/lib/permissions";
import { listObservations, observationChoices } from "@/lib/services/observations";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const STATUSES = [
  ["", "All"],
  ["draft", "Draft"],
  ["open", "Open"],
  ["ready", "Ready for review"],
  ["closed", "Closed"],
  ["void", "Void"],
  ["overdue", "Overdue"],
  ["review", "Review"],
];

export default async function ObservationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const filter = {
    type: one(query.type) ?? "",
    status: one(query.filter) ?? "",
    priority: one(query.priority) ?? "",
    vendorContactId: one(query.vendor) ?? "",
    projectId: one(query.project) ?? "",
  };
  const rows = listObservations(session, filter);
  const choices = observationChoices(session);
  const canCreate = canAddFieldNotes(session.role);
  const csv = `/api/export/observations?type=${encodeURIComponent(filter.type)}&filter=${encodeURIComponent(filter.status)}&priority=${encodeURIComponent(filter.priority)}&vendor=${encodeURIComponent(filter.vendorContactId)}&project=${encodeURIComponent(filter.projectId)}`;
  const print = `/observations/print?type=${encodeURIComponent(filter.type)}&filter=${encodeURIComponent(filter.status)}&priority=${encodeURIComponent(filter.priority)}&vendor=${encodeURIComponent(filter.vendorContactId)}&project=${encodeURIComponent(filter.projectId)}`;
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Observations" subtitle={String(rows.length)} search={false} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Observations</h1>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <select name="type" aria-label="Type" defaultValue={filter.type} className="field w-auto">
            <option value="">All types</option>
            {choices.types.map((row) => (
              <option key={row.value} value={row.value}>
                {row.label}
              </option>
            ))}
          </select>
          <select name="filter" aria-label="Status" defaultValue={filter.status} className="field w-auto">
            {STATUSES.map(([value, label]) => (
              <option key={value || "all"} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select name="priority" aria-label="Priority" defaultValue={filter.priority} className="field w-auto">
            <option value="">All priorities</option>
            {choices.priorities.map((row) => (
              <option key={row.value} value={row.value}>
                {row.label}
              </option>
            ))}
          </select>
          <select name="vendor" aria-label="Vendor filter" defaultValue={filter.vendorContactId} className="field w-auto">
            <option value="">All vendors</option>
            {choices.vendors.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          <select name="project" aria-label="Job" defaultValue={filter.projectId} className="field w-auto">
            <option value="">All jobs</option>
            {choices.jobs.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          <button type="submit" className="mac-glass-btn">
            Show
          </button>
          <Link href={csv} className="text-[var(--mac-accent)]">
            CSV
          </Link>
          <Link href={print} className="text-[var(--mac-accent)]">
            Print
          </Link>
        </form>
        <table aria-label="Observations" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-2 pr-3 font-medium">No.</th>
              <th className="py-2 pr-3 font-medium">Job</th>
              <th className="py-2 pr-3 font-medium">Title</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Priority</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Vendor</th>
              <th className="py-2 font-medium">Due</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[var(--mac-separator)]">
                <td className="py-2 pr-3 tabular-nums">{row.number}</td>
                <td className="py-2 pr-3">{row.job}</td>
                <td className="py-2 pr-3">
                  <Link href={`/observations/${row.id}`} className="text-[var(--mac-accent)]">
                    {row.title}
                  </Link>
                </td>
                <td className="py-2 pr-3">{row.typeLabel}</td>
                <td className="py-2 pr-3">{row.priorityLabel}</td>
                <td className="py-2 pr-3">
                  <span className="fl-pill" data-status={row.status}>
                    {row.statusLabel}
                  </span>
                </td>
                <td className="py-2 pr-3">{row.vendor || row.assignee}</td>
                <td className="py-2 tabular-nums">{row.dueDate ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="tabular-nums text-[var(--mac-secondary)]">{rows.length}</p>
        {canCreate ? (
          <ActionForm action={createObservationAction} className="grid max-w-xl gap-2">
            <label className="text-sm">
              Job
              <select name="projectId" aria-label="New job" className="field mt-1" defaultValue={filter.projectId || choices.jobs[0]?.id || ""}>
                {choices.jobs.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Title
              <input name="title" aria-label="Title" className="field mt-1" />
            </label>
            <label className="text-sm">
              Type
              <select name="type" aria-label="New type" className="field mt-1" defaultValue="quality">
                {choices.types.map((row) => (
                  <option key={row.value} value={row.value}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Priority
              <select name="priority" aria-label="New priority" className="field mt-1" defaultValue="medium">
                {choices.priorities.map((row) => (
                  <option key={row.value} value={row.value}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Hazard
              <input name="hazard" aria-label="Hazard" className="field mt-1" />
            </label>
            <label className="text-sm">
              Room
              <input name="location" aria-label="Room" className="field mt-1" />
            </label>
            <label className="text-sm">
              Cost code
              <input name="costCode" aria-label="Cost code" className="field mt-1" />
            </label>
            <label className="text-sm">
              Trade
              <input name="trade" aria-label="Trade" className="field mt-1" />
            </label>
            <label className="text-sm">
              Vendor
              <select name="assigneeContactId" aria-label="Vendor" className="field mt-1" defaultValue="">
                <option value="">None</option>
                {choices.vendors.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Crew
              <select name="assigneeUserId" aria-label="Crew" className="field mt-1" defaultValue="">
                <option value="">None</option>
                {choices.crew.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Due
              <input name="dueDate" type="date" aria-label="Due" className="field mt-1" />
            </label>
            <label className="text-sm">
              Description
              <textarea name="description" aria-label="Description" className="field mt-1" />
            </label>
            <button type="submit" className="mac-glass-btn w-fit">
              Add observation
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
