"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { closePurchaseOrderAction, issuePurchaseOrderAction, referencePlanAction, releasePoRetainageAction, saveBillAction, voidPurchaseOrderAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { DetailFacts, DetailHeader, recordStatus } from "@/components/detail-header";
import { PurchaseOrderForm } from "@/components/purchase-order-form";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { overRemainingMessage } from "@/lib/bills/from-po";
import { netPayableCents, retainedCents } from "@/lib/bills/retainage";
import { formatCalendarDay, formatDateTime } from "@/lib/format";
import { formatMoney, parseMoneyToCents } from "@/lib/money";

type Choice = { id: string; label: string };
type Line = { id: string; costCode: string; description: string | null; amountCents: number; billedCents: number; remainingCents: number };
type Bill = { id: string; billNumber: string; billDate: string | null; status: string; amountCents: number; retainageCents: number; netCents: number };
type EventRow = { id: string; type: string; reason: string | null; createdAt: string };
type Plan = { documentId: string; name: string; revision: number };
type PlanChoice = { groupId: string; name: string };

export function PurchaseOrderDetail({
  po,
  scope,
  voidReason,
  acceptedName,
  declineReason,
  changeOrderId,
  changeOrderLabel,
  lines,
  bills,
  events,
  retainage,
  plans,
  planChoices,
  projects,
  vendors,
  orders,
  codes,
  office,
}: {
  po: {
    id: string;
    number: string;
    projectId: string;
    projectName: string;
    vendorContactId: string;
    vendorName: string;
    status: string;
    amountCents: number;
    openCents: number;
    retainageBps: number;
  };
  scope: string | null;
  voidReason: string | null;
  acceptedName: string | null;
  declineReason: string | null;
  changeOrderId: string | null;
  changeOrderLabel: string | null;
  lines: Line[];
  bills: Bill[];
  events: EventRow[];
  retainage: { bps: number; retainedCents: number; releasedCents: number; canRelease: boolean; releaseId: string | null; releaseNumber: string | null } | null;
  plans: Plan[];
  planChoices: PlanChoice[];
  projects: Choice[];
  vendors: Choice[];
  orders: Choice[];
  codes: string[];
  office: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [billing, setBilling] = useState(false);
  const [more, setMore] = useState(false);
  const editable = office && (po.status === "draft" || po.status === "issued");
  const billed = lines.reduce((sum, line) => sum + line.billedCents, 0);
  const prefill = lines.filter((line) => line.remainingCents > 0);
  return (
    <div className="flex flex-col gap-4 pb-6">
      <DetailHeader
        title={po.number}
        status={po.status}
        meta={
          <>
            {po.vendorName} · <Link href={`/projects/${po.projectId}`}>{po.projectName}</Link>
          </>
        }
        actions={
          office ? (
            <>
              {editable ? (
                <button type="button" className="ctl" onClick={() => setEditing(true)}>
                  Edit
                </button>
              ) : null}
              {po.status === "issued" || po.status === "closed" ? (
                <button type="button" className="mac-primary" onClick={() => setBilling(true)}>
                  New bill
                </button>
              ) : null}
              {po.status === "draft" ? (
                <ActionForm action={issuePurchaseOrderAction.bind(null, po.id)}>
                  <input type="hidden" name="projectId" value={po.projectId} />
                  <button type="submit" className="mac-primary">
                    Issue purchase order
                  </button>
                </ActionForm>
              ) : null}
              <Link href={`/purchase-orders/${po.id}/print`} className="ctl">
                Print
              </Link>
              {po.status !== "void" ? (
                <div className="detail-more">
                  <button type="button" className="ctl" aria-label="More" aria-expanded={more} onClick={() => setMore((open) => !open)}>
                    …
                  </button>
                  {more ? (
                  <div className="detail-more-panel">
                    {retainage?.canRelease ? (
                      <ActionForm action={releasePoRetainageAction.bind(null, po.id)}>
                        <button type="submit" className="ctl">
                          Release retainage
                        </button>
                      </ActionForm>
                    ) : null}
                    {po.status === "issued" ? (
                      <ActionForm action={closePurchaseOrderAction.bind(null, po.id)}>
                        <input type="hidden" name="projectId" value={po.projectId} />
                        <button type="submit" className="ctl">
                          Close
                        </button>
                      </ActionForm>
                    ) : null}
                    <ActionForm action={voidPurchaseOrderAction.bind(null, po.id)} className="flex flex-col gap-2">
                      <input type="hidden" name="projectId" value={po.projectId} />
                      <input name="reason" aria-label="Void reason" placeholder="Reason" className="ctl" required />
                      <button type="submit" className="ctl">
                        Void
                      </button>
                    </ActionForm>
                  </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <Link href={`/purchase-orders/${po.id}/print`} className="ctl">
              Print
            </Link>
          )
        }
      />
      <DetailFacts
        label="Purchase order"
        rows={[
          { label: "Amount", value: <span className="num">{formatMoney(po.amountCents)}</span> },
          { label: "Committed", value: <span className="num">{formatMoney(po.status === "issued" ? po.amountCents : 0)}</span> },
          { label: "Billed", value: <span className="num">{formatMoney(billed)}</span> },
          { label: "Open", value: <span className="num">{formatMoney(po.openCents)}</span> },
          { label: "Retainage", value: <span className="num">{Math.round(po.retainageBps / 100)}%</span> },
          { label: "Retained", value: <span className="num">{formatMoney(retainage?.retainedCents ?? 0)}</span> },
          {
            label: "Released",
            value: (
              <span className="num">
                {formatMoney(retainage?.releasedCents ?? 0)}
                {retainage?.releaseId && retainage.releaseNumber ? (
                  <>
                    {" "}
                    · <Link href={`/bills/${retainage.releaseId}`}>{retainage.releaseNumber}</Link>
                  </>
                ) : null}
              </span>
            ),
          },
          {
            label: "Plan",
            value: <PlanValue projectId={po.projectId} poId={po.id} plans={plans} choices={planChoices} office={office} />,
          },
          ...(scope ? [{ label: "Scope", value: scope }] : []),
          ...(changeOrderLabel ? [{ label: "Change", value: changeOrderLabel }] : []),
          ...(acceptedName ? [{ label: "Accepted", value: acceptedName }] : []),
          ...(declineReason ? [{ label: "Declined", value: declineReason }] : []),
          ...(voidReason ? [{ label: "Void", value: voidReason }] : []),
        ]}
      />
      <section className="px-4" aria-label="Lines">
        <h2 className="mac-t13 text-[var(--mac-secondary)]">Lines</h2>
        <div className="overflow-x-auto">
        <table className="mac-table" aria-label="Lines">
          <thead>
            <tr>
              <th>Cost code</th>
              <th>Description</th>
              <th className="text-right">Amount</th>
              <th className="text-right">Billed</th>
              <th className="text-right">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} data-code={line.costCode}>
                <td>{line.costCode}</td>
                <td>{line.description}</td>
                <td className="fit num text-right" data-fit="amount">{formatMoney(line.amountCents)}</td>
                <td className="fit num text-right" data-fit="amount" data-kind="billed">{formatMoney(line.billedCents)}</td>
                <td className="fit num text-right" data-fit="amount" data-kind="remaining">{formatMoney(line.remainingCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
      <section className="px-4" aria-label="Bills">
        <h2 className="mac-t13 text-[var(--mac-secondary)]">Bills</h2>
        <div className="overflow-x-auto">
        <table className="mac-table" aria-label="Bills">
          <thead>
            <tr>
              <th>Bill</th>
              <th>Date</th>
              <th>Status</th>
              <th className="text-right">Amount</th>
              <th className="text-right">Retained</th>
              <th className="text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {bills.length === 0 ? (
              <tr>
                <td colSpan={6}>No bills</td>
              </tr>
            ) : null}
            {bills.map((bill) => (
              <tr key={bill.id}>
                <td>
                  <Link href={`/bills/${bill.id}`}>{bill.billNumber}</Link>
                </td>
                <td className="fit" data-fit="date">{bill.billDate ? formatCalendarDay(bill.billDate) : "—"}</td>
                <td className="fit" data-fit="status">{recordStatus(bill.status)}</td>
                <td className="fit num text-right" data-fit="amount">{formatMoney(bill.amountCents)}</td>
                <td className="fit num text-right" data-fit="amount">{formatMoney(bill.retainageCents)}</td>
                <td className="fit num text-right" data-fit="amount">{formatMoney(bill.netCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
      <section className="px-4" aria-label="History">
        <h2 className="mac-t13 text-[var(--mac-secondary)]">History</h2>
        <ul className="mt-1">
          {events.map((event) => (
            <li key={event.id} className="mac-t13">
              {recordStatus(event.type)}
              {event.reason ? ` · ${event.reason}` : ""} · <span className="num">{formatDateTime(event.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>
      {editing ? (
        <Dialog open onOpenChange={setEditing}>
          <DialogContent aria-describedby={undefined} className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit {po.number}</DialogTitle>
            </DialogHeader>
            <PurchaseOrderForm
              compact
              projects={projects}
              vendors={vendors}
              orders={orders}
              codes={codes}
              lockJob={po.status === "issued"}
              defaults={{
                id: po.id,
                projectId: po.projectId,
                vendorContactId: po.vendorContactId,
                scope,
                changeOrderId,
                lines,
              }}
            />
            <button type="button" className="ctl w-fit" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </DialogContent>
        </Dialog>
      ) : null}
      {billing ? (
        <Dialog open onOpenChange={setBilling}>
          <DialogContent aria-describedby={undefined} className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>New bill</DialogTitle>
            </DialogHeader>
            <BillFromPo
              poId={po.id}
              number={po.number}
              projectId={po.projectId}
              vendorContactId={po.vendorContactId}
              vendorName={po.vendorName}
              projectName={po.projectName}
              retainageBps={po.retainageBps}
              lines={lines}
              prefill={prefill}
            />
            <button type="button" className="ctl w-fit" onClick={() => setBilling(false)}>
              Cancel
            </button>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function PlanValue({
  projectId,
  poId,
  plans,
  choices,
  office,
}: {
  projectId: string;
  poId: string;
  plans: Plan[];
  choices: PlanChoice[];
  office: boolean;
}) {
  if (plans.length === 0 && (!office || choices.length === 0)) return "—";
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      {plans.map((plan) => (
        <a key={plan.documentId} href={`/api/files/${plan.documentId}`}>
          {plan.name}
        </a>
      ))}
      {office && choices.length > 0 ? (
        <ActionForm action={referencePlanAction.bind(null, projectId, "purchase_order", poId)} className="inline-flex items-center gap-2">
          <select name="groupId" aria-label="Plan" className="ctl" defaultValue={choices[0]?.groupId}>
            {choices.map((choice) => (
              <option key={choice.groupId} value={choice.groupId}>
                {choice.name}
              </option>
            ))}
          </select>
          <button type="submit" className="ctl">
            Add
          </button>
        </ActionForm>
      ) : null}
    </span>
  );
}

function BillFromPo({
  poId,
  number,
  projectId,
  vendorContactId,
  vendorName,
  projectName,
  retainageBps,
  lines,
  prefill,
}: {
  poId: string;
  number: string;
  projectId: string;
  vendorContactId: string;
  vendorName: string;
  projectName: string;
  retainageBps: number;
  lines: Line[];
  prefill: Line[];
}) {
  const [amounts, setAmounts] = useState(prefill.map((line) => (line.remainingCents / 100).toFixed(2)));
  const incoming = useMemo(
    () =>
      prefill.map((line, index) => ({
        costCode: line.costCode,
        amountCents: parseMoneyToCents(amounts[index] ?? "") ?? 0,
      })),
    [amounts, prefill],
  );
  const amountCents = incoming.reduce((sum, line) => sum + line.amountCents, 0);
  const hold = retainedCents(amountCents, retainageBps);
  const net = netPayableCents(amountCents, hold, "standard");
  const warning = overRemainingMessage(
    number,
    lines,
    lines.map((line) => ({ costCode: line.costCode, amountCents: line.billedCents })),
    incoming,
  );
  return (
    <ActionForm action={saveBillAction} className="grid gap-3" dataSheet="bill">
      <p className="mac-t13 text-[var(--mac-secondary)]">
        {vendorName} · {projectName}
      </p>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="vendorContactId" value={vendorContactId} />
      <input type="hidden" name="purchaseOrderId" value={poId} />
      <label className="text-sm">
        Bill number
        <input name="billNumber" aria-label="Bill number" className="field mt-1" required />
      </label>
      <label className="text-sm">
        Bill date
        <input name="billDate" type="date" aria-label="Bill date" className="field mt-1" required />
      </label>
      <label className="text-sm">
        Due date
        <input name="dueDate" type="date" aria-label="Due date" className="field mt-1" required />
      </label>
      {prefill.length === 0 ? <p className="mac-t13">No remaining amount</p> : null}
      {prefill.map((line, index) => (
        <div key={line.id} className="grid grid-cols-[1fr_8rem] gap-2">
          <input type="hidden" name="description" value={line.description ?? ""} />
          <input name="costCode" aria-label={`Line ${index + 1} cost code`} defaultValue={line.costCode} className="field" readOnly />
          <input
            name="amount"
            aria-label={`Line ${index + 1} amount`}
            inputMode="decimal"
            className="field"
            value={amounts[index] ?? ""}
            onChange={(event) => {
              const next = [...amounts];
              next[index] = event.target.value;
              setAmounts(next);
            }}
          />
        </div>
      ))}
      <p className="num mac-t13" data-bill-net="">
        {Math.round(retainageBps / 100)}% · Retained {formatMoney(hold)} · Net {formatMoney(net)}
      </p>
      {warning ? (
        <p role="status" className="text-sm">
          {warning}
        </p>
      ) : null}
      <button type="submit" className="mac-primary w-fit" disabled={prefill.length === 0}>
        Save draft
      </button>
    </ActionForm>
  );
}
