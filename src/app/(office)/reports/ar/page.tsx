import Link from "next/link";
import { notFound } from "next/navigation";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { AR_BUCKETS } from "@/lib/fees/late";
import { formatMoney } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { arAging } from "@/lib/services/late-fees";

export const dynamic = "force-dynamic";

export default async function ArAgingPage() {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) notFound();
  const report = arAging(session);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title="AR aging"
        subtitle={formatMoney(report.totals.totalCents)}
        search={false}
        trailing={
          <Link className="mac-glass-btn" href="/api/export/ar">
            CSV
          </Link>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6" data-mac-list>
        {report.rows.length === 0 ? <p className="num">0</p> : null}
        <table className="mac-table" aria-label="AR aging">
          <thead>
            <tr>
              <th>Client</th>
              {AR_BUCKETS.map((bucket) => (
                <th key={bucket} className="text-right">
                  {bucket}
                </th>
              ))}
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.contactId} data-client={row.name}>
                <td>{row.name}</td>
                {AR_BUCKETS.map((bucket) => (
                  <td key={bucket} className="num text-right">
                    {formatMoney(row.buckets[bucket])}
                  </td>
                ))}
                <td className="num text-right">{formatMoney(row.totalCents)}</td>
              </tr>
            ))}
            <tr>
              <td>Total</td>
              {AR_BUCKETS.map((bucket) => (
                <td key={bucket} className="num text-right">
                  {formatMoney(report.totals[bucket])}
                </td>
              ))}
              <td className="num text-right">{formatMoney(report.totals.totalCents)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
