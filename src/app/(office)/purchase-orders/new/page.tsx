import { PurchaseOrderForm } from "@/components/purchase-order-form";
import { requireSession } from "@/lib/auth/session";
import { canManageMoney, canSeeMoney } from "@/lib/permissions";
import { changeOrderChoices } from "@/lib/services/purchase-orders";
import { listContacts, listPriceBook, listProjects } from "@/lib/services/read";

export default async function NewPurchaseOrderPage() {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return <h1 className="fl-large-title">Purchase orders</h1>;
  }
  if (!canManageMoney(session.role)) {
    return <p className="rounded-xl bg-muted p-4 text-sm">Your role can view purchase orders, not enter them.</p>;
  }
  const projects = listProjects(session.orgId).map((row) => ({ id: row.project.id, label: row.project.name }));
  const vendors = listContacts(session.orgId)
    .filter((contact) => contact.type === "sub" || contact.type === "vendor")
    .map((contact) => ({ id: contact.id, label: contact.company || contact.name }));
  const orders = changeOrderChoices(session.orgId);
  const codes = listPriceBook(session.orgId).map((item) => item.code);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-3xl">New purchase order</h1>
        <p className="text-sm text-muted-foreground">A draft does not commit cost. Issuing it does. The number is assigned when you save, and it is not reused.</p>
      </div>
      <PurchaseOrderForm projects={projects} vendors={vendors} orders={orders} codes={codes} />
    </div>
  );
}
