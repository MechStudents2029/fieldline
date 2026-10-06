"use client";

import { useCallback, useEffect, useState } from "react";
import {
  approveSelectionAction,
  draftSelectionCoAction,
  lockSelectionAction,
  releaseSelectionAction,
  resetSelectionAction,
  saveSelectionAction,
  type ActionState,
} from "@/app/actions";
import { GroupedList, GroupedRow, StatusPill } from "@/components/ios";
import { Toolbar } from "@/components/mac/toolbar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatCalendarDay } from "@/lib/format";
import { formatWhole } from "@/lib/money";
import { formatSelectionDelta } from "@/lib/selections/money";
import type { SelectionBoard, SelectionView } from "@/lib/services/selections";

type DraftChoice = { name: string; vendor: string; sku: string; price: string; cost: string; note: string };

function blankChoice(): DraftChoice {
  return { name: "", vendor: "", sku: "", price: "", cost: "", note: "" };
}

function dollars(cents: number | null) {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

function fromRow(row: SelectionView): DraftChoice[] {
  return row.choices.map((choice) => ({
    name: choice.name,
    vendor: choice.vendor ?? "",
    sku: choice.sku ?? "",
    price: dollars(choice.unitPriceCents),
    cost: dollars(choice.unitCostCents),
    note: choice.note ?? "",
  }));
}

function netLabel(cents: number) {
  if (cents === 0) return formatWhole(0);
  return formatSelectionDelta(cents);
}

function DoneForm({
  action,
  onDone,
  className,
  children,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  onDone: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<ActionState>(null);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  return (
    <form
      className={className}
      action={async (formData) => {
        const next = await action(null, formData);
        setState(next);
      }}
    >
      {children}
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function Status({ row }: { row: SelectionView }) {
  if (row.status === "draft" || row.status === "released") return <StatusPill>{row.statusLabel}</StatusPill>;
  return <span className="text-[var(--mac-secondary)]">{row.statusLabel}</span>;
}

export function SelectionsBoard({ board }: { board: SelectionBoard }) {
  const [open, setOpen] = useState(false);
  const [ticket, setTicket] = useState(0);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const finish = useCallback(() => setOpen(false), []);
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [due, setDue] = useState("");
  const [qty, setQty] = useState("1");
  const [allowanceId, setAllowanceId] = useState("");
  const [choices, setChoices] = useState<DraftChoice[]>([blankChoice(), blankChoice()]);
  const current = board.rows.find((row) => row.id === currentId) ?? null;
  const editable = board.canEdit && (!current || current.status === "draft" || current.status === "released");

  function showNew() {
    setTicket((value) => value + 1);
    setCurrentId(null);
    setTitle("");
    setArea("");
    setDue("");
    setQty("1");
    setAllowanceId("");
    setChoices([blankChoice(), blankChoice()]);
    setOpen(true);
  }

  function showRow(row: SelectionView) {
    setTicket((value) => value + 1);
    setCurrentId(row.id);
    setTitle(row.title);
    setArea(row.area);
    setDue(row.dueDate ?? "");
    setQty(String(row.qty));
    setAllowanceId(board.allowances.find((line) => line.name === row.allowanceName)?.id ?? "");
    setChoices(fromRow(row));
    setOpen(true);
  }

  function patchChoice(index: number, patch: Partial<DraftChoice>) {
    setChoices((rows) => rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="flex flex-col">
      <Toolbar
        title="Selections"
        subtitle={board.projectName}
        search={false}
        onPrimary={board.canEdit ? showNew : undefined}
        primary={board.canEdit ? "Add" : undefined}
      />
      {board.showMoney ? (
        <div className="mac-strip mx-4 mb-4 hidden md:flex">
          <div>
            <p className="mac-t22 num">{formatWhole(board.allowanceTotalCents)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Allowance</p>
          </div>
          <div>
            <p className="mac-t22 num">{formatWhole(board.chosenTotalCents)}</p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Chosen</p>
          </div>
          <div>
            <p className={`mac-t22 num ${(board.differenceCents ?? 0) > 0 ? "text-[var(--mac-danger)]" : ""}`}>
              {netLabel(board.differenceCents ?? 0)}
            </p>
            <p className="mac-t11 text-[var(--mac-secondary)]">Difference</p>
          </div>
        </div>
      ) : null}
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 md:hidden">
        {board.showMoney ? (
          <div className="mac-strip">
            <div>
              <p className="mac-t22 num">{formatWhole(board.allowanceTotalCents)}</p>
              <p className="mac-t11 text-[var(--mac-secondary)]">Allowance</p>
            </div>
            <div>
              <p className="mac-t22 num">{formatWhole(board.chosenTotalCents)}</p>
              <p className="mac-t11 text-[var(--mac-secondary)]">Chosen</p>
            </div>
            <div>
              <p className="mac-t22 num">{netLabel(board.differenceCents ?? 0)}</p>
              <p className="mac-t11 text-[var(--mac-secondary)]">Difference</p>
            </div>
          </div>
        ) : null}
        <GroupedList label="Selections">
          {board.rows.map((row) => (
            <GroupedRow
              key={row.id}
              title={row.title}
              subtitle={row.area || undefined}
              trailing={<span className={row.overdue ? "fl-late" : undefined}>{row.chosenName || row.statusLabel}</span>}
              chevron={false}
            />
          ))}
        </GroupedList>
        {board.canEdit ? (
          <ul className="fl-group">
            {board.rows.map((row) => (
              <li key={row.id} className="fl-cell">
                <button type="button" className="fl-body text-[var(--fl-accent)]" onClick={() => showRow(row)}>
                  Open {row.title}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="hidden flex-col md:flex">
        <div className="overflow-auto px-4">
          <table className="mac-table w-full text-left">
            <thead>
              <tr>
                <th className="px-2">Selection</th>
                <th className="px-2">Area</th>
                <th className="px-2">Due</th>
                {board.showMoney ? <th className="px-2 text-right">Allowance</th> : null}
                <th className="px-2">Chosen</th>
                {board.showMoney ? <th className="px-2 text-right">Difference</th> : null}
                <th className="px-2">Status</th>
                {board.canEdit ? <th className="px-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {board.rows.map((row) => (
                <tr key={row.id} data-mac-row={`${row.title} ${row.area} ${row.chosenName ?? ""}`}>
                  <th scope="row" className="mac-name px-2 font-normal">
                    {row.title}
                  </th>
                  <td className="px-2 text-[var(--mac-secondary)]">{row.area || "—"}</td>
                  <td className={`px-2 ${row.overdue ? "text-[var(--mac-danger)]" : ""}`}>{formatCalendarDay(row.dueDate)}</td>
                  {board.showMoney ? <td className="px-2 text-right num">{row.allowanceLabel ?? "—"}</td> : null}
                  <td className="px-2">{row.chosenName ?? "—"}</td>
                  {board.showMoney ? <td className="px-2 text-right num">{row.differenceLabel ?? "—"}</td> : null}
                  <td className="px-2">
                    <span className="inline-flex items-center gap-2">
                      <Status row={row} />
                      {row.changeOrderStatus === "draft" ? <span className="text-[var(--mac-secondary)]">CO draft</span> : null}
                    </span>
                  </td>
                  {board.canEdit ? (
                    <td className="px-2 text-right">
                      <button type="button" className="text-[var(--mac-accent)]" onClick={() => showRow(row)}>
                        Open {row.title}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex h-[30px] items-center border-t border-[var(--mac-separator)] px-4 mac-t11 text-[var(--mac-secondary)]">
          {board.rows.length} {board.rows.length === 1 ? "selection" : "selections"}
        </div>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent key={ticket} className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{current ? current.title : "New selection"}</SheetTitle>
            <SheetDescription>{current?.area || "Choices"}</SheetDescription>
          </SheetHeader>
          {editable ? (
            <DoneForm action={saveSelectionAction.bind(null, board.projectId)} onDone={finish} className="flex flex-col gap-3 px-4">
              <input type="hidden" name="selectionId" value={current?.id ?? ""} />
              <input type="hidden" name="choiceCount" value={choices.length} />
              <label className="mac-t13">
                Title
                <input name="title" value={title} onChange={(event) => setTitle(event.target.value)} className="field mt-1" required />
              </label>
              <label className="mac-t13">
                Area
                <input name="area" value={area} onChange={(event) => setArea(event.target.value)} className="field mt-1" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="mac-t13">
                  Due
                  <input type="date" name="due" value={due} onChange={(event) => setDue(event.target.value)} className="field mt-1" />
                </label>
                <label className="mac-t13">
                  Qty
                  <input name="qty" value={qty} onChange={(event) => setQty(event.target.value)} className="field mt-1" inputMode="decimal" />
                </label>
              </div>
              {board.showMoney ? (
                <label className="mac-t13">
                  Allowance
                  <select name="allowanceId" value={allowanceId} onChange={(event) => setAllowanceId(event.target.value)} className="field mt-1">
                    <option value="">None</option>
                    {board.allowances.map((line) => (
                      <option key={line.id} value={line.id}>
                        {line.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <input type="hidden" name="allowanceId" value="" />
              )}
              {choices.map((choice, index) => (
                <fieldset key={index} className="flex flex-col gap-2 rounded-lg border border-[var(--mac-separator)] p-3">
                  <legend className="px-1 mac-t11 text-[var(--mac-secondary)]">Choice {index + 1}</legend>
                  <input name={`choice_${index}_name`} value={choice.name} onChange={(event) => patchChoice(index, { name: event.target.value })} aria-label={`Choice ${index + 1} name`} className="field" placeholder="Name" />
                  <input name={`choice_${index}_vendor`} value={choice.vendor} onChange={(event) => patchChoice(index, { vendor: event.target.value })} aria-label={`Choice ${index + 1} vendor`} className="field" placeholder="Vendor" />
                  <input name={`choice_${index}_sku`} value={choice.sku} onChange={(event) => patchChoice(index, { sku: event.target.value })} aria-label={`Choice ${index + 1} sku`} className="field" placeholder="SKU" />
                  <div className="grid grid-cols-2 gap-2">
                    <input name={`choice_${index}_price`} value={choice.price} onChange={(event) => patchChoice(index, { price: event.target.value })} aria-label={`Choice ${index + 1} price`} className="field" inputMode="decimal" placeholder="Price" />
                    <input name={`choice_${index}_cost`} value={choice.cost} onChange={(event) => patchChoice(index, { cost: event.target.value })} aria-label={`Choice ${index + 1} cost`} className="field" inputMode="decimal" placeholder="Cost" />
                  </div>
                  {current?.choices[index]?.deltaLabel ? <p className="num mac-t11 text-[var(--mac-secondary)]">{current.choices[index]?.deltaLabel}</p> : null}
                </fieldset>
              ))}
              <button type="button" className="text-left mac-t13 text-[var(--mac-accent)]" onClick={() => setChoices((rows) => [...rows, blankChoice()])}>
                Add choice
              </button>
              <button type="submit" className="mac-primary w-fit">
                Save
              </button>
            </DoneForm>
          ) : null}
          {current && board.showMoney ? (
            <ul className="flex flex-col gap-2 px-4">
              {current.choices.map((choice) => (
                <li key={choice.id} className="flex items-baseline justify-between gap-3">
                  <span>{choice.name}</span>
                  <span className="num">{choice.deltaLabel}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {current && board.canEdit && (current.status === "draft" || current.status === "released") ? (
            <DoneForm action={approveSelectionAction.bind(null, board.projectId)} onDone={finish} className="flex flex-col gap-2 px-4">
              <input type="hidden" name="selectionId" value={current.id} />
              <label className="mac-t13">
                Choice
                <select name="choiceId" className="field mt-1" defaultValue={current.choices[0]?.id}>
                  {current.choices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.name}
                    </option>
                  ))}
                </select>
              </label>
              <input name="note" aria-label="Note" placeholder="in person" className="field" />
              <button type="submit" className="mac-primary w-fit">
                Approve
              </button>
            </DoneForm>
          ) : null}
          {current && board.canEdit ? (
            <div className="flex flex-wrap gap-2 px-4 pb-4">
              {current.status === "draft" ? (
                <DoneForm action={releaseSelectionAction.bind(null, board.projectId)} onDone={finish}>
                  <input type="hidden" name="selectionId" value={current.id} />
                  <button type="submit" className="mac-glass-btn">
                    Release
                  </button>
                </DoneForm>
              ) : null}
              {current.status === "released" || current.status === "chosen" ? (
                <DoneForm action={lockSelectionAction.bind(null, board.projectId)} onDone={finish}>
                  <input type="hidden" name="selectionId" value={current.id} />
                  <button type="submit" className="mac-glass-btn">
                    Lock
                  </button>
                </DoneForm>
              ) : null}
              {current.draftLabel ? (
                <DoneForm action={draftSelectionCoAction.bind(null, board.projectId)} onDone={finish}>
                  <input type="hidden" name="selectionId" value={current.id} />
                  <button type="submit" className="mac-primary">
                    Draft change order for {current.draftLabel}
                  </button>
                </DoneForm>
              ) : null}
            </div>
          ) : null}
          {current && board.canEdit && (current.status === "chosen" || current.status === "locked") ? (
            <DoneForm action={resetSelectionAction.bind(null, board.projectId)} onDone={finish} className="flex flex-col gap-2 px-4 pb-6">
              <input type="hidden" name="selectionId" value={current.id} />
              <input name="reason" aria-label="Reason" placeholder="Reason" className="field" />
              <button type="submit" className="mac-glass-btn w-fit">
                Reset
              </button>
            </DoneForm>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
