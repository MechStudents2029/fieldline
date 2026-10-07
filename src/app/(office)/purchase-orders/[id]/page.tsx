import Link from "next/link";
import { closePurchaseOrderAction, issuePurchaseOrderAction, voidPurchaseOrderAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CommentThread } from "@/components/comment-thread";
import { MissingRecord } from "@/components/missing-record";
import { LinkedRfis } from "@/components/linked-rfis";
import { PurchaseOrderForm } from "@/components/purchase-order-form";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { canManageMoney, canSeeMoney } from "@/lib/permissions";
import { changeOrderChoices, purchaseOrderDetail } from "@/lib/services/purchase-orders";
import { relatedRfis } from "@/lib/services/rfis";
import { listContacts, listPriceBook, listProjects } from "@/lib/services/read";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return <h1 className="fl-large-title">Purchase orders</h1>;
  }
  const detail = purchaseOrderDetail(session.orgId, id, session.role);
  if (!detail) return <MissingRecord orgName={session.orgName} kind="purchase order" />;
  const { po, lines, events } = detail;
  const office = canManageMoney(session.role);
  const editable = office && (po.status === "draft" || po.status === "issued");
  const projects = listProjects(session.orgId).map((row) => ({ id: row.project.id, label: row.project.name }));
  const vendors = listContacts(session.orgId)
    .filter((contact) => contact.type === "sub" || contact.type === "vendor")
    .map((contact) => ({ id: contact.id, label: contact.company || contact.name }));
  return (
    <div className="flex flex-col gap-5">
      <LinkedRfis rows={relatedRfis(session, "purchase_order", po.id)} />
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{po.status}</p>
        <h1 className="font-heading text-3xl">{po.number}</h1>
        <p className="text-sm">
          {po.vendorName} · <Link href={`/projects/${po.projectId}`} className="underline">{po.projectName}</Link>
        </p>
        <p className="mt-2 font-heading text-3xl">{formatMoney(po.amountCents)}</p>
        {po.status === "issued" ? <p className="text-sm">Open commitment {formatMoney(po.openCents)}</p> : null}
        {po.status === "closed" ? <p className="text-sm">Closed. Unbilled balance is no longer committed.</p> : null}
        {detail.scope ? <p className="mt-2 text-sm">{detail.scope}</p> : null}
        {detail.changeOrderLabel ? <p className="mt-2 text-sm">Tied to {detail.changeOrderLabel}. The order does not change the budget by itself.</p> : null}
        {detail.voidReason ? <p className="mt-2 text-sm">Voided: {detail.voidReason}</p> : null}
        {detail.acceptedName ? <p className="mt-2 text-sm">Accepted · {detail.acceptedName}</p> : null}
        {detail.declineReason ? <p className="mt-2 text-sm">Declined · {detail.declineReason}</p> : null}
        <p className="mt-3">
          <Link href={`/purchase-orders/${po.id}/print`} className="text-sm underline">
            Printable view
          </Link>
        </p>
      </div>
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">Lines</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {lines.map((line) => (
            <li key={line.id} className="flex justify-between gap-2">
              <span>
                {line.costCode}
                {line.description ? ` · ${line.description}` : ""}
              </span>
              <span>{formatMoney(line.amountCents)}</span>
            </li>
          ))}
        </ul>
      </section>
      {office && po.status === "draft" ? (
        <ActionForm action={issuePurchaseOrderAction.bind(null, po.id)}>
          <input type="hidden" name="projectId" value={po.projectId} />
          <Button type="submit" className="h-11">
            Issue purchase order
          </Button>
        </ActionForm>
      ) : null}
      {office && po.status === "issued" ? (
        <ActionForm action={closePurchaseOrderAction.bind(null, po.id)}>
          <input type="hidden" name="projectId" value={po.projectId} />
          <Button type="submit" variant="outline" className="h-11">
            Close purchase order
          </Button>
        </ActionForm>
      ) : null}
      {editable ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">{po.status === "issued" ? "Revise" : "Edit draft"}</h2>
          {po.status === "issued" ? (
            <p className="text-sm text-muted-foreground">Saving keeps the previous lines in the history. The job and vendor stay put.</p>
          ) : null}
          <PurchaseOrderForm
            projects={projects}
            vendors={vendors}
            orders={changeOrderChoices(session.orgId)}
            codes={listPriceBook(session.orgId).map((item) => item.code)}
            lockJob={po.status === "issued"}
            defaults={{
              id: po.id,
              projectId: po.projectId,
              vendorContactId: po.vendorContactId,
              scope: detail.scope,
              changeOrderId: detail.changeOrderId,
              lines,
            }}
          />
        </section>
      ) : null}
      {office && po.status !== "void" ? (
        <ActionForm action={voidPurchaseOrderAction.bind(null, po.id)} className="grid gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <input type="hidden" name="projectId" value={po.projectId} />
          <label className="text-sm">
            Void reason
            <input name="reason" aria-label="Void reason" className="field mt-1" required />
          </label>
          <Button type="submit" variant="outline" className="h-11">
            Void purchase order
          </Button>
        </ActionForm>
      ) : null}
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">History</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {events.map((event) => (
            <li key={event.id}>
              <span className="capitalize">{event.type}</span>
              {event.reason ? ` · ${event.reason}` : ""} · {formatDateTime(event.createdAt)}
            </li>
          ))}
        </ul>
      </section>
      <CommentThread entityType="purchase_order" entityId={po.id} />
    </div>
  );
}
