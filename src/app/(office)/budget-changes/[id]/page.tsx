import Link from "next/link";
import { notFound } from "next/navigation";
import { addBudgetChangeLineAction, approveBudgetChangeAction, voidBudgetChangeAction } from "@/app/(office)/budget-changes/actions";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatWhole } from "@/lib/money";
import { budgetChangeDetail } from "@/lib/services/budget-changes";

export default async function BudgetChangePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (session.role === "field") notFound();
  const detail = budgetChangeDetail(session, id);
  if (!detail) notFound();
  return (
    <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
      <p className="text-sm">
        <Link href={`/projects/${detail.projectId}`} className="text-[var(--mac-accent)]">
          {detail.job}
        </Link>
        <span className="num"> · {detail.number}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="fl-large-title">{detail.title}</h1>
        <span className="fl-pill" data-status={detail.status}>
          {detail.statusLabel}
        </span>
      </div>
      <p className="text-sm text-[var(--mac-secondary)]">
        {detail.typeLabel}
        {` · ${detail.fromName}`}
        {` · ${formatWhole(detail.amountCents)}`}
      </p>
      {detail.changeEventId ? (
        <p className="text-sm">
          <Link href={`/change-events/${detail.changeEventId}`} className="text-[var(--mac-accent)]" data-event={detail.changeEventNumber ?? ""}>
            CE {detail.changeEventNumber}
          </Link>
        </p>
      ) : null}
      {detail.voidReason ? <p className="text-sm">{detail.voidReason}</p> : null}
      {detail.overrideNote ? <p className="num text-sm">{detail.overrideNote}</p> : null}
      <table aria-label="Lines" className="w-full text-left text-sm">
        <thead>
          <tr className="text-[var(--mac-secondary)]">
            <th className="py-2 pr-3 font-medium">Line</th>
            <th className="py-2 pr-3 font-medium">Code</th>
            <th className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-[var(--mac-separator)]">
            <td className="py-2 pr-3">{detail.fromName}</td>
            <td className="py-2 pr-3" />
            <td className="py-2 text-right num">{formatWhole(-detail.amountCents)}</td>
          </tr>
          {detail.lines.map((line) => (
            <tr key={line.id} className="border-t border-[var(--mac-separator)]">
              <td className="py-2 pr-3">{line.name}</td>
              <td className="py-2 pr-3">{line.costCode}</td>
              <td className="py-2 text-right num">{formatWhole(line.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail.canEdit && detail.lineChoices.length > 0 ? (
        <ActionForm action={addBudgetChangeLineAction.bind(null, detail.id)} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Line
            <select name="budgetLineId" aria-label="Destination" className="field mt-1" defaultValue="">
              <option value="">Select</option>
              {detail.lineChoices.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Amount
            <input name="amount" aria-label="Line amount" className="field mt-1" />
          </label>
          <Button type="submit">Add</Button>
        </ActionForm>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {detail.canApprove ? (
          <ActionForm action={approveBudgetChangeAction.bind(null, detail.id)}>
            <Button type="submit">Approve</Button>
          </ActionForm>
        ) : null}
      </div>
      {detail.canVoid ? (
        <ActionForm action={voidBudgetChangeAction.bind(null, detail.id)} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Reason
            <input name="reason" aria-label="Void reason" className="field mt-1" />
          </label>
          <Button type="submit" variant="secondary">
            Void
          </Button>
        </ActionForm>
      ) : null}
    </div>
  );
}
