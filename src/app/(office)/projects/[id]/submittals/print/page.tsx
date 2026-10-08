import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { submittalPrint } from "@/lib/services/submittals";

export default async function JobSubmittalPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const doc = submittalPrint(session, id);
  if (!doc) notFound();
  return (
    <main className="mx-auto max-w-4xl bg-white px-8 py-8 text-[13px] text-black print:px-0">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/projects/${id}#submittals`} className="text-[var(--fl-accent)]">
          ‹ Submittals
        </Link>
        <PrintButton />
      </div>
      <header className="mb-6">
        <p>{doc.orgName}</p>
        <h1 className="text-[22px] font-semibold">Submittal log</h1>
        <p>
          {doc.projectName}
          {doc.address ? ` · ${doc.address}` : ""} · {formatCalendarDay(doc.today)}
        </p>
      </header>
      <table className="w-full border-collapse text-left" aria-label="Submittal log">
        <thead>
          <tr className="border-b border-black">
            <th className="py-1 pr-3">Number</th>
            <th className="py-1 pr-3">Title</th>
            <th className="py-1 pr-3">Division</th>
            <th className="py-1 pr-3">Assignee</th>
            <th className="py-1 pr-3">Due</th>
            <th className="py-1 pr-3">Age</th>
            <th className="py-1 pr-3">Status</th>
            <th className="py-1">Rev</th>
          </tr>
        </thead>
        <tbody>
          {doc.items.map((item) => (
            <tr key={item.id} className="border-b border-neutral-300">
              <td className="py-1 pr-3">{item.label}</td>
              <td className="py-1 pr-3">{item.title}</td>
              <td className="py-1 pr-3">{item.division}</td>
              <td className="py-1 pr-3">{item.assigneeName}</td>
              <td className="py-1 pr-3">{item.dueOn ? formatCalendarDay(item.dueOn) : ""}</td>
              <td className="py-1 pr-3">{item.ageDays}</td>
              <td className="py-1 pr-3">{item.statusLabel}</td>
              <td className="py-1">{item.revision}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
