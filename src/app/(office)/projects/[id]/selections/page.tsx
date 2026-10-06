import { notFound } from "next/navigation";
import { SelectionsBoard } from "@/components/mac/selections-board";
import { requireSession } from "@/lib/auth/session";
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
  return <SelectionsBoard board={board} />;
}
