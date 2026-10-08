import Link from "next/link";
import { redirect } from "next/navigation";
import { ListToolbar } from "@/components/list-toolbar";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { one, pinnedTarget, readQuery } from "@/lib/lists/query";
import { formatMoney } from "@/lib/money";
import { canEditCrm, canManageMoney, canSeeMoney } from "@/lib/permissions";
import { listBills, vendorBillSummaries } from "@/lib/services/bills";
import { listContacts, listProjects } from "@/lib/services/read";
import { LIST_FILTERS, listSavedViews, viewHref } from "@/lib/services/saved-views";

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return <h1 className="fl-large-title">Bills</h1>;
  }
  const query = await searchParams;
  const keys = LIST_FILTERS.bills ?? [];
  const views = listSavedViews(session, "bills");
  const target = pinnedTarget("/bills", query, views.find((view) => view.pinned) ?? null, keys);
  if (target) redirect(target);
  const filters = readQuery(query, keys);
  const rows = listBills(session.orgId, session.role, {
    projectId: filters.job || undefined,
    vendorContactId: filters.vendor || undefined,
    status: filters.status || undefined,
  }).filter((bill) => {
    const needle = (filters.q || "").toLowerCase();
    return !needle || `${bill.billNumber} ${bill.vendorName} ${bill.projectName}`.toLowerCase().includes(needle);
  });
  const summaries = vendorBillSummaries(session.orgId, session.role).filter((row) => !filters.vendor || row.contactId === filters.vendor);
  const jobs = listProjects(session.orgId);
  const vendors = listContacts(session.orgId).filter((contact) => contact.type === "sub" || contact.type === "vendor");
  return (
    <div className="flex flex-col gap-5">
      <div className="hidden md:block">
        <Toolbar title="Bills" primary={canManageMoney(session.role) ? "New bill" : undefined} primaryHref={canManageMoney(session.role) ? "/bills/new" : undefined} search={false} />
      </div>
      <h1 className="fl-large-title md:hidden">Bills</h1>
      {canManageMoney(session.role) ? (
        <Link href="/bills/new" className="mac-primary w-fit md:hidden">
          New bill
        </Link>
      ) : null}
      <ListToolbar
        path="/bills"
        list="bills"
        search={filters.q || ""}
        query={filters}
        activeId={views.some((view) => view.id === one(query.view)) ? one(query.view) : ""}
        canShare={canEditCrm(session.role)}
        clearHref={Object.keys(filters).length ? "/bills?view=none" : null}
        views={views.map((view) => ({ id: view.id, name: view.name, href: viewHref(view), pinned: view.pinned, mine: view.mine, shared: view.shared }))}
        filters={[
          { name: "job", label: "Job", value: filters.job || "", any: "Any", options: jobs.map((row) => ({ value: row.project.id, label: row.project.name })) },
          { name: "vendor", label: "Vendor", value: filters.vendor || "", any: "Any", options: vendors.map((contact) => ({ value: contact.id, label: contact.company || contact.name })) },
          { name: "status", label: "Status", value: filters.status || "", any: "Any", options: [{ value: "draft", label: "Draft" }, { value: "approved", label: "Approved" }, { value: "paid", label: "Paid" }, { value: "void", label: "Void" }, { value: "overdue", label: "Overdue" }, { value: "upcoming", label: "Due soon" }] },
        ]}
      />
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
                <td className="clip" title={bill.projectName}>
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
        <h2 className="mac-t15">Vendors</h2>
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
