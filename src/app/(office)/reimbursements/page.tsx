import Link from "next/link";
import { markMileageReimbursedAction, markReceiptReimbursedAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { reimbursementBoard } from "@/lib/services/cost-receipts";
import { mileageOwed } from "@/lib/services/mileage";

export default async function ReimbursementsPage() {
  const session = await requireSession();
  const board = reimbursementBoard(session);
  const miles = mileageOwed(session);
  const people = board.totals.filter((row) => row.openCents > 0 || row.reimbursedCents > 0);
  const drivers = miles.totals.filter((row) => row.openCents > 0 || row.reimbursedCents > 0);
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
        <section aria-label="Miles" className="flex flex-col gap-3" data-miles>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="fl-section">Miles</h2>
            <span className="num">{formatMoney(miles.openCents)}</span>
            <a href="/api/export/mileage">CSV</a>
          </div>
          {drivers.length === 0 ? <p className="num">0</p> : null}
          {drivers.map((person) => (
            <section key={person.userId} className="flex flex-col gap-2" data-miles-person={person.name}>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="fl-section">{person.name}</h3>
                <span className="num">{formatMoney(person.openCents)}</span>
              </div>
              <ul className="fl-group">
                {miles.lines
                  .filter((row) => row.userId === person.userId)
                  .map((row) => (
                    <li key={row.id} className="fl-cell" data-miles-trip={row.id} data-purpose={row.purpose}>
                      <Link href={`/mileage/${row.id}`} className="min-w-0 flex-1 truncate">
                        {row.purpose}
                      </Link>
                      <span className="num">{row.milesLabel}</span>
                      <span className="num">{formatMoney(row.amountCents)}</span>
                      {row.reimbursedAt ? (
                        <span className="fl-pill">
                          Reimbursed {row.reimbursedAt.slice(0, 10)}
                          {row.reimbursedByName ? ` · ${row.reimbursedByName}` : ""}
                        </span>
                      ) : miles.canMark ? (
                        <ActionForm action={markMileageReimbursedAction.bind(null, row.id)}>
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
        </section>
      </div>
    </div>
  );
}
