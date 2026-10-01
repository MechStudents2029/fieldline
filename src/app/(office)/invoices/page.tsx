import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { listInvoices } from "@/lib/services/read";

export default async function InvoicesPage() {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) return <p>Invoices are hidden for the field role.</p>;
  const rows = listInvoices(session.orgId);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <h1 className="font-heading text-3xl">Invoices</h1>
        <a href="/api/export/invoices" className="text-sm underline">
          CSV for QuickBooks
        </a>
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">A signed proposal creates the deposit invoice.</p> : null}
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
