import Link from "next/link";
import { saveFieldsAction } from "@/app/(office)/settings/fields/actions";
import { ActionForm } from "@/components/action-form";
import type { ValueRow } from "@/lib/services/custom-fields";
import { fieldPeople } from "@/lib/services/custom-fields";

function formValue(row: ValueRow) {
  if (row.fieldType === "money" && row.value) return (Number(row.value) / 100).toFixed(2);
  if (row.fieldType === "multi") {
    try {
      const parsed = JSON.parse(row.value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return row.value;
}

export function FieldRows({ rows }: { rows: ValueRow[] }) {
  if (rows.length === 0) return null;
  return (
    <dl className="mac-kv wide" aria-label="Fields">
      {rows.map((row) => (
        <div key={row.id}>
          <dt>{row.label}</dt>
          <dd>{row.missing ? <span className="fl-pill">Missing</span> : row.display}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FieldSheet({
  rows,
  recordType,
  recordId,
  orgId,
  cancelHref,
}: {
  rows: ValueRow[];
  recordType: string;
  recordId: string;
  orgId: string;
  cancelHref: string;
}) {
  const people = fieldPeople(orgId);
  return (
    <aside data-sheet="fields" aria-label="Fields" className="fixed inset-y-0 right-0 z-40 flex w-[320px] flex-col gap-3 overflow-auto border-l border-[var(--mac-separator)] bg-[var(--mac-window)] p-4">
      <ActionForm action={saveFieldsAction} className="flex flex-col gap-3">
        <input type="hidden" name="recordType" value={recordType} />
        <input type="hidden" name="recordId" value={recordId} />
        <input type="hidden" name="returnTo" value={cancelHref} />
        {rows.map((row) => {
          const current = formValue(row);
          const chosen = Array.isArray(current) ? current : [];
          return (
            <label key={row.id} className="text-[13px]">
              {row.label}
              {row.required ? " *" : ""}
              {row.fieldType === "yes_no" ? (
                <select name={row.id} aria-label={row.label} defaultValue={typeof current === "string" ? current : ""} className="ctl mt-1">
                  <option value="">—</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : null}
              {row.fieldType === "single" ? (
                <select name={row.id} aria-label={row.label} defaultValue={typeof current === "string" ? current : ""} className="ctl mt-1">
                  <option value="">—</option>
                  {row.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : null}
              {row.fieldType === "person" ? (
                <select name={row.id} aria-label={row.label} defaultValue={typeof current === "string" ? current : ""} className="ctl mt-1">
                  <option value="">—</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              ) : null}
              {row.fieldType === "multi" ? (
                <span className="mt-1 flex flex-col gap-1">
                  {row.options.map((option) => (
                    <label key={option} className="mac-t13">
                      <input type="checkbox" name={row.id} value={option} defaultChecked={chosen.includes(option)} /> {option}
                    </label>
                  ))}
                </span>
              ) : null}
              {row.fieldType === "date" ? <input name={row.id} aria-label={row.label} type="date" defaultValue={typeof current === "string" ? current : ""} className="field mt-1" /> : null}
              {row.fieldType === "number" || row.fieldType === "money" ? (
                <input name={row.id} aria-label={row.label} inputMode="decimal" defaultValue={typeof current === "string" ? current : ""} className="field mt-1" />
              ) : null}
              {row.fieldType === "link" ? <input name={row.id} aria-label={row.label} type="url" defaultValue={typeof current === "string" ? current : ""} className="field mt-1" /> : null}
              {row.fieldType === "text" ? <input name={row.id} aria-label={row.label} defaultValue={typeof current === "string" ? current : ""} className="field mt-1" /> : null}
              {row.hint ? <span className="mt-1 block mac-t11 text-[var(--mac-secondary)]">{row.hint}</span> : null}
            </label>
          );
        })}
        <div className="flex gap-2">
          <button type="submit" className="mac-primary w-fit">
            Save
          </button>
          <Link href={cancelHref} className="ctl">
            Cancel
          </Link>
        </div>
      </ActionForm>
    </aside>
  );
}

export function FieldInputs({ rows, orgId }: { rows: ValueRow[]; orgId: string }) {
  const people = fieldPeople(orgId);
  if (rows.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-2" aria-label="Fields">
      {rows.map((row) => {
        const current = formValue(row);
        const chosen = Array.isArray(current) ? current : [];
        return (
          <label key={row.id} className="text-[13px]">
            {row.label}
            {row.required ? " *" : ""}
            {row.fieldType === "yes_no" || row.fieldType === "single" || row.fieldType === "person" ? (
              <select name={row.id} aria-label={row.label} defaultValue={typeof current === "string" ? current : ""} className="field mt-1">
                <option value="">—</option>
                {row.fieldType === "yes_no" ? (
                  <>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </>
                ) : null}
                {row.fieldType === "single" ? row.options.map((option) => <option key={option} value={option}>{option}</option>) : null}
                {row.fieldType === "person" ? people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>) : null}
              </select>
            ) : null}
            {row.fieldType === "text" || row.fieldType === "number" || row.fieldType === "money" || row.fieldType === "date" || row.fieldType === "link" ? (
              <input name={row.id} aria-label={row.label} defaultValue={typeof current === "string" ? current : ""} className="field mt-1" />
            ) : null}
            {row.fieldType === "multi"
              ? row.options.map((option) => (
                  <span key={option} className="mt-1 flex items-center gap-2">
                    <input type="checkbox" name={row.id} value={option} defaultChecked={chosen.includes(option)} /> {option}
                  </span>
                ))
              : null}
            {row.hint ? <span className="mt-1 block mac-t11 text-[var(--mac-secondary)]">{row.hint}</span> : null}
          </label>
        );
      })}
    </fieldset>
  );
}

export function RecordFields({
  rows,
  recordType,
  recordId,
  orgId,
  editing,
  editHref,
  cancelHref,
}: {
  rows: ValueRow[];
  recordType: string;
  recordId: string;
  orgId: string;
  editing: boolean;
  editHref: string;
  cancelHref: string;
}) {
  if (rows.length === 0 && !editing) return null;
  return (
    <section aria-label="Fields">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="mac-t11 font-semibold text-[var(--mac-secondary)]">Fields</p>
        {editing ? null : (
          <Link href={editHref} className="ctl">
            Edit
          </Link>
        )}
      </div>
      <FieldRows rows={rows} />
      {editing ? <FieldSheet rows={rows} recordType={recordType} recordId={recordId} orgId={orgId} cancelHref={cancelHref} /> : null}
    </section>
  );
}
