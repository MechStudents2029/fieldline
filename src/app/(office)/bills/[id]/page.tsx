import Link from "next/link";
import { approveBillAction, confirmBillAction, payBillAction, unapproveBillAction, voidBillAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { MissingRecord } from "@/components/missing-record";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { canManageMoney, canSeeMoney } from "@/lib/permissions";
import { billDetail } from "@/lib/services/bills";

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return <p className="rounded-xl bg-muted p-4 text-sm">Bills are for the office.</p>;
  }
  const detail = billDetail(session.orgId, id, session.role);
  if (!detail) return <MissingRecord orgName={session.orgName} kind="bill" />;
  const { bill, lines, events } = detail;
  const office = canManageMoney(session.role);
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
        <p className="text-sm text-muted-foreground">
          Bill date {bill.billDate ? formatCalendarDay(bill.billDate) : "—"} · due {bill.dueDate ? formatCalendarDay(bill.dueDate) : "—"}
        </p>
        {detail.memo ? <p className="mt-2 text-sm">{detail.memo}</p> : null}
        {detail.voidReason ? <p className="mt-2 text-sm">Voided: {detail.voidReason}</p> : null}
        {bill.status === "paid" ? (
          <p className="mt-2 text-sm">
            Paid {detail.paidAt ? formatCalendarDay(detail.paidAt) : ""} · {detail.payMethod} · {detail.payReference}. Nothing was sent to a bank.
          </p>
        ) : null}
      </div>
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
    </div>
  );
}
