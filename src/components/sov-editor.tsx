"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions";
import { createPayAppAction } from "@/app/actions";
import { formatWhole } from "@/lib/money";

export function SovEditor({
  projectId,
  lines,
  retainageBps,
}: {
  projectId: string;
  lines: { key: string; name: string; scheduledCents: number; previousCents: number }[];
  retainageBps: number;
}) {
  const [state, action, pending] = useActionState(createPayAppAction.bind(null, projectId), null as ActionState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="mac-table w-full text-left" aria-label="Schedule of values">
          <thead>
            <tr>
              <th>Item</th>
              <th className="text-right">Scheduled</th>
              <th className="text-right">Previous</th>
              <th className="text-right">This period</th>
              <th className="text-right">%</th>
              <th className="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key}>
                <th scope="row" className="font-normal">
                  {line.name}
                  <input type="hidden" name="lineKey" value={line.key} />
                </th>
                <td className="num text-right">{formatWhole(line.scheduledCents)}</td>
                <td className="num text-right">{formatWhole(line.previousCents)}</td>
                <td className="text-right">
                  <input name="thisAmount" inputMode="decimal" aria-label={`This period ${line.name}`} className="field w-28 text-right" defaultValue="" />
                </td>
                <td className="text-right">
                  <input name="percent" inputMode="decimal" aria-label={`Percent ${line.name}`} className="field w-16 text-right" defaultValue="" />
                </td>
                <td className="num text-right">{formatWhole(line.scheduledCents - line.previousCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mac-t11 text-[var(--mac-secondary)]">Retainage {(retainageBps / 100).toFixed(0)}%</p>
      <button type="submit" className="mac-primary w-fit" disabled={pending}>
        Create application
      </button>
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
