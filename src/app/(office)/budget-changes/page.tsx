import Link from "next/link";
import { notFound } from "next/navigation";
import { createBudgetChangeAction } from "@/app/(office)/budget-changes/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatWhole } from "@/lib/money";
import { canEditCrm, canManageSettings } from "@/lib/permissions";
import { BUDGET_CHANGE_TYPES, budgetChangeJobs, jobLineChoices, listBudgetChanges } from "@/lib/services/budget-changes";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const FILTERS = [
  ["", "All"],
  ["draft", "Draft"],
  ["approved", "Approved"],
  ["voided", "Void"],
  ["age", "Age"],
  ["low", "Low"],
  ["transfer", "Transfer"],
  ["contingency", "Contingency"],
  ["allowance", "Allowance"],
  ["buyout", "Buy-out"],
];

export default async function BudgetChangesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (session.role === "field") notFound();
  const query = await searchParams;
  const filter = one(query.filter) ?? "";
  const projectId = one(query.project) ?? "";
  const rows = listBudgetChanges(session, { filter, projectId });
  const jobs = budgetChangeJobs(session);
  const lines = projectId ? jobLineChoices(session, projectId) : jobs.flatMap((job) => jobLineChoices(session, job.id));
  const csv = `/api/export/budget-changes?filter=${encodeURIComponent(filter)}&project=${encodeURIComponent(projectId)}`;
  const office = canEditCrm(session.role);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Budget changes" subtitle={String(rows.length)} search={false} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Budget changes</h1>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <select name="filter" aria-label="Filter" defaultValue={filter} className="field w-auto">
            {FILTERS.map(([value, label]) => (
              <option key={value || "all"} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select name="project" aria-label="Job" defaultValue={projectId} className="field w-auto">
            <option value="">All jobs</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
          <button type="submit" className="mac-glass-btn">
            Show
          </button>
          <Link href={csv} className="text-[var(--mac-accent)]">
            CSV
          </Link>
        </form>
        <table aria-label="Budget changes" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-2 pr-3 font-medium">Job</th>
              <th className="py-2 pr-3 font-medium">No.</th>
              <th className="py-2 pr-3 font-medium">Title</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">From</th>
              <th className="py-2 pr-3 font-medium">To</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[var(--mac-separator)]">
                <td className="py-2 pr-3">{row.job}</td>
                <td className="py-2 pr-3 num">{row.number}</td>
                <td className="py-2 pr-3">
                  <Link href={`/budget-changes/${row.id}`} className="text-[var(--mac-accent)]">
                    {row.title}
                  </Link>
                </td>
                <td className="py-2 pr-3">{row.typeLabel}</td>
                <td className="py-2 pr-3">
                  <span className="fl-pill" data-status={row.status}>
                    {row.statusLabel}
                  </span>
                </td>
                <td className="py-2 pr-3">{row.fromName}</td>
                <td className="py-2 pr-3">{row.toName}</td>
                <td className="py-2 text-right num">{formatWhole(row.amountCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--mac-separator)]">
              <td className="py-2 pr-3 num">{rows.length}</td>
              <td />
              <td />
              <td />
              <td />
              <td />
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
        {office ? (
          <ActionForm action={createBudgetChangeAction} className="flex flex-col gap-2">
            <label className="text-sm">
              Job
              <select name="projectId" aria-label="Change job" defaultValue={projectId || "proj_chen"} className="field mt-1">
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name}
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
              <select name="type" aria-label="Type" defaultValue="transfer" className="field mt-1">
                {BUDGET_CHANGE_TYPES.map((row) => (
                  <option key={row.value} value={row.value}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              From
              <select name="fromBudgetLineId" aria-label="From" className="field mt-1" defaultValue="">
                <option value="">Select</option>
                {lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.job} · {line.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              To
              <select name="toBudgetLineId" aria-label="To" className="field mt-1" defaultValue="">
                <option value="">Select</option>
                {lines.map((line) => (
                  <option key={`to-${line.id}`} value={line.id}>
                    {line.job} · {line.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Amount
              <input name="amount" aria-label="Amount" className="field mt-1" />
            </label>
            {canManageSettings(session.role) ? (
              <label className="text-sm">
                Override
                <input name="overrideNote" aria-label="Override note" className="field mt-1" />
              </label>
            ) : null}
            <Button type="submit">Save</Button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
