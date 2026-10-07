import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { formatMoney, formatPercent } from "@/lib/money";
import { payAppDocument } from "@/lib/services/draws";

export default async function PayAppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const doc = payAppDocument(session, id);
  if (!doc?.project) notFound();
  const lines = doc.lines;
  const scheduled = lines.reduce((sum, line) => sum + line.scheduledCents, 0);
  const previous = lines.reduce((sum, line) => sum + line.previousCents, 0);
  const current = lines.reduce((sum, line) => sum + line.thisCents, 0);
  const retainage = lines.reduce((sum, line) => sum + line.retainageCents, 0);
  return (
    <main className="mx-auto max-w-4xl bg-white px-8 py-8 text-[13px] text-black print:px-0">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/projects/${doc.project.id}/draws`} className="text-[var(--fl-accent)]">
          ‹ Draws
        </Link>
        <PrintButton />
      </div>
      <header className="mb-6 flex items-start justify-between gap-6">
        <div>
          <p className="text-[11px] uppercase tracking-wide">{doc.orgName}</p>
          <h1 className="text-[22px] font-semibold">Pay application {doc.invoice.applicationNumber ?? ""}</h1>
          <p>
            {doc.project.name}
            {doc.project.address ? ` · ${doc.project.address}` : ""}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 text-right">
          <dt>Number</dt>
          <dd>{doc.invoice.number}</dd>
          <dt>Date</dt>
          <dd>{formatCalendarDay(doc.invoice.issueDate)}</dd>
          <dt>Contract</dt>
          <dd>{formatMoney(doc.project.contractValueCents)}</dd>
          <dt>Amount due</dt>
          <dd>{formatMoney(doc.invoice.totalCents)}</dd>
        </dl>
      </header>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-black">
            <th className="py-1 pr-2 font-semibold">Item</th>
            <th className="py-1 text-right font-semibold">Scheduled</th>
            <th className="py-1 text-right font-semibold">Previous</th>
            <th className="py-1 text-right font-semibold">This period</th>
            <th className="py-1 text-right font-semibold">To date</th>
            <th className="py-1 text-right font-semibold">%</th>
            <th className="py-1 text-right font-semibold">Balance</th>
            <th className="py-1 text-right font-semibold">Retainage</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b border-neutral-300">
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                {line.name}
              </th>
              <td className="num py-1 text-right">{formatMoney(line.scheduledCents)}</td>
              <td className="num py-1 text-right">{formatMoney(line.previousCents)}</td>
              <td className="num py-1 text-right">{formatMoney(line.thisCents)}</td>
              <td className="num py-1 text-right">{formatMoney(line.previousCents + line.thisCents)}</td>
              <td className="num py-1 text-right">{formatPercent(line.percentBps)}</td>
              <td className="num py-1 text-right">{formatMoney(line.scheduledCents - line.previousCents - line.thisCents)}</td>
              <td className="num py-1 text-right">{formatMoney(line.retainageCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="py-2 text-left">
              Total
            </th>
            <td className="num py-2 text-right">{formatMoney(scheduled)}</td>
            <td className="num py-2 text-right">{formatMoney(previous)}</td>
            <td className="num py-2 text-right">{formatMoney(current)}</td>
            <td className="num py-2 text-right">{formatMoney(previous + current)}</td>
            <td />
            <td className="num py-2 text-right">{formatMoney(scheduled - previous - current)}</td>
            <td className="num py-2 text-right">{formatMoney(retainage)}</td>
          </tr>
        </tfoot>
      </table>
    </main>
  );
}
