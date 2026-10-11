"use client";

import Link from "next/link";
import { useState } from "react";

type FieldRow = {
  id: string;
  label: string;
  typeLabel: string;
  required: boolean;
  office: boolean;
  field: boolean;
  vendor: boolean;
  client: boolean;
};

export function FieldTable({
  recordType,
  rows,
  archiveAction,
  orderAction,
}: {
  recordType: string;
  rows: FieldRow[];
  archiveAction: (formData: FormData) => void;
  orderAction: (formData: FormData) => void;
}) {
  const [order, setOrder] = useState(rows.map((row) => row.id));
  const [drag, setDrag] = useState("");
  const byId = new Map(rows.map((row) => [row.id, row]));

  async function dropOn(targetId: string) {
    if (!drag || drag === targetId) return;
    const next = order.filter((item) => item !== drag);
    next.splice(next.indexOf(targetId), 0, drag);
    setOrder(next);
    setDrag("");
    const data = new FormData();
    data.set("recordType", recordType);
    for (const item of next) data.append("ids", item);
    await orderAction(data);
  }

  return (
    <table className="mac-table fields-table w-full" data-fields={recordType}>
      <colgroup>
        <col style={{ width: "28px" }} />
        <col />
        <col style={{ width: "120px" }} />
        <col style={{ width: "240px" }} />
        <col style={{ width: "36px" }} />
      </colgroup>
      <tbody>
        {order.map((id) => {
          const field = byId.get(id);
          if (!field) return null;
          const pills = [
            field.required ? "Required" : "",
            field.office ? "Office" : "",
            field.field ? "Field" : "",
            field.vendor ? "Vendor" : "",
            field.client ? "Client" : "",
          ].filter(Boolean);
          return (
            <tr
              key={field.id}
              data-field={field.label}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void dropOn(field.id);
              }}
            >
              <td>
                <button
                  type="button"
                  draggable
                  aria-label={`Reorder ${field.label}`}
                  data-drag={field.label}
                  className="cursor-grab text-[var(--mac-tertiary)]"
                  onDragStart={() => setDrag(field.id)}
                >
                  ⋮⋮
                </button>
              </td>
              <td>
                <Link href={`/settings/fields?field=${field.id}`}>{field.label}</Link>
              </td>
              <td>{field.typeLabel}</td>
              <td>
                <span className="flex flex-wrap gap-1">
                  {pills.map((pill) => (
                    <span key={pill} className="fl-pill fl-pill-sm">
                      {pill}
                    </span>
                  ))}
                </span>
              </td>
              <td>
                <details className="list-pop">
                  <summary aria-label={`Actions for ${field.label}`}>…</summary>
                  <form action={archiveAction} className="absolute right-0 z-10 mt-1 rounded-lg bg-[var(--mac-window)] p-1 shadow-[var(--mac-shadow-panel)]">
                    <input type="hidden" name="id" value={field.id} />
                    <button type="submit" className="ctl" aria-label={`Archive ${field.label}`}>
                      Archive
                    </button>
                  </form>
                </details>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
