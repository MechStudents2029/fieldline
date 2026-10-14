import Link from "next/link";
import { notFound } from "next/navigation";
import { saveJobSplitsAction } from "@/app/(office)/commissions/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatWhole } from "@/lib/money";
import { jobCommission } from "@/lib/services/commissions";

const SEATS = [
  ["setter", "Setter"],
  ["consultant", "Consultant"],
  ["manager", "Manager"],
  ["other", "Other"],
] as const;

export default async function JobCommissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const board = jobCommission(session, id);
  if (!board) notFound();
  const slots = [0, 1, 2, 3].map((index) => board.splits[index] ?? { userId: "", seat: "setter" as const, share: "" });
  const owed = board.lines.filter((row) => row.status === "owed").reduce((sum, row) => sum + row.earnedCents, 0);
  const paid = board.lines.filter((row) => row.status === "paid").reduce((sum, row) => sum + row.earnedCents, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title={board.name}
        subtitle={board.seeMoney ? board.remainderLabel : String(board.lines.length)}
        search={false}
        leading={<Link href={`/projects/${board.projectId}`}>Job</Link>}
      />
      <div className="flex flex-col gap-5 overflow-auto px-4 pb-10 md:px-6">
        {board.seeMoney ? (
          <div className="mac-strip">
            <div>
              <p className="mac-t22 num">{formatWhole(owed)}</p>
              <p className="mac-t11 text-[var(--mac-secondary)]">Owed</p>
            </div>
            <div>
              <p className="mac-t22 num">{formatWhole(paid)}</p>
              <p className="mac-t11 text-[var(--mac-secondary)]">Paid</p>
            </div>
            <div>
              <p className="mac-t22 num">{formatWhole(board.deltaCents)}</p>
              <p className="mac-t11 text-[var(--mac-secondary)]">Delta</p>
            </div>
          </div>
        ) : null}
        {board.fallback ? <p className="text-[13px]">Contract, no job cost</p> : null}
        {board.capped ? <p className="text-[13px]">Capped</p> : null}
        <table className="mac-table" aria-label="Job commissions">
          <thead>
            <tr>
              <th>Person</th>
              <th>Milestone</th>
              <th>Earned</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {board.lines.length === 0 ? (
              <tr>
                <td colSpan={4}>No commission</td>
              </tr>
            ) : null}
            {board.lines.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/commissions/${row.id}`}>{row.person}</Link>
                </td>
                <td>{row.milestone}</td>
                <td className="num">{formatWhole(row.earnedCents)}</td>
                <td>
                  <span className="fl-pill">{row.statusLabel}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {board.canEdit ? (
          <ActionForm action={saveJobSplitsAction} className="flex max-w-3xl flex-col gap-3">
            <input type="hidden" name="projectId" value={board.projectId} />
            <div className="flex flex-wrap gap-3">
              <label className="text-[13px]">
                Project type
                <input name="projectType" aria-label="Project type" defaultValue={board.projectType} className="field mt-1" />
              </label>
              <label className="text-[13px]">
                Split
                <select name="mode" aria-label="Split" className="field mt-1" defaultValue={board.mode}>
                  <option value="percent">Percent</option>
                  <option value="fixed">Fixed</option>
                </select>
              </label>
            </div>
            {slots.map((slot, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <label className="text-[13px]">
                  Person
                  <select name={`user${index}`} aria-label={`Person ${index + 1}`} className="field mt-1" defaultValue={slot.userId}>
                    <option value="">—</option>
                    {board.people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[13px]">
                  Seat
                  <select name={`seat${index}`} aria-label={`Seat ${index + 1}`} className="field mt-1" defaultValue={slot.seat}>
                    {SEATS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[13px]">
                  Share
                  <input name={`share${index}`} aria-label={`Share ${index + 1}`} defaultValue={slot.share} className="field mt-1 w-24" inputMode="decimal" />
                </label>
              </div>
            ))}
            <button type="submit" className="mac-primary w-fit">
              Save
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
