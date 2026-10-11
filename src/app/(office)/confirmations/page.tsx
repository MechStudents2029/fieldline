import Link from "next/link";
import { requestRangeAction, requestUpcomingAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { listConfirmations } from "@/lib/services/confirmations";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || "";
}

export default async function ConfirmationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const params = await searchParams;
  const status = one(params.status);
  const vendorId = one(params.vendor);
  const projectId = one(params.job);
  const board = listConfirmations(session, { status, vendorId, projectId });
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  if (vendorId) query.set("vendor", vendorId);
  if (projectId) query.set("job", projectId);
  const csv = `/api/export/confirmations${query.toString() ? `?${query.toString()}` : ""}`;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Toolbar title="Confirmations" search={false} trailing={<a className="mac-glass-btn" href={csv}>CSV</a>} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4">
        <form className="flex flex-wrap items-center gap-2" method="get">
          <select name="status" aria-label="Status" className="ctl" defaultValue={status}>
            <option value="">Status</option>
            <option value="requested">Requested</option>
            <option value="confirmed">Confirmed</option>
            <option value="declined">Declined</option>
            <option value="none">None</option>
          </select>
          <select name="vendor" aria-label="Vendor" className="ctl" defaultValue={vendorId}>
            <option value="">Vendor</option>
            {board.vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
          <select name="job" aria-label="Job" className="ctl" defaultValue={projectId}>
            <option value="">Job</option>
            {board.jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
          <button type="submit" className="ctl">
            Filter
          </button>
        </form>
        {board.canEdit ? (
          <div className="flex flex-wrap gap-4">
            <ActionForm action={requestUpcomingAction} className="flex flex-wrap items-center gap-2">
              <select name="vendorId" aria-label="Vendor for next items" className="ctl" defaultValue={vendorId}>
                <option value="">Vendor</option>
                {board.vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
              <input name="next" aria-label="Next" type="number" min={1} max={40} defaultValue={5} className="ctl w-16" />
              <button type="submit" className="ctl">
                Request next
              </button>
            </ActionForm>
            <ActionForm action={requestRangeAction} className="flex flex-wrap items-center gap-2">
              <select name="projectId" aria-label="Job range" className="ctl" required defaultValue={projectId}>
                <option value="">Job</option>
                {board.jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name}
                  </option>
                ))}
              </select>
              <input name="from" aria-label="From" type="date" className="ctl" required />
              <input name="to" aria-label="To" type="date" className="ctl" required />
              <button type="submit" className="ctl">
                Request range
              </button>
            </ActionForm>
          </div>
        ) : null}
        <table className="mac-table">
          <thead>
            <tr>
              {["Job", "Item", "Vendor", "Status", "Start", "Proposed"].map((label) => (
                <th key={label} className="text-left">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.rows.length === 0 ? (
              <tr>
                <td colSpan={6}>No items</td>
              </tr>
            ) : null}
            {board.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.job}</td>
                <td>
                  <Link href={`/schedule/items/${row.id}`}>{row.title}</Link>
                </td>
                <td>{row.vendor}</td>
                <td>{row.pill ? <span className="fl-pill fl-pill-sm">{row.pill}</span> : null}</td>
                <td className="num">{formatCalendarDay(row.start)}</td>
                <td className="num">{row.proposed ? formatCalendarDay(row.proposed) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
