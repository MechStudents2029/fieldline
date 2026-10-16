import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { publicHandover } from "@/lib/services/handover";

export const dynamic = "force-dynamic";

export default async function PublicHandoverPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pack = publicHandover(token);
  if (!pack) notFound();
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl bg-white px-6 py-8 text-[13px] text-black">
      <div className="no-print mb-4 flex justify-end">
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
                <p>{[item.manufacturer, item.model, item.serial, item.finish, item.vendorName, item.trade, item.phone].filter(Boolean).join(" · ")}</p>
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
