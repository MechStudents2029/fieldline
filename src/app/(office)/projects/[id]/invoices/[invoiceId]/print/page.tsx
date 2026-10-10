import Link from "next/link";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { costInvoiceDetail } from "@/lib/services/cost-plus";

export const dynamic = "force-dynamic";

export default async function CostInvoicePrintPage({ params }: { params: Promise<{ id: string; invoiceId: string }> }) {
  const { id, invoiceId } = await params;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) return null;
  const detail = costInvoiceDetail(session, id, invoiceId);
  if (!detail) return null;
  return (
    <main className="mx-auto min-h-screen max-w-[8.5in] bg-[var(--mac-window)] px-8 py-8 text-[13px] text-[var(--mac-label)] print:bg-white print:text-black">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/projects/${id}/invoices/${invoiceId}`}>‹</Link>
        <PrintButton />
      </div>
      <p>{session.orgName}</p>
      <h1 className="text-[22px] font-semibold">{detail.invoice.number}</h1>
      <p>{detail.project.name}</p>
      <table className="mt-6 w-full">
        <tbody>
          {detail.lines.map((line) => (
            <tr key={line.id}>
              <td className="py-1">{line.description}</td>
              <td className="py-1 text-right">{formatMoney(line.amountCents)}</td>
            </tr>
          ))}
          {detail.invoice.taxCents > 0 ? (
            <tr>
              <td className="py-1">Tax</td>
              <td className="py-1 text-right">{formatMoney(detail.invoice.taxCents)}</td>
            </tr>
          ) : null}
          <tr>
            <td className="py-2 font-semibold">Total</td>
            <td className="py-2 text-right font-semibold">{formatMoney(detail.invoice.totalCents)}</td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}
