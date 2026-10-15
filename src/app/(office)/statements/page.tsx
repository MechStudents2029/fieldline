import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureStatementAction } from "@/app/(office)/fees/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { canManageMoney, canSeeMoney } from "@/lib/permissions";
import { clientChoices, listStatements } from "@/lib/services/late-fees";

export default async function StatementsPage() {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) notFound();
  const rows = listStatements(session);
  const clients = canManageMoney(session.role) ? clientChoices(session) : [];
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Statements" subtitle={String(rows.length)} search={false} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Statements</h1>
        {rows.length === 0 ? <p className="num">0</p> : null}
        <ul className="fl-group">
          {rows.map((row) => (
            <li key={row.id} className="fl-cell" data-statement={row.id}>
              <Link href={`/statements/${row.id}`} className="min-w-0 flex-1">
                <span className="fl-body block truncate">{row.client}</span>
              </Link>
              <span className="fl-pill">{row.sentAt ? "Sent" : "Open"}</span>
            </li>
          ))}
        </ul>
        {clients.length > 0 ? (
          <ActionForm action={ensureStatementAction} className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              Client
              <select name="contactId" aria-label="Client" className="field mt-1" required defaultValue={clients[0]?.id}>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="ctl h-9">
              Open
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
