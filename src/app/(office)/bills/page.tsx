import Link from "next/link";
import { Toolbar } from "@/components/mac/toolbar";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { canManageMoney, canSeeMoney } from "@/lib/permissions";
import { listBills, vendorBillSummaries } from "@/lib/services/bills";
import { listContacts, listProjects } from "@/lib/services/read";

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; vendor?: string; status?: string }>;
}) {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return <h1 className="fl-large-title">Bills</h1>;
  }
  const query = await searchParams;
  const rows = listBills(session.orgId, session.role, {
    projectId: query.job || undefined,
    vendorContactId: query.vendor || undefined,
    status: query.status || undefined,
  });
  const summaries = vendorBillSummaries(session.orgId, session.role).filter((row) => !query.vendor || row.contactId === query.vendor);
  const jobs = listProjects(session.orgId);
  const vendors = listContacts(session.orgId).filter((contact) => contact.type === "sub" || contact.type === "vendor");
  return (
    <div className="flex flex-col gap-5">
      <div className="hidden md:block">
        <Toolbar title="Bills" primary={canManageMoney(session.role) ? "New bill" : undefined} primaryHref={canManageMoney(session.role) ? "/bills/new" : undefined} search={false} />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 md:hidden">
        <div>
          <h1 className="font-heading text-3xl">Bills</h1>
          <p className="text-sm text-muted-foreground">Sub and vendor bills for {session.orgName}. Approving one adds it to the job. Paying one does not move money.</p>
        </div>
        {canManageMoney(session.role) ? (
          <Link href="/bills/new" className="inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm text-primary-foreground">
            New bill
          </Link>
        ) : null}
      </div>
      <form method="get" className="grid gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:grid-cols-4">
        <label className="text-sm">
          Job
          <select name="job" defaultValue={query.job ?? ""} className="field mt-1" aria-label="Filter by job">
            <option value="">All jobs</option>
            {jobs.map((row) => (
              <option key={row.project.id} value={row.project.id}>
                {row.project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Vendor
          <select name="vendor" defaultValue={query.vendor ?? ""} className="field mt-1" aria-label="Filter by vendor">
            <option value="">All vendors</option>
            {vendors.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.company || contact.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Status
          <select name="status" defaultValue={query.status ?? ""} className="field mt-1" aria-label="Filter by status">
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
            <option value="overdue">Overdue</option>
            <option value="upcoming">Due in 7 days</option>
          </select>
        </label>
        <Button type="submit" variant="outline" className="h-11 self-end">
          Filter
        </Button>
      </form>
      <div className="overflow-x-auto">
        <table className="mac-table">
          <thead>
            <tr>
              <th className="px-2">Bill</th>
              <th className="px-2">Job</th>
              <th className="px-2">Status</th>
              <th className="px-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-2" colSpan={4}>No bills match these filters.</td>
              </tr>
            ) : null}
            {rows.map((bill) => (
              <tr key={bill.id}>
                <td className="px-2">
                  <Link href={`/bills/${bill.id}`} className="font-medium">
                    <span className="num">{bill.billNumber}</span> · {bill.vendorName}
                  </Link>
                  {bill.timing === "overdue" ? " · Overdue" : ""}
                  {bill.timing === "upcoming" ? " · Due soon" : ""}
                </td>
                <td className="px-2">
                  {bill.projectName}
                  {bill.dueDate ? <span className="num"> · {formatCalendarDay(bill.dueDate)}</span> : ""}
                </td>
                <td className="px-2">{bill.status === "draft" ? <span className="fl-pill">{bill.status}</span> : bill.status}</td>
                <td className="px-2 text-right num">{formatMoney(bill.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-heading text-xl">Vendors</h2>
        <p className="mt-1 text-xs text-muted-foreground">Billed is approved and paid. Committed is the issued purchase-order total. Open PO is what those orders still have after approved bills.</p>
        {summaries.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No approved or paid bills yet.</p> : null}
        <ul className="mt-3 space-y-4">
          {summaries.map((vendor) => (
            <li key={vendor.contactId}>
              <Link href={`/bills?vendor=${vendor.contactId}`} className="font-medium">
                {vendor.company || vendor.name}
              </Link>
              <p className="text-sm">
                Billed {formatMoney(vendor.billedCents)} · paid {formatMoney(vendor.paidCents)} · outstanding {formatMoney(vendor.outstandingCents)} · committed {formatMoney(vendor.committedCents)} · open PO {formatMoney(vendor.openBalanceCents)}
              </p>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {vendor.codes.map((code) => (
                  <li key={code.code}>
                    {code.code}: billed {formatMoney(code.billedCents)} · budget {formatMoney(code.budgetCents)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
