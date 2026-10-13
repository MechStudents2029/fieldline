import Link from "next/link";
import { createAgreementAction } from "@/app/(office)/agreements/actions";
import { ActionForm } from "@/components/action-form";
import { requireSession } from "@/lib/auth/session";
import { canManageMoney } from "@/lib/permissions";
import { agreementChoices } from "@/lib/services/agreements";

export default async function NewAgreementPage() {
  const session = await requireSession();
  if (!canManageMoney(session.role)) {
    return (
      <div className="px-4 pt-4">
        <p className="text-sm">Agreements are sold from the office.</p>
      </div>
    );
  }
  const choices = agreementChoices(session);
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="fl-large-title">New agreement</h1>
        <Link href="/agreements" className="text-sm">
          Agreements
        </Link>
      </div>
      <ActionForm action={createAgreementAction} className="flex flex-col gap-3">
        <label className="text-sm">
          Client
          <select name="contactId" aria-label="Client" className="field mt-1" required defaultValue="">
            <option value="" disabled>
              Client
            </option>
            {choices.clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Job
          <select name="projectId" aria-label="Job" className="field mt-1" defaultValue="">
            <option value="">None</option>
            {choices.jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Name
          <input name="name" aria-label="Name" required className="field mt-1" />
        </label>
        <label className="text-sm">
          Start
          <input name="startOn" aria-label="Start" type="date" required className="field mt-1" />
        </label>
        <label className="text-sm">
          Term
          <select name="termKind" aria-label="Term" className="field mt-1" defaultValue="months">
            <option value="months">Fixed months</option>
            <option value="until_cancelled">Until cancelled</option>
            <option value="date">End date</option>
            <option value="visits">Visit count</option>
          </select>
        </label>
        <label className="text-sm">
          Months
          <input name="termMonths" aria-label="Months" type="number" min={1} defaultValue={12} className="field mt-1" />
        </label>
        <label className="text-sm">
          End
          <input name="endOn" aria-label="End" type="date" className="field mt-1" />
        </label>
        <label className="text-sm">
          Visits
          <input name="visitLimit" aria-label="Visits" type="number" min={1} className="field mt-1" />
        </label>
        <label className="text-sm">
          Cadence
          <select name="cadence" aria-label="Cadence" className="field mt-1" defaultValue="monthly">
            <option value="weekly">Weekly</option>
            <option value="weeks">Every N weeks</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="semiannual">Semiannual</option>
            <option value="annual">Annual</option>
            <option value="custom">Custom dates</option>
            <option value="as_needed">As needed</option>
          </select>
        </label>
        <label className="text-sm">
          Interval
          <input name="intervalWeeks" aria-label="Interval" type="number" min={1} defaultValue={2} className="field mt-1" />
        </label>
        <label className="text-sm">
          Custom dates
          <textarea name="customDates" aria-label="Custom dates" rows={2} className="field mt-1" placeholder="YYYY-MM-DD" />
        </label>
        <label className="text-sm">
          Billing
          <select name="billing" aria-label="Billing" className="field mt-1" defaultValue="per_visit">
            <option value="per_visit">Per visit</option>
            <option value="monthly">Monthly amount</option>
            <option value="quarterly">Quarterly amount</option>
            <option value="annual">Annual amount</option>
          </select>
        </label>
        <label className="text-sm">
          Amount
          <input name="fixed" aria-label="Amount" className="field mt-1" placeholder="0.00" />
        </label>
        <label className="text-sm">
          Code
          <select name="code" aria-label="Code" className="field mt-1" required defaultValue="FRM-LABOR">
            {choices.codes.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Qty
          <input name="qty" aria-label="Qty" type="number" min={0.001} step="0.001" defaultValue={1} className="field mt-1" />
        </label>
        <label className="text-sm">
          Crew
          <select name="assigneeUserId" aria-label="Crew" className="field mt-1" defaultValue="">
            <option value="">Unassigned</option>
            {choices.people.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Checklist
          <textarea name="checklist" aria-label="Checklist" rows={3} className="field mt-1" placeholder="One step per line" />
        </label>
        <label className="text-sm">
          Notes
          <textarea name="notes" aria-label="Notes" rows={2} className="field mt-1" />
        </label>
        <button type="submit" className="ctl">
          Save
        </button>
      </ActionForm>
    </div>
  );
}
