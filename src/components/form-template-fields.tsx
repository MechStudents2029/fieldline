import { AUDIENCES, FIELD_TYPES, type Audience, type FormField } from "@/lib/forms/template";

export function AudienceChecks({ selected }: { selected: Audience[] }) {
  return (
    <fieldset className="flex flex-wrap gap-3">
      <legend className="sr-only">Who can fill this</legend>
      {AUDIENCES.map((audience) => (
        <label key={audience} className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="audience" value={audience} defaultChecked={selected.includes(audience)} />
          {audience === "office" ? "Office" : audience === "field" ? "Field" : audience === "client" ? "Client" : "Vendor"}
        </label>
      ))}
    </fieldset>
  );
}

export function FieldSlots({ fields }: { fields: FormField[] }) {
  const count = Math.max(fields.length, 4);
  const slots = Array.from({ length: count }, (_, index) => fields[index]);
  return (
    <div className="flex flex-col gap-3">
      {slots.map((field, index) => (
        <div key={field?.id ?? `new-${index}`} className="grid grid-cols-2 gap-2 border-b border-[var(--mac-separator)] py-2">
          <input type="hidden" name={`field_id_${index}`} value={field?.id ?? ""} />
          <label className="col-span-2 text-sm">
            Label
            <input name={`field_label_${index}`} aria-label={index === 0 ? "Field label" : `Field label ${index + 1}`} defaultValue={field?.label ?? ""} className="field mt-1" />
          </label>
          <label className="text-sm">
            Type
            <select name={`field_type_${index}`} aria-label={index === 0 ? "Field type" : `Field type ${index + 1}`} defaultValue={field?.type ?? "text"} className="field mt-1">
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Options
            <input name={`field_options_${index}`} aria-label={index === 0 ? "Options" : `Options ${index + 1}`} defaultValue={field?.options.join(", ") ?? ""} className="field mt-1" />
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name={`field_required_${index}`} value="1" defaultChecked={field?.required ?? false} aria-label={index === 0 ? "Required" : `Required ${index + 1}`} />
            Required
          </label>
        </div>
      ))}
    </div>
  );
}
