import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { listInvoices, qboImportLimitWarning, qboInvoicesExport } from "@/lib/services/read";

export default async function InvoicesPage() {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return (
      <div>
        <h1 className="fl-large-title">Invoices</h1>
      </div>
    );
  }
  const rows = listInvoices(session.orgId);
  const exported = qboInvoicesExport(session.orgId);
  const limitWarning = qboImportLimitWarning(exported.invoiceCount, exported.rowCount);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="font-heading text-3xl md:hidden">Invoices</h1>
        <div className="max-w-md text-sm sm:text-right">
          <a href="/api/export/invoices" className="underline">
            QuickBooks Online invoices
          </a>
          <p className="mt-1 text-xs text-muted-foreground">
            For Settings → Import Data. Import customers first, then invoices. The Customer column must match DisplayName. About 100 invoices and 1,000 rows per file. Negative amounts are left out.
          </p>
          {limitWarning ? <p className="mt-1 text-xs text-copper">{limitWarning}</p> : null}
        </div>
      </div>
      <div className="hidden md:block">
        <Toolbar title="Invoices" search={false} />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          why="No invoices yet."
          href="/leads/new"
          action="Add a lead"
        />
      ) : null}
      <div className="overflow-x-auto">
        <table className="mac-table">
          <thead>
            <tr>
              <th className="px-2">Invoice</th>
              <th className="px-2">Client</th>
              <th className="px-2">Job</th>
              <th className="px-2">Status</th>
              <th className="px-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ invoice, project, contact }) => (
              <tr key={invoice.id}>
                <td className="px-2">
                  <Link href={`/pay/${invoice.payToken}`} className="font-medium underline">
                    {invoice.number}
                  </Link>
                </td>
                <td className="px-2">{contact.name}</td>
                <td className="px-2">{project.name} · {invoice.type}</td>
                <td className="fit px-2" data-fit="status">{invoice.status === "open" ? <span className="fl-pill">{invoice.status}</span> : invoice.status}</td>
                <td className="fit num px-2 text-right" data-fit="amount">{formatMoney(invoice.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
