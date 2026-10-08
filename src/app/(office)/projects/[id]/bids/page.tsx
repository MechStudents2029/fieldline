import Link from "next/link";
import { createBidAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FileButton } from "@/components/file-button";
import { MissingRecord } from "@/components/missing-record";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { bidComposer } from "@/lib/services/bids";

export default async function JobBidsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const board = bidComposer(session, id);
  if (!board) return <MissingRecord orgName={session.orgName} kind="job" />;
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Bids" subtitle={board.projectName} search={false} leading={<Link href={`/projects/${board.projectId}`}>‹</Link>} />
      </div>
      <div className="flex flex-col gap-6 px-4 py-4 md:px-6">
        <div className="md:hidden">
          <Link href={`/projects/${board.projectId}`} className="text-[var(--fl-accent)]">
            ‹ Job
          </Link>
          <h1 className="fl-title mt-2">Bids</h1>
        </div>
        <ul className="fl-group">
          {board.bids.length === 0 ? <li className="fl-cell">No bids</li> : null}
          {board.bids.map((bid) => (
            <li key={bid.id}>
              <Link href={`/bids/${bid.id}`} className="fl-cell">
                <span className="min-w-0 flex-1">
                  <span className="fl-body block truncate">{bid.title}</span>
                  <span className="fl-footnote text-[var(--fl-secondary)]">{formatCalendarDay(bid.dueOn)}</span>
                </span>
                <span className="fl-pill">{bid.statusLabel}</span>
              </Link>
            </li>
          ))}
        </ul>
        {board.canEdit ? (
          <ActionForm action={createBidAction.bind(null, board.projectId)} className="flex flex-col gap-3">
            <label className="text-sm">
              Title
              <input name="title" required aria-label="Title" className="field mt-1" />
            </label>
            <label className="text-sm">
              Scope
              <textarea name="scope" aria-label="Scope" rows={3} className="field mt-1" />
            </label>
            <label className="text-sm">
              Due
              <input name="dueOn" type="date" required aria-label="Due" className="field mt-1" />
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm">Lines</legend>
              {board.lines.map((line) => (
                <label key={line.budgetLineId} className="flex flex-wrap items-center gap-2 text-sm">
                  <input type="checkbox" name="budgetLine" value={line.budgetLineId} aria-label={`Line ${line.costCode}`} />
                  <span>
                    {line.name} · {line.costCode}
                  </span>
                  <input name={`qty_${line.budgetLineId}`} defaultValue="1" aria-label={`Qty ${line.costCode}`} className="field w-16" />
                  <input name={`unit_${line.budgetLineId}`} defaultValue={line.unit} aria-label={`Unit ${line.costCode}`} className="field w-16" />
                </label>
              ))}
              <label className="text-sm">
                Cost code
                <input name="extraCode" aria-label="Cost code" className="field mt-1" />
              </label>
              <label className="text-sm">
                Line
                <input name="extraName" aria-label="Line" className="field mt-1" />
              </label>
              <label className="text-sm">
                Qty
                <input name="extraQty" defaultValue="1" aria-label="Qty" className="field mt-1" />
              </label>
              <label className="text-sm">
                Unit
                <input name="extraUnit" defaultValue="ea" aria-label="Unit" className="field mt-1" />
              </label>
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm">Vendors</legend>
              {board.vendors.map((vendor) => (
                <label key={vendor.id} className="text-sm">
                  <input type="checkbox" name="vendor" value={vendor.id} aria-label={`Invite ${vendor.name}`} /> {vendor.name}
                </label>
              ))}
            </fieldset>
            <FileButton name="file" label="File" accept="image/jpeg,image/png,image/webp" empty="File" />
            <button type="submit" className="mac-primary w-fit">
              Request bids
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
