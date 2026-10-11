import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay, formatDateTime } from "@/lib/format";
import { formatMoney, formatQty } from "@/lib/money";
import { ticketPrint } from "@/lib/services/tm";

export default async function TmPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const doc = ticketPrint(session, id);
  if (!doc) notFound();
  return (
    <main className="mx-auto min-h-screen max-w-[8.5in] bg-[var(--mac-window)] px-8 py-8 text-[13px] text-[var(--mac-label)] print:bg-white print:text-black">
      <style>{`@page { size: letter; margin: 0.75in; }`}</style>
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/tm/${doc.id}`}>T&M</Link>
        <PrintButton />
      </div>
      <header className="mb-6">
        <p>{doc.orgName}</p>
        <h1 className="text-[22px] font-semibold">{doc.title}</h1>
        <p>
          {doc.job} · {formatCalendarDay(doc.performedOn)} · {doc.pill}
        </p>
        <p>
          {doc.location}
          {doc.orderedBy ? ` · ${doc.orderedBy}` : ""}
        </p>
      </header>
      <p className="whitespace-pre-wrap">{doc.description}</p>
      <table className="mt-4 w-full text-left">
        <tbody>
          {doc.lines.map((line) => (
            <tr key={line.id}>
              <td className="py-1">{line.label}</td>
              <td className="num py-1 text-right">
                {formatQty(line.qtyMilli)} {line.unit}
              </td>
              {doc.money && "priceCents" in line ? <td className="num py-1 text-right">{formatMoney(line.priceCents)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      {doc.money ? <p className="mt-4 num">{formatMoney(doc.money.totalCents)}</p> : null}
      {doc.companySigner ? (
        <p className="mt-8">
          {doc.companySigner}
          {doc.companySignedAt ? ` · ${formatDateTime(doc.companySignedAt)}` : ""}
        </p>
      ) : null}
      {doc.companySignature ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="Company signature" src={doc.companySignature} className="h-16 bg-white" />
      ) : null}
      {doc.clientSigner ? (
        <p className="mt-4">
          {doc.clientSigner}
          {doc.clientSignedAt ? ` · ${formatDateTime(doc.clientSignedAt)}` : ""}
        </p>
      ) : null}
      {doc.clientSignature ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="Customer signature" src={doc.clientSignature} className="h-16 bg-white" />
      ) : null}
    </main>
  );
}
