"use client";

import { useState } from "react";
import { receiveDeliveryAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FileButton } from "@/components/file-button";

export type ReceiveChoice = {
  id: string;
  number: string;
  projectId: string;
  kind: "purchase" | "work";
  lines: {
    id: string;
    description: string;
    progress: string;
    defaultQty: string;
    expectedOn: string;
    scheduleItemId: string;
    work: boolean;
  }[];
  schedule: { id: string; title: string }[];
};

export function ReceiveSheet({ orders, fixedId, today }: { orders: ReceiveChoice[]; fixedId?: string; today: string }) {
  const [poId, setPoId] = useState(fixedId || orders[0]?.id || "");
  const order = orders.find((row) => row.id === poId) ?? orders[0];
  if (!order) return <p className="mac-t13">No open lines</p>;
  return (
    <ActionForm action={receiveDeliveryAction} className="grid gap-3">
      <input type="hidden" name="purchaseOrderId" value={order.id} />
      {fixedId ? null : (
        <label className="text-sm">
          Purchase order
          <select name="picker" aria-label="Purchase order" className="field mt-1" value={poId} onChange={(event) => setPoId(event.target.value)}>
            {orders.map((row) => (
              <option key={row.id} value={row.id}>
                {row.number}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="text-sm">
        Date
        <input name="receivedOn" type="date" aria-label="Delivery date" defaultValue={today} className="field mt-1" required />
      </label>
      {order.lines.map((line) => (
        <fieldset key={line.id} className="grid gap-2">
          <legend className="mac-t13">
            {line.description} · <span className="num">{line.progress}</span>
          </legend>
          <input type="hidden" name="lineId" value={line.id} />
          {line.work ? (
            <>
              <input type="hidden" name="qty" value="0" />
              <label className="text-sm">
                Percent
                <input name="pct" aria-label={`Percent ${line.description}`} defaultValue={line.defaultQty} className="field mt-1" inputMode="decimal" />
              </label>
            </>
          ) : (
            <>
              <input type="hidden" name="pct" value="0" />
              <label className="text-sm">
                Qty
                <input name="qty" aria-label={`Qty ${line.description}`} defaultValue={line.defaultQty} className="field mt-1" inputMode="decimal" />
              </label>
            </>
          )}
          <label className="text-sm">
            Condition
            <select name="condition" aria-label={`Condition ${line.description}`} className="field mt-1" defaultValue="ok">
              <option value="ok">Received</option>
              <option value="short">Short</option>
              <option value="damaged">Damaged</option>
              <option value="backordered">Backordered</option>
            </select>
          </label>
          <label className="text-sm">
            Expected
            <input name="expectedOn" type="date" aria-label={`Expected ${line.description}`} defaultValue={line.expectedOn} className="field mt-1" />
          </label>
          <label className="text-sm">
            Schedule
            <select name="scheduleItemId" aria-label={`Schedule ${line.description}`} className="field mt-1" defaultValue={line.scheduleItemId}>
              <option value="">None</option>
              {order.schedule.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Line note
            <input name="lineNote" aria-label={`Note ${line.description}`} className="field mt-1" />
          </label>
        </fieldset>
      ))}
      <label className="text-sm">
        Note
        <input name="receiptNote" aria-label="Receipt note" className="field mt-1" />
      </label>
      <FileButton name="photo" label="Packing slip" accept="image/jpeg,image/png,image/webp" empty="Packing slip" capture />
      <button type="submit" className="mac-primary w-fit">
        Save receipt
      </button>
    </ActionForm>
  );
}
