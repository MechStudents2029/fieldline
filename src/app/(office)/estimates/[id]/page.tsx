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
  const deposit = Math.round(detail.priceCents * 0.4);
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-7 pb-28 md:mx-0 md:max-w-none md:flex-row md:gap-0 md:pb-0">
      <div className="min-w-0 flex-1 md:flex md:flex-col">
      <div className="fl-safe-top md:hidden">
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
      <div className="md:hidden">
        <PhotoCapture action={leadPhotoAction.bind(null, detail.estimate.leadId)} label="Take an estimate photo" submitLabel="Save site photo" />
      </div>
      {detail.lines.length === 0 ? <p className="fl-secondary-text text-[var(--fl-secondary)]">No lines yet</p> : null}
      <div className="hidden grid-cols-[28px_minmax(0,1.5fr)_88px_52px_40px_72px_52px_80px] gap-2 px-4 mac-t11 text-[var(--mac-secondary)] md:grid">
        <span>#</span>
        <span>Item</span>
        <span>Cost code</span>
        <span className="text-right">Qty</span>
        <span>Unit</span>
        <span className="text-right">Cost</span>
        <span className="text-right">Margin</span>
        <span className="text-right">Amount</span>
      </div>
      <GroupedList label="Lines" meta={String(detail.lines.length)}>
        {detail.sections.map((section) => {
          const lines = detail.lines.filter((line) => line.sectionId === section.id);
          if (lines.length === 0) return null;
          const subtotal = lines.reduce((sum, line) => sum + line.priceCents, 0);
          return (
            <li key={section.id} className="hidden md:list-item">
              <div className="flex items-baseline justify-between bg-[var(--mac-fill)] px-4 py-1 mac-t11 font-semibold">
                <span>{section.name}</span>
                <span className="num">{formatWhole(subtotal)}</span>
              </div>
            </li>
          );
        })}
        {detail.lines.map((line, index) => {
          const measure = /site measure/i.test(line.sourceNote ?? "");
          return (
            <li key={line.id} id={`line-${line.id}`}>
              <article className="px-4 py-3 md:px-2 md:py-0.5">
                <div className="flex items-start justify-between gap-3 md:hidden">
                  <p className="fl-body min-w-0">{line.name}</p>
                  <p className="fl-body tabular-nums">{formatWhole(line.priceCents)}</p>
                </div>
                <p className="fl-secondary-text text-[var(--fl-secondary)] md:px-1">
                  {formatQty(line.qtyMilli)} {line.unit}
                  {line.costCode ? ` · ${line.costCode}` : ""}
                  {measure ? <span className="fl-close"> · Measure on site</span> : null}
                </p>
                {detail.locked ? null : (
                  <ActionForm action={updateLineAction.bind(null, line.id, detail.estimate.id)} className="mt-3 grid gap-2 sm:grid-cols-4 md:mt-0 md:grid-cols-[28px_minmax(0,1.5fr)_88px_52px_40px_72px_52px_80px_auto] md:items-center md:gap-2">
                    <span className="hidden num text-[var(--mac-secondary)] md:inline">{index + 1}</span>
                    <input name="name" defaultValue={line.name} className="field sm:col-span-4 md:col-span-1 md:h-6 md:px-1.5 md:text-[13px]" aria-label="Line name" />
                    <span className="hidden md:inline" />
                    <input name="qty" defaultValue={String(milliToQty(line.qtyMilli))} className="field md:h-6 md:px-1.5 md:text-right md:text-[13px]" aria-label="Quantity" />
                    <span className="hidden md:inline">{line.unit}</span>
                    <input name="unitCost" defaultValue={(line.unitCostCents / 100).toFixed(2)} className="field md:h-6 md:px-1.5 md:text-right md:text-[13px]" aria-label="Unit cost" />
                    <input name="markup" defaultValue={(line.markupBps / 100).toFixed(1)} className="field md:h-6 md:px-1.5 md:text-right md:text-[13px]" aria-label="Markup percent" />
                    <span className="hidden md:inline" />
                    <Button type="submit" variant="outline" className="h-11 md:h-6 md:px-2 md:text-[12px]">
                      Save line
                    </Button>
                  </ActionForm>
                )}
                {detail.locked ? null : (
                  <ActionForm action={removeLineAction.bind(null, line.id, detail.estimate.id)} className="mt-2 md:mt-0">
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
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-[var(--mac-separator)] bg-[var(--mac-window)] px-6 py-3 mac-t11 text-[var(--mac-secondary)] hidden md:flex md:items-end md:justify-end md:gap-8">
        <span>Cost <strong className="mac-t17 text-[var(--mac-label)]">{formatWhole(detail.costCents)}</strong></span>
        <span>Margin <strong className={`mac-t17 ${under ? "text-[var(--mac-danger)]" : "text-[var(--mac-label)]"}`}>{formatPercent(detail.marginBps)}</strong></span>
        <span>Deposit <strong className="mac-t17 text-[var(--mac-label)]">{formatWhole(deposit)}</strong></span>
        <span>Price <strong className="mac-t22 text-[var(--mac-label)]">{formatWhole(detail.priceCents)}</strong></span>
      </div>
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 mx-auto w-full max-w-lg px-4 md:static md:bottom-auto md:order-first md:mx-0 md:flex md:max-w-none md:items-center md:justify-between md:px-6 md:pt-3">
        <div className="hidden md:block">
          <h1 className="mac-t15">{detail.estimate.title}</h1>
          <p className="mac-t11 text-[var(--mac-secondary)]">
            {detail.contact?.name ?? client} · Version {detail.estimate.version} · {statusWord(detail.estimate.status)}
          </p>
        </div>
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
            <Button type="submit" data-mac-primary className="fl-primary md:h-8 md:rounded-full md:px-3 md:text-[13px]">
              Send proposal
            </Button>
          </ActionForm>
        )}
      </div>
      </div>
      <aside className="mac-inspector" aria-label="Inspector">
        <p className="mac-t11 font-semibold text-[var(--mac-secondary)]">Proposal</p>
        <p className="mac-t13">{detail.contact?.name}</p>
        <p className="mac-t13 text-[var(--mac-secondary)]">Version {detail.estimate.version}</p>
        <p className="mac-t11 font-semibold text-[var(--mac-secondary)]">Pricing</p>
        <p className="mac-t13">Target {formatPercent(detail.estimate.marginTargetBps)}</p>
        <p className="mac-t13 num">{formatWhole(detail.priceCents)}</p>
        <p className="mac-t11 font-semibold text-[var(--mac-secondary)]">Payment schedule</p>
        <p className="mac-t13">Deposit {formatWhole(deposit)}</p>
        <div className="hidden md:block">
          <PhotoCapture action={leadPhotoAction.bind(null, detail.estimate.leadId)} label="Take an estimate photo" submitLabel="Save site photo" />
        </div>
      </aside>
    </div>
  );
}

function statusWord(status: string) {
  if (!status) return "Draft";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
