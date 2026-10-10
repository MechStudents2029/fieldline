"use client";

import { useRouter } from "next/navigation";

export function EquipmentFilters({
  status,
  category,
  categories,
}: {
  status: string;
  category: string;
  categories: string[];
}) {
  const router = useRouter();
  function push(name: string, value: string) {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(name, value);
    else url.searchParams.delete(name);
    url.searchParams.delete("edit");
    url.searchParams.delete("new");
    router.push(`${url.pathname}${url.search}`);
  }
  return (
    <div data-bar="equipment" className="flex items-center gap-2 px-4 pb-2">
      <select aria-label="Status" className="ctl" value={status} onChange={(event) => push("status", event.target.value)}>
        <option value="">All</option>
        <option value="available">Available</option>
        <option value="on_job">On job</option>
        <option value="with_person">With person</option>
        <option value="in_service">In service</option>
        <option value="lost">Lost</option>
        <option value="retired">Retired</option>
      </select>
      <select aria-label="Category" className="ctl" value={category} onChange={(event) => push("category", event.target.value)}>
        <option value="">All</option>
        {categories.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    </div>
  );
}
