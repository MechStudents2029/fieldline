import Link from "next/link";
import { applyClientCreditAction, releaseClientCreditAction, voidClientCreditAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { DetailFacts, DetailHeader } from "@/components/detail-header";
import { IdempotencyKey } from "@/components/idempotency-key";
import { MissingRecord } from "@/components/missing-record";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { canManageMoney, canSeeMoney } from "@/lib/permissions";
import { clientCreditDetail } from "@/lib/services/client-credits";

export default async function CreditMemoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const memo = clientCreditDetail(session, id);
  if (!memo) return <MissingRecord orgName={session.orgName} kind="credit memo" />;
  const office = canManageMoney(session.role);
  const seeMoney = canSeeMoney(session.role);
  return (
    <div className="flex flex-col gap-4 pb-6">
      <DetailHeader
        title={memo.number}
        status={memo.statusLabel}
        meta={
          <>
            {memo.clientName} · <Link href={`/projects/${memo.projectId}`}>{memo.projectName}</Link>
          </>
        }
      />
      <DetailFacts
        label="Credit memo"
        rows={[
          { label: "Title", value: memo.title },
          ...(memo.description ? [{ label: "Description", value: memo.description }] : []),
          ...(seeMoney ? [{ label: "Amount", value: <span className="num">{formatMoney(memo.amountCents)}</span> }] : []),
          ...(seeMoney ? [{ label: "Applied", value: <span className="num">{formatMoney(memo.appliedCents)}</span> }] : []),
          ...(seeMoney ? [{ label: "Remaining", value: <span className="num">{formatMoney(memo.remainingCents)}</span> }] : []),
          ...(memo.voidReason ? [{ label: "Void", value: memo.voidReason }] : []),
        ]}
      />
      {memo.lines.length ? (
        <section className="px-4" aria-label="Lines">
          <table className="mac-table">
            <thead>
              <tr>
                <th>Cost code</th>
                <th>Line</th>
                {seeMoney ? <th className="text-right">Amount</th> : null}
              </tr>
            </thead>
            <tbody>
              {memo.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.costCode}</td>
                  <td>{line.description}</td>
                  {seeMoney ? <td className="num text-right">{formatMoney(line.amountCents)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {seeMoney && memo.applications.length ? (
        <section className="px-4" aria-label="Applications">
          <h2 className="mac-t13 text-[var(--mac-secondary)]">Applied</h2>
          <ul>
            {memo.applications.map((row) => (
              <li key={row.id} className="mac-t13">
                <Link href={`/invoices/${row.invoiceId}`}>{row.invoiceNumber}</Link>
                <span className="num"> · {formatMoney(row.amountCents)}</span>
                <span className="fl-pill ml-2">{row.status === "void" ? "Void" : "Credit memo"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {office && memo.status === "draft" ? (
        <ActionForm action={releaseClientCreditAction.bind(null, memo.id)} className="flex max-w-lg flex-col gap-2 px-4">
          {memo.kind === "flat" ? (
            <label className="text-sm">
              Amount
              <input name="amount" aria-label="Amount" inputMode="decimal" className="field mt-1" required />
            </label>
          ) : (
            memo.lines.map((line, index) => (
              <div key={line.id} className="grid grid-cols-[8rem_1fr_6rem] gap-2">
                <input name={`line${index}code`} aria-label={`Cost code ${index + 1}`} defaultValue={line.costCode} className="field" />
                <input name={`line${index}desc`} aria-label={`Line ${index + 1}`} defaultValue={line.description} className="field" />
                <input name={`line${index}amount`} aria-label={`Line amount ${index + 1}`} inputMode="decimal" className="field" required />
              </div>
            ))
          )}
          <button type="submit" className="mac-primary w-fit">
            Release
          </button>
        </ActionForm>
      ) : null}
      {office && (memo.status === "ready" || memo.status === "partial") && memo.openInvoices.length ? (
        <ActionForm action={applyClientCreditAction} className="flex flex-wrap items-end gap-2 px-4">
          <input type="hidden" name="memoId" value={memo.id} />
          <IdempotencyKey />
          <label className="text-sm">
            Invoice
            <select name="invoiceId" aria-label="Invoice" className="field mt-1" required>
              {memo.openInvoices.map((invoice) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.number}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Amount
            <input name="amount" aria-label="Apply amount" inputMode="decimal" className="field mt-1" required />
          </label>
          <button type="submit" className="mac-primary">
            Apply
          </button>
        </ActionForm>
      ) : null}
      {office && memo.status !== "void" ? (
        <ActionForm action={voidClientCreditAction.bind(null, memo.id)} className="flex flex-wrap items-end gap-2 px-4">
          <input name="reason" aria-label="Void reason" placeholder="Reason" className="ctl" required />
          <button type="submit" className="ctl">
            Void
          </button>
        </ActionForm>
      ) : null}
    </div>
  );
}
