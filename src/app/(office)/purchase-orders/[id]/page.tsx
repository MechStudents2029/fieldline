import { CommentThread } from "@/components/comment-thread";
import { MissingRecord } from "@/components/missing-record";
import { LinkedRfis } from "@/components/linked-rfis";
import { PurchaseOrderDetail } from "@/components/purchase-order-detail";
import { requireSession } from "@/lib/auth/session";
import { canManageMoney, canSeeMoney } from "@/lib/permissions";
import { poReceiving } from "@/lib/receiving/facts";
import { canBillReceived, companyToday, receiveChoices } from "@/lib/services/receiving";
import { changeOrderChoices, purchaseOrderDetail } from "@/lib/services/purchase-orders";
import { poRetainage } from "@/lib/services/pay-ready";
import { officeTargetPlans, planChoices } from "@/lib/services/files";
import { relatedRfis } from "@/lib/services/rfis";
import { listContacts, listPriceBook, listProjects } from "@/lib/services/read";
import { creditableReceiptIds, poFactsFor } from "@/lib/services/vendor-credits";
import { stockPlaces } from "@/lib/services/inventory";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return <h1 className="fl-large-title">Purchase orders</h1>;
  }
  const detail = purchaseOrderDetail(session.orgId, id, session.role);
  if (!detail) return <MissingRecord orgName={session.orgName} kind="purchase order" />;
  const office = canManageMoney(session.role);
  const projects = listProjects(session.orgId).map((row) => ({ id: row.project.id, label: row.project.name }));
  const vendors = listContacts(session.orgId)
    .filter((contact) => contact.type === "sub" || contact.type === "vendor")
    .map((contact) => ({ id: contact.id, label: contact.company || contact.name }));
  const retainage = poRetainage(session.orgId, detail.po.id);
  const billed = detail.lines.reduce((sum, line) => sum + line.billedCents, 0);
  const facts = poFactsFor(session.orgId, detail.po, billed);
  const creditable = [...creditableReceiptIds(session.orgId)];
  return (
    <div className="flex flex-col gap-4">
      <div className="px-4 pt-3">
        <LinkedRfis rows={relatedRfis(session, "purchase_order", detail.po.id)} />
      </div>
      <PurchaseOrderDetail
        po={detail.po}
        scope={detail.scope}
        voidReason={detail.voidReason}
        acceptedName={detail.acceptedName}
        declineReason={detail.declineReason}
        changeOrderId={detail.changeOrderId}
        changeOrderLabel={detail.changeOrderLabel}
        lines={detail.lines.map((line) => {
          const extra = line as typeof line & {
            qtyMilli?: number | null;
            unitCostCents?: number | null;
            sourceKind?: string;
            sourceId?: string;
            note?: string | null;
          };
          return {
            id: extra.id ?? extra.costCode,
            costCode: extra.costCode,
            description: extra.description,
            amountCents: extra.amountCents,
            billedCents: extra.billedCents,
            remainingCents: extra.remainingCents,
            qtyMilli: extra.qtyMilli ?? null,
            unitCostCents: extra.unitCostCents ?? null,
            sourceKind: extra.sourceKind ?? "",
            sourceId: extra.sourceId ?? "",
            note: extra.note ?? null,
          };
        })}
        bills={detail.bills}
        events={detail.events.map((event) => ({ id: event.id, type: event.type, reason: event.reason, createdAt: event.createdAt }))}
        retainage={retainage}
        plans={officeTargetPlans(session, "purchase_order", detail.po.id)}
        planChoices={planChoices(session, detail.po.projectId)}
        projects={projects}
        vendors={vendors}
        orders={changeOrderChoices(session.orgId)}
        codes={listPriceBook(session.orgId).map((item) => item.code)}
        office={office}
        receiving={{
          label: poReceiving(session.orgId, detail.po.id).label,
          lines: poReceiving(session.orgId, detail.po.id).lines.map((line) => ({
            id: line.id,
            text: line.text,
            expectedOn: line.expectedOn,
            label: line.label,
          })),
          receipts: poReceiving(session.orgId, detail.po.id).receipts,
          choices: session.role === "viewer" ? [] : receiveChoices(session).filter((order) => order.id === detail.po.id),
          today: companyToday(session.orgId),
          canBill: office && canBillReceived(session.orgId, detail.po.id),
          places: stockPlaces(session.orgId),
        }}
        facts={facts}
        creditableReceipts={creditable}
      />
      <div className="max-w-md px-4">
        <CommentThread entityType="purchase_order" entityId={detail.po.id} />
      </div>
    </div>
  );
}
