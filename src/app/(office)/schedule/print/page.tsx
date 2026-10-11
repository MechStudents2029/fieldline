import Link from "next/link";
import { GanttBoard } from "@/components/gantt-board";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth/session";
import { cleanZoom } from "@/lib/schedule/gantt";
import { orgGantt } from "@/lib/services/gantt";

export const dynamic = "force-dynamic";

export default async function OrgGanttPrintPage({ searchParams }: { searchParams: Promise<{ zoom?: string; critical?: string }> }) {
  const session = await requireSession();
  const query = await searchParams;
  const zoom = cleanZoom(query.zoom) ?? "week";
  const model = orgGantt(session, zoom);
  return (
    <div className="bg-white px-4 py-4 text-black">
      <style>{`
        @page { size: letter landscape; margin: 0.4in; }
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
      <div className="no-print mb-3 flex items-center justify-between">
        <Link href={`/schedule?view=gantt&zoom=${zoom}`} className="text-[var(--mac-accent)]">
          Schedule
        </Link>
        <PrintButton />
      </div>
      <header className="mb-3">
        <p className="text-[11px] uppercase tracking-wide">{session.orgName}</p>
        <h1 className="text-[22px] font-semibold">Schedule</h1>
        <p className="num">Finish {model.finishLabel} · {zoom}</p>
      </header>
      <GanttBoard model={{ ...model, canEdit: false }} critical={query.critical === "1"} printHref="/schedule/print" chrome={false} />
    </div>
  );
}
