"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type JobListItem = { href: string; title: string; subtitle: string; group: string };

export function JobList({ items, selected }: { items: JobListItem[]; selected: string }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const names = ["In progress", "Up next", "Estimating", "Completed"];
    return names
      .map((label) => ({ label, rows: items.filter((item) => item.group === label && `${item.title} ${item.subtitle}`.toLowerCase().includes(needle)) }))
      .filter((group) => group.rows.length > 0);
  }, [items, needle]);
  return (
    <div className="flex h-full flex-col border-r border-[var(--mac-separator)] bg-[var(--mac-under)]">
      <input className="mx-3 mt-3 h-7 rounded-md bg-[var(--mac-fill)] px-2 mac-t13" aria-label="Filter jobs" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="min-h-0 flex-1 overflow-auto p-2" data-mac-list>
        {groups.map((group) => (
          <section key={group.label}>
            <p className="px-2 pb-1 pt-3 mac-t11 font-semibold text-[var(--mac-secondary)]">{group.label}</p>
            <ul>
              {group.rows.map((row) => (
                <li key={row.href}>
                  <Link href={row.href} aria-current={selected === row.href ? "page" : undefined} className={`block rounded-lg px-2 py-1.5 ${selected === row.href ? "bg-[var(--mac-sel)] text-white" : ""}`}>
                    <span className="block truncate mac-t13 font-semibold">{row.title}</span>
                    <span className={`block truncate text-[12px] ${selected === row.href ? "text-white/80" : "text-[var(--mac-secondary)]"}`}>{row.subtitle}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
