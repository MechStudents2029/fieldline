import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addTmLineAction,
  attachTmPhotoAction,
  removeTmLineAction,
  requestTmSignatureAction,
  signTmAction,
  updateTmLineAction,
  voidTmAction,
  voidTmChangeOrderAction,
} from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FileButton } from "@/components/file-button";
import { SignaturePad } from "@/components/signature-pad";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { formatBps, formatMoney, formatQty, formatWhole } from "@/lib/money";
import { ticketComposer, ticketDetail } from "@/lib/services/tm";

export default async function TmDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const ticket = ticketDetail(session, id);
  if (!ticket) notFound();
  const form = ticket.canEdit ? ticketComposer(session) : null;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Toolbar
        title={ticket.title}
        subtitle={ticket.job}
        search={false}
        trailing={
          <Link className="mac-glass-btn" href={`/tm/${ticket.id}/print`}>
            Print
          </Link>
        }
      />
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 overflow-auto px-4 py-4 md:max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <span className="fl-pill">{ticket.pill}</span>
          {ticket.money ? <span className="num text-[22px] font-semibold">{formatWhole(ticket.money.totalCents)}</span> : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-[var(--mac-secondary)]">Date</dt>
            <dd className="num">{formatCalendarDay(ticket.performedOn)}</dd>
          </div>
          <div>
            <dt className="text-[var(--mac-secondary)]">Location</dt>
            <dd>{ticket.location}</dd>
          </div>
          <div>
            <dt className="text-[var(--mac-secondary)]">Ordered by</dt>
            <dd>{ticket.orderedBy}</dd>
          </div>
          {ticket.money ? (
            <div>
              <dt className="text-[var(--mac-secondary)]">Margin</dt>
              <dd className="num">{formatBps(ticket.money.marginBps)}</dd>
            </div>
          ) : null}
        </dl>
        <p>{ticket.description}</p>
        {ticket.changeOrderId ? (
          <Link href={`/projects/${ticket.projectId}/orders/${ticket.changeOrderId}`}>{ticket.changeOrderLabel}</Link>
        ) : null}
        {ticket.invoiceId ? <Link href={`/projects/${ticket.projectId}/invoices/${ticket.invoiceId}`}>{ticket.invoiceLabel}</Link> : null}
        <ul className="flex flex-col gap-2" aria-label="Lines">
          {ticket.lines.map((line) => (
            <li key={line.id} className="flex flex-col gap-1 rounded-lg border border-[var(--mac-separator)] px-3 py-2">
              <span className="flex items-baseline justify-between gap-3">
                <span>{line.label}</span>
                <span className="num">
                  {formatQty(line.qtyMilli)} {line.unit}
                  {ticket.money && "priceCents" in line ? ` · ${formatMoney(line.priceCents)}` : ""}
                </span>
              </span>
              {ticket.money && "unitCostCents" in line ? (
                <span className="num text-[var(--mac-secondary)]">
                  {formatMoney(line.unitCostCents)} · {formatMoney(line.costCents)} · {formatBps(line.markupBps)}
                </span>
              ) : null}
              {ticket.canEdit && ticket.canBill && "unitCostCents" in line && "markupBps" in line ? (
                <ActionForm action={updateTmLineAction.bind(null, line.id, ticket.id)} className="flex flex-wrap items-center gap-2">
                  <input name="qty" aria-label={`Qty ${line.label}`} className="ctl w-20" defaultValue={formatQty(line.qtyMilli)} />
                  <input name="unitCost" aria-label={`Unit cost ${line.label}`} className="ctl w-24" defaultValue={(line.unitCostCents / 100).toFixed(2)} />
                  <input name="markup" aria-label={`Markup ${line.label}`} className="ctl w-20" defaultValue={(line.markupBps / 100).toFixed(1)} />
                  <button type="submit" className="ctl">
                    Save
                  </button>
                </ActionForm>
              ) : null}
              {ticket.canEdit ? (
                <form action={removeTmLineAction.bind(null, line.id, ticket.id)}>
                  <button type="submit" className="ctl">
                    Remove
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {form ? (
          <ActionForm action={addTmLineAction.bind(null, ticket.id)} className="flex flex-col gap-2">
            <select name="kind" aria-label="Kind" className="ctl" defaultValue="labor">
              <option value="labor">Labor</option>
              <option value="material">Material</option>
              <option value="equipment">Equipment</option>
            </select>
            <select name="userId" aria-label="Crew" className="ctl" defaultValue={session.userId}>
              {form.crew.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
            <input name="hours" aria-label="Hours" inputMode="decimal" className="field" placeholder="Hours" />
            <input name="catalog" aria-label="Catalog" className="field" placeholder="Catalog" />
            <input name="label" aria-label="Item" className="field" placeholder="Item" />
            <input name="qty" aria-label="Qty" inputMode="decimal" className="field" placeholder="Qty" />
            <select name="equipmentId" aria-label="Equipment" className="ctl" defaultValue="">
              <option value="">Equipment</option>
              {form.gear.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
            {form.money ? (
              <span className="flex gap-2">
                <input name="unitCost" aria-label="Unit cost" className="field" placeholder="Unit cost" />
                <input name="markup" aria-label="Markup" className="field" placeholder="Markup" />
              </span>
            ) : null}
            <button type="submit" className="h-11 rounded-lg bg-[var(--fl-accent)] text-sm font-semibold text-white">
              Add line
            </button>
          </ActionForm>
        ) : null}
        <ul aria-label="Photos" className="flex flex-col gap-2">
          {ticket.photos.map((photo) => (
            <li key={photo.id}>
              <a href={`/api/files/${photo.id}`}>{photo.filename}</a>
            </li>
          ))}
        </ul>
        {ticket.canEdit ? (
          <ActionForm action={attachTmPhotoAction.bind(null, ticket.id)} className="flex flex-col gap-2">
            <FileButton name="photo" label="Photo" accept="image/jpeg,image/png,image/webp" empty="Photo" />
            <button type="submit" className="ctl w-fit">
              Add photo
            </button>
          </ActionForm>
        ) : null}
        {ticket.companySigner ? (
          <p>
            {ticket.companySigner}
            {ticket.companySignature ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="Company signature" src={ticket.companySignature} className="mt-1 h-16 bg-white" />
            ) : null}
          </p>
        ) : null}
        {ticket.clientSigner ? (
          <p>
            {ticket.clientSigner}
            {ticket.clientSignature ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="Customer signature" src={ticket.clientSignature} className="mt-1 h-16 bg-white" />
            ) : null}
          </p>
        ) : null}
        {ticket.status === "draft" ? (
          <ActionForm action={signTmAction.bind(null, ticket.id, "company")} className="flex flex-col gap-2">
            <input name="signer" aria-label="Company name" className="field" placeholder="Name" />
            <SignaturePad name="drawn" label="Company signature" />
            <button type="submit" className="h-11 rounded-lg bg-[var(--fl-accent)] text-sm font-semibold text-white">
              Company signature
            </button>
          </ActionForm>
        ) : null}
        {ticket.status === "draft" || ticket.status === "ready" ? (
          <ActionForm action={signTmAction.bind(null, ticket.id, "client")} className="flex flex-col gap-2">
            <input name="signer" aria-label="Customer name" className="field" placeholder="Name" />
            <SignaturePad name="drawn" label="Customer signature" />
            <button type="submit" className="h-11 rounded-lg bg-[var(--fl-accent)] text-sm font-semibold text-white">
              Customer signature
            </button>
          </ActionForm>
        ) : null}
        {ticket.status === "draft" || ticket.status === "ready" ? (
          <ActionForm action={requestTmSignatureAction.bind(null, ticket.id)}>
            <button type="submit" className="ctl">
              Request signature
            </button>
          </ActionForm>
        ) : null}
        {ticket.canVoid ? (
          <ActionForm action={voidTmAction.bind(null, ticket.id)}>
            <button type="submit" className="ctl">
              Void
            </button>
          </ActionForm>
        ) : null}
        {ticket.canBill && ticket.changeOrderId && (ticket.changeOrderStatus === "draft" || ticket.changeOrderStatus === "sent") ? (
          <ActionForm action={voidTmChangeOrderAction.bind(null, ticket.changeOrderId, ticket.projectId)}>
            <button type="submit" className="ctl">
              Void change order
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
