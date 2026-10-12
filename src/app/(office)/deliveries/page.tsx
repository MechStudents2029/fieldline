import Link from "next/link";
import { SheetButton } from "@/components/sheet-button";
import { ReceiveSheet } from "@/components/receive-sheet";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { companyToday, deliveryBoard, receiveChoices } from "@/lib/services/receiving";
import { listProjects } from "@/lib/services/read";

const FILTERS = [
  ["", "All"],
  ["expected", "Expected"],
  ["late", "Late"],
  ["received", "Received"],
] as const;

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  if (session.role === "viewer") return <h1 className="fl-large-title">Deliveries</h1>;
  const query = await searchParams;
  const status = typeof query.status === "string" ? query.status : "";
  const job = typeof query.job === "string" ? query.job : "";
  const bucket = status === "expected" || status === "late" || status === "received" || status === "today" ? status : "";
  const board = deliveryBoard(session, bucket);
  const rows = board.rows.filter((row) => !job || row.projectId === job);
  const jobs = listProjects(session.orgId);
  const today = companyToday(session.orgId);
  const choices = receiveChoices(session);
  const csv = `/api/export/deliveries?status=${encodeURIComponent(bucket)}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
        <h1 className="fl-large-title">Deliveries</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SheetButton label="Receive">
            <ReceiveSheet orders={choices} today={today} />
          </SheetButton>
          <SheetButton label="Filter">
            <form method="get" className="grid gap-2" action="/deliveries">
              <label className="text-sm">
                Status
                <select name="status" aria-label="Status" className="field mt-1" defaultValue={status}>
                  {FILTERS.map(([value, label]) => (
                    <option key={value || "all"} value={value}>
                      {label}
                    </option>
                  ))}
                  <option value="today">Today</option>
                </select>
              </label>
              <label className="text-sm">
                Job
                <select name="job" aria-label="Job" className="field mt-1" defaultValue={job}>
                  <option value="">Any</option>
                  {jobs.map((row) => (
                    <option key={row.project.id} value={row.project.id}>
                      {row.project.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="mac-primary w-fit">
                Show
              </button>
            </form>
          </SheetButton>
          <a href={csv} className="ctl">
            CSV
          </a>
        </div>
      </div>
      <div className="overflow-x-auto px-4">
        <table className="mac-table" aria-label="Deliveries">
          <thead>
            <tr>
              <th>Order</th>
              <th>Job</th>
              <th>Vendor</th>
              <th>Line</th>
              <th>Expected</th>
              <th>Status</th>
              <th>Qty</th>
              {board.seeMoney ? <th className="text-right">Amount</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={board.seeMoney ? 8 : 7}>No deliveries</td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="num">
                  {board.seeMoney ? <Link href={`/purchase-orders/${row.poId}`}>{row.number}</Link> : row.number}
                </td>
                <td className="clip">{row.job}</td>
                <td>{row.vendor}</td>
                <td>{row.description}</td>
                <td className="num">{row.expectedOn ? formatCalendarDay(row.expectedOn) : "—"}</td>
                <td>
                  <span className="fl-pill">{row.label}</span>
                  {row.backordered ? <span className="fl-pill ml-2">Backordered</span> : null}
                </td>
                <td className="num">{row.text}</td>
                {board.seeMoney ? <td className="num text-right">{row.amountCents == null ? "" : formatMoney(row.amountCents)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
