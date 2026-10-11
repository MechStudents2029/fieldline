"use client";

import Link from "next/link";
import { useState } from "react";
import { convertTmAction, costPlusTmAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { formatCalendarDay } from "@/lib/format";
import { formatWhole } from "@/lib/money";

type Row = {
  id: string;
  title: string;
  projectId: string;
  job: string;
  billingMode: string;
  performedOn: string;
  pill: string;
  description: string;
  status: string;
  priceCents: number | null;
};

export function TmBoard({ rows, canBill }: { rows: Row[]; canBill: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const picked = rows.filter((row) => selected.includes(row.id));
  const sameJob = new Set(picked.map((row) => row.projectId)).size === 1;
  const costPlus = sameJob && picked[0]?.billingMode === "cost_plus";
  return (
    <div className="flex flex-col gap-3">
      {canBill ? (
        <button type="button" className="mac-glass-btn w-fit" disabled={picked.length === 0} onClick={() => setOpen(true)}>
          Convert
        </button>
      ) : null}
      {open ? (
        <div role="dialog" aria-label="Convert" className="flex flex-col gap-3 rounded-lg border border-[var(--mac-separator)] p-3">
          <p className="num text-[22px] font-semibold">{picked.length}</p>
          {sameJob ? (
            <ActionForm action={convertTmAction} className="flex flex-col gap-2">
              {picked.map((row) => (
                <input key={row.id} type="hidden" name="ticketId" value={row.id} />
              ))}
              <button type="submit" className="ctl w-fit">
                Change order
              </button>
            </ActionForm>
          ) : null}
          {costPlus ? (
            <ActionForm action={costPlusTmAction} className="flex flex-col gap-2">
              {picked.map((row) => (
                <input key={row.id} type="hidden" name="ticketId" value={row.id} />
              ))}
              <button type="submit" className="ctl w-fit">
                Cost-plus invoice
              </button>
            </ActionForm>
          ) : null}
          <button type="button" className="ctl w-fit" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      ) : null}
      <table className="mac-table">
        <thead>
          <tr>
            {canBill ? <th /> : null}
            {["Ticket", "Job", "Date", "Status", ...(rows.some((row) => row.priceCents != null) ? ["Total"] : [])].map((label) => (
              <th key={label || "pick"} className="text-left">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6}>No tickets</td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={row.id}>
              {canBill ? (
                <td>
                  {row.status === "verified" ? (
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.job} ${row.title}`}
                      checked={selected.includes(row.id)}
                      onChange={(event) =>
                        setSelected((current) => (event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id)))
                      }
                    />
                  ) : null}
                </td>
              ) : null}
              <td>
                <Link href={`/tm/${row.id}`}>{row.title}</Link>
              </td>
              <td>{row.job}</td>
              <td className="num">{formatCalendarDay(row.performedOn)}</td>
              <td>
                <span className="fl-pill fl-pill-sm">{row.pill}</span>
              </td>
              {row.priceCents != null ? <td className="num">{formatWhole(row.priceCents)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
