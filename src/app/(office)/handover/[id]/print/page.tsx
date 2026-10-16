import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth/session";
import { handoverDetail } from "@/lib/services/handover";

export default async function HandoverPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const pack = handoverDetail(session, id);
  if (!pack) notFound();
  return (
    <main className="mx-auto max-w-4xl bg-white px-8 py-8 text-[13px] text-black print:px-0">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/handover/${pack.id}`} className="text-[var(--fl-accent)]">
          ‹ {pack.job}
        </Link>
        <PrintButton />
      </div>
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-wide">Handover</p>
        <h1 className="text-[22px] font-semibold">{pack.job}</h1>
        <p>{pack.address}</p>
        {pack.closedOn ? <p>{pack.closedOn}</p> : null}
        {pack.warrantyEndsOn ? <p>{pack.warrantyEndsOn}</p> : null}
      </header>
      <h2 className="mb-2 text-sm font-semibold">Contents</h2>
      <ol className="mb-8">
        {pack.sections.map((section, index) => (
          <li key={section.id}>
            {index + 1}. {section.title}
          </li>
        ))}
      </ol>
      {pack.sections.map((section) => (
        <section key={section.id} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold">{section.title}</h2>
          <ul>
            {section.items.map((item) => (
              <li key={item.id} className="mb-2">
                <p className="font-medium">{item.title}</p>
                <p>
                  {[item.manufacturer, item.model, item.serial, item.finish, item.vendorName, item.trade, item.phone].filter(Boolean).join(" · ")}
                </p>
                {item.installOn ? <p>{item.installOn}</p> : null}
                {item.warrantyEndsOn ? <p>{item.warrantyEndsOn}</p> : null}
                {item.nextDueOn ? <p>{item.intervalLabel || "Care"} · {item.nextDueOn}</p> : null}
                {item.documentName ? <p>{item.documentName}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
