import Link from "next/link";
import { notFound } from "next/navigation";
import { createPayApplicationAction } from "@/app/(office)/pay-applications/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatWhole } from "@/lib/money";
import { canManageMoney } from "@/lib/permissions";
import { listPayApplications, progressPurchaseOrders } from "@/lib/services/pay-applications";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const FILTERS = [
  ["", "All"],
  ["draft", "Draft"],
  ["submitted", "Submitted"],
  ["under_review", "Under review"],
  ["revise", "Revise & resubmit"],
  ["approved", "Approved"],
  ["void", "Void"],
  ["age", "Age"],
];

export default async function PayApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (session.role === "field") notFound();
  const query = await searchParams;
  const filter = one(query.filter) ?? "";
  const projectId = one(query.project) ?? "";
  const vendorContactId = one(query.vendor) ?? "";
  const period = one(query.period) ?? "";
  const rows = listPayApplications(session, { status: filter, projectId, vendorContactId, period });
  const all = listPayApplications(session, {});
  const jobs = [...new Map(all.map((row) => [row.projectId, row.job])).entries()];
  const vendors = [...new Map(all.map((row) => [row.vendorContactId, row.vendor])).entries()];
  const orders = canManageMoney(session.role) ? progressPurchaseOrders(session) : [];
  const csv = `/api/export/pay-applications?filter=${encodeURIComponent(filter)}&project=${encodeURIComponent(projectId)}&vendor=${encodeURIComponent(vendorContactId)}&period=${encodeURIComponent(period)}`;
  const thisCents = rows.reduce((sum, row) => sum + row.thisCents, 0);
  const netCents = rows.reduce((sum, row) => sum + row.netCents, 0);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Pay applications" subtitle={String(rows.length)} search={false} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Pay applications</h1>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <select name="filter" aria-label="Status" defaultValue={filter} className="field w-auto">
            {FILTERS.map(([value, label]) => (
              <option key={value || "all"} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select name="project" aria-label="Job" defaultValue={projectId} className="field w-auto">
            <option value="">All jobs</option>
            {jobs.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select name="vendor" aria-label="Vendor" defaultValue={vendorContactId} className="field w-auto">
            <option value="">All vendors</option>
            {vendors.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <input name="period" type="date" aria-label="Period" defaultValue={period} className="field w-auto" />
          <button type="submit" className="mac-glass-btn">
            Show
          </button>
          <Link href={csv} className="text-[var(--mac-accent)]">
            CSV
          </Link>
        </form>
        <table aria-label="Pay applications" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-2 pr-3 font-medium">Job</th>
              <th className="py-2 pr-3 font-medium">Vendor</th>
              <th className="py-2 pr-3 font-medium">PO</th>
              <th className="py-2 pr-3 font-medium">No.</th>
              <th className="py-2 pr-3 font-medium">Period</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 text-right font-medium">This period</th>
              <th className="py-2 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[var(--mac-separator)]" data-pay-app={row.id}>
                <td className="py-2 pr-3">{row.job}</td>
                <td className="py-2 pr-3">{row.vendor}</td>
                <td className="py-2 pr-3">{row.poNumber}</td>
                <td className="py-2 pr-3 num">
                  <Link href={`/pay-applications/${row.id}`} className="text-[var(--mac-accent)]">
                    {row.number}
                  </Link>
                </td>
                <td className="py-2 pr-3 num">{row.periodEnd}</td>
                <td className="py-2 pr-3">
                  <span className="fl-pill" data-status={row.status}>
                    {row.statusLabel}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right num">{formatWhole(row.thisCents)}</td>
                <td className="py-2 text-right num">{formatWhole(row.netCents)}</td>
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
              <td className="py-2 pr-3 text-right num">{formatWhole(thisCents)}</td>
              <td className="py-2 text-right num">{formatWhole(netCents)}</td>
            </tr>
          </tfoot>
        </table>
        {orders.length > 0 ? (
          <ActionForm action={createPayApplicationAction} className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              Purchase order
              <select name="purchaseOrderId" aria-label="Purchase order" className="field" required>
                {orders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.number}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Start
              <input name="periodStart" type="date" aria-label="Start" required className="field" />
            </label>
            <label className="text-sm">
              End
              <input name="periodEnd" type="date" aria-label="End" required className="field" />
            </label>
            <button type="submit" className="mac-glass-btn">
              Create
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
