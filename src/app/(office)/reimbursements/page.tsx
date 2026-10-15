import Link from "next/link";
import { markReceiptReimbursedAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { reimbursementBoard } from "@/lib/services/cost-receipts";

export default async function ReimbursementsPage() {
  const session = await requireSession();
  const board = reimbursementBoard(session);
  const people = board.totals.filter((row) => row.openCents > 0 || row.reimbursedCents > 0);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Reimbursements" subtitle={formatMoney(board.openCents)} search={false} trailing={<a href="/api/export/reimbursements">CSV</a>} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <div className="flex items-center justify-between md:hidden">
          <h1 className="fl-large-title">Reimbursements</h1>
          <a href="/api/export/reimbursements">CSV</a>
        </div>
        <p className="num md:hidden">{formatMoney(board.openCents)}</p>
        {people.length === 0 ? <p className="num">0</p> : null}
        {people.map((person) => (
          <section key={person.userId} className="flex flex-col gap-2" data-person={person.name}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="fl-section">{person.name}</h2>
              <span className="num">{formatMoney(person.openCents)}</span>
            </div>
            <ul className="fl-group">
              {board.lines
                .filter((row) => row.submittedBy === person.userId)
                .map((row) => (
                  <li key={row.id} className="fl-cell" data-reimburse={row.id} data-vendor={row.vendorName}>
                    <Link href={`/receipts/${row.id}`} className="min-w-0 flex-1 truncate">
                      {row.vendorName}
                    </Link>
                    <span className="num">{formatMoney(row.amountCents)}</span>
                    {row.reimbursedAt ? (
                      <span className="fl-pill">
                        Reimbursed {row.reimbursedAt.slice(0, 10)}
                        {row.reimbursedByName ? ` · ${row.reimbursedByName}` : ""}
                      </span>
                    ) : board.canMark ? (
                      <ActionForm action={markReceiptReimbursedAction.bind(null, row.id)}>
                        <Button type="submit" variant="outline" className="h-9">
                          Mark reimbursed
                        </Button>
                      </ActionForm>
                    ) : (
                      <span className="fl-pill">Open</span>
                    )}
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
