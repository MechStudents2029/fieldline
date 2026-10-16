import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth/session";
import { transmittalDetail } from "@/lib/services/transmittals";

export default async function TransmittalPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const pack = transmittalDetail(session, id);
  if (!pack) notFound();
  return (
    <main className="mx-auto max-w-4xl bg-white px-8 py-8 text-[13px] text-black print:px-0">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/transmittals/${pack.id}`} className="text-[var(--fl-accent)]">
          ‹ {pack.subject}
        </Link>
        <PrintButton />
      </div>
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-wide">Transmittal {pack.number}</p>
        <h1 className="text-[22px] font-semibold">{pack.subject}</h1>
        <p>{pack.orgName}</p>
        <p>{pack.toName}</p>
        <p>{pack.purposeLabel}</p>
        <p>{pack.dateLabel}</p>
        <p>{pack.job}</p>
        {pack.address ? <p>{pack.address}</p> : null}
        {pack.cc.length > 0 ? <p>{pack.cc.map((row) => row.name).join(", ")}</p> : null}
      </header>
      <h2 className="mb-2 text-sm font-semibold">Contents</h2>
      <ol className="mb-8">
        {pack.lines.map((line, index) => (
          <li key={line.id}>
            {index + 1}. {line.title}
            {line.returnRequired ? " · Return" : ""}
          </li>
        ))}
      </ol>
      <h2 className="mb-2 text-sm font-semibold">Acknowledgment</h2>
      {pack.ackName ? (
        <p data-ack={pack.ackName}>
          {pack.ackName}
          {pack.ackAt ? ` · ${pack.ackAt}` : ""}
          {pack.ackNote ? ` · ${pack.ackNote}` : ""}
        </p>
      ) : null}
      {pack.declineReason ? <p>{pack.declineReason}</p> : null}
    </main>
  );
}
