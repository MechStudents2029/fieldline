import Link from "next/link";
import { addLineAction, leadPhotoAction, removeLineAction, reviseAction, sendProposalAction, updateLineAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { GroupedList, NumberStrip, StatusPill } from "@/components/ios";
import { MissingRecord } from "@/components/missing-record";
import { PhotoCapture } from "@/components/photo-capture";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatPercent, formatQty, formatWhole, milliToQty } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { estimateDetail } from "@/lib/services/read";

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return <h1 className="fl-large-title">Estimate</h1>;
  }
  const detail = estimateDetail(session.orgId, id);
  if (!detail) return <MissingRecord orgName={session.orgName} kind="estimate" />;
  const under = detail.marginBps != null && detail.marginBps < detail.estimate.marginTargetBps;
  const client = detail.lead?.title ?? "Estimate";
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-7 pb-28">
      <div className="fl-safe-top">
        <div className="flex items-center justify-between">
          <Link href={`/leads/${detail.estimate.leadId}`} className="fl-body text-[var(--fl-accent)]">
            ‹ {client.split(" ")[0]}
          </Link>
          <Link href={`/leads/${detail.estimate.leadId}`} className="fl-body text-[var(--fl-accent)]">
            Preview
          </Link>
        </div>
        <h1 className="fl-title mt-3">{detail.estimate.title}</h1>
        <p className="fl-secondary-text mt-1 flex items-center gap-2 text-[var(--fl-secondary)]">
          <span>
            {detail.contact?.name ?? client} · Version {detail.estimate.version}
          </span>
          <StatusPill>{statusWord(detail.estimate.status)}</StatusPill>
        </p>
      </div>
      <NumberStrip
        items={[
          { label: "Price", value: formatWhole(detail.priceCents) },
          { label: "Cost", value: formatWhole(detail.costCents) },
          { label: "Margin", value: formatPercent(detail.marginBps), tone: under ? "late" : "neutral" },
        ]}
      />
      <PhotoCapture action={leadPhotoAction.bind(null, detail.estimate.leadId)} label="Take an estimate photo" submitLabel="Save site photo" />
      {detail.lines.length === 0 ? <p className="fl-secondary-text text-[var(--fl-secondary)]">No lines yet</p> : null}
      <GroupedList label="Lines" meta={String(detail.lines.length)}>
        {detail.lines.map((line) => {
          const measure = /site measure/i.test(line.sourceNote ?? "");
          return (
            <li key={line.id} id={`line-${line.id}`}>
              <article className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="fl-body">{line.name}</p>
                    <p className="fl-secondary-text text-[var(--fl-secondary)]">
                      {formatQty(line.qtyMilli)} {line.unit}
                      {line.costCode ? ` · ${line.costCode}` : ""}
                      {measure ? <span className="fl-close"> · Measure on site</span> : null}
                    </p>
                  </div>
                  <p className="fl-body tabular-nums">{formatWhole(line.priceCents)}</p>
                </div>
                {detail.locked ? null : (
                  <ActionForm action={updateLineAction.bind(null, line.id, detail.estimate.id)} className="mt-3 grid gap-2 sm:grid-cols-4">
                    <input name="name" defaultValue={line.name} className="field sm:col-span-4" aria-label="Line name" />
                    <input name="qty" defaultValue={String(milliToQty(line.qtyMilli))} className="field" aria-label="Quantity" />
                    <input name="unitCost" defaultValue={(line.unitCostCents / 100).toFixed(2)} className="field" aria-label="Unit cost" />
                    <input name="markup" defaultValue={(line.markupBps / 100).toFixed(1)} className="field" aria-label="Markup percent" />
                    <Button type="submit" variant="outline" className="h-11">
                      Save line
                    </Button>
                  </ActionForm>
                )}
                {detail.locked ? null : (
                  <ActionForm action={removeLineAction.bind(null, line.id, detail.estimate.id)} className="mt-2">
                    <button type="submit" className="fl-footnote text-[var(--fl-secondary)]">
                      Remove line
                    </button>
                  </ActionForm>
                )}
              </article>
            </li>
          );
        })}
        {detail.locked ? null : (
          <li id="add-line" className="px-4 py-3">
            <p className="fl-body text-[var(--fl-accent)]">+ Add line</p>
            <ActionForm action={addLineAction.bind(null, detail.estimate.id)} className="mt-3 grid gap-2 sm:grid-cols-3">
              <input name="name" placeholder="Line name" className="field sm:col-span-3" />
              <input name="qty" defaultValue="1" className="field" aria-label="Quantity" />
              <input name="unit" defaultValue="ea" className="field" aria-label="Unit" />
              <input name="unitCost" placeholder="Unit cost" className="field" />
              <input name="markup" defaultValue="35" className="field" aria-label="Markup percent" />
              <input name="costCode" placeholder="Cost code" className="field" />
              <Button type="submit" variant="outline" className="h-11">
                Add line
              </Button>
            </ActionForm>
          </li>
        )}
      </GroupedList>
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 mx-auto w-full max-w-lg px-4 md:bottom-4 md:left-60 md:max-w-[calc(100%-16rem)]">
        {detail.locked ? (
          <ActionForm action={reviseAction.bind(null, detail.estimate.id)}>
            <Button type="submit" className="fl-primary">
              Revise
            </Button>
          </ActionForm>
        ) : (
          <ActionForm action={sendProposalAction.bind(null, detail.estimate.id)} className="flex flex-col gap-2">
            <label className="fl-footnote flex items-center gap-2 text-[var(--fl-secondary)]">
              <input type="checkbox" name="override" />
              Send even if margin is under target
            </label>
            <Button type="submit" className="fl-primary">
              Send proposal
            </Button>
          </ActionForm>
        )}
      </div>
    </div>
  );
}

function statusWord(status: string) {
  if (!status) return "Draft";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
