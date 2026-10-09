"use client";

import Link from "next/link";
import { Fragment, useRef, useState } from "react";
import { useActionState } from "react";
import { payBillsAction, requestUnconditionalsAction, requestWaiversAction } from "@/app/actions";
import { SelectionBar } from "@/components/selection-bar";
import { formatMoney } from "@/lib/money";
import { WAIVER_TYPES, waiverTypeLabel } from "@/lib/waivers/format";

type BillRow = {
  id: string;
  billNumber: string;
  vendorName: string;
  projectName: string;
  status: string;
  amountCents: number;
  timing: string;
  waiverLabel: string;
  waiverRequested: boolean;
  netCents: number;
  ready: boolean;
  reason: string | null;
};

type CodeRow = { code: string; billedCents: number; budgetCents: number };

type VendorRow = {
  contactId: string;
  name: string;
  company: string | null;
  billedCents: number;
  paidCents: number;
  outstandingCents: number;
  committedCents: number;
  openBalanceCents: number;
  retainedCents: number;
  codes: CodeRow[];
};

function statusLabel(status: string) {
  if (status === "draft") return "Draft";
  if (status === "approved") return "Approved";
  if (status === "paid") return "Paid";
  if (status === "void") return "Void";
  return status;
}

export function BillsBoard({
  office,
  rows,
  summaries,
  pay = false,
  readyCount = 0,
  readyCents = 0,
}: {
  office: boolean;
  rows: BillRow[];
  summaries: VendorRow[];
  pay?: boolean;
  readyCount?: number;
  readyCents?: number;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [count, setCount] = useState(0);
  const [payState, payAction] = useActionState(payBillsAction, null);
  function sync(form: HTMLFormElement | null) {
    if (!form) return;
    setCount(form.querySelectorAll('input[name="billId"]:checked').length);
  }
  const columns = office ? 7 : 6;
  return (
    <div className="flex flex-col gap-6">
      {pay && payState?.error ? (
        <p role="alert" className="px-4 text-sm">
          {payState.error}
        </p>
      ) : null}
      {pay && payState?.paidIds && payState.paidIds.length > 0 ? (
        <form action={requestUnconditionalsAction} className="px-4">
          {payState.paidIds.map((billId) => (
            <input key={billId} type="hidden" name="billId" value={billId} />
          ))}
          <button type="submit" className="mac-primary">
            Request unconditional waiver
          </button>
        </form>
      ) : null}
      <form
        action={office ? (pay ? payAction : requestWaiversAction) : undefined}
        ref={formRef}
        className="flex flex-col"
        onChange={(event) => sync(event.currentTarget)}
      >
        {pay ? (
          <SelectionBar
            label="Mark paid"
            count={office ? count : 0}
            onClear={() => {
              formRef.current?.querySelectorAll<HTMLInputElement>('input[name="billId"]').forEach((box) => {
                box.checked = false;
              });
              setCount(0);
            }}
          >
            <input name="paidOn" type="date" aria-label="Paid on" className="ctl" required />
            <select name="method" aria-label="Payment method" className="ctl" defaultValue="check">
              <option value="check">Check</option>
              <option value="ach">ACH</option>
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
            <input name="reference" aria-label="Payment reference" placeholder="Reference" className="ctl" required />
            <button type="submit" className="mac-primary">
              Mark paid
            </button>
          </SelectionBar>
        ) : (
          <SelectionBar
            label="Waiver request"
            count={office ? count : 0}
            onClear={() => {
              formRef.current?.querySelectorAll<HTMLInputElement>('input[name="billId"]').forEach((box) => {
                box.checked = false;
              });
              setCount(0);
            }}
          >
            <select name="type" aria-label="Waiver type" className="ctl" defaultValue="conditional_progress">
              {WAIVER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {waiverTypeLabel(type)}
                </option>
              ))}
            </select>
            <button type="submit" className="mac-primary">
              Request waiver
            </button>
          </SelectionBar>
        )}
        <div className="overflow-x-auto md:px-4">
          <table className="mac-table" aria-label="Bills">
            <thead>
              <tr>
                {office ? <th className="px-2" /> : null}
                <th className="px-2">Bill</th>
                <th className="px-2">Job</th>
                <th className="px-2">Status</th>
                <th className="px-2">Waiver</th>
                <th className="px-2"> </th>
                <th className="px-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-2" colSpan={columns}>
                    No bills match these filters.
                  </td>
                </tr>
              ) : null}
              {rows.map((bill) => (
                <tr key={bill.id}>
                  {office ? (
                    <td className="px-2">
                      <input
                        type="checkbox"
                        name="billId"
                        value={bill.id}
                        aria-label={pay ? `Pay ${bill.billNumber}` : `Waiver ${bill.billNumber}`}
                        disabled={pay ? !bill.ready : bill.status === "void" || bill.status === "draft"}
                      />
                    </td>
                  ) : null}
                  <td className="px-2">
                    <Link href={`/bills/${bill.id}`} className="font-medium">
                      <span className="num">{bill.billNumber}</span> · {bill.vendorName}
                    </Link>
                    {bill.timing === "overdue" ? " · Overdue" : ""}
                    {bill.timing === "upcoming" ? " · Due soon" : ""}
                  </td>
                  <td className="px-2" title={bill.projectName}>
                    {bill.projectName}
                  </td>
                  <td className="fit px-2" data-fit="status">
                    <span className="fl-pill">{statusLabel(bill.status)}</span>
                  </td>
                  <td className="px-2">{bill.waiverRequested ? <span className="fl-pill">{bill.waiverLabel}</span> : bill.waiverLabel}</td>
                  <td className="fit px-2" data-fit="status">
                    {bill.reason ? <span className="fl-pill">{bill.reason}</span> : null}
                  </td>
                  <td className="fit num px-2 text-right" data-fit="amount">{formatMoney(pay ? bill.netCents : bill.amountCents)}</td>
                </tr>
              ))}
            </tbody>
            {pay ? (
              <tfoot>
                <tr>
                  <td className="num px-2" colSpan={columns} data-ready-totals="">
                    {readyCount} · {formatMoney(readyCents)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </form>
      <section>
        <h2 className="mac-t15 px-4">Vendors</h2>
        {summaries.length === 0 ? <p className="mt-3 px-4 text-sm text-[var(--mac-secondary)]">No approved or paid bills yet.</p> : null}
        {summaries.length > 0 ? (
          <div className="mt-2 overflow-x-auto md:px-4">
            <table className="mac-table" aria-label="Vendors">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th className="text-right">Billed</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Outstanding</th>
                  <th className="text-right">Committed</th>
                  <th className="text-right">Open PO</th>
                  <th className="text-right">Retained</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((vendor) => (
                  <Fragment key={vendor.contactId}>
                    <tr>
                      <td>
                        <Link href={`/bills?vendor=${vendor.contactId}`}>{vendor.company || vendor.name}</Link>
                      </td>
                      <td className="fit num text-right" data-fit="amount">{formatMoney(vendor.billedCents)}</td>
                      <td className="fit num text-right" data-fit="amount">{formatMoney(vendor.paidCents)}</td>
                      <td className="fit num text-right" data-fit="amount">{formatMoney(vendor.outstandingCents)}</td>
                      <td className="fit num text-right" data-fit="amount">{formatMoney(vendor.committedCents)}</td>
                      <td className="fit num text-right" data-fit="amount">{formatMoney(vendor.openBalanceCents)}</td>
                      <td className="fit num text-right" data-fit="amount">{formatMoney(vendor.retainedCents)}</td>
                    </tr>
                    {vendor.codes.map((code) => (
                      <tr key={`${vendor.contactId}-${code.code}`} title={`Budget ${formatMoney(code.budgetCents)}`}>
                        <td className="pl-8 text-[var(--mac-secondary)]">{code.code}</td>
                        <td className="fit num text-right" data-fit="amount">{formatMoney(code.billedCents)}</td>
                        <td />
                        <td />
                        <td />
                        <td />
                        <td />
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
