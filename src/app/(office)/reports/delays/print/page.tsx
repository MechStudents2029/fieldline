import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth/session";
import { canEditCrm } from "@/lib/permissions";
import { formatClaimHours, listDelays } from "@/lib/services/delays";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export const dynamic = "force-dynamic";

export default async function DelayPrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!canEditCrm(session.role)) notFound();
  const query = await searchParams;
  const rows = listDelays(session, {
    filter: one(query.filter) ?? one(query.status) ?? "",
    cause: one(query.cause) ?? "",
    impact: one(query.impact) ?? "",
    projectId: one(query.project) ?? "",
  });
  return (
    <div className="bg-white px-6 py-6 text-[12px] text-black">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg">Delays</h1>
        <PrintButton />
      </div>
      <table className="w-full text-left">
        <thead>
          <tr>
            <th className="py-1 pr-2">Job</th>
            <th className="py-1 pr-2">No.</th>
            <th className="py-1 pr-2">Title</th>
            <th className="py-1 pr-2">Cause</th>
            <th className="py-1 pr-2">Impact</th>
            <th className="py-1 pr-2">Status</th>
            <th className="py-1 pr-2">Start</th>
            <th className="py-1 pr-2">End</th>
            <th className="py-1 text-right">Lost h</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="py-1 pr-2">{row.job}</td>
              <td className="py-1 pr-2">{row.number}</td>
              <td className="py-1 pr-2">{row.title}</td>
              <td className="py-1 pr-2">{row.causeLabel}</td>
              <td className="py-1 pr-2">{row.impactLabel}</td>
              <td className="py-1 pr-2">{row.statusLabel}</td>
              <td className="py-1 pr-2">{row.startedAt}</td>
              <td className="py-1 pr-2">{row.endedAt}</td>
              <td className="py-1 text-right">{formatClaimHours(row.lostHoursMilli)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
