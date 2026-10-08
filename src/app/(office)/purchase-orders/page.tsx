import Link from "next/link";
import { redirect } from "next/navigation";
import { ListToolbar } from "@/components/list-toolbar";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { one, pinnedTarget, readQuery } from "@/lib/lists/query";
import { formatMoney } from "@/lib/money";
import { canEditCrm, canManageMoney, canSeeMoney } from "@/lib/permissions";
import { listPurchaseOrders } from "@/lib/services/purchase-orders";
import { listContacts, listProjects } from "@/lib/services/read";
import { LIST_FILTERS, listSavedViews, viewHref } from "@/lib/services/saved-views";

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return <h1 className="fl-large-title">Purchase orders</h1>;
  }
  const query = await searchParams;
  const keys = LIST_FILTERS["purchase-orders"] ?? [];
  const views = listSavedViews(session, "purchase-orders");
  const target = pinnedTarget("/purchase-orders", query, views.find((view) => view.pinned) ?? null, keys);
  if (target) redirect(target);
  const filters = readQuery(query, keys);
  const rows = listPurchaseOrders(session.orgId, session.role, {
    projectId: filters.job || undefined,
    vendorContactId: filters.vendor || undefined,
    status: filters.status || undefined,
  }).filter((order) => {
    const needle = (filters.q || "").toLowerCase();
    return !needle || `${order.number} ${order.vendorName} ${order.projectName}`.toLowerCase().includes(needle);
  });
  const jobs = listProjects(session.orgId);
  const vendors = listContacts(session.orgId).filter((contact) => contact.type === "sub" || contact.type === "vendor");
  return (
    <div className="flex flex-col gap-3">
      <div className="hidden md:block">
        <Toolbar title="Purchase orders" primary={canManageMoney(session.role) ? "New purchase order" : undefined} primaryHref={canManageMoney(session.role) ? "/purchase-orders/new" : undefined} search={false} />
      </div>
      <div className="flex items-center justify-between gap-3 px-4 md:hidden">
        <h1 className="fl-large-title">Purchase orders</h1>
        {canManageMoney(session.role) ? (
          <Link href="/purchase-orders/new" className="mac-primary">
            New
          </Link>
        ) : null}
      </div>
      <ListToolbar
        path="/purchase-orders"
        list="purchase-orders"
        search={filters.q || ""}
        query={filters}
        activeId={views.some((view) => view.id === one(query.view)) ? one(query.view) : ""}
        canShare={canEditCrm(session.role)}
        clearHref={Object.keys(filters).length ? "/purchase-orders?view=none" : null}
        views={views.map((view) => ({ id: view.id, name: view.name, href: viewHref(view), pinned: view.pinned, mine: view.mine, shared: view.shared }))}
        filters={[
          { name: "job", label: "Job", value: filters.job || "", any: "Any", options: jobs.map((row) => ({ value: row.project.id, label: row.project.name })) },
          { name: "vendor", label: "Vendor", value: filters.vendor || "", any: "Any", options: vendors.map((contact) => ({ value: contact.id, label: contact.company || contact.name })) },
          { name: "status", label: "Status", value: filters.status || "", any: "Any", options: [{ value: "draft", label: "Draft" }, { value: "issued", label: "Issued" }, { value: "closed", label: "Closed" }, { value: "void", label: "Void" }] },
        ]}
      />
      <div className="overflow-x-auto px-4">
        <table className="mac-table" aria-label="Purchase orders">
          <thead>
            <tr>
              <th>Number</th>
              <th>Vendor</th>
              <th>Job</th>
              <th>Status</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5}>No purchase orders</td>
              </tr>
            ) : null}
            {rows.map((order) => (
              <tr key={order.id}>
                <td className="num">
                  <Link href={`/purchase-orders/${order.id}`}>{order.number}</Link>
                </td>
                <td>{order.vendorName}</td>
                <td className="clip" title={order.projectName}>{order.projectName}</td>
                <td>
                  {order.status === "draft" ? <span className="fl-pill">{order.status}</span> : order.status}
                  {order.status === "issued" ? <span className="num"> · {formatMoney(order.openCents)}</span> : ""}
                </td>
                <td className="num text-right">{formatMoney(order.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
