import Link from "next/link";
import { notFound } from "next/navigation";
import { applyClientCreditAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { IdempotencyKey } from "@/components/idempotency-key";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { cashDueCents, paymentMethodLabel } from "@/lib/credits/client-memo";
import { formatMoney } from "@/lib/money";
import { canManageMoney, canSeeMoney } from "@/lib/permissions";
import { openMemosForInvoice } from "@/lib/services/client-credits";
import { policyLineForOrg } from "@/lib/services/late-fees";
import { invoiceByPayToken, listInvoices } from "@/lib/services/read";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) notFound();
  const match = listInvoices(session.orgId).find((row) => row.invoice.id === id);
  if (!match) notFound();
  const data = invoiceByPayToken(match.invoice.payToken);
  if (!data?.invoice || data.invoice.orgId !== session.orgId) notFound();
  const due = cashDueCents(data.invoice.totalCents, data.invoice.amountPaidCents);
  const memos = data.invoice.status === "open" ? openMemosForInvoice(session.orgId, data.invoice.projectId) : [];
  const history = data.payments.filter((payment) => payment.status === "succeeded" || payment.status === "void" || payment.method === "credit_memo");
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar
          title={data.invoice.number}
          subtitle={match.project.name}
          search={false}
          leading={<Link href="/invoices">‹</Link>}
          trailing={
            <>
              <span className="fl-pill">{data.invoice.status === "open" ? "Open" : data.invoice.status === "paid" ? "Paid" : data.invoice.status === "void" ? "Void" : "Draft"}</span>
              <Link href={`/pay/${data.invoice.payToken}`}>Pay</Link>
            </>
          }
        />
      </div>
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <p className="mac-t22 num">{formatMoney(due)}</p>
        <p className="mac-t13 text-[var(--mac-secondary)]">
          {match.contact.name} · Due {formatDate(data.invoice.dueDate)} · {formatMoney(data.invoice.totalCents)}
        </p>
        <table className="mac-table" aria-label="Lines">
          <tbody>
            {data.lines.map((line) => (
              <tr key={line.id}>
                <th scope="row" className="font-normal">
                  {line.description}
                </th>
                <td className="num text-right">{formatMoney(line.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {policyLineForOrg(session.orgId) ? <p data-late-policy>{policyLineForOrg(session.orgId)}</p> : null}
        <section aria-label="Payments">
          <h2 className="mac-t13 text-[var(--mac-secondary)]">Payments</h2>
          {history.length === 0 ? <p className="mac-t13">None</p> : null}
          <ul>
            {history.map((payment) => (
              <li key={payment.id} className="mac-t13">
                <span>{paymentMethodLabel(payment.method)}</span>
                <span className="num"> · {formatMoney(payment.amountCents)}</span>
                {payment.status === "void" ? <span className="fl-pill ml-2">Void</span> : null}
                {payment.method === "credit_memo" ? <span className="num text-[var(--mac-secondary)]"> · {formatMoney(payment.netCents)} cash</span> : null}
              </li>
            ))}
          </ul>
        </section>
        {canManageMoney(session.role) && data.invoice.status === "open" && memos.length ? (
          <ActionForm action={applyClientCreditAction} className="flex flex-wrap items-end gap-2">
            <IdempotencyKey />
            <label className="text-sm">
              Credit memo
              <select name="memoId" aria-label="Credit memo" className="field mt-1" required>
                {memos.map((memo) => (
                  <option key={memo.id} value={memo.id}>
                    {memo.number}
                  </option>
                ))}
              </select>
            </label>
            <input type="hidden" name="invoiceId" value={data.invoice.id} />
            <label className="text-sm">
              Amount
              <input name="amount" aria-label="Apply amount" inputMode="decimal" className="field mt-1" required />
            </label>
            <button type="submit" className="mac-primary">
              Apply
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
