import Link from "next/link";
import { CredentialForm } from "@/components/credential-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { canManageMoney } from "@/lib/permissions";
import { credentialCounts, credentialPeople, credentialTypesFor, listCredentials } from "@/lib/services/certifications";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const WINDOWS = [
  ["expired", "Expired"],
  ["7", "7"],
  ["30", "30"],
  ["90", "90"],
  ["due", "Due"],
] as const;

export default async function CertificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const filters = {
    personId: one(query.person),
    typeId: one(query.type),
    status: one(query.status),
    window: one(query.window),
    by: one(query.by),
  };
  const rows = listCredentials(session, filters);
  const types = credentialTypesFor(session);
  const people = credentialPeople(session);
  const counts = credentialCounts(session);
  const office = canManageMoney(session.role);
  const activeTypes = types.filter((type) => !type.archived);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Certifications" subtitle={String(rows.length)} search={false} trailing={<a href="/api/export/certifications">CSV</a>} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <div className="flex items-center justify-between md:hidden">
          <h1 className="fl-large-title">Certifications</h1>
          <a href="/api/export/certifications">CSV</a>
        </div>
        <p className="num" data-cert-counts>
          {counts.expired} Expired · {counts.d7} in 7 · {counts.d30} in 30 · {counts.d90} in 90
        </p>
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
            Type
            <select name="type" aria-label="Filter type" className="field mt-1" defaultValue={filters.typeId ?? ""}>
              <option value="">All</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Status
            <select name="status" aria-label="Filter status" className="field mt-1" defaultValue={filters.status ?? ""}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="revoked">Revoked</option>
            </select>
          </label>
          <label className="text-sm">
            Expiring by
            <input name="by" aria-label="Expiring by" type="date" className="field mt-1" defaultValue={filters.by ?? ""} />
          </label>
          <button type="submit" className="ctl h-9">
            Filter
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Link href="/certifications" className="fl-pill" aria-current={!filters.window ? "page" : undefined}>
            All
          </Link>
          {WINDOWS.map(([id, label]) => (
            <Link key={id} href={`/certifications?window=${id}`} className="fl-pill" aria-current={filters.window === id ? "page" : undefined} data-window-link={id}>
              {label}
            </Link>
          ))}
        </div>
        {rows.length === 0 ? <p className="num">0</p> : null}
        <ul className="fl-group">
          {rows.map((row) => (
            <li key={row.id} className="fl-cell" data-cert={row.id} data-status={row.status} data-window={row.bucket}>
              <Link href={`/certifications/${row.id}`} className="min-w-0 flex-1">
                <span className="fl-body block truncate">{row.typeName}</span>
                <span className="fl-footnote block truncate text-[var(--fl-secondary)]">{row.personName}</span>
              </Link>
              <span className="num">{row.expiresOn ?? "—"}</span>
              <span className="fl-pill">{row.statusLabel}</span>
              {row.requestedAt ? <span className="fl-pill">Requested</span> : null}
            </li>
          ))}
        </ul>
        {session.role === "viewer" ? null : <CredentialForm types={activeTypes} people={office ? people : undefined} />}
      </div>
    </div>
  );
}
