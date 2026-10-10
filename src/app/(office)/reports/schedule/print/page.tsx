import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { canEditCrm } from "@/lib/permissions";
import { formatWorkdayVariance } from "@/lib/schedule/delays";
import { scheduleVariance } from "@/lib/services/schedule-plan";

export const dynamic = "force-dynamic";

export default async function ScheduleVariancePrintPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const session = await requireSession();
  if (!canEditCrm(session.role)) notFound();
  const all = (await searchParams).all === "1";
  const report = scheduleVariance(session);
  const rows = all ? report.rows : report.rows.filter((row) => row.baselineFinish);
  const reasonColumns = [
    ["weather", "Weather"],
    ["client", "Client"],
    ["change_order", "Change order"],
    ["material", "Material"],
    ["sub", "Sub"],
    ["inspection", "Inspection"],
    ["other", "Other"],
  ] as const;
  const active = reasonColumns.filter(([key]) => rows.some((row) => row.delays[key] > 0));
  return (
    <div className="bg-white px-6 py-6 text-[12px] text-black">
      <style>{`
        @page { size: letter landscape; margin: 0.45in; }
        @media print {
          #fieldline-office-shell { display: block !important; height: auto !important; overflow: visible !important; background: white !important; }
          #fieldline-office-shell > a,
          #fieldline-office-shell > div:first-of-type,
          #fieldline-office-shell nav,
          #fieldline-office-shell .mac-glass { display: none !important; }
          #fieldline-office-shell > div { margin: 0 !important; overflow: visible !important; height: auto !important; background: white !important; border-radius: 0 !important; }
          #main { overflow: visible !important; height: auto !important; padding: 0 !important; }
        }
      `}</style>
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href="/reports/schedule" className="text-[var(--mac-accent)]">
          Schedule variance
        </Link>
        <PrintButton />
      </div>
      <header className="mb-4">
        <p className="text-[11px] uppercase tracking-wide">{session.orgName}</p>
        <h1 className="text-[22px] font-semibold">Schedule variance</h1>
        <p>{rows.length} jobs</p>
      </header>
      <table className="w-full text-left">
        <thead>
          <tr>
            {["Job", "Baseline", "Current", "Variance", ...active.map(([, header]) => header)].map((header) => (
              <th key={header} className="py-1 pr-2 text-left font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.projectId}>
              <td className="py-1 pr-2">{row.name}</td>
              <td className="py-1 pr-2">{row.baselineFinish ? formatCalendarDay(row.baselineFinish) : "—"}</td>
              <td className="py-1 pr-2">{row.currentFinish ? formatCalendarDay(row.currentFinish) : "—"}</td>
              <td className="num py-1 pr-2">{row.variance == null ? "—" : formatWorkdayVariance(row.variance)}</td>
              {active.map(([key]) => (
                <td key={key} className="num py-1 pr-2">{row.delays[key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
