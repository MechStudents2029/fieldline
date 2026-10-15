import { notFound } from "next/navigation";
import { markNecRequestedAction } from "@/app/(office)/reports/nec/actions";
import { ActionForm } from "@/components/action-form";
import { NecCopy } from "@/components/nec-copy";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatMoney, formatWhole } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { currentNecYear, necReport, type NecRow } from "@/lib/services/nec1099";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || "";
}

function statusPills(row: NecRow) {
  const pills: string[] = [];
  if (row.exempt) pills.push("Exempt");
  if (row.cardCents > 0) pills.push("Card");
  if (!row.exempt && row.cardCents === 0) pills.push(row.over ? "Over" : "Under");
  return pills;
}

export default async function NecPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) notFound();
  const params = await searchParams;
  const raw = one(params.year);
  const year = raw ? Number(raw) : currentNecYear(session.orgId);
  const report = necReport(session, Number.isFinite(year) ? year : currentNecYear(session.orgId));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title="1099"
        subtitle={formatWhole(report.thresholdCents)}
        search={false}
        trailing={
          <span className="flex items-center gap-2">
            <form method="get" className="flex items-center gap-2">
              <select name="year" aria-label="Year" className="ctl" defaultValue={String(report.year)}>
                {report.years.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <button type="submit" className="ctl">
                Show
              </button>
            </form>
            <a className="mac-glass-btn" href={`/api/export/nec?year=${report.year}`}>
              CSV
            </a>
          </span>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto" data-mac-list>
        <table className="mac-table" aria-label="1099">
          <thead>
            <tr>
              <th>Vendor</th>
              <th className="text-right">Paid</th>
              <th className="text-right">Box 1</th>
              <th>W-9</th>
              <th>TIN</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr
                key={row.contactId}
                data-vendor={row.name}
                data-box1={row.box1Cents}
                data-paid={row.paidCents}
                data-w9={row.w9}
                data-over={row.over ? "1" : "0"}
                data-exempt={row.exempt ? "1" : "0"}
                data-card={row.cardCents > 0 ? "1" : "0"}
              >
                <td>
                  {row.name}
                  {statusPills(row).map((pill) => (
                    <span key={pill} className="fl-pill ml-2">
                      {pill}
                    </span>
                  ))}
                </td>
                <td className="num text-right">{formatMoney(row.paidCents)}</td>
                <td className={row.over ? "num text-right text-[var(--mac-accent)]" : "num text-right"}>{formatMoney(row.box1Cents)}</td>
                <td>
                  <span className="fl-pill">{row.w9Label}</span>
                </td>
                <td className="num">{row.tinMask || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="mac-table mt-6" aria-label="Needs W-9">
          <thead>
            <tr>
              <th>Needs W-9</th>
              <th className="text-right">Box 1</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {report.needs.map((row) => (
              <tr key={row.contactId} data-needs={row.name} data-box1={row.box1Cents}>
                <td>
                  {row.name}
                  {row.requested ? <span className="fl-pill ml-2">Requested</span> : null}
                </td>
                <td className="num text-right text-[var(--mac-accent)]">{formatMoney(row.box1Cents)}</td>
                <td className="text-right">
                  <span className="inline-flex items-center justify-end gap-2">
                    {row.portalUrl ? <NecCopy url={row.portalUrl} /> : null}
                    {report.canEdit && !row.requested ? (
                      <ActionForm action={markNecRequestedAction} className="inline-flex">
                        <input type="hidden" name="contactId" value={row.contactId} />
                        <input type="hidden" name="year" value={report.year} />
                        <button type="submit" className="mac-glass-btn">
                          Mark requested
                        </button>
                      </ActionForm>
                    ) : null}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
