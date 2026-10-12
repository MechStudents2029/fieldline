"use client";

import { useState } from "react";
import { payBillAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { SheetButton } from "@/components/sheet-button";
import { formatMoney } from "@/lib/money";

export function CreditPaySheet({
  billId,
  projectId,
  netCents,
  credits,
  today,
}: {
  billId: string;
  projectId: string;
  netCents: number;
  credits: { id: string; number: string; reason: string; remainingCents: number }[];
  today: string;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const applied = credits.reduce((sum, credit) => {
    const dollars = Number(amounts[credit.id] || 0);
    if (!Number.isFinite(dollars) || dollars <= 0) return sum;
    return sum + Math.round(dollars * 100);
  }, 0);
  const cash = Math.max(0, netCents - applied);
  return (
    <SheetButton label="Pay">
      <ActionForm action={payBillAction.bind(null, billId)} className="grid gap-2">
        <input type="hidden" name="projectId" value={projectId} />
        <p className="mac-t13">
          Net <span className="num">{formatMoney(netCents)}</span>
          {" · Cash "}
          <span className="num" data-net-paid={cash}>
            {formatMoney(cash)}
          </span>
        </p>
        {credits.map((credit) => (
          <label key={credit.id} className="text-sm">
            {credit.number} · {credit.reason} · <span className="num">{formatMoney(credit.remainingCents)}</span>
            <input type="hidden" name="creditId" value={credit.id} />
            <input
              name={`creditAmount:${credit.id}`}
              aria-label={`Apply ${credit.number}`}
              inputMode="decimal"
              className="field mt-1"
              value={amounts[credit.id] ?? ""}
              onChange={(event) => setAmounts((current) => ({ ...current, [credit.id]: event.target.value }))}
            />
          </label>
        ))}
        <label className="text-sm">
          Paid on
          <input name="paidOn" type="date" aria-label="Paid on" defaultValue={today} className="field mt-1" required />
        </label>
        <label className="text-sm">
          Method
          <select name="method" aria-label="Payment method" className="field mt-1" defaultValue="check">
            <option value="check">Check</option>
            <option value="ach">ACH</option>
            <option value="card">Card</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="text-sm">
          Reference
          <input name="reference" aria-label="Payment reference" className="field mt-1" required />
        </label>
        <button type="submit" className="mac-primary w-fit">
          Mark paid
        </button>
      </ActionForm>
    </SheetButton>
  );
}
