import Link from "next/link";
import { redirect } from "next/navigation";
import { archiveFieldAction, createFieldAction, orderFieldsAction, restoreFieldAction, updateFieldAction } from "@/app/(office)/settings/fields/actions";
import { FieldTable } from "@/components/field-table";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { canManageSettings } from "@/lib/permissions";
import { FIELD_TYPES, listFields, RECORD_LABEL, RECORD_TYPES, TYPE_LABEL, type FieldDef } from "@/lib/services/custom-fields";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || "";
}

function Audience({ field }: { field?: FieldDef }) {
  const boxes = [
    ["office", "Office", field ? field.office : true],
    ["field", "Field", field ? field.field : true],
    ["vendor", "Vendor portal", field ? field.vendor : false],
    ["client", "Client portal", field ? field.client : false],
  ] as const;
  return (
    <span className="flex flex-wrap gap-2">
      {boxes.map(([name, label, on]) => (
        <label key={name} className="mac-t13">
          <input type="checkbox" name={name} value="1" defaultChecked={on} /> {label}
        </label>
      ))}
      <label className="mac-t13">
        <input type="checkbox" name="showOnDocuments" value="1" defaultChecked={field?.showOnDocuments ?? false} /> Show on documents
      </label>
    </span>
  );
}

function FieldForm({ field, recordType }: { field?: FieldDef; recordType: string }) {
  const action = field ? updateFieldAction : createFieldAction;
  return (
    <ActionForm action={action} className="flex flex-col gap-2" dataSheet="field">
      {field ? <input type="hidden" name="id" value={field.id} /> : <input type="hidden" name="recordType" value={recordType} />}
      <label className="text-[13px]">
        Label
        <input name="label" aria-label="Label" required defaultValue={field?.label ?? ""} className="field mt-1" />
      </label>
      <label className="text-[13px]">
        Type
        <select name="fieldType" aria-label="Type" defaultValue={field?.fieldType ?? "text"} className="ctl mt-1">
          {FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABEL[type]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[13px]">
        Choices
        <input name="options" aria-label="Choices" defaultValue={field?.options.join(", ") ?? ""} className="field mt-1" />
      </label>
      <label className="text-[13px]">
        Default
        <input name="defaultValue" aria-label="Default" defaultValue={field?.fieldType === "money" && field.defaultValue ? (Number(field.defaultValue) / 100).toFixed(2) : field?.defaultValue ?? ""} className="field mt-1" />
      </label>
      <label className="text-[13px]">
        Hint
        <input name="hint" aria-label="Hint" defaultValue={field?.hint ?? ""} className="field mt-1" />
      </label>
      <label className="mac-t13">
        <input type="checkbox" name="required" value="1" defaultChecked={field?.required ?? false} /> Required
      </label>
      <Audience field={field} />
      <div className="flex gap-2">
        <button type="submit" className="mac-primary w-fit">
          Save
        </button>
        <Link href="/settings/fields" className="ctl">
          Cancel
        </Link>
      </div>
    </ActionForm>
  );
}

export default async function CustomFieldsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!canManageSettings(session.role)) redirect("/settings");
  const query = await searchParams;
  const adding = one(query.new);
  const editing = one(query.field);
  const fields = listFields(session);
  const active = fields.filter((field) => !field.archived);
  const archived = fields.filter((field) => field.archived);
  const current = fields.find((field) => field.id === editing);
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar title="Custom fields" subtitle={`${active.length}`} search={false} />
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-8">
          {RECORD_TYPES.map((recordType) => {
            const rows = active.filter((field) => field.recordType === recordType);
            return (
              <section key={recordType} className="mb-6" aria-label={RECORD_LABEL[recordType]}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="mac-t11 font-semibold text-[var(--mac-secondary)]">{RECORD_LABEL[recordType]}</h2>
                  <Link href={`/settings/fields?new=${recordType}`} className="ctl">
                    New
                  </Link>
                </div>
                {rows.length === 0 ? <p className="mac-t13 text-[var(--mac-secondary)]">None</p> : <FieldTable recordType={recordType} rows={rows} archiveAction={archiveFieldAction} orderAction={orderFieldsAction} />}
              </section>
            );
          })}
          {archived.length > 0 ? (
            <section aria-label="Archived">
              <h2 className="mac-t11 mb-2 font-semibold text-[var(--mac-secondary)]">Archived</h2>
              <ul>
                {archived.map((field) => (
                  <li key={field.id} className="flex items-center gap-2 py-1">
                    <span className="mac-t13">{field.label}</span>
                    <span className="mac-t11 text-[var(--mac-secondary)]">{RECORD_LABEL[field.recordType]}</span>
                    <form action={restoreFieldAction}>
                      <input type="hidden" name="id" value={field.id} />
                      <button type="submit" className="ctl">
                        Restore
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
      {adding && (RECORD_TYPES as readonly string[]).includes(adding) ? (
        <aside className="w-full shrink-0 overflow-auto border-l border-[var(--mac-separator)] p-4 md:w-[360px]">
          <FieldForm recordType={adding} />
        </aside>
      ) : null}
      {current ? (
        <aside className="w-full shrink-0 overflow-auto border-l border-[var(--mac-separator)] p-4 md:w-[360px]">
          <FieldForm field={current} recordType={current.recordType} />
        </aside>
      ) : null}
    </div>
  );
}
