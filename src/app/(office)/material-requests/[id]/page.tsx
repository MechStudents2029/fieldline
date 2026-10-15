import Link from "next/link";
import { notFound } from "next/navigation";
import { approveMaterialRequestAction, fulfillMaterialRequestAction, orderMaterialRequestAction, rejectMaterialRequestAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { MaterialRequestForm } from "@/components/material-request-form";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { canManageMoney } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import {
  materialCodes,
  materialDetail,
  materialJobs,
  materialPeople,
  materialPlaces,
  materialStock,
  materialVendors,
} from "@/lib/services/material-requests";

export default async function MaterialRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  let request: ReturnType<typeof materialDetail>;
  try {
    request = materialDetail(session, id);
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
  const office = canManageMoney(session.role);
  const places = request.canFulfill ? materialPlaces(session.orgId) : [];
  const vendors = request.canOrder ? materialVendors(session.orgId) : [];
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4 md:px-6">
      <Link href={`/material-requests?status=${request.status}`} className="text-sm">
        Materials
      </Link>
      <article className="flex flex-col gap-3" data-request-detail={request.id} data-status={request.status} data-urgency={request.urgency}>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="fl-title">{request.title}</h1>
          <span className="num">{request.qtyLabel}</span>
          <span className="fl-pill">{request.statusLabel}</span>
          {request.urgency === "urgent" ? <span className="fl-pill">Urgent</span> : null}
          {request.duplicateId ? (
            <Link href={`/material-requests/${request.duplicateId}`} className="fl-pill" data-duplicate>
              Duplicate
            </Link>
          ) : null}
        </div>
        <p className="text-sm text-[var(--fl-secondary)]">
          {request.projectName} · {request.personName}
        </p>
        <ul className="fl-group">
          {request.lines.map((line) => (
            <li key={line.id} className="fl-cell">
              <span className="min-w-0 flex-1 truncate">{line.sku ? `${line.sku} · ${line.description}` : line.description}</span>
              <span className="num">{line.qtyLabel}</span>
            </li>
          ))}
        </ul>
        {request.note ? <p className="text-sm">{request.note}</p> : null}
        {request.rejectNote ? (
          <p className="text-sm" data-reject-note>
            {request.rejectNote}
          </p>
        ) : null}
        {request.purchaseOrderId && request.purchaseOrderNumber ? (
          <p className="text-sm">
            <Link href={`/purchase-orders/${request.purchaseOrderId}`} data-po>
              {request.purchaseOrderNumber}
            </Link>
          </p>
        ) : null}
        {request.canApprove ? (
          <ActionForm action={approveMaterialRequestAction.bind(null, request.id)}>
            <Button type="submit" className="h-11">
              Approve
            </Button>
          </ActionForm>
        ) : null}
        {request.canReject ? (
          <ActionForm action={rejectMaterialRequestAction.bind(null, request.id)} className="grid gap-2">
            <label className="text-sm">
              Note
              <input name="note" aria-label="Reject note" className="field mt-1" required />
            </label>
            <Button type="submit" variant="outline" className="h-11">
              Reject
            </Button>
          </ActionForm>
        ) : null}
        {request.canFulfill ? (
          <ActionForm action={fulfillMaterialRequestAction.bind(null, request.id)} className="grid gap-2">
            <label className="text-sm">
              Place
              <select name="locationId" aria-label="Place" className="field mt-1" defaultValue={places[0]?.id ?? ""}>
                {places.map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" className="h-11">
              Fulfill
            </Button>
          </ActionForm>
        ) : null}
        {request.canOrder ? (
          <ActionForm action={orderMaterialRequestAction.bind(null, request.id)} className="grid gap-2">
            <label className="text-sm">
              Vendor
              <select name="vendorContactId" aria-label="Vendor" className="field mt-1" defaultValue={vendors[0]?.id ?? ""}>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" className="h-11">
              Order
            </Button>
          </ActionForm>
        ) : null}
      </article>
      {request.canEdit ? (
        <MaterialRequestForm
          jobs={materialJobs(session.orgId)}
          stock={materialStock(session.orgId)}
          codes={materialCodes(session.orgId)}
          people={office ? materialPeople(session) : undefined}
          request={request}
        />
      ) : null}
    </div>
  );
}
