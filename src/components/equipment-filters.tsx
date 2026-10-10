"use client";

import { useRouter } from "next/navigation";

export function EquipmentFilters({ status, place }: { status: string; place: string }) {
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
      <select aria-label="Status" className="list-select" value={status} onChange={(event) => push("status", event.target.value)}>
        <option value="">Status: Any</option>
        <option value="available">Status: Available</option>
        <option value="on_job">Status: On job</option>
        <option value="with_person">Status: With person</option>
        <option value="in_service">Status: In service</option>
        <option value="lost">Status: Lost</option>
        <option value="retired">Status: Retired</option>
      </select>
      <select aria-label="Location" className="list-select" value={place} onChange={(event) => push("place", event.target.value)}>
        <option value="">Location: Any</option>
        <option value="yard">Location: Yard</option>
        <option value="job">Location: Job</option>
        <option value="person">Location: Person</option>
      </select>
    </div>
  );
}
