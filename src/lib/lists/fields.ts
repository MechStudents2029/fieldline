import { withPatch } from "@/lib/lists/query";
import { customCell, customColumns, customFilters, matchesCustom } from "@/lib/services/custom-fields";
import type { Actor } from "@/lib/services/read";

export function fieldList(actor: Actor, recordType: string, path: string, current: Record<string, string>) {
  const specs = customFilters(actor, recordType);
  const columns = customColumns(actor, recordType);
  const chosen = new Set((current.cols || "").split(",").filter(Boolean));
  const visible = columns.filter((column) => chosen.has(column.key));
  return {
    keys: [...specs.map((spec) => spec.name), "cols"],
    filters: specs.map((spec) => ({
      name: spec.name,
      label: spec.label,
      value: current[spec.name] || "",
      any: "Any",
      options: spec.options,
    })),
    columns: columns.map((column) => {
      const on = chosen.has(column.key);
      const next = new Set(chosen);
      if (on) next.delete(column.key);
      else next.add(column.key);
      const cols = [...next].join(",");
      return { id: column.key, label: column.label, on, href: withPatch(path, current, { cols: cols || null }) };
    }),
    visible,
    match: (recordId: string) => matchesCustom(actor, recordType, recordId, current),
    cell: (recordId: string, fieldId: string) => customCell(actor, recordId, fieldId),
  };
}
