import Link from "next/link";
import { notFound } from "next/navigation";
import { approveMileageAction, rejectMileageAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { MileageForm } from "@/components/mileage-form";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { canManageMoney } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import { mileageDetail, mileageJobs, mileagePeople } from "@/lib/services/mileage";

export default async function MileageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  let trip: ReturnType<typeof mileageDetail>;
  try {
    trip = mileageDetail(session, id);
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
  const office = canManageMoney(session.role);
  const where = [trip.projectName, trip.tripOn, trip.personName, trip.fromText && trip.toText ? `${trip.fromText} → ${trip.toText}` : trip.fromText || trip.toText]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4 md:px-6">
      <Link href={`/mileage?status=${trip.status}`} className="text-sm">
        Mileage
      </Link>
      <article className="flex flex-col gap-3" data-trip-detail={trip.id} data-status={trip.status} data-amount={trip.amountCents} data-purpose={trip.purpose}>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="fl-title">{trip.purpose}</h1>
          <span className="num">{trip.business ? formatMoney(trip.amountCents) : "—"}</span>
          <span className="fl-pill">{trip.statusLabel}</span>
          <span className="fl-pill">{trip.business ? "Business" : "Personal"}</span>
        </div>
        <p className="num">{trip.milesLabel}</p>
        {trip.rateLabel ? <p className="num">{trip.rateLabel}</p> : null}
        <p className="text-sm text-[var(--fl-secondary)]">{where}</p>
        {trip.rejectNote ? (
          <p className="text-sm" data-reject-note>
            {trip.rejectNote}
          </p>
        ) : null}
        {trip.reimbursedAt ? (
          <p className="text-sm">
            <span className="fl-pill">Reimbursed</span> <span className="num">{trip.reimbursedAt.slice(0, 10)}</span>
            {trip.reimbursedByName ? ` · ${trip.reimbursedByName}` : ""}
          </p>
        ) : null}
        {trip.canApprove ? (
          <ActionForm action={approveMileageAction.bind(null, trip.id)}>
            <Button type="submit" className="h-11">
              Approve
            </Button>
          </ActionForm>
        ) : null}
        {trip.canReject ? (
          <ActionForm action={rejectMileageAction.bind(null, trip.id)} className="grid gap-2">
            <label className="text-sm">
              Note
              <input name="note" aria-label="Note" className="field mt-1" required />
            </label>
            <Button type="submit" variant="outline" className="h-11">
              Reject
            </Button>
          </ActionForm>
        ) : null}
      </article>
      {trip.canEdit ? <MileageForm jobs={mileageJobs(session.orgId)} people={office ? mileagePeople(session) : undefined} trip={trip} /> : null}
    </div>
  );
}
