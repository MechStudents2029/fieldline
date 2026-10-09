import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatWhole } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { listEstimates } from "@/lib/services/read";

export default async function EstimatesPage() {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) return <h1 className="fl-large-title">Estimates</h1>;
  const rows = listEstimates(session.orgId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="hidden md:block">
        <Toolbar title="Estimates" subtitle={`${rows.length} versions`} primary="New lead" primaryHref="/leads/new" search={false} />
      </div>
      <h1 className="fl-large-title md:hidden">Estimates</h1>
      {rows.length === 0 ? <EmptyState title="No estimates yet" why="Draft one from a lead." href="/leads/new" action="Add a lead" /> : null}
      <div className="overflow-x-auto">
        <table className="mac-table">
          <thead>
            <tr>
              <th className="px-2">Estimate</th>
              <th className="px-2">Client</th>
              <th className="px-2">Status</th>
              <th className="px-2 text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.estimate.id}>
                <td className="px-2">
                  <Link href={`/estimates/${row.estimate.id}`} className="font-medium">
                    {row.estimate.title}
                  </Link>
                </td>
                <td className="px-2">{row.contact.name}</td>
                <td className="fit px-2" data-fit="status">
                  {row.estimate.status === "draft" || row.estimate.status === "sent" ? <span className="fl-pill">{row.estimate.status}</span> : row.estimate.status}
                </td>
                <td className="fit num px-2 text-right" data-fit="amount">{formatWhole(row.priceCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
