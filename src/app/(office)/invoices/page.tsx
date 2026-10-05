import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { listInvoices, qboImportLimitWarning, qboInvoicesExport } from "@/lib/services/read";

export default async function InvoicesPage() {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return (
      <div>
        <h1 className="font-heading text-3xl">Invoices</h1>
        <p className="mt-2 text-sm text-muted-foreground">Invoices are hidden for the field role.</p>
      </div>
    );
  }
  const rows = listInvoices(session.orgId);
  const exported = qboInvoicesExport(session.orgId);
  const limitWarning = qboImportLimitWarning(exported.invoiceCount, exported.rowCount);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="font-heading text-3xl">Invoices</h1>
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
      {rows.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          why="Invoices appear after a client signs a proposal. The deposit invoice is created then. This company has none yet."
          href="/leads/new"
          action="Add a lead"
        />
      ) : null}
      <ul className="divide-y divide-border rounded-xl bg-card ring-1 ring-foreground/10">
        {rows.map(({ invoice, project, contact }) => (
          <li key={invoice.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span>
              <Link href={`/pay/${invoice.payToken}`} className="font-medium underline">
                {invoice.number}
              </Link>
              <span className="block text-xs text-muted-foreground">
                {contact.name} · {project.name} · {invoice.type}
              </span>
            </span>
            <span className="text-right">
              {formatMoney(invoice.totalCents)}
              <span className="block text-xs uppercase text-muted-foreground">{invoice.status}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
