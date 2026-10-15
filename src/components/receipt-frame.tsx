import Link from "next/link";
import { Toolbar } from "@/components/mac/toolbar";
import { formatMoney } from "@/lib/money";
import type { ReceiptListRow } from "@/lib/services/cost-receipts";

const STATUSES = [
  ["new", "New"],
  ["coded", "Coded"],
  ["posted", "Posted"],
  ["rejected", "Rejected"],
] as const;

export function ReceiptFrame({
  title,
  status,
  rows,
  children,
}: {
  title: string;
  status: string;
  rows: ReceiptListRow[];
  children?: React.ReactNode;
}) {
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title={title} subtitle={String(rows.length)} search={false} />
      </div>
      <div className="md:flex md:min-h-0 md:flex-1">
        <div className={children ? "hidden w-full flex-col gap-3 md:flex md:w-80 md:shrink-0 md:overflow-auto md:border-r md:border-[var(--mac-separator)] md:px-3 md:py-3" : "flex w-full flex-col gap-3 md:w-80 md:shrink-0 md:px-3 md:py-3"}>
          <h1 className="fl-large-title px-1 md:hidden">{title}</h1>
          <div className="flex flex-wrap gap-2 px-1">
            {STATUSES.map(([id, label]) => (
              <Link key={id} href={`/receipts?status=${id}`} className="fl-pill" aria-current={status === id ? "page" : undefined} data-status-link={id}>
                {label}
              </Link>
            ))}
          </div>
          {rows.length === 0 ? <p className="num px-1">0</p> : null}
          <ul className="fl-group">
            {rows.map((row) => (
              <li key={row.id} className="fl-cell" data-receipt={row.id} data-vendor={row.vendorName} data-status={row.status}>
                <Link href={`/receipts/${row.id}`} className="min-w-0 flex-1 truncate">
                  {row.vendorName}
                </Link>
                <span className="num">{formatMoney(row.amountCents)}</span>
                {row.duplicateId ? (
                  <Link href={`/receipts/${row.duplicateId}`} className="fl-pill" data-duplicate={row.duplicateId}>
                    Duplicate
                  </Link>
                ) : null}
                <span className="fl-pill">{row.statusLabel}</span>
              </li>
            ))}
          </ul>
        </div>
        {children ? <div className="min-w-0 flex-1 md:overflow-auto md:p-6">{children}</div> : <div className="hidden min-w-0 flex-1 md:block" />}
      </div>
    </div>
  );
}
