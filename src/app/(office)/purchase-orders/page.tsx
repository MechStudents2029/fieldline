import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { canManageMoney, canSeeMoney } from "@/lib/permissions";
import { listPurchaseOrders } from "@/lib/services/purchase-orders";
import { listContacts, listProjects } from "@/lib/services/read";

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; vendor?: string; status?: string }>;
}) {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return <p className="rounded-xl bg-muted p-4 text-sm">Purchase orders are for the office.</p>;
  }
  const query = await searchParams;
  const rows = listPurchaseOrders(session.orgId, session.role, {
    projectId: query.job || undefined,
    vendorContactId: query.vendor || undefined,
    status: query.status || undefined,
  });
  const jobs = listProjects(session.orgId);
  const vendors = listContacts(session.orgId).filter((contact) => contact.type === "sub" || contact.type === "vendor");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl">Purchase orders</h1>
          <p className="text-sm text-muted-foreground">
            Issued orders commit cost on {session.orgName} before a bill arrives. Nothing here is sent to the vendor.
          </p>
        </div>
        {canManageMoney(session.role) ? (
          <Link href="/purchase-orders/new" className="inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm text-primary-foreground">
            New purchase order
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
            <option value="issued">Issued</option>
            <option value="closed">Closed</option>
            <option value="void">Void</option>
          </select>
        </label>
        <Button type="submit" variant="outline" className="h-11 self-end">
          Filter
        </Button>
      </form>
      <ul className="divide-y divide-border rounded-xl bg-card ring-1 ring-foreground/10">
        {rows.length === 0 ? <li className="p-4 text-sm text-muted-foreground">No purchase orders match these filters.</li> : null}
        {rows.map((order) => (
          <li key={order.id} className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Link href={`/purchase-orders/${order.id}`} className="font-medium">
                {order.number} · {order.vendorName}
              </Link>
              <p className="text-xs text-muted-foreground">{order.projectName}</p>
            </div>
            <div className="text-left sm:text-right">
              <p>{formatMoney(order.amountCents)}</p>
              <p className="text-xs capitalize text-muted-foreground">
                {order.status}
                {order.status === "issued" ? ` · open ${formatMoney(order.openCents)}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
