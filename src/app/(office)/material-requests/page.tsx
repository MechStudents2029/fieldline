import Link from "next/link";
import { MaterialRequestForm } from "@/components/material-request-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { MATERIAL_STATUSES } from "@/lib/material/request";
import { canManageMoney } from "@/lib/permissions";
import {
  listMaterialRequests,
  materialCodes,
  materialJobs,
  materialPeople,
  materialStock,
} from "@/lib/services/material-requests";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const STATUS_LINKS = [
  ["draft", "Draft"],
  ["submitted", "Submitted"],
  ["approved", "Approved"],
  ["fulfilled", "Fulfilled"],
  ["ordered", "Ordered"],
  ["rejected", "Rejected"],
] as const;

export default async function MaterialRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const filters = {
    personId: one(query.person),
    projectId: one(query.job),
    status: one(query.status),
    urgency: one(query.urgency),
  };
  const rows = listMaterialRequests(session, filters);
  const jobs = materialJobs(session.orgId);
  const people = materialPeople(session);
  const stock = materialStock(session.orgId);
  const codes = materialCodes(session.orgId);
  const office = canManageMoney(session.role);
  const status = filters.status && (MATERIAL_STATUSES as readonly string[]).includes(filters.status) ? filters.status : "";
  const keep = new URLSearchParams();
  if (filters.personId && office) keep.set("person", filters.personId);
  if (filters.projectId) keep.set("job", filters.projectId);
  if (filters.urgency === "urgent" || filters.urgency === "normal") keep.set("urgency", filters.urgency);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Materials" subtitle={String(rows.length)} search={false} trailing={<a href="/api/export/material-requests">CSV</a>} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <div className="flex items-center justify-between md:hidden">
          <h1 className="fl-large-title">Materials</h1>
          <a href="/api/export/material-requests">CSV</a>
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
            Urgency
            <select name="urgency" aria-label="Filter urgency" className="field mt-1" defaultValue={filters.urgency ?? ""}>
              <option value="">All</option>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <button type="submit" className="ctl h-9">
            Filter
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Link href={`/material-requests?${keep.toString()}`} className="fl-pill" aria-current={status === "" ? "page" : undefined}>
            All
          </Link>
          {STATUS_LINKS.map(([id, label]) => {
            const next = new URLSearchParams(keep);
            next.set("status", id);
            return (
              <Link key={id} href={`/material-requests?${next.toString()}`} className="fl-pill" aria-current={status === id ? "page" : undefined} data-status-link={id}>
                {label}
              </Link>
            );
          })}
        </div>
        {rows.length === 0 ? <p className="num">0</p> : null}
        <ul className="fl-group">
          {rows.map((row) => (
            <li key={row.id} className="fl-cell" data-request={row.id} data-status={row.status} data-urgency={row.urgency}>
              <Link href={`/material-requests/${row.id}`} className="min-w-0 flex-1">
                <span className="fl-body block truncate">{row.title}</span>
                <span className="fl-footnote block truncate text-[var(--fl-secondary)]">{row.projectName}</span>
              </Link>
              <span className="num">{row.qtyLabel}</span>
              <span className="fl-pill">{row.statusLabel}</span>
              {row.urgency === "urgent" ? <span className="fl-pill">Urgent</span> : null}
              {row.duplicateId ? (
                <Link href={`/material-requests/${row.duplicateId}`} className="fl-pill" data-duplicate>
                  Duplicate
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
        {session.role === "viewer" ? null : (
          <MaterialRequestForm jobs={jobs} stock={stock} codes={codes} people={office ? people : undefined} />
        )}
      </div>
    </div>
  );
}
