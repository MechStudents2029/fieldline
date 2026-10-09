"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteMeasurementAction, saveMeasurementAction } from "@/app/actions";
import { formulaCaption } from "@/lib/estimate/formula";
import { formatQty } from "@/lib/money";

type MeasureRowData = { id: string; name: string; valueMilli: number; unit: string };
type FormulaLine = { id: string; qtyFormula: string | null; wasteBps: number; roundToMilli: number | null };

const UNITS = ["sf", "lf", "ea", "sq", "cy"];

export function MeasurementsPanel({
  estimateId,
  locked,
  rows,
}: {
  estimateId: string;
  locked: boolean;
  rows: MeasureRowData[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("sf");

  async function save(input: { id?: string; name: string; value: string; unit: string }) {
    const body = new FormData();
    if (input.id) body.set("id", input.id);
    body.set("name", input.name);
    body.set("value", input.value);
    body.set("unit", input.unit);
    const result = await saveMeasurementAction(estimateId, null, body);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setError(null);
    if (!input.id) {
      setName("");
      setValue("");
    }
    router.refresh();
  }

  return (
    <div className="measure-block">
      <p className="est-kicker">Measurements</p>
      <table className="measure-table" data-measure aria-label="Measurements">
        <thead>
          <tr>
            <th>Name</th>
            <th>Value</th>
            <th>Unit</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <MeasureRow
              key={`${row.id}-${row.valueMilli}-${row.unit}`}
              row={row}
              locked={locked}
              onSave={(next) => save({ id: row.id, name: row.name, value: next.value, unit: next.unit })}
              onDelete={async () => {
                const result = await deleteMeasurementAction(estimateId, row.id);
                if (result?.error) setError(result.error);
                else {
                  setError(null);
                  router.refresh();
                }
              }}
            />
          ))}
          {locked ? null : (
            <tr>
              <td>
                <input aria-label="Measurement name" className="ctl" value={name} onChange={(event) => setName(event.target.value)} />
              </td>
              <td>
                <input aria-label="Measurement value" className="ctl num" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} />
              </td>
              <td>
                <select aria-label="Measurement unit" className="ctl" value={unit} onChange={(event) => setUnit(event.target.value)}>
                  {UNITS.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </td>
              <td>
                <button
                  type="button"
                  className="ctl"
                  onClick={() => save({ name, value, unit })}
                >
                  Add
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {error ? (
        <p role="alert" className="est-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function MeasureRow({
  row,
  locked,
  onSave,
  onDelete,
}: {
  row: MeasureRowData;
  locked: boolean;
  onSave: (next: { value: string; unit: string }) => void;
  onDelete: () => void;
}) {
  const [value, setValue] = useState(formatQty(row.valueMilli));
  const [unit, setUnit] = useState(row.unit);
  return (
    <tr>
      <td>{row.name}</td>
      <td>
        <input
          aria-label={row.name}
          className="ctl num"
          inputMode="decimal"
          value={value}
          disabled={locked}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => {
            if (value !== formatQty(row.valueMilli)) onSave({ value, unit });
          }}
        />
      </td>
      <td>
        <select
          aria-label={`${row.name} unit`}
          className="ctl"
          value={unit}
          disabled={locked}
          onChange={(event) => {
            const next = event.target.value;
            setUnit(next);
            onSave({ value, unit: next });
          }}
        >
          {UNITS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </td>
      <td>
        {locked ? null : (
          <button type="button" className="ctl" aria-label={`Delete ${row.name}`} onClick={onDelete}>
            Delete
          </button>
        )}
      </td>
    </tr>
  );
}

export function FormulaBar({
  line,
  locked,
  onTyped,
  onFormula,
}: {
  line: FormulaLine | null;
  locked: boolean;
  onTyped: (id: string) => void;
  onFormula: (id: string, expr: string, wasteBps: number, roundToMilli: number | null) => void;
}) {
  const [expr, setExpr] = useState(line?.qtyFormula ?? "");
  const [waste, setWaste] = useState(line?.wasteBps ? String(line.wasteBps / 100) : "");
  const [round, setRound] = useState(line?.roundToMilli ? formatQty(line.roundToMilli) : "");
  if (!line || locked) return null;
  if (line.qtyFormula) {
    return (
      <p className="measure-formula" data-formula>
        {formulaCaption(line.qtyFormula, line.wasteBps, line.roundToMilli)}{" "}
        <button type="button" className="ctl" onClick={() => onTyped(line.id)}>
          Typed
        </button>
      </p>
    );
  }
  return (
    <form
      className="measure-formula"
      onSubmit={(event) => {
        event.preventDefault();
        const wasteBps = waste.trim() === "" ? 0 : Math.round(Number(waste) * 100);
        const roundToMilli = round.trim() === "" ? null : Math.round(Number(round) * 1000);
        onFormula(line.id, expr.trim(), wasteBps, roundToMilli);
      }}
    >
      <input aria-label="Formula" className="ctl" value={expr} onChange={(event) => setExpr(event.target.value)} placeholder="Floor" />
      <input aria-label="Waste" className="ctl num" inputMode="decimal" value={waste} onChange={(event) => setWaste(event.target.value)} placeholder="%" />
      <input aria-label="Round" className="ctl num" inputMode="decimal" value={round} onChange={(event) => setRound(event.target.value)} placeholder="Round" />
      <button type="submit" className="ctl">
        Use
      </button>
    </form>
  );
}
