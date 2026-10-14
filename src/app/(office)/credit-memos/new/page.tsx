import Link from "next/link";
import { notFound } from "next/navigation";
import { createClientCreditAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { canManageMoney } from "@/lib/permissions";
import { listProjects } from "@/lib/services/read";

export default async function NewCreditMemoPage() {
  const session = await requireSession();
  if (!canManageMoney(session.role)) notFound();
  const jobs = listProjects(session.orgId);
  return (
    <div className="flex flex-col gap-4">
      <div className="hidden md:block">
        <Toolbar title="New credit memo" search={false} leading={<Link href="/credit-memos">‹</Link>} />
      </div>
      <ActionForm action={createClientCreditAction} className="flex max-w-lg flex-col gap-3 px-4 py-4">
        <label className="text-sm">
          Job
          <select name="projectId" aria-label="Job" className="field mt-1" required>
            {jobs.map((row) => (
              <option key={row.project.id} value={row.project.id}>
                {row.project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Title
          <input name="title" aria-label="Title" className="field mt-1" required />
        </label>
        <label className="text-sm">
          Description
          <textarea name="description" aria-label="Description" className="field mt-1" rows={2} />
        </label>
        <label className="text-sm">
          Kind
          <select name="kind" aria-label="Kind" className="field mt-1" defaultValue="flat">
            <option value="flat">Flat fee</option>
            <option value="lines">Cost codes</option>
          </select>
        </label>
        <label className="text-sm">
          Amount
          <input name="amount" aria-label="Amount" inputMode="decimal" className="field mt-1" placeholder="0.00" />
        </label>
        {[0, 1, 2].map((index) => (
          <div key={index} className="grid grid-cols-[8rem_1fr_6rem] gap-2">
            <input name={`line${index}code`} aria-label={`Cost code ${index + 1}`} placeholder="Cost code" className="field" />
            <input name={`line${index}desc`} aria-label={`Line ${index + 1}`} placeholder="Line" className="field" />
            <input name={`line${index}amount`} aria-label={`Line amount ${index + 1}`} inputMode="decimal" placeholder="0.00" className="field" />
          </div>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="release" value="1" />
          Release
        </label>
        <button type="submit" className="mac-primary w-fit">
          Save
        </button>
      </ActionForm>
    </div>
  );
}
