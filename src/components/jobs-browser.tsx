"use client";

import { useState } from "react";
import { GroupedList, GroupedRow, StatusPill } from "@/components/ios";

export type JobItem = {
  href: string;
  title: string;
  subtitle: string;
  trailing: string;
  tone?: "late" | "close";
  pill?: string;
};

export function JobsBrowser({
  inProgress,
  upNext,
  estimating,
  completed,
}: {
  inProgress: JobItem[];
  upNext: JobItem[];
  estimating: JobItem[];
  completed: JobItem[];
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const match = (row: JobItem) => `${row.title} ${row.subtitle}`.toLowerCase().includes(needle);
  const groups = [
    { label: "In progress", rows: inProgress.filter(match) },
    { label: "Up next", rows: upNext.filter(match) },
    { label: "Estimating", rows: estimating.filter(match) },
  ];
  const done = completed.filter(match);
  return (
    <div className="flex flex-col gap-7">
      <input className="fl-search" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search" />
      {groups.map((group) =>
        group.rows.length === 0 ? null : (
          <GroupedList key={group.label} label={group.label}>
            {group.rows.map((row) => (
              <GroupedRow
                key={row.href}
                href={row.href}
                title={row.title}
                subtitle={row.subtitle}
                trailing={
                  row.pill ? (
                    <StatusPill>{row.pill}</StatusPill>
                  ) : (
                    <span className={row.tone === "late" ? "fl-late" : row.tone === "close" ? "fl-close" : "text-[var(--fl-secondary)]"}>{row.trailing}</span>
                  )
                }
              />
            ))}
          </GroupedList>
        ),
      )}
      {done.length > 0 ? (
        <GroupedList label="Completed">
          <GroupedRow href={done[0]?.href ?? "/projects"} title="Completed" subtitle="" trailing={String(completed.length)} />
        </GroupedList>
      ) : null}
    </div>
  );
}
