import Link from "next/link";
import { PrintButton } from "@/components/print-button";
import { formatCalendarDay } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { LienPrint } from "@/lib/services/liens";

export function LienSheet({ doc, back }: { doc: LienPrint; back: string }) {
  return (
    <main className="mx-auto min-h-screen max-w-[8.5in] bg-[var(--mac-window)] px-8 py-8 text-[13px] text-[var(--mac-label)] print:bg-white print:text-black">
      <style>{`@page { size: letter; margin: 0.75in; }`}</style>
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={back}>Job</Link>
        <PrintButton />
      </div>
      <header className="mb-6">
        <p>{doc.orgName}</p>
        {doc.orgPlace ? <p>{doc.orgPlace}</p> : null}
        <h1 className="text-[22px] font-semibold">{doc.client}</h1>
        <p>{doc.title}</p>
        <p>
          {doc.job}
          {doc.address ? ` · ${doc.address}` : ""}
        </p>
        <p className="num">{formatMoney(doc.unpaidCents)}</p>
        <p className="num">
          {doc.first ? formatCalendarDay(doc.first) : "—"} · {doc.last ? formatCalendarDay(doc.last) : "—"}
          {doc.deadline ? ` · ${formatCalendarDay(doc.deadline)}` : ""}
        </p>
      </header>
      {doc.citation ? <p>{doc.citation}</p> : null}
    </main>
  );
}
