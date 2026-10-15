import Link from "next/link";
import { MileageForm } from "@/components/mileage-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { MILEAGE_STATUSES } from "@/lib/mileage/rate";
import { canManageMoney } from "@/lib/permissions";
import { listMileageTrips, mileageJobs, mileagePeople, type MileageFilters } from "@/lib/services/mileage";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MileagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const filters: MileageFilters = {
    personId: one(query.person),
    projectId: one(query.job),
    from: one(query.from),
    to: one(query.to),
    status: one(query.status),
  };
  const rows = listMileageTrips(session, filters);
  const jobs = mileageJobs(session.orgId);
  const people = mileagePeople(session);
  const office = canManageMoney(session.role);
  const status = filters.status && (MILEAGE_STATUSES as readonly string[]).includes(filters.status) ? filters.status : "";
  const keep = new URLSearchParams();
  if (filters.personId && office) keep.set("person", filters.personId);
  if (filters.projectId) keep.set("job", filters.projectId);
  if (filters.from) keep.set("from", filters.from);
  if (filters.to) keep.set("to", filters.to);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Mileage" subtitle={String(rows.length)} search={false} trailing={<a href="/api/export/mileage">CSV</a>} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <div className="flex items-center justify-between md:hidden">
          <h1 className="fl-large-title">Mileage</h1>
          <a href="/api/export/mileage">CSV</a>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2">
          {office ? (
            <label className="text-sm">
              Person
              <select name="person" aria-label="Filter person" className="field mt-1" defaultValue={filters.personId ?? ""}>
                <option value="">All</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="text-sm">
            Job
            <select name="job" aria-label="Filter job" className="field mt-1" defaultValue={filters.projectId ?? ""}>
              <option value="">All</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            From
            <input name="from" aria-label="From date" type="date" className="field mt-1" defaultValue={filters.from ?? ""} />
          </label>
          <label className="text-sm">
            To
            <input name="to" aria-label="To date" type="date" className="field mt-1" defaultValue={filters.to ?? ""} />
          </label>
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <button type="submit" className="ctl h-9">
            Filter
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Link href={`/mileage?${keep.toString()}`} className="fl-pill" aria-current={status === "" ? "page" : undefined}>
            All
          </Link>
          {(
            [
              ["draft", "Draft"],
              ["submitted", "Submitted"],
              ["approved", "Approved"],
              ["reimbursed", "Reimbursed"],
              ["rejected", "Rejected"],
            ] as const
          ).map(([id, label]) => {
            const next = new URLSearchParams(keep);
            next.set("status", id);
            return (
              <Link key={id} href={`/mileage?${next.toString()}`} className="fl-pill" aria-current={status === id ? "page" : undefined} data-status-link={id}>
                {label}
              </Link>
            );
          })}
        </div>
        {rows.length === 0 ? <p className="num">0</p> : null}
        <ul className="fl-group">
          {rows.map((row) => (
            <li key={row.id} className="fl-cell" data-trip={row.id} data-status={row.status} data-purpose={row.purpose}>
              <Link href={`/mileage/${row.id}`} className="min-w-0 flex-1 truncate">
                {row.purpose}
              </Link>
              <span className="num">{row.milesLabel}</span>
              <span className="num">{row.business ? formatMoney(row.amountCents) : "—"}</span>
              <span className="fl-pill">{row.statusLabel}</span>
            </li>
          ))}
        </ul>
        {session.role === "viewer" ? null : <MileageForm jobs={jobs} people={office ? people : undefined} />}
      </div>
    </div>
  );
}
