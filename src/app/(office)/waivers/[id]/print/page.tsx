import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { waiverPrint } from "@/lib/services/waivers";

export default async function WaiverPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const doc = waiverPrint(session, id);
  if (!doc) notFound();
  return (
    <main className="mx-auto min-h-screen max-w-[8.5in] bg-[var(--mac-window)] px-8 py-8 text-[13px] text-[var(--mac-label)] print:bg-white print:text-black">
      <style>{`@page { size: letter; margin: 0.75in; }`}</style>
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href="/bills">Bills</Link>
        <PrintButton />
      </div>
      <header className="mb-6">
        <p>{doc.orgName}</p>
        <h1 className="text-[22px] font-semibold">{doc.typeLabel}</h1>
        <p>
          {doc.vendor} · {doc.job} · {doc.billNumber}
        </p>
        <p>
          {formatMoney(doc.amountCents)} · through {formatCalendarDay(doc.throughDate)} · {doc.statusLabel}
        </p>
      </header>
      <p className="whitespace-pre-wrap">{doc.text}</p>
      {doc.signedName ? (
        <p className="mt-8">
          {doc.signedName}
          {doc.signedAt ? ` · ${formatDateTime(doc.signedAt)}` : ""}
        </p>
      ) : null}
    </main>
  );
}
