"use client";

import { useRouter } from "next/navigation";

export function SafetyFilters({
  path,
  type,
  status,
  job,
  jobs,
}: {
  path: string;
  type: string;
  status: string;
  job: string;
  jobs: { id: string; name: string }[] | null;
}) {
  const router = useRouter();
  function push(name: string, value: string) {
    const url = new URL(path, window.location.origin);
    const current = new URLSearchParams(window.location.search);
    if (type) current.set("type", type);
    if (status) current.set("status", status);
    if (job) current.set("job", job);
    if (value) current.set(name, value);
    else current.delete(name);
    const query = current.toString();
    router.push(query ? `${url.pathname}?${query}` : url.pathname);
  }
  return (
    <div data-bar="safety" className="flex items-center gap-2 overflow-x-auto px-4 pb-2">
      <select aria-label="Type" className="list-select" value={type} onChange={(event) => push("type", event.target.value)}>
        <option value="">Type: Any</option>
        <option value="talk">Type: Talk</option>
        <option value="check">Type: Checklist</option>
        <option value="incident">Type: Incident</option>
      </select>
      <select aria-label="Status" className="list-select" value={status} onChange={(event) => push("status", event.target.value)}>
        <option value="">Status: Any</option>
        <option value="upcoming">Status: Upcoming</option>
        <option value="missed">Status: Missed</option>
        <option value="completed">Status: Completed</option>
        <option value="open">Status: Open</option>
        <option value="void">Status: Void</option>
      </select>
      {jobs ? (
        <select aria-label="Job" className="list-select" value={job} onChange={(event) => push("job", event.target.value)}>
          <option value="">Job: Any</option>
          {jobs.map((row) => (
            <option key={row.id} value={row.id}>
              Job: {row.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
