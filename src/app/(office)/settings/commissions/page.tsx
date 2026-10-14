import Link from "next/link";
import { saveCommissionPlanAction, savePlanOverrideAction, setPlanStatusAction } from "@/app/(office)/settings/commissions/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { commissionSettings } from "@/lib/services/commissions";

function percent(bps: number) {
  return bps % 100 === 0 ? String(bps / 100) : (bps / 100).toFixed(1);
}

export default async function CommissionSettingsPage() {
  const session = await requireSession();
  const board = commissionSettings(session);
  if (!board) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-2 px-6">
        <h1 className="font-heading text-3xl">Commissions</h1>
        <p className="text-sm">Only an owner or admin can change commissions.</p>
      </div>
    );
  }
  const roles = [...new Set(board.people.map((person) => person.role))];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar title="Commissions" subtitle={String(board.plans.length)} search={false} leading={<Link href="/settings">Settings</Link>} />
      <div className="flex flex-col gap-6 overflow-auto px-4 pb-10 md:px-6">
        <table className="mac-table" aria-label="Commission plans">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Who</th>
              <th>Basis</th>
              <th>Rate</th>
              <th>Milestones</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {board.plans.map((plan) => (
              <tr key={plan.id}>
                <td>
                  {plan.name}
                  {plan.archived ? <span className="fl-pill ml-2">Archived</span> : null}
                  {plan.overrides.map((row) => (
                    <span key={row.id} className="mt-1 block mac-t11 text-[var(--mac-secondary)]">
                      {row.projectType} {percent(row.rateBps)}%
                    </span>
                  ))}
                </td>
                <td>{plan.who}</td>
                <td>{plan.basisLabel}</td>
                <td className="num">{percent(plan.rateBps)}%</td>
                <td className="num">
                  {plan.deposit}/{plan.start}/{plan.completion}
                </td>
                <td>
                  {plan.archived ? null : (
                    <ActionForm action={savePlanOverrideAction} className="flex items-center gap-2">
                      <input type="hidden" name="planId" value={plan.id} />
                      <input name="projectType" aria-label={`${plan.name} project type`} className="field w-28" placeholder="Type" />
                      <input name="rate" aria-label={`${plan.name} override`} className="field w-16" inputMode="decimal" />
                      <button type="submit" className="mac-glass-btn">
                        Override
                      </button>
                    </ActionForm>
                  )}
                  <ActionForm action={setPlanStatusAction} className="mt-2">
                    <input type="hidden" name="planId" value={plan.id} />
                    <input type="hidden" name="archived" value={plan.archived ? "0" : "1"} />
                    <button type="submit" className="mac-glass-btn">
                      {plan.archived ? "Restore" : "Archive"}
                    </button>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ActionForm action={saveCommissionPlanAction} className="grid max-w-xl grid-cols-2 gap-3">
          <label className="text-[13px]">
            Name
            <input name="name" aria-label="Plan name" className="field mt-1" />
          </label>
          <label className="text-[13px]">
            Who
            <select name="subject" aria-label="Who" className="field mt-1" defaultValue="">
              <option value="">Choose</option>
              {board.people.map((person) => (
                <option key={person.id} value={`user:${person.id}`}>
                  {person.name}
                </option>
              ))}
              {roles.map((role) => (
                <option key={role} value={`role:${role}`}>
                  Role · {role}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[13px]">
            Basis
            <select name="basis" aria-label="Basis" className="field mt-1" defaultValue="contract">
              <option value="contract">Contract value</option>
              <option value="gross_profit">Gross profit</option>
            </select>
          </label>
          <label className="text-[13px]">
            Rate %
            <input name="rate" aria-label="Rate" className="field mt-1" inputMode="decimal" defaultValue="5" />
          </label>
          <label className="text-[13px]">
            Deposit %
            <input name="deposit" aria-label="Deposit" className="field mt-1" inputMode="decimal" defaultValue="40" />
          </label>
          <label className="text-[13px]">
            Start %
            <input name="start" aria-label="Start" className="field mt-1" inputMode="decimal" defaultValue="30" />
          </label>
          <label className="text-[13px]">
            Completion %
            <input name="completion" aria-label="Completion" className="field mt-1" inputMode="decimal" defaultValue="30" />
          </label>
          <button type="submit" className="mac-primary w-fit">
            Add
          </button>
        </ActionForm>
      </div>
    </div>
  );
}
