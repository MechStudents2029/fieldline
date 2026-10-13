import Link from "next/link";
import { DispatchBoard } from "@/components/dispatch-board";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { dispatchBoard } from "@/lib/services/dispatch";

export const dynamic = "force-dynamic";

export default async function DispatchPage({ searchParams }: { searchParams: Promise<{ on?: string }> }) {
  const session = await requireSession();
  const query = await searchParams;
  const board = dispatchBoard(session, query.on);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar title="Dispatch" subtitle={`${board.open} open`} search={false} trailing={<Link href="/schedule" className="mac-glass-btn">Week</Link>} />
      <DispatchBoard board={board} />
    </div>
  );
}
