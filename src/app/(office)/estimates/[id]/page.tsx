import Link from "next/link";
import { addLineAction, leadPhotoAction, removeLineAction, reviseAction, sendProposalAction, updateLineAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { GroupedList, StatusPill } from "@/components/ios";
import { CommentThread } from "@/components/comment-thread";
import { EstimateWorkspace, type WorkspaceLine } from "@/components/mac/estimate-workspace";
import { MissingRecord } from "@/components/missing-record";
import { PhotoCapture } from "@/components/photo-capture";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import type { Billing } from "@/lib/estimate/pricing";
import { formatQty, formatWhole, milliToQty } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { captionFromMetadata, estimateDetail } from "@/lib/services/read";

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return <h1 className="fl-large-title">Estimate</h1>;
  }
  const detail = estimateDetail(session.orgId, id);
  if (!detail) return <MissingRecord orgName={session.orgName} kind="estimate" />;
  const client = detail.lead?.title ?? "Estimate";
  const lines: WorkspaceLine[] = detail.lines.map((line) => ({
    id: line.id,
    sectionId: line.sectionId,
    name: line.name,
    qtyMilli: line.qtyMilli,
    unit: line.unit,
    unitCostCents: line.unitCostCents,
    markupBps: line.markupBps,
    costCode: line.costCode,
    billing: (line.billing || "included") as Billing,
    sortOrder: line.sortOrder,
    aiConfidenceMilli: line.aiConfidenceMilli,
    sourceNote: line.sourceNote,
  }));
  const budget = detail.lead?.scopeText?.match(/\$\d+–\d+k/i)?.[0] ?? null;
  return (
    <div className="estimate-screen">
      <div className="estimate-top">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <Link href={`/leads/${detail.estimate.leadId}`} className="estimate-back">
              ‹ <span className="estimate-back-name">{(detail.contact?.name ?? client).split(" ")[0]}</span>
            </Link>
            <Link href={`/leads/${detail.estimate.leadId}`} className="estimate-phone-preview">
              Preview
            </Link>
          </div>
          <h1 className="estimate-title">{detail.estimate.title}</h1>
          <p className="estimate-sub">
            {detail.contact?.name ?? client} · Version {detail.estimate.version}{" "}
            <StatusPill>{statusWord(detail.estimate.status)}</StatusPill>
          </p>
        </div>
        {detail.locked ? (
          <ActionForm action={reviseAction.bind(null, detail.estimate.id)}>
            <Button type="submit" className="fl-primary">
              Revise
            </Button>
          </ActionForm>
        ) : (
          <ActionForm action={sendProposalAction.bind(null, detail.estimate.id)} className="estimate-send">
            <label className="fl-footnote flex items-center gap-2 text-[var(--fl-secondary)]">
              <input type="checkbox" name="override" />
              Send even if margin is under target
            </label>
            <Button type="submit" data-mac-primary className="fl-primary">
              Send proposal
            </Button>
          </ActionForm>
        )}
      </div>
      <EstimateWorkspace
        userId={session.userId}
        estimateId={detail.estimate.id}
        locked={detail.locked}
        sections={detail.sections.map((section) => ({ id: section.id, name: section.name, sortOrder: section.sortOrder }))}
        lines={lines}
        marginTargetBps={detail.estimate.marginTargetBps}
        depositBps={detail.depositBps}
        progressBps={detail.progressBps}
        finalBps={detail.finalBps}
        clientName={detail.contact?.name ?? client}
        address={[detail.contact?.address, detail.contact?.city, detail.contact?.state].filter(Boolean).join(", ")}
        version={detail.estimate.version}
        sqft={detail.lead?.sqft ?? null}
        budgetLabel={budget}
        photos={detail.photos.map((photo) => ({
          src: photo.storagePath.startsWith("/") ? photo.storagePath : `/api/files/${photo.id}`,
          caption: captionFromMetadata(photo.metadataJson) || "Site photo",
        }))}
      >
        <div className="estimate-phone">
          <PhotoCapture action={leadPhotoAction.bind(null, detail.estimate.leadId)} label="Take an estimate photo" submitLabel="Save site photo" />
          {detail.lines.length === 0 ? <p className="fl-secondary-text text-[var(--fl-secondary)]">No lines yet</p> : null}
          <GroupedList label="Lines" meta={String(detail.lines.length)}>
            {detail.lines.map((line) => {
              const measure = /site measure/i.test(line.sourceNote ?? "");
              const billing = line.billing === "optional" ? " · Optional" : line.billing === "allowance" ? " · Allowance" : line.billing === "excluded" ? " · Excluded" : "";
              return (
                <li key={line.id} id={`line-${line.id}`}>
                  <article className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="fl-body min-w-0">{line.name}</p>
                      <p className="fl-body tabular-nums">{formatWhole(line.priceCents)}</p>
                    </div>
                    <p className="fl-secondary-text text-[var(--fl-secondary)]">
                      {formatQty(line.qtyMilli)} {line.unit}
                      {billing}
                      {measure ? <span className="fl-close"> · Measure on site</span> : null}
                    </p>
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
        </div>
      </EstimateWorkspace>
      <CommentThread entityType="estimate" entityId={detail.estimate.id} />
    </div>
  );
}

function statusWord(status: string) {
  if (!status) return "Draft";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
