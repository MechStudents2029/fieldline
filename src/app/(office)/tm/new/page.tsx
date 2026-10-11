import { createTmTicketAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { ticketComposer } from "@/lib/services/tm";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || "";
}

export default async function NewTmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const params = await searchParams;
  const jobId = one(params.job);
  const form = ticketComposer(session);
  const job = form.jobs.find((row) => row.id === jobId) ?? form.jobs[0];
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Toolbar title="New ticket" search={false} />
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4">
        <ActionForm action={createTmTicketAction} className="flex flex-col gap-3">
          <label className="text-sm">
            Job
            <select name="projectId" aria-label="Job" className="field mt-1" defaultValue={job?.id ?? ""}>
              {form.jobs.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Date
            <input name="performedOn" aria-label="Date" type="date" className="field mt-1" required defaultValue={form.today} />
          </label>
          <label className="text-sm">
            Location
            <input name="location" aria-label="Location" className="field mt-1" />
          </label>
          <label className="text-sm">
            Ordered by
            <select name="orderedById" aria-label="Ordered by" className="field mt-1" defaultValue={job?.contactId ?? ""}>
              {form.clients.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Description
            <textarea name="description" aria-label="Description" rows={3} className="field mt-1" required />
          </label>
          <button type="submit" className="h-11 rounded-lg bg-[var(--fl-accent)] text-sm font-semibold text-white">
            Create ticket
          </button>
        </ActionForm>
      </div>
    </div>
  );
}
