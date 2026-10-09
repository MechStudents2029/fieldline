"use client";

import { useRef, useState } from "react";
import { useActionState } from "react";
import { archiveAssemblyAction, duplicateAssemblyAction, saveAssemblyAction } from "@/app/actions";
import { DRIVES } from "@/lib/estimate/assembly";
import { formatQty } from "@/lib/money";

type Part = {
  name: string;
  code: string;
  formula: string;
  waste: string;
  round: string;
  unit: string;
  cost: string;
};

const UNITS = ["sf", "lf", "ea", "sq", "cy"];
const DRIVE_LABEL: Record<(typeof DRIVES)[number], string> = { area: "Area", length: "Length", count: "Count" };

function blankPart(): Part {
  return { name: "", code: "", formula: "Qty", waste: "", round: "", unit: "sf", cost: "" };
}

export function AssemblyEditor({
  assembly,
}: {
  assembly: {
    id: string | null;
    name: string;
    drive: string;
    parts: { name: string; costCode: string | null; formula: string; wasteBps: number; roundToMilli: number | null; unit: string; unitCostCents: number }[];
  };
}) {
  const [name, setName] = useState(assembly.name);
  const [drive, setDrive] = useState(assembly.drive || "area");
  const [parts, setParts] = useState<Part[]>(
    assembly.parts.length
      ? assembly.parts.map((part) => ({
          name: part.name,
          code: part.costCode ?? "",
          formula: part.formula,
          waste: part.wasteBps ? String(part.wasteBps / 100) : "",
          round: part.roundToMilli ? formatQty(part.roundToMilli) : "",
          unit: part.unit,
          cost: (part.unitCostCents / 100).toFixed(2),
        }))
      : [blankPart()],
  );
  const [state, formAction] = useActionState(saveAssemblyAction, null);
  const payloadRef = useRef<HTMLInputElement>(null);

  function patch(index: number, next: Partial<Part>) {
    setParts((current) => current.map((part, i) => (i === index ? { ...part, ...next } : part)));
  }

  function payload() {
    return JSON.stringify({
      id: assembly.id,
      name,
      drive,
      parts: parts.map((part) => ({
        name: part.name,
        code: part.code.trim() || null,
        formula: part.formula,
        wasteBps: part.waste.trim() === "" ? 0 : Math.round(Number(part.waste) * 100),
        roundToMilli: part.round.trim() === "" ? null : Math.round(Number(part.round) * 1000),
        unit: part.unit,
        unitCostCents: Math.round(Number(part.cost) * 100),
      })),
    });
  }

  return (
    <div className="assembly-editor">
      <div className="assembly-head">
        <h1>{assembly.id ? name || "Assembly" : "New assembly"}</h1>
        {assembly.id ? (
          <div className="assembly-tools">
            <form action={duplicateAssemblyAction.bind(null, assembly.id)}>
              <button type="submit" className="ctl">
                Duplicate
              </button>
            </form>
            <form action={archiveAssemblyAction.bind(null, assembly.id)}>
              <button type="submit" className="ctl">
                Archive
              </button>
            </form>
          </div>
        ) : null}
      </div>
      <label className="assembly-field">
        Name
        <input aria-label="Assembly name" className="field" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="assembly-field">
        Driving measurement
        <select aria-label="Driving measurement" className="field" value={drive} onChange={(event) => setDrive(event.target.value)}>
          {DRIVES.map((item) => (
            <option key={item} value={item}>
              {DRIVE_LABEL[item]}
            </option>
          ))}
        </select>
      </label>
      <p className="est-kicker">Parts</p>
      <div className="assembly-parts">
        {parts.map((part, index) => (
          <div key={index} className="assembly-part">
            <input aria-label="Part name" className="field" value={part.name} placeholder="Part" onChange={(event) => patch(index, { name: event.target.value })} />
            <input aria-label="Code" className="ctl" value={part.code} placeholder="Code" onChange={(event) => patch(index, { code: event.target.value })} />
            <input aria-label="Formula" className="ctl" value={part.formula} onChange={(event) => patch(index, { formula: event.target.value })} />
            <input aria-label="Waste" className="ctl num" inputMode="decimal" value={part.waste} placeholder="Waste %" onChange={(event) => patch(index, { waste: event.target.value })} />
            <input aria-label="Round" className="ctl num" inputMode="decimal" value={part.round} placeholder="Round" onChange={(event) => patch(index, { round: event.target.value })} />
            <select aria-label="Unit" className="ctl" value={part.unit} onChange={(event) => patch(index, { unit: event.target.value })}>
              {UNITS.map((unit) => (
                <option key={unit}>{unit}</option>
              ))}
            </select>
            <input aria-label="Unit cost" className="ctl num" inputMode="decimal" value={part.cost} placeholder="Unit cost" onChange={(event) => patch(index, { cost: event.target.value })} />
            {parts.length > 1 ? (
              <button type="button" className="ctl" onClick={() => setParts((current) => current.filter((_, i) => i !== index))}>
                Remove
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <form
        action={formAction}
        className="assembly-tools"
        onSubmit={() => {
          if (payloadRef.current) payloadRef.current.value = payload();
        }}
      >
        <input ref={payloadRef} type="hidden" name="payload" defaultValue="" />
        <button type="button" className="ctl" onClick={() => setParts((current) => [...current, blankPart()])}>
          Add part
        </button>
        <button type="submit" className="ctl">
          Save
        </button>
      </form>
      {state?.error ? (
        <p role="alert" className="est-error">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
