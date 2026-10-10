import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth/session";
import { projectVisuals } from "@/lib/services/markup";
import { punchBoard } from "@/lib/services/punch";

export default async function PunchPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const board = punchBoard(session, id);
  if (!board) notFound();
  const visuals = new Map(projectVisuals(session, id).filter((row) => row.linkType === "punch").map((row) => [row.linkId, row.visual]));
  return (
    <main className="mx-auto max-w-4xl bg-white px-8 py-8 text-[13px] text-black print:px-0">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/projects/${id}#punch`} className="text-[var(--fl-accent)]">
          ‹ Punch
        </Link>
        <PrintButton />
      </div>
      <header className="mb-6">
        <h1 className="text-[22px] font-semibold">Punch list</h1>
        <p>{board.projectName}</p>
      </header>
      <ul className="flex flex-col gap-4">
        {board.items.map((item) => {
          const visual = visuals.get(item.id);
          return (
            <li key={item.id} className="border-b border-neutral-300 pb-3">
              <p className="font-semibold">
                {item.title} · {item.statusLabel}
              </p>
              <p>{item.location}</p>
              {visual?.cropHref ? <img src={visual.cropHref} alt="" className="mt-2 h-24 w-36 object-cover" /> : null}
              {visual?.flatHref ? <img src={visual.flatHref} alt="" className="mt-2 h-24 w-36 object-cover" /> : null}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
