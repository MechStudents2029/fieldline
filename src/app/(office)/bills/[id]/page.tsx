import Link from "next/link";
import { approveBillAction, confirmBillAction, payBillAction, requestUnconditionalAction, requestWaiverAction, unapproveBillAction, uploadWaiverAction, voidBillAction, voidWaiverAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CommentThread } from "@/components/comment-thread";
import { FileButton } from "@/components/file-button";
import { MissingRecord } from "@/components/missing-record";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { canManageMoney, canSeeMoney } from "@/lib/permissions";
import { billDetail } from "@/lib/services/bills";
import { billWaiverPanel } from "@/lib/services/waivers";
import { WAIVER_TYPES, waiverTypeLabel } from "@/lib/waivers/format";

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return <h1 className="fl-large-title">Bills</h1>;
  }
  const detail = billDetail(session.orgId, id, session.role);
  if (!detail) return <MissingRecord orgName={session.orgName} kind="bill" />;
  const { bill, lines, events } = detail;
  const office = canManageMoney(session.role);
  const waivers = billWaiverPanel(session, bill.id);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {bill.status}
          {bill.timing === "overdue" ? " · Overdue" : ""}
          {bill.lowConfidence ? " · Low confidence" : ""}
        </p>
        <h1 className="font-heading text-3xl">{bill.billNumber}</h1>
        <p className="text-sm">
          {bill.vendorName} · <Link href={`/projects/${bill.projectId}`} className="underline">{bill.projectName}</Link>
        </p>
        <p className="mt-2 font-heading text-3xl">{formatMoney(bill.amountCents)}</p>
        {bill.retainageCents > 0 ? (
          <p className="num text-sm">
            Net {formatMoney(bill.netCents)} · Retained {formatMoney(bill.retainageCents)}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Bill date {bill.billDate ? formatCalendarDay(bill.billDate) : "—"} · due {bill.dueDate ? formatCalendarDay(bill.dueDate) : "—"}
        </p>
        {detail.purchaseOrderNumber ? (
          <p className="mt-2 text-sm">
            Linked to <Link href={`/purchase-orders/${detail.purchaseOrderId}`} className="underline">{detail.purchaseOrderNumber}</Link>
          </p>
        ) : null}
        {detail.poWarning ? (
          <p role="status" className="mt-2 text-sm text-copper">
            {detail.poWarning}
          </p>
        ) : null}
        {detail.memo ? <p className="mt-2 text-sm">{detail.memo}</p> : null}
        {detail.voidReason ? <p className="mt-2 text-sm">Voided: {detail.voidReason}</p> : null}
        {bill.status === "paid" ? (
          <p className="mt-2 text-sm">
            Paid {detail.paidAt ? formatCalendarDay(detail.paidAt) : ""} · {detail.payMethod} · {detail.payReference}
          </p>
        ) : null}
      </div>
      {waivers ? (
        <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10" aria-label="Lien waivers">
          <h2 className="font-medium">Lien waiver</h2>
          {waivers.lines.length === 0 ? <p className="mt-2 text-sm">Missing</p> : null}
          <ul className="mt-2 space-y-2 text-sm">
            {waivers.lines.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2">
                <span>{row.typeLabel}</span>
                {row.pending ? <span className="fl-pill">{row.statusLabel}</span> : <span>{row.statusLabel}</span>}
                {row.signedAt ? <span className="num">{formatCalendarDay(row.signedAt.slice(0, 10))}</span> : null}
                <Link href={row.href}>Print</Link>
                {office && row.pending ? (
                  <ActionForm action={uploadWaiverAction.bind(null, row.id)} className="flex flex-wrap items-center gap-2">
                    <FileButton name="file" label={`Paper ${row.typeLabel}`} accept="image/jpeg,image/png,image/webp,application/pdf" empty="File" />
                    <Button type="submit" variant="outline" className="h-8">
                      Mark signed
                    </Button>
                  </ActionForm>
                ) : null}
                {office && row.pending ? (
                  <ActionForm action={voidWaiverAction.bind(null, row.id)}>
                    <input type="hidden" name="projectId" value={bill.projectId} />
                    <input type="hidden" name="billId" value={bill.id} />
                    <Button type="submit" variant="outline" className="h-8">
                      Void
                    </Button>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
          {office && bill.status !== "void" ? (
            <ActionForm action={requestWaiverAction.bind(null, bill.id)} className="mt-3 grid gap-2 sm:grid-cols-3">
              <input type="hidden" name="projectId" value={bill.projectId} />
              <label className="text-sm">
                Type
                <select name="type" aria-label="Waiver type" className="field mt-1" defaultValue="conditional_progress">
                  {WAIVER_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {waiverTypeLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Amount
                <input name="amount" aria-label="Waiver amount" defaultValue={(bill.amountCents / 100).toFixed(2)} className="field mt-1" />
              </label>
              <label className="text-sm">
                Through
                <input name="throughDate" type="date" aria-label="Through date" defaultValue={bill.billDate ?? ""} className="field mt-1" />
              </label>
              <Button type="submit" className="h-11 sm:col-span-3">
                Request waiver
              </Button>
            </ActionForm>
          ) : null}
          {office && waivers.offer ? (
            <ActionForm action={requestUnconditionalAction.bind(null, bill.id)} className="mt-3">
              <input type="hidden" name="projectId" value={bill.projectId} />
              <Button type="submit" className="h-11">
                {waivers.offer.label}
              </Button>
            </ActionForm>
          ) : null}
        </section>
      ) : null}
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">Lines</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {lines.map((line) => (
            <li key={line.id} className="flex justify-between gap-2">
              <span>
                {line.costCode}
                {line.description ? ` · ${line.description}` : ""}
                {line.costItemId ? "" : " · not on the job yet"}
              </span>
              <span>{formatMoney(line.amountCents)}</span>
            </li>
          ))}
        </ul>
      </section>
      {office && bill.lowConfidence && bill.status === "draft" ? (
        <ActionForm action={confirmBillAction.bind(null, bill.id)} className="rounded-xl bg-accent p-4 ring-1 ring-copper/40">
          <input type="hidden" name="projectId" value={bill.projectId} />
          <p className="text-sm">This read stays a draft until someone confirms the vendor, date, and lines.</p>
          <Button type="submit" variant="outline" className="mt-3 h-11">
            Confirm this read
          </Button>
        </ActionForm>
      ) : null}
      {office && bill.status === "draft" && !bill.lowConfidence ? (
        <ActionForm action={approveBillAction.bind(null, bill.id)}>
          <input type="hidden" name="projectId" value={bill.projectId} />
          <Button type="submit" className="h-11">
            Approve bill
          </Button>
        </ActionForm>
      ) : null}
      {office && bill.status === "approved" ? (
        <div className="grid gap-4">
          <ActionForm action={payBillAction.bind(null, bill.id)} className="grid gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:grid-cols-3">
            <input type="hidden" name="projectId" value={bill.projectId} />
            <p className="text-sm font-medium sm:col-span-3">Mark paid. This records the date, method, and reference. It does not send a payment.</p>
            <label className="text-sm">
              Paid on
              <input name="paidOn" type="date" aria-label="Paid on" className="field mt-1" required />
            </label>
            <label className="text-sm">
              Method
              <select name="method" aria-label="Payment method" className="field mt-1" defaultValue="check">
                <option value="check">Check</option>
                <option value="ach">ACH</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="text-sm">
              Reference
              <input name="reference" aria-label="Payment reference" placeholder="Check number" className="field mt-1" required />
            </label>
            <Button type="submit" className="h-11 sm:col-span-3">
              Mark paid
            </Button>
          </ActionForm>
          <ActionForm action={unapproveBillAction.bind(null, bill.id)} className="flex flex-col gap-2">
            <input type="hidden" name="projectId" value={bill.projectId} />
            <label className="text-sm">
              Reason to move back to draft
              <input name="reason" aria-label="Reason to unapprove" className="field mt-1" required />
            </label>
            <Button type="submit" variant="outline" className="h-11">
              Unapprove
            </Button>
          </ActionForm>
        </div>
      ) : null}
      {office && bill.status !== "void" ? (
        <ActionForm action={voidBillAction.bind(null, bill.id)} className="flex flex-col gap-2">
          <input type="hidden" name="projectId" value={bill.projectId} />
          <label className="text-sm">
            Void reason
            <input name="reason" aria-label="Void reason" className="field mt-1" required />
          </label>
          <Button type="submit" variant="outline" className="h-11">
            Void bill
          </Button>
        </ActionForm>
      ) : null}
      <section>
        <h2 className="font-medium">History</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {events.map((event) => (
            <li key={event.id}>
              <span className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</span>
              <p>
                {event.type}
                {event.reason ? ` · ${event.reason}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <CommentThread entityType="bill" entityId={bill.id} />
    </div>
  );
}
