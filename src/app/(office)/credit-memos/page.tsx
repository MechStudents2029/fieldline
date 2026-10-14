import Link from "next/link";
import { createClientCreditAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { canManageMoney, canSeeMoney } from "@/lib/permissions";
import { listClientCredits } from "@/lib/services/client-credits";
import { listContacts, listProjects } from "@/lib/services/read";

const FILTERS = [
  ["", "All"],
  ["draft", "Draft"],
  ["ready", "Ready"],
  ["partial", "Partial"],
  ["applied", "Applied"],
  ["void", "Void"],
] as const;

export default async function CreditMemosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const query = await searchParams;
  const status = typeof query.status === "string" ? query.status : "";
  const job = typeof query.job === "string" ? query.job : "";
  const client = typeof query.client === "string" ? query.client : "";
  const attention = query.attention === "1";
  const seeMoney = canSeeMoney(session.role);
  const office = canManageMoney(session.role);
  const rows = listClientCredits(session, {
    projectId: job || undefined,
    clientContactId: client || undefined,
    status: status || undefined,
    attention,
  });
  const jobs = listProjects(session.orgId);
  const clients = listContacts(session.orgId).filter((contact) => contact.type === "client");
  const subtitle = `${rows.length} ${rows.length === 1 ? "memo" : "memos"}`;
  const csv = `/api/export/credit-memos?status=${encodeURIComponent(status)}&job=${encodeURIComponent(job)}&client=${encodeURIComponent(client)}&attention=${attention ? "1" : ""}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="hidden md:block">
        <Toolbar
          title="Credit memos"
          subtitle={subtitle}
          search={false}
          trailing={
            <>
              {seeMoney ? <a href={csv}>CSV</a> : null}
              {office ? <Link href="/credit-memos/new">New</Link> : null}
            </>
          }
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 md:hidden">
        <h1 className="fl-large-title">Credit memos</h1>
        <span className="flex gap-3">
          {seeMoney ? (
            <a href={csv} className="ctl">
              CSV
            </a>
          ) : null}
          {office ? (
            <Link href="/credit-memos/new" className="ctl">
              New
            </Link>
          ) : null}
        </span>
      </div>
      <p className="px-4 mac-t13 text-[var(--mac-secondary)] md:hidden">{subtitle}</p>
      {seeMoney ? (
        <form method="get" action="/credit-memos" className="flex flex-wrap items-end gap-2 px-4">
          <label className="text-sm">
            Status
            <select name="status" aria-label="Status" className="field mt-1" defaultValue={status}>
              {FILTERS.map(([value, label]) => (
                <option key={value || "all"} value={value}>
                  {label}
                </option>
              ))}
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
          <label className="text-sm">
            Client
            <select name="client" aria-label="Client" className="field mt-1" defaultValue={client}>
              <option value="">Any</option>
              {clients.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </select>
          </label>
          {attention ? <input type="hidden" name="attention" value="1" /> : null}
          <button type="submit" className="ctl">
            Show
          </button>
        </form>
      ) : null}
      <div className="overflow-x-auto px-4">
        <table className="mac-table" aria-label="Credit memos">
          <thead>
            <tr>
              <th>Memo</th>
              <th>Client</th>
              <th>Job</th>
              <th>Status</th>
              {seeMoney ? <th className="text-right">Amount</th> : null}
              {seeMoney ? <th className="text-right">Remaining</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={seeMoney ? 6 : 4}>No memos</td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/credit-memos/${row.id}`}>{row.number}</Link>
                  <span className="block mac-t11 text-[var(--mac-secondary)]">{row.title}</span>
                </td>
                <td>{row.clientName}</td>
                <td className="clip">{row.projectName}</td>
                <td>
                  <span className="fl-pill">{row.statusLabel}</span>
                </td>
                {seeMoney ? <td className="num text-right">{formatMoney(row.amountCents)}</td> : null}
                {seeMoney ? <td className="num text-right">{formatMoney(row.remainingCents)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {session.role === "field" ? (
        <ActionForm action={createClientCreditAction} className="flex max-w-md flex-col gap-2 px-4">
          <h2 className="mac-t13 font-semibold">Propose</h2>
          <label className="text-sm">
            Job
            <select name="projectId" aria-label="Job" className="field mt-1" required defaultValue={job}>
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
            <input name="description" aria-label="Description" className="field mt-1" />
          </label>
          <input type="hidden" name="kind" value="flat" />
          <button type="submit" className="mac-primary w-fit">
            Save draft
          </button>
        </ActionForm>
      ) : null}
    </div>
  );
}
