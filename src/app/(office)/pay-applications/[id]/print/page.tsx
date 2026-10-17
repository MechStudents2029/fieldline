import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { formatPercent, formatWhole } from "@/lib/money";
import { payApplicationDetail } from "@/lib/services/pay-applications";

export default async function PayApplicationPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (session.role === "field") notFound();
  const detail = payApplicationDetail(session, id);
  if (!detail) notFound();
  return (
    <main className="mx-auto max-w-5xl px-6 py-8 text-sm">
      <h1 className="text-2xl">
        {detail.poNumber} {detail.number}
      </h1>
      <p className="mt-1">
        {detail.job} · {detail.vendor} · {detail.periodStart} – {detail.periodEnd}
      </p>
      <table aria-label="Pay application" className="mt-6 w-full text-left">
        <thead>
          <tr>
            <th className="py-1 pr-2 font-medium">Description</th>
            <th className="py-1 pr-2 text-right font-medium">Scheduled value</th>
            <th className="py-1 pr-2 text-right font-medium">Previous</th>
            <th className="py-1 pr-2 text-right font-medium">This period</th>
            <th className="py-1 pr-2 text-right font-medium">Materials stored</th>
            <th className="py-1 pr-2 text-right font-medium">Total completed & stored</th>
            <th className="py-1 pr-2 text-right font-medium">%</th>
            <th className="py-1 pr-2 text-right font-medium">Balance to finish</th>
            <th className="py-1 pr-2 text-right font-medium">Retainage this period</th>
            <th className="py-1 pr-2 text-right font-medium">Released</th>
            <th className="py-1 text-right font-medium">Held to date</th>
          </tr>
        </thead>
        <tbody>
          {detail.lines.map((line) => (
            <tr key={line.id} className="border-t">
              <td className="py-1 pr-2">
                {line.costCode}
                {line.description ? ` · ${line.description}` : ""}
              </td>
              <td className="py-1 pr-2 text-right num">{formatWhole(line.scheduledCents)}</td>
              <td className="py-1 pr-2 text-right num">{formatWhole(line.previousCents)}</td>
              <td className="py-1 pr-2 text-right num">{formatWhole(line.thisPeriodCents)}</td>
              <td className="py-1 pr-2 text-right num">{formatWhole(line.storedCents)}</td>
              <td className="py-1 pr-2 text-right num">{formatWhole(line.completedCents)}</td>
              <td className="py-1 pr-2 text-right num">{formatPercent(line.percentBps)}</td>
              <td className="py-1 pr-2 text-right num">{formatWhole(line.balanceCents)}</td>
              <td className="py-1 pr-2 text-right num">{formatWhole(line.retainageCents)}</td>
              <td className="py-1 pr-2 text-right num">{formatWhole(line.releasedCents)}</td>
              <td className="py-1 text-right num">{formatWhole(line.heldCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t">
            <td className="py-1 pr-2">Net {formatWhole(detail.totals.netCents)}</td>
            <td />
            <td />
            <td className="py-1 pr-2 text-right num">{formatWhole(detail.totals.grossCents)}</td>
            <td />
            <td />
            <td />
            <td />
            <td className="py-1 pr-2 text-right num">{formatWhole(detail.totals.retainageCents)}</td>
            <td className="py-1 pr-2 text-right num">{formatWhole(detail.totals.releasedCents)}</td>
            <td className="py-1 text-right num">{formatWhole(detail.totals.heldCents)}</td>
          </tr>
        </tfoot>
      </table>
    </main>
  );
}
