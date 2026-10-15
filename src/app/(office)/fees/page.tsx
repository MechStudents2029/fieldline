import Link from "next/link";
import { notFound } from "next/navigation";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { listLateFees } from "@/lib/services/late-fees";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FeesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) notFound();
  const status = one((await searchParams).status) ?? "";
  const rows = listLateFees(session, status);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Fees" subtitle={String(rows.length)} search={false} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Fees</h1>
        <div className="flex flex-wrap gap-2">
          {[
            ["", "All"],
            ["pending", "Pending"],
            ["applied", "Applied"],
            ["waived", "Waived"],
          ].map(([id, label]) => (
            <Link key={id || "all"} href={id ? `/fees?status=${id}` : "/fees"} className="fl-pill" aria-current={status === id ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </div>
        {rows.length === 0 ? <p className="num">0</p> : null}
        <ul className="fl-group">
          {rows.map((row) => (
            <li key={row.id} className="fl-cell" data-fee={row.id} data-status={row.status}>
              <Link href={`/fees/${row.id}`} className="min-w-0 flex-1">
                <span className="fl-body block truncate">{row.number}</span>
                <span className="fl-footnote block truncate text-[var(--fl-secondary)]">{row.client}</span>
              </Link>
              <span className="num">{formatMoney(row.amountCents)}</span>
              <span className="fl-pill">{row.status === "pending" ? "Pending" : row.status === "applied" ? "Applied" : "Waived"}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
