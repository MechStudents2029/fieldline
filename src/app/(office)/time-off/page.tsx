import Link from "next/link";
import { approveTimeOffAction, cancelTimeOffAction, declineTimeOffAction, setPtoAllowanceAction } from "@/app/(office)/time-off/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { canEditCrm } from "@/lib/permissions";
import { listTimeOff, timeOffPeople } from "@/lib/services/time-off";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TimeOffPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const userId = one(query.user) ?? "";
  const status = one(query.status) ?? "";
  const from = one(query.from) ?? "";
  const to = one(query.to) ?? "";
  const office = canEditCrm(session.role);
  const rows = listTimeOff(session, { userId, status, from, to });
  const people = timeOffPeople(session);
  const csv = `/api/export/time-off?user=${encodeURIComponent(userId)}&status=${encodeURIComponent(status)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Time off" subtitle={String(rows.length)} search={false} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Time off</h1>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <select name="user" aria-label="Person" defaultValue={userId} className="field w-auto">
            <option value="">All</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <select name="status" aria-label="Status" defaultValue={status} className="field w-auto">
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="declined">Declined</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input type="date" name="from" aria-label="From" defaultValue={from} className="field w-auto" />
          <input type="date" name="to" aria-label="To" defaultValue={to} className="field w-auto" />
          <Button type="submit" variant="secondary">
            Show
          </Button>
          <Link href={csv} className="text-[var(--mac-accent)]">
            CSV
          </Link>
        </form>
        {office ? (
          <ActionForm action={setPtoAllowanceAction} className="flex flex-wrap items-end gap-2">
            <label className="text-[13px]">
              Allowance
              <select name="userId" aria-label="Allowance person" className="field mt-1" defaultValue={people[0]?.id ?? ""}>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[13px]">
              Hours
              <input name="hours" aria-label="Yearly hours" inputMode="decimal" className="field mt-1 w-24" />
            </label>
            <Button type="submit">Save</Button>
          </ActionForm>
        ) : null}
        <table aria-label="Time off" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-2 pr-3 font-medium">Person</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Start</th>
              <th className="py-2 pr-3 font-medium">End</th>
              <th className="py-2 pr-3 font-medium">Hours</th>
              <th className="py-2 pr-3 font-medium">Note</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-request={row.id} className="border-t border-[var(--mac-separator)]">
                <td className="py-2 pr-3">
                  {row.name}
                  {row.allowanceLabel ? <span className="mt-1 block text-[12px] text-[var(--mac-secondary)]">{row.allowanceLabel}</span> : null}
                </td>
                <td className="py-2 pr-3">
                  <span className="fl-pill" data-status={row.status}>
                    {row.statusLabel}
                  </span>
                  {row.decidedByName ? <span className="mt-1 block text-[12px] text-[var(--mac-secondary)]">{row.decidedByName}</span> : null}
                </td>
                <td className="py-2 pr-3">{row.kindLabel}</td>
                <td className="py-2 pr-3 num">{row.startOn}</td>
                <td className="py-2 pr-3 num">{row.endOn}</td>
                <td className="py-2 pr-3 num">{row.hours}</td>
                <td className="py-2 pr-3">
                  {row.note}
                  {row.decisionReason ? <span className="mt-1 block text-[12px] text-[var(--mac-secondary)]">{row.decisionReason}</span> : null}
                </td>
                <td className="py-2">
                  {row.status === "pending" && row.userId === session.userId ? (
                    <ActionForm action={cancelTimeOffAction.bind(null, row.id)}>
                      <Button type="submit" variant="secondary">
                        Cancel
                      </Button>
                    </ActionForm>
                  ) : null}
                  {office && row.status === "pending" ? (
                    <div className="flex flex-col gap-2">
                      <ActionForm action={approveTimeOffAction.bind(null, row.id)} className="flex items-center gap-2">
                        <input name="reason" aria-label={`Approve note ${row.name}`} className="field w-28" />
                        <Button type="submit">Approve</Button>
                      </ActionForm>
                      <ActionForm action={declineTimeOffAction.bind(null, row.id)} className="flex items-center gap-2">
                        <input name="reason" aria-label={`Decline reason ${row.name}`} className="field w-28" required />
                        <Button type="submit" variant="secondary">
                          Decline
                        </Button>
                      </ActionForm>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
