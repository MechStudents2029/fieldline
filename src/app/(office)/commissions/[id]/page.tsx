import Link from "next/link";
import { notFound } from "next/navigation";
import { markCommissionAction } from "@/app/(office)/commissions/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { commissionDetail } from "@/lib/services/commissions";

export default async function CommissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const row = commissionDetail(session, id);
  if (!row) notFound();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar title={row.person} subtitle={row.statusLabel} search={false} leading={<Link href="/commissions">Commissions</Link>} />
      <div className="flex flex-col gap-4 overflow-auto px-4 pb-10 md:px-6">
        <p className="text-[13px]">
          {row.job} · {row.milestone}
          {row.seat ? ` · ${row.seat}` : ""} · <span className="fl-pill">{row.statusLabel}</span>
        </p>
        <dl className="grid max-w-md grid-cols-2 gap-3 text-[13px]">
          <div>
            <dt>Basis</dt>
            <dd className="num">{formatMoney(row.basisCents)}</dd>
          </div>
          <div>
            <dt>Rate</dt>
            <dd className="num">{(row.rateBps / 100).toFixed(row.rateBps % 100 === 0 ? 0 : 1)}%</dd>
          </div>
          <div>
            <dt>Earned</dt>
            <dd className="num">{formatMoney(row.earnedCents)}</dd>
          </div>
          <div>
            <dt>Delta</dt>
            <dd className="num">{formatMoney(row.deltaCents)}</dd>
          </div>
        </dl>
        {row.fallback ? <p className="text-[13px]">Contract, no job cost</p> : null}
        {row.canEdit && row.status === "owed" ? (
          <ActionForm action={markCommissionAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="action" value="paid" />
            <button type="submit" className="mac-glass-btn">
              Mark paid
            </button>
          </ActionForm>
        ) : null}
        {row.canEdit && row.status !== "void" ? (
          <ActionForm action={markCommissionAction}>
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="action" value="void" />
            <button type="submit" className="mac-glass-btn">
              Void
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
