import Link from "next/link";
import { notFound } from "next/navigation";
import { createLeadSourceAction, setLeadSourceSpendAction, setLeadSourceStatusAction } from "@/app/(office)/settings/lead-sources/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { leadSourceBoard } from "@/lib/services/lead-sources";

function spendValue(cents: number | null) {
  if (cents == null) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

export default async function LeadSourcesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await requireSession();
  const query = await searchParams;
  const board = leadSourceBoard(session, query.month);
  if (!board) notFound();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar title="Lead sources" subtitle={board.month} search={false} leading={<Link href="/settings">Settings</Link>} />
      <div className="flex flex-col gap-6 overflow-auto px-4 pb-10 md:px-6">
        <form method="get" className="flex items-end gap-2">
          <label className="text-[13px]">
            Month
            <input name="month" aria-label="Month" type="month" defaultValue={board.month} className="field mt-1" />
          </label>
          <button type="submit" className="mac-primary">
            Show
          </button>
        </form>
        <table className="mac-table" aria-label="Lead sources">
          <thead>
            <tr>
              <th>Source</th>
              <th>Spend</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {board.sources.map((source) => (
              <tr key={source.id}>
                <td>
                  {source.name}
                  {source.archived ? <span className="fl-pill ml-2">Archived</span> : null}
                </td>
                <td>
                  <ActionForm action={setLeadSourceSpendAction} className="flex items-center gap-2">
                    <input type="hidden" name="sourceId" value={source.id} />
                    <input type="hidden" name="month" value={board.month} />
                    <input name="spend" aria-label={`${source.name} spend`} defaultValue={spendValue(source.spendCents)} className="field w-28" inputMode="decimal" />
                    <button type="submit" className="mac-glass-btn">
                      Save {source.name}
                    </button>
                  </ActionForm>
                </td>
                <td>
                  <ActionForm action={setLeadSourceStatusAction}>
                    <input type="hidden" name="sourceId" value={source.id} />
                    <input type="hidden" name="archived" value={source.archived ? "0" : "1"} />
                    <button type="submit" className="mac-glass-btn">
                      {source.archived ? "Restore" : "Archive"}
                    </button>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ActionForm action={createLeadSourceAction} className="flex max-w-xl items-end gap-2">
          <label className="flex-1 text-[13px]">
            Name
            <input name="name" aria-label="Source name" className="field mt-1" />
          </label>
          <button type="submit" className="mac-primary">
            Add
          </button>
        </ActionForm>
      </div>
    </div>
  );
}
