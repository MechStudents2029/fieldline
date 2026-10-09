"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { insertAssemblyAction } from "@/app/actions";
import { formatQty, formatWhole, lineAmounts } from "@/lib/money";
import type { Billing } from "@/lib/estimate/pricing";

type Choice = { id: string; name: string };
type Measure = { id: string; name: string; valueMilli: number; unit: string };

export function AddAssembly({
  estimateId,
  locked,
  assemblies,
  measurements,
}: {
  estimateId: string;
  locked: boolean;
  assemblies: Choice[];
  measurements: Measure[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [assemblyId, setAssemblyId] = useState(assemblies[0]?.id ?? "");
  const [measurementId, setMeasurementId] = useState("");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (locked || assemblies.length === 0) return null;

  async function insert() {
    const result = await insertAssemblyAction(estimateId, {
      assemblyId,
      measurementId: measurementId || null,
      measurementName: measurementId ? undefined : name,
      measurementValue: measurementId ? undefined : Number(value),
    });
    if (result?.error) {
      setError(result.error);
      return;
    }
    setError(null);
    setOpen(false);
    setName("");
    setValue("");
    router.refresh();
  }

  return (
    <div className="est-assembly-add">
      <button type="button" className="est-add" onClick={() => setOpen((current) => !current)}>
        Add assembly
      </button>
      {open ? (
        <form
          className="est-assembly-form"
          onSubmit={(event) => {
            event.preventDefault();
            void insert();
          }}
        >
          <select aria-label="Assembly" className="ctl" value={assemblyId} onChange={(event) => setAssemblyId(event.target.value)}>
            {assemblies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select aria-label="Assembly measurement" className="ctl" value={measurementId} onChange={(event) => setMeasurementId(event.target.value)}>
            <option value="">New</option>
            {measurements.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {measurementId ? null : (
            <>
              <input aria-label="New measurement" className="ctl" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
              <input
                aria-label="New measurement value"
                className="ctl num"
                inputMode="decimal"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="Value"
              />
            </>
          )}
          <button type="submit" className="ctl">
            Insert
          </button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="est-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function AssemblyGroupRow({
  name,
  presentAs,
  open,
  locked,
  qty,
  unit,
  priceCents,
  onToggle,
  onUngroup,
  onPresent,
}: {
  name: string;
  presentAs: string;
  open: boolean;
  locked: boolean;
  qty: string;
  unit: string;
  priceCents: number;
  onToggle: () => void;
  onUngroup: () => void;
  onPresent: () => void;
}) {
  return (
    <div className="est-assembly" data-assembly={name} role="row">
      <button type="button" className="est-twist" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${name}`} onClick={onToggle}>
        {open ? "▾" : "▸"}
      </button>
      <span className="est-assembly-name">{name}</span>
      <span className="est-muted num">
        {qty} {unit}
      </span>
      <span className="est-assembly-total num">{formatWhole(priceCents)}</span>
      {locked ? null : (
        <>
          <button type="button" className="ctl" aria-label={`Ungroup ${name}`} onClick={onUngroup}>
            Ungroup
          </button>
          <button type="button" className="ctl" aria-label={`Proposal ${name}`} onClick={onPresent}>
            {presentAs === "parts" ? "Parts" : "One line"}
          </button>
        </>
      )}
    </div>
  );
}

export function groupPrice(
  lines: { qtyMilli: number; unitCostCents: number; markupBps: number; billing: Billing }[],
) {
  return lines.reduce((sum, line) => {
    if (line.billing === "optional" || line.billing === "excluded") return sum;
    return sum + lineAmounts(line.qtyMilli, line.unitCostCents, line.markupBps).price;
  }, 0);
}

export async function runGroupAction(action: () => Promise<{ error?: string } | null>, onError: (message: string | null) => void, refresh: () => void) {
  const result = await action();
  if (result?.error) {
    onError(result.error);
    return;
  }
  onError(null);
  refresh();
}

export function measurementLabel(measure: { valueMilli: number; unit: string } | undefined) {
  if (!measure) return { qty: "", unit: "" };
  return { qty: formatQty(measure.valueMilli), unit: measure.unit };
}
