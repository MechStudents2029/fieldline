import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addChangeCodeAction,
  askChangeQuoteAction,
  attachChangeFileAction,
  chooseChangeQuoteAction,
  convertChangeEventAction,
  markChangeReadyAction,
  markChangeRequestedAction,
  saveChangeEventAction,
  voidChangeEventAction,
} from "@/app/(office)/change-events/actions";
import { ActionForm } from "@/components/action-form";
import { CopyChangeLink } from "@/components/copy-change-link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatWhole } from "@/lib/money";
import { CHANGE_REASONS, changeEventDetail } from "@/lib/services/change-events";

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

export default async function ChangeEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const detail = changeEventDetail(session, id);
  if (!detail) notFound();
  const money = detail.showMoney;
  return (
    <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
      <p className="text-sm">
        <Link href={`/projects/${detail.projectId}/changes`} className="text-[var(--mac-accent)]">
          {detail.job}
        </Link>
        <span className="num"> · {detail.number}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="fl-large-title">{detail.title}</h1>
        <span className="fl-pill" data-status={detail.status}>
          {detail.statusLabel}
        </span>
      </div>
      <p className="text-sm text-[var(--mac-secondary)]">
        {detail.reasonLabel}
        {detail.sourceLabel ? ` · ${detail.sourceLabel}` : ""}
        {` · ${detail.scheduleDays}d`}
      </p>
      {detail.changeOrderHref ? (
        <p className="text-sm">
          <Link href={detail.changeOrderHref} className="text-[var(--mac-accent)]" data-co={detail.changeOrderNumber ?? ""}>
            CO {detail.changeOrderNumber}
          </Link>
          {detail.commitments.map((row) => (
            <Link key={row.id} href={row.href} className="ml-3 text-[var(--mac-accent)]" data-po={row.number}>
              {row.number}
            </Link>
          ))}
        </p>
      ) : null}
      {detail.voidReason ? <p className="text-sm">{detail.voidReason}</p> : null}
      <table aria-label="Cost codes" className="w-full text-left text-sm">
        <thead>
          <tr className="text-[var(--mac-secondary)]">
            <th className="py-2 pr-3 font-medium">Code</th>
            <th className="py-2 pr-3 text-right font-medium">ROM cost</th>
            <th className="py-2 text-right font-medium">ROM price</th>
          </tr>
        </thead>
        <tbody>
          {detail.codes.map((code) => (
            <tr key={code.id} className="border-t border-[var(--mac-separator)]">
              <td className="py-2 pr-3">{code.costCode}</td>
              <td className="py-2 pr-3 text-right num">{money ? formatWhole(code.romCostCents) : ""}</td>
              <td className="py-2 text-right num">{money ? formatWhole(code.romPriceCents) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail.canEdit && money ? (
        <ActionForm action={saveChangeEventAction.bind(null, detail.id)} className="flex flex-col gap-2">
          <input type="hidden" name="projectId" value={detail.projectId} />
          <label className="text-sm">
            Title
            <input name="title" aria-label="Title" defaultValue={detail.title} className="field mt-1" />
          </label>
          <label className="text-sm">
            Reason
            <select name="reason" aria-label="Reason" defaultValue={detail.reason} className="field mt-1">
              {CHANGE_REASONS.map((row) => (
                <option key={row.value} value={row.value}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Schedule days
            <input name="scheduleDays" aria-label="Schedule days" defaultValue={String(detail.scheduleDays)} className="field mt-1" />
          </label>
          {detail.codes.map((code) => (
            <div key={code.id} className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                {code.costCode} cost
                <input name={`cost_${code.id}`} aria-label={`ROM cost ${code.costCode}`} defaultValue={dollars(code.romCostCents)} className="field mt-1" />
              </label>
              <label className="text-sm">
                {code.costCode} price
                <input name={`price_${code.id}`} aria-label={`ROM price ${code.costCode}`} defaultValue={dollars(code.romPriceCents)} className="field mt-1" />
              </label>
            </div>
          ))}
          <Button type="submit">Save</Button>
        </ActionForm>
      ) : null}
      {detail.canEdit && money ? (
        <ActionForm action={addChangeCodeAction.bind(null, detail.id)} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="projectId" value={detail.projectId} />
          <label className="text-sm">
            Cost code
            <input name="costCode" aria-label="Add cost code" className="field mt-1" />
          </label>
          <label className="text-sm">
            Cost
            <input name="romCost" aria-label="Add ROM cost" className="field mt-1" />
          </label>
          <label className="text-sm">
            Price
            <input name="romPrice" aria-label="Add ROM price" className="field mt-1" />
          </label>
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </ActionForm>
      ) : null}
      {detail.files.length > 0 ? (
        <ul className="text-sm">
          {detail.files.map((file) => (
            <li key={file.id}>{file.filename}</li>
          ))}
        </ul>
      ) : null}
      {detail.canEdit && detail.documents.length > 0 ? (
        <ActionForm action={attachChangeFileAction.bind(null, detail.id)} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            File
            <select name="documentId" aria-label="File" className="field mt-1" defaultValue="">
              <option value="">Select</option>
              {detail.documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary">
            Attach
          </Button>
        </ActionForm>
      ) : null}
      <table aria-label="Vendor prices" className="w-full text-left text-sm">
        <thead>
          <tr className="text-[var(--mac-secondary)]">
            <th className="py-2 pr-3 font-medium">Vendor</th>
            <th className="py-2 pr-3 font-medium">Due</th>
            <th className="py-2 pr-3 text-right font-medium">Amount</th>
            <th className="py-2 pr-3 text-right font-medium">Days</th>
            <th className="py-2 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {detail.quotes.map((quote) => (
            <tr key={quote.id} className="border-t border-[var(--mac-separator)]" data-quote={quote.vendor}>
              <td className="py-2 pr-3">
                {quote.vendor}
                {quote.chosen ? <span className="fl-pill ml-2">Used</span> : null}
              </td>
              <td className="py-2 pr-3 num">{quote.dueOn}</td>
              <td className="py-2 pr-3 text-right num">{money && quote.amountCents != null ? formatWhole(quote.amountCents) : ""}</td>
              <td className="py-2 pr-3 text-right num">{quote.days ?? ""}</td>
              <td className="py-2">
                {quote.note}
                <span className="ml-2 inline-flex flex-wrap gap-2">
                  {detail.canEdit && quote.shareUrl ? <CopyChangeLink quoteId={quote.id} url={quote.shareUrl} /> : null}
                  {detail.canEdit && quote.status === "draft" ? (
                    <ActionForm action={markChangeRequestedAction.bind(null, quote.id)}>
                      <Button type="submit" variant="secondary">
                        Mark requested
                      </Button>
                    </ActionForm>
                  ) : null}
                  {detail.canEdit && quote.status === "priced" && !quote.chosen ? (
                    <ActionForm action={chooseChangeQuoteAction.bind(null, quote.id)}>
                      <Button type="submit" variant="secondary">
                        Use
                      </Button>
                    </ActionForm>
                  ) : null}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail.canEdit && detail.vendors.length > 0 ? (
        <ActionForm action={askChangeQuoteAction.bind(null, detail.id)} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Vendor
            <select name="contactId" aria-label="Vendor" className="field mt-1" defaultValue="">
              <option value="">Select</option>
              {detail.vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Due
            <input type="date" name="dueOn" aria-label="Quote due" className="field mt-1" />
          </label>
          <Button type="submit">Ask</Button>
        </ActionForm>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {detail.canReady ? (
          <ActionForm action={markChangeReadyAction.bind(null, detail.id)}>
            <input type="hidden" name="projectId" value={detail.projectId} />
            <Button type="submit">Mark ready</Button>
          </ActionForm>
        ) : null}
        {detail.canConvert ? (
          <ActionForm action={convertChangeEventAction.bind(null, detail.id)}>
            <input type="hidden" name="projectId" value={detail.projectId} />
            <Button type="submit">Convert</Button>
          </ActionForm>
        ) : null}
      </div>
      {detail.canVoid ? (
        <ActionForm action={voidChangeEventAction.bind(null, detail.id)} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="projectId" value={detail.projectId} />
          <label className="text-sm">
            Reason
            <input name="reason" aria-label="Void reason" className="field mt-1" />
          </label>
          <Button type="submit" variant="secondary">
            Void
          </Button>
        </ActionForm>
      ) : null}
    </div>
  );
}
