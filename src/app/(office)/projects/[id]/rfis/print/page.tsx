import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { projectVisuals } from "@/lib/services/markup";
import { rfiPrint } from "@/lib/services/rfis";

export default async function RfiPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const doc = rfiPrint(session, id);
  if (!doc) notFound();
  const visuals = new Map(projectVisuals(session, id).filter((row) => row.linkType === "rfi").map((row) => [row.linkId, row.visual]));
  return (
    <main className="mx-auto max-w-4xl bg-white px-8 py-8 text-[13px] text-black print:px-0">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/projects/${id}#rfis`} className="text-[var(--fl-accent)]">
          ‹ RFIs
        </Link>
        <PrintButton />
      </div>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-wide">{doc.orgName}</p>
        <h1 className="text-[22px] font-semibold">RFI log</h1>
        <p>
          {doc.projectName}
          {doc.address ? ` · ${doc.address}` : ""}
        </p>
      </header>
      <table className="w-full border-collapse text-left" aria-label="RFI log">
        <thead>
          <tr className="border-b border-black">
            <th className="py-1 pr-3">Number</th>
            <th className="py-1 pr-3">Title</th>
            <th className="py-1 pr-3">Assignee</th>
            <th className="py-1 pr-3">Due</th>
            <th className="py-1 pr-3">Age</th>
            <th className="py-1 pr-3">Status</th>
            <th className="py-1">Impact</th>
          </tr>
        </thead>
        <tbody>
          {doc.items.map((item) => (
            <tr key={item.id} className="border-b border-neutral-300 align-top">
              <td className="py-1 pr-3">{item.label}</td>
              <td className="py-1 pr-3">{item.title}</td>
              <td className="py-1 pr-3">{item.assigneeName}</td>
              <td className="py-1 pr-3">{item.dueOn ? formatCalendarDay(item.dueOn) : ""}</td>
              <td className="py-1 pr-3">{item.ageDays}</td>
              <td className="py-1 pr-3">{item.statusLabel}</td>
              <td className="py-1">{item.impact}</td>
              <td className="py-1">
                {visuals.get(item.id)?.cropHref ? <img src={visuals.get(item.id)?.cropHref ?? ""} alt="" className="h-16 w-24 object-cover" /> : null}
                {visuals.get(item.id)?.flatHref ? <img src={visuals.get(item.id)?.flatHref ?? ""} alt="" className="mt-1 h-16 w-24 object-cover" /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
