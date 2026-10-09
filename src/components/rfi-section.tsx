import Link from "next/link";
import { RfiCreateForm } from "@/components/rfi-create-form";
import { formatCalendarDay } from "@/lib/format";
import type { JobRfiBoard } from "@/lib/services/rfis";

function Pill({ children }: { children: string }) {
  return <span className="fl-pill">{children}</span>;
}

export function RfiSection({ board }: { board: JobRfiBoard }) {
  return (
    <section id="rfis" aria-label="RFIs" className="mb-6 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="fl-section">RFIs</h2>
        <span className="flex gap-3 text-sm">
          <Link href={`/projects/${board.projectId}/rfis/print`}>Print</Link>
          <a href={`/api/export/rfis?project=${board.projectId}`}>CSV</a>
        </span>
      </div>
      <div className="hidden md:block">
        <table className="mac-table" aria-label="RFI log">
          <thead>
            <tr>
              <th>Number</th>
              <th>Title</th>
              <th>Assignee</th>
              <th>Due</th>
              <th>Age</th>
              <th>Status</th>
              <th>Impact</th>
            </tr>
          </thead>
          <tbody>
            {board.items.map((item) => (
              <tr key={item.id}>
                <td className="num">{item.label}</td>
                <td>
                  <Link href={item.href}>{item.title}</Link>
                </td>
                <td>{item.assigneeName}</td>
                <td className="fit num" data-fit="date">{item.dueOn ? formatCalendarDay(item.dueOn) : "—"}</td>
                <td className="num">{item.ageDays}</td>
                <td className="fit" data-fit="status">
                  <Pill>{item.statusLabel}</Pill>
                </td>
                <td className="num">{item.impact}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="fl-group md:hidden" aria-label="RFI list">
        {board.items.map((item) => (
          <li key={item.id}>
            <Link href={item.href} className="fl-cell">
              <span className="min-w-0 flex-1">
                <span className="fl-body block truncate">
                  {item.label} · {item.title}
                </span>
                <span className="fl-footnote block truncate text-[var(--fl-secondary)]">
                  {item.assigneeName}
                  {item.dueOn ? ` · ${formatCalendarDay(item.dueOn)}` : ""} · {item.ageDays}d
                </span>
              </span>
              <Pill>{item.statusLabel}</Pill>
            </Link>
          </li>
        ))}
      </ul>
      {board.canAdd ? <RfiCreateForm projectId={board.projectId} canClose={board.canClose} assignees={board.assignees} related={board.related} /> : null}
    </section>
  );
}
