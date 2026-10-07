"use client";

import { useActionState, useMemo, useState } from "react";
import type { ActionState } from "@/app/actions";
import { saveDrawsAction } from "@/app/actions";
import { formatWhole } from "@/lib/money";

type Row = {
  key: string;
  id: string;
  title: string;
  basis: "percent" | "fixed";
  percent: string;
  dollars: string;
  scheduleItemId: string;
  dueOn: string;
  locked: boolean;
};

export function DrawEditor({
  projectId,
  contractCents,
  schedule,
  initial,
}: {
  projectId: string;
  contractCents: number;
  schedule: { id: string; title: string }[];
  initial: Row[];
}) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [state, action, pending] = useActionState(saveDrawsAction.bind(null, projectId), null as ActionState);
  const remainder = useMemo(() => {
    const amounts = rows.map((row) => {
      if (row.basis === "fixed") return Math.round(Number(row.dollars || 0) * 100);
      return Math.round((contractCents * Math.round(Number(row.percent || 0) * 100)) / 10000);
    });
    const allPercent = rows.every((row) => row.basis === "percent");
    const bps = rows.reduce((sum, row) => sum + Math.round(Number(row.percent || 0) * 100), 0);
    if (allPercent && bps === 10000 && rows.length > 0) {
      let allocated = 0;
      const exact = rows.map((row, index) => {
        const part = Math.round(Number(row.percent || 0) * 100);
        const amount = index === rows.length - 1 ? contractCents - allocated : Math.round((contractCents * part) / 10000);
        allocated += amount;
        return amount;
      });
      return contractCents - exact.reduce((sum, amount) => sum + amount, 0);
    }
    return contractCents - amounts.reduce((sum, amount) => sum + amount, 0);
  }, [rows, contractCents]);

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="mac-t13 num">
        Left {formatWhole(remainder)}
      </p>
      <div className="overflow-x-auto">
        <table className="mac-table w-full text-left" aria-label="Draws">
          <thead>
            <tr>
              <th>Draw</th>
              <th>Amount</th>
              <th>Schedule</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>
                  <input type="hidden" name="drawId" value={row.id} />
                  <input type="hidden" name="title" value={row.title} />
                  <input type="hidden" name="basis" value={row.basis} />
                  <input type="hidden" name="percent" value={row.percent} />
                  <input type="hidden" name="amount" value={row.dollars} />
                  <input type="hidden" name="scheduleItemId" value={row.scheduleItemId} />
                  <input type="hidden" name="dueOn" value={row.dueOn} />
                  <input
                    value={row.title}
                    readOnly={row.locked}
                    aria-label={`Title ${row.title || "draw"}`}
                    className="field"
                    onChange={(event) => update(row.key, { title: event.target.value })}
                  />
                </td>
                <td className="num">
                  <select
                    value={row.basis}
                    disabled={row.locked}
                    aria-label={`Basis ${row.title || "draw"}`}
                    className="field"
                    onChange={(event) => update(row.key, { basis: event.target.value === "percent" ? "percent" : "fixed" })}
                  >
                    <option value="percent">%</option>
                    <option value="fixed">$</option>
                  </select>
                  {row.basis === "percent" ? (
                    <input
                      value={row.percent}
                      readOnly={row.locked}
                      inputMode="decimal"
                      aria-label={`Percent ${row.title || "draw"}`}
                      className="field w-20"
                      onChange={(event) => update(row.key, { percent: event.target.value })}
                    />
                  ) : (
                    <input
                      value={row.dollars}
                      readOnly={row.locked}
                      inputMode="decimal"
                      aria-label={`Amount ${row.title || "draw"}`}
                      className="field w-28"
                      onChange={(event) => update(row.key, { dollars: event.target.value })}
                    />
                  )}
                </td>
                <td>
                  <select
                    value={row.scheduleItemId}
                    disabled={row.locked}
                    aria-label={`Schedule ${row.title || "draw"}`}
                    className="field"
                    onChange={(event) => update(row.key, { scheduleItemId: event.target.value })}
                  >
                    <option value="">Date</option>
                    {schedule.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num">
                  <input
                    type="date"
                    value={row.dueOn}
                    readOnly={row.locked || Boolean(row.scheduleItemId)}
                    aria-label={`Due ${row.title || "draw"}`}
                    className="field"
                    onChange={(event) => update(row.key, { dueOn: event.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="mac-glass-btn"
          onClick={() =>
            setRows((current) => [
              ...current,
              { key: `new-${current.length}`, id: "", title: "Draw", basis: "fixed", percent: "0", dollars: "0", scheduleItemId: "", dueOn: "", locked: false },
            ])
          }
        >
          Add draw
        </button>
        <button type="submit" className="mac-primary" disabled={pending || remainder !== 0}>
          Save
        </button>
      </div>
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
