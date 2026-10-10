import Link from "next/link";
import { openCostInvoiceAction, voidBillingAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatMoney, formatWhole } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { costInvoiceDetail } from "@/lib/services/cost-plus";

export const dynamic = "force-dynamic";

export default async function CostInvoicePage({ params }: { params: Promise<{ id: string; invoiceId: string }> }) {
  const { id, invoiceId } = await params;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) return null;
  const detail = costInvoiceDetail(session, id, invoiceId);
  if (!detail) return null;
  const { invoice, lines, project } = detail;
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar
          title={invoice.number}
          subtitle={project.name}
          search={false}
          leading={<Link href={`/projects/${id}/costs`}>‹</Link>}
          trailing={
            <>
              <span className="fl-pill fl-pill-sm">{invoice.status === "draft" ? "Draft" : invoice.status === "void" ? "Void" : "Open"}</span>
              <Link className="ctl" href={`/projects/${id}/invoices/${invoice.id}/print`}>
                Print
              </Link>
            </>
          }
        />
      </div>
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <p className="mac-t22 num">{formatWhole(invoice.totalCents)}</p>
        <table className="mac-table w-full text-left" aria-label="Invoice">
          <thead>
            <tr>
              <th>Line</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <th scope="row" className="font-normal">
                  {line.description}
                </th>
                <td className="num text-right">{formatMoney(line.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="mac-kv max-w-sm">
          <div>
            <dt>Cost</dt>
            <dd className="num">{formatMoney(detail.costCents)}</dd>
          </div>
          <div>
            <dt>Markup</dt>
            <dd className="num">{formatMoney(detail.markupCents)}</dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd className="num">{formatMoney(invoice.taxCents)}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd className="num">{formatMoney(invoice.totalCents)}</dd>
          </div>
        </dl>
        {invoice.status === "draft" ? (
          <ActionForm action={openCostInvoiceAction.bind(null, id, invoice.id)}>
            <button className="mac-primary" type="submit">
              Open
            </button>
          </ActionForm>
        ) : null}
        {invoice.status === "draft" || invoice.status === "open" ? (
          <ActionForm action={voidBillingAction.bind(null, invoice.id, id)}>
            <button className="ctl" type="submit">
              Void
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
