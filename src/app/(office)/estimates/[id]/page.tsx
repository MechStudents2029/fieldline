import Link from "next/link";
import { addLineAction, leadPhotoAction, removeLineAction, reviseAction, sendProposalAction, updateLineAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { MissingRecord } from "@/components/missing-record";
import { PhotoCapture } from "@/components/photo-capture";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatBps, formatMoney, formatQty, milliToQty } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { estimateDetail } from "@/lib/services/read";

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return (
      <div>
        <h1 className="font-heading text-3xl">Estimate</h1>
        <p className="mt-2 text-sm text-muted-foreground">Pricing is hidden for the field role.</p>
      </div>
    );
  }
  const detail = estimateDetail(session.orgId, id);
  if (!detail) return <MissingRecord orgName={session.orgName} kind="estimate" />;
  const under = detail.marginBps != null && detail.marginBps < detail.estimate.marginTargetBps;
  const review = detail.lines.filter((line) => lineNeedsReview(line));
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs text-muted-foreground">
          <Link href={`/leads/${detail.estimate.leadId}`} className="underline">
            {detail.lead?.title}
          </Link>{" "}
          · v{detail.estimate.version} · {detail.estimate.status}
        </p>
        <h1 className="font-heading text-3xl">{detail.estimate.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{detail.estimate.notes}</p>
      </div>
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">Site photo</h2>
        <p className="mt-1 text-sm text-muted-foreground">A caption helps the next draft. Prices still come from the price book.</p>
        <PhotoCapture action={leadPhotoAction.bind(null, detail.estimate.leadId)} label="Take an estimate photo" submitLabel="Save site photo" />
      </section>
      <section className={`rounded-xl p-4 ring-1 ${under ? "bg-accent ring-copper/40" : "bg-card ring-foreground/10"}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Sell price</p>
            <p className="font-heading text-3xl">{formatMoney(detail.priceCents)}</p>
          </div>
          <div className="text-sm">
            <p>Cost {formatMoney(detail.costCents)}</p>
            <p>Margin {formatBps(detail.marginBps)} · target {formatBps(detail.estimate.marginTargetBps)}</p>
          </div>
        </div>
        {under ? <p className="mt-2 text-sm">This draft is under the margin target. Edit lines or override when you send.</p> : null}
        {detail.lines.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No lines yet. Lines are the priced items the client will see. This estimate is empty because nothing has been added from the price book.{" "}
            <a href="#add-line" className="underline">
              Add a line
            </a>
          </p>
        ) : null}
      </section>
      {review.length > 0 ? (
        <section className="rounded-xl bg-accent p-4 ring-1 ring-copper/40">
          <h2 className="font-medium">Review these</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Photo-driven and low-confidence lines stay in the draft until you edit them. Nothing sends on its own.
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {review.map((line) => {
              const flags = lineFlags(line);
              return (
                <li key={line.id}>
                  <a href={`#line-${line.id}`} className="underline">
                    {line.costCode} · {line.name}
                  </a>
                  {flags.photo ? " · photo" : ""}
                  {flags.low ? " · low confidence" : ""}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {detail.sections.map((section) => (
        <section key={section.id}>
          <h2 className="font-medium">{section.name}</h2>
          <div className="mt-2 flex flex-col gap-3">
            {detail.lines
              .filter((line) => line.sectionId === section.id)
              .map((line) => (
                <article
                  key={line.id}
                  id={`line-${line.id}`}
                  className={`rounded-xl p-3 ring-1 ${lineNeedsReview(line) ? "bg-accent ring-copper/40" : "bg-card ring-foreground/10"}`}
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="flex flex-wrap items-center gap-1">
                      <span>
                        {line.costCode} · {line.source}
                        {line.aiConfidenceMilli != null ? ` · ${Math.round(line.aiConfidenceMilli / 10)}% confidence` : ""}
                      </span>
                      <LineBadges line={line} />
                    </span>
                    <span>{formatMoney(line.priceCents)}</span>
                  </div>
                  {line.aiConfidenceMilli != null && line.aiConfidenceMilli < 700 ? (
                    <p className="mb-2 text-xs text-copper">Low confidence. {line.sourceNote}</p>
                  ) : (
                    <p className="mb-2 text-xs text-muted-foreground">{line.sourceNote}</p>
                  )}
                  {detail.locked ? (
                    <p className="text-sm">
                      {line.name} · {formatQty(line.qtyMilli)} {line.unit} · cost {formatMoney(line.unitCostCents)} · markup {formatBps(line.markupBps)}
                    </p>
                  ) : (
                    <ActionForm action={updateLineAction.bind(null, line.id, detail.estimate.id)} className="grid gap-2 sm:grid-cols-4">
                      <input name="name" defaultValue={line.name} className="field sm:col-span-4" />
                      <input name="qty" defaultValue={String(milliToQty(line.qtyMilli))} className="field" aria-label="Quantity" />
                      <input name="unitCost" defaultValue={(line.unitCostCents / 100).toFixed(2)} className="field" aria-label="Unit cost" />
                      <input name="markup" defaultValue={(line.markupBps / 100).toFixed(1)} className="field" aria-label="Markup percent" />
                      <Button type="submit" variant="outline" className="h-11">
                        Save line
                      </Button>
                    </ActionForm>
                  )}
                  {!detail.locked ? (
                    <ActionForm action={removeLineAction.bind(null, line.id, detail.estimate.id)} className="mt-2">
                      <button type="submit" className="text-xs text-muted-foreground underline">
                        Remove line
                      </button>
                    </ActionForm>
                  ) : null}
                </article>
              ))}
          </div>
        </section>
      ))}
      {!detail.locked ? (
        <section id="add-line" className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="font-medium">Add a line</h2>
          <ActionForm action={addLineAction.bind(null, detail.estimate.id)} className="mt-2 grid gap-2 sm:grid-cols-3">
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
        </section>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row">
        {!detail.locked ? (
          <ActionForm action={sendProposalAction.bind(null, detail.estimate.id)} className="flex flex-1 flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="override" className="mt-1" />
              Send even if margin is under target
            </label>
            <Button type="submit" className="h-11">
              Send proposal
            </Button>
          </ActionForm>
        ) : (
          <ActionForm action={reviseAction.bind(null, detail.estimate.id)}>
            <Button type="submit" variant="outline" className="h-11">
              Revise as a new version
            </Button>
          </ActionForm>
        )}
      </div>
    </div>
  );
}

function lineFlags(line: { aiConfidenceMilli: number | null; sourceNote: string | null }) {
  const note = line.sourceNote ?? "";
  return {
    low: line.aiConfidenceMilli != null && line.aiConfidenceMilli < 700,
    photo: /site photo/i.test(note),
    measure: /site measure/i.test(note),
  };
}

function lineNeedsReview(line: { aiConfidenceMilli: number | null; sourceNote: string | null }) {
  const flags = lineFlags(line);
  return flags.low || flags.photo;
}

function LineBadges({ line }: { line: { aiConfidenceMilli: number | null; sourceNote: string | null } }) {
  const flags = lineFlags(line);
  if (!flags.low && !flags.photo && !flags.measure) return null;
  return (
    <>
      {flags.photo ? <Badge>Photo</Badge> : null}
      {flags.low ? <Badge>Low confidence</Badge> : null}
      {flags.measure ? <Badge>Needs site measure</Badge> : null}
    </>
  );
}

function Badge({ children }: { children: string }) {
  return <span className="rounded-full bg-card px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-copper">{children}</span>;
}
