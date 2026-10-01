import Link from "next/link";
import { notFound } from "next/navigation";
import { addLineAction, removeLineAction, reviseAction, sendProposalAction, updateLineAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { formatBps, formatMoney, formatQty, milliToQty } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { estimateDetail } from "@/lib/services/read";

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await getSession())!;
  if (!canSeeMoney(session.role)) {
    return <p>Pricing is hidden for field roles.</p>;
  }
  const detail = estimateDetail(session.orgId, id);
  if (!detail) notFound();
  const under = detail.marginBps != null && detail.marginBps < detail.estimate.marginTargetBps;
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
      </section>
      {detail.sections.map((section) => (
        <section key={section.id}>
          <h2 className="font-medium">{section.name}</h2>
          <div className="mt-2 flex flex-col gap-3">
            {detail.lines
              .filter((line) => line.sectionId === section.id)
              .map((line) => (
                <article key={line.id} className="rounded-xl bg-card p-3 ring-1 ring-foreground/10">
                  <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {line.costCode} · {line.source}
                      {line.aiConfidenceMilli != null ? ` · ${Math.round(line.aiConfidenceMilli / 10)}% confidence` : ""}
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
        <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
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
