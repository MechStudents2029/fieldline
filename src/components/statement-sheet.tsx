import { AR_BUCKETS } from "@/lib/fees/late";
import { formatMoney } from "@/lib/money";
import type { StatementView } from "@/lib/services/late-fees";

export function StatementSheet({ view }: { view: StatementView }) {
  return (
    <article data-statement={view.id} className="flex flex-col gap-4">
      <h1 className="text-[22px] font-semibold">{view.client}</h1>
      <p className="num">{formatMoney(view.totalCents)}</p>
      <table className="w-full" aria-label="Aging">
        <thead>
          <tr>
            {AR_BUCKETS.map((bucket) => (
              <th key={bucket} className="py-1 text-right text-[12px] font-normal">
                {bucket}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {AR_BUCKETS.map((bucket) => (
              <td key={bucket} className="num py-1 text-right" data-bucket={bucket}>
                {formatMoney(view.buckets[bucket])}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <table className="w-full" aria-label="Activity">
        <tbody>
          {view.events.map((event, index) => (
            <tr key={`${index}-${event.label}`}>
              <td className="py-1">{event.date}</td>
              <td className="py-1">{event.label}</td>
              <td className="num py-1 text-right">{event.chargeCents ? formatMoney(event.chargeCents) : ""}</td>
              <td className="num py-1 text-right">{event.creditCents ? formatMoney(event.creditCents) : ""}</td>
              <td className="num py-1 text-right">{formatMoney(event.balanceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {view.policy ? <p data-late-policy>{view.policy}</p> : null}
    </article>
  );
}
