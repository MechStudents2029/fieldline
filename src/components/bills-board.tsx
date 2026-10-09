"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { requestWaiversAction } from "@/app/actions";
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
  codes: CodeRow[];
};

function statusLabel(status: string) {
  if (status === "draft") return "Draft";
  if (status === "approved") return "Approved";
  if (status === "paid") return "Paid";
  if (status === "void") return "Void";
  return status;
}

export function BillsBoard({ office, rows, summaries }: { office: boolean; rows: BillRow[]; summaries: VendorRow[] }) {
  const [count, setCount] = useState(0);
  function sync(form: HTMLFormElement | null) {
    if (!form) return;
    setCount(form.querySelectorAll('input[name="billId"]:checked').length);
  }
  return (
    <div className="flex flex-col gap-6">
      <form
        action={office ? requestWaiversAction : undefined}
        className="flex flex-col"
        onChange={(event) => sync(event.currentTarget)}
      >
        {office && count > 0 ? (
          <div role="region" aria-label="Waiver request" className="flex flex-wrap items-center gap-2 px-4 py-2">
            <span className="text-sm">{count} selected</span>
            <select name="type" aria-label="Waiver type" className="field" defaultValue="conditional_progress">
              {WAIVER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {waiverTypeLabel(type)}
                </option>
              ))}
            </select>
            <button type="submit" className="mac-primary">
              Request waiver
            </button>
          </div>
        ) : null}
        <div className="overflow-x-auto md:px-4">
          <table className="mac-table" aria-label="Bills">
            <thead>
              <tr>
                {office ? <th className="px-2" /> : null}
                <th className="px-2">Bill</th>
                <th className="px-2">Job</th>
                <th className="px-2">Status</th>
                <th className="px-2">Waiver</th>
                <th className="px-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-2" colSpan={office ? 6 : 5}>
                    No bills match these filters.
                  </td>
                </tr>
              ) : null}
              {rows.map((bill) => (
                <tr key={bill.id}>
                  {office ? (
                    <td className="px-2">
                      <input type="checkbox" name="billId" value={bill.id} aria-label={`Waiver ${bill.billNumber}`} disabled={bill.status === "void" || bill.status === "draft"} />
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
                  <td className="px-2">
                    <span className="fl-pill">{statusLabel(bill.status)}</span>
                  </td>
                  <td className="px-2">{bill.waiverRequested ? <span className="fl-pill">{bill.waiverLabel}</span> : bill.waiverLabel}</td>
                  <td className="px-2 text-right num">{formatMoney(bill.amountCents)}</td>
                </tr>
              ))}
            </tbody>
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
                </tr>
              </thead>
              <tbody>
                {summaries.map((vendor) => (
                  <Fragment key={vendor.contactId}>
                    <tr>
                      <td>
                        <Link href={`/bills?vendor=${vendor.contactId}`}>{vendor.company || vendor.name}</Link>
                      </td>
                      <td className="num text-right">{formatMoney(vendor.billedCents)}</td>
                      <td className="num text-right">{formatMoney(vendor.paidCents)}</td>
                      <td className="num text-right">{formatMoney(vendor.outstandingCents)}</td>
                      <td className="num text-right">{formatMoney(vendor.committedCents)}</td>
                      <td className="num text-right">{formatMoney(vendor.openBalanceCents)}</td>
                    </tr>
                    {vendor.codes.map((code) => (
                      <tr key={`${vendor.contactId}-${code.code}`} title={`Budget ${formatMoney(code.budgetCents)}`}>
                        <td className="pl-8 text-[var(--mac-secondary)]">{code.code}</td>
                        <td className="num text-right">{formatMoney(code.billedCents)}</td>
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
