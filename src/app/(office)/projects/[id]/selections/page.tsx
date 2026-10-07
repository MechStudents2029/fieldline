import { notFound } from "next/navigation";
import { LinkedRfis } from "@/components/linked-rfis";
import { SelectionsBoard } from "@/components/mac/selections-board";
import { requireSession } from "@/lib/auth/session";
import { jobRfis } from "@/lib/services/rfis";
import { selectionBoard } from "@/lib/services/selections";
import { timeBoard } from "@/lib/services/time";
import { localDay } from "@/lib/time/calendar";

function officeToday(timeZone: string) {
  return localDay(Date.now(), timeZone);
}

export default async function SelectionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const zone = timeBoard(session).timeZone;
  const board = selectionBoard(session, id, officeToday(zone));
  if (!board) notFound();
  const linked = (jobRfis(session, id)?.items ?? []).filter((item) => item.relatedType === "selection" && item.status !== "void");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {linked.length > 0 ? (
        <div className="px-4 pt-3">
          <LinkedRfis rows={linked} />
        </div>
      ) : null}
      <SelectionsBoard board={board} />
    </div>
  );
}
