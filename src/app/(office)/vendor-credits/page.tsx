import Link from "next/link";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { listContacts, listProjects } from "@/lib/services/read";
import { listVendorCredits } from "@/lib/services/vendor-credits";

const FILTERS = [
  ["", "All"],
  ["draft", "Draft"],
  ["issued", "Issued"],
  ["acknowledged", "Acknowledged"],
  ["disputed", "Disputed"],
  ["partial", "Partially applied"],
  ["applied", "Applied"],
  ["void", "Void"],
] as const;

export default async function VendorCreditsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const query = await searchParams;
  const status = typeof query.status === "string" ? query.status : "";
  const job = typeof query.job === "string" ? query.job : "";
  const vendor = typeof query.vendor === "string" ? query.vendor : "";
  const attention = query.attention === "1";
  const seeMoney = canSeeMoney(session.role);
  const rows = listVendorCredits(session, {
    projectId: job || undefined,
    vendorContactId: vendor || undefined,
    status: status || undefined,
    attention,
  });
  const jobs = listProjects(session.orgId);
  const vendors = listContacts(session.orgId).filter((contact) => contact.type === "sub" || contact.type === "vendor");
  const subtitle = `${rows.length} ${rows.length === 1 ? "credit" : "credits"}`;
  const csv = `/api/export/vendor-credits?status=${encodeURIComponent(status)}&job=${encodeURIComponent(job)}&vendor=${encodeURIComponent(vendor)}&attention=${attention ? "1" : ""}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="hidden md:block">
        <Toolbar title="Vendor credits" subtitle={subtitle} search={false} trailing={<a href={csv}>CSV</a>} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 md:hidden">
        <h1 className="fl-large-title">Vendor credits</h1>
        <a href={csv} className="ctl">
          CSV
        </a>
      </div>
      <p className="px-4 mac-t13 text-[var(--mac-secondary)] md:hidden">{subtitle}</p>
      <form method="get" action="/vendor-credits" className="flex flex-wrap items-end gap-2 px-4">
        <label className="text-sm">
          Status
          <select name="status" aria-label="Status" className="field mt-1" defaultValue={status}>
            {FILTERS.map(([value, label]) => (
              <option key={value || "all"} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Job
          <select name="job" aria-label="Job" className="field mt-1" defaultValue={job}>
            <option value="">Any</option>
            {jobs.map((row) => (
              <option key={row.project.id} value={row.project.id}>
                {row.project.name}
              </option>
            ))}
          </select>
        </label>
        {seeMoney ? (
          <label className="text-sm">
            Vendor
            <select name="vendor" aria-label="Vendor" className="field mt-1" defaultValue={vendor}>
              <option value="">Any</option>
              {vendors.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.company || contact.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {attention ? <input type="hidden" name="attention" value="1" /> : null}
        <button type="submit" className="ctl">
          Show
        </button>
      </form>
      <div className="overflow-x-auto px-4">
        <table className="mac-table" aria-label="Vendor credits">
          <thead>
            <tr>
              <th>Credit</th>
              <th>Vendor</th>
              <th>Job</th>
              <th>Status</th>
              {seeMoney ? <th className="text-right">Amount</th> : null}
              {seeMoney ? <th className="text-right">Remaining</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={seeMoney ? 6 : 4}>No credits</td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/vendor-credits/${row.id}`}>{row.number}</Link>
                </td>
                <td>{row.vendorName}</td>
                <td className="clip">{row.projectName}</td>
                <td>
                  <span className="fl-pill">{row.statusLabel}</span>
                </td>
                {seeMoney ? <td className="num text-right">{formatMoney(row.amountCents)}</td> : null}
                {seeMoney ? <td className="num text-right">{formatMoney(row.remainingCents)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
