import { savePurchaseOrderAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";

type Choice = { id: string; label: string };

export function PurchaseOrderForm({
  projects,
  vendors,
  orders,
  codes,
  defaults,
  lockJob,
}: {
  projects: Choice[];
  vendors: Choice[];
  orders: Choice[];
  codes: string[];
  lockJob?: boolean;
  defaults?: {
    id?: string;
    projectId?: string;
    vendorContactId?: string;
    scope?: string | null;
    changeOrderId?: string | null;
    lines?: { description: string | null; costCode: string; amountCents: number }[];
  };
}) {
  const lines = [...(defaults?.lines ?? []), { description: "", costCode: "", amountCents: 0 }, { description: "", costCode: "", amountCents: 0 }, { description: "", costCode: "", amountCents: 0 }].slice(0, 4);
  return (
    <ActionForm action={savePurchaseOrderAction} className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:grid-cols-2">
      {defaults?.id ? <input type="hidden" name="purchaseOrderId" value={defaults.id} /> : null}
      <label className="text-sm">
        Job
        <select name="projectId" aria-label="Job" className="field mt-1" defaultValue={defaults?.projectId ?? ""} required disabled={lockJob}>
          <option value="">Choose a job</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.label}
            </option>
          ))}
        </select>
      </label>
      {lockJob ? <input type="hidden" name="projectId" value={defaults?.projectId ?? ""} /> : null}
      <label className="text-sm">
        Sub or vendor
        <select name="vendorContactId" aria-label="Sub or vendor" className="field mt-1" defaultValue={defaults?.vendorContactId ?? ""} required disabled={lockJob}>
          <option value="">Choose a contact</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.label}
            </option>
          ))}
        </select>
      </label>
      {lockJob ? <input type="hidden" name="vendorContactId" value={defaults?.vendorContactId ?? ""} /> : null}
      <label className="text-sm sm:col-span-2">
        Scope
        <textarea name="scope" aria-label="Scope" rows={3} defaultValue={defaults?.scope ?? ""} placeholder="What this order covers" className="mt-1 w-full rounded-lg border border-input bg-background p-3" />
      </label>
      <label className="text-sm sm:col-span-2">
        Change order
        <select name="changeOrderId" aria-label="Change order" className="field mt-1" defaultValue={defaults?.changeOrderId ?? ""}>
          <option value="">None</option>
          {orders.map((order) => (
            <option key={order.id} value={order.id}>
              {order.label}
            </option>
          ))}
        </select>
      </label>
      <div className="sm:col-span-2">
        <p className="text-sm font-medium">Lines</p>
        <datalist id="po-codes">
          {codes.map((code) => (
            <option key={code} value={code} />
          ))}
        </datalist>
        <div className="mt-2 flex flex-col gap-2">
          {lines.map((line, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-3">
              <input name="description" aria-label={`Line ${index + 1} description`} defaultValue={line.description ?? ""} placeholder="Description" className="field" />
              <input name="costCode" aria-label={`Line ${index + 1} cost code`} list="po-codes" defaultValue={line.costCode} placeholder="Cost code" className="field" />
              <input
                name="amount"
                aria-label={`Line ${index + 1} amount`}
                defaultValue={line.amountCents ? (line.amountCents / 100).toFixed(2) : ""}
                inputMode="decimal"
                placeholder="Amount"
                className="field"
              />
            </div>
          ))}
        </div>
      </div>
      <Button type="submit" className="h-11 sm:col-span-2">
        {defaults?.id ? "Save revision" : "Save draft"}
      </Button>
    </ActionForm>
  );
}
