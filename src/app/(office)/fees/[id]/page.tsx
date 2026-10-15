import Link from "next/link";
import { notFound } from "next/navigation";
import { applyLateFeeAction, waiveLateFeeAction } from "@/app/(office)/fees/actions";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { lateFeeDetail } from "@/lib/services/late-fees";
import { ServiceError } from "@/lib/services/errors";

export default async function FeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) notFound();
  const { id } = await params;
  let fee: ReturnType<typeof lateFeeDetail>;
  try {
    fee = lateFeeDetail(session, id);
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4">
      <Link href="/fees" className="text-sm">
        Fees
      </Link>
      <article className="flex flex-col gap-3" data-fee-detail={fee.id} data-status={fee.status}>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="fl-title">{fee.number}</h1>
          <span className="fl-pill">{fee.status === "pending" ? "Pending" : fee.status === "applied" ? "Applied" : "Waived"}</span>
        </div>
        <p className="text-sm text-[var(--fl-secondary)]">{fee.client}</p>
        <p className="num">{formatMoney(fee.amountCents)}</p>
        <p className="num text-[var(--fl-secondary)]">{fee.period}</p>
        {fee.reason ? (
          <p className="text-sm" data-reason>
            {fee.reason}
          </p>
        ) : null}
        <Link href={`/invoices/${fee.invoiceId}`}>{fee.number}</Link>
      </article>
      {fee.canEdit && fee.status === "pending" ? (
        <ActionForm action={applyLateFeeAction.bind(null, fee.id)}>
          <Button type="submit" className="h-11">
            Apply
          </Button>
        </ActionForm>
      ) : null}
      {fee.canEdit && fee.status !== "waived" ? (
        <ActionForm action={waiveLateFeeAction.bind(null, fee.id)} className="flex flex-col gap-2">
          <label className="text-sm">
            Reason
            <input name="reason" aria-label="Reason" required className="field mt-1" />
          </label>
          <Button type="submit" variant="outline" className="h-11">
            Waive
          </Button>
        </ActionForm>
      ) : null}
    </div>
  );
}
