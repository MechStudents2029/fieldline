"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type Cell = { text: string; sort?: string | number; tone?: "late" | "pill" };
export type TableRow = { id: string; href?: string; hint?: string; badge?: string; cells: Record<string, Cell> };
export type TableGroup = { label: string; rows: TableRow[]; subtotal?: string };

export function DataTable({
  columns,
  rows = [],
  groups,
  status,
  initialSort = null,
  footer,
}: {
  columns: { key: string; header: string; align?: "right"; fit?: boolean; clip?: boolean }[];
  rows?: TableRow[];
  groups?: TableGroup[];
  status?: string;
  initialSort?: { key: string; dir: "asc" | "desc" } | null;
  footer?: TableRow;
}) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(initialSort);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; href?: string } | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});

  const visible = useMemo(() => {
    const source = groups ?? [{ label: "", rows }];
    const sortRows = (list: TableRow[]) => {
      if (!sort) return list;
      const copy = [...list];
      copy.sort((a, b) => {
        const left = a.cells[sort.key]?.sort ?? a.cells[sort.key]?.text ?? "";
        const right = b.cells[sort.key]?.sort ?? b.cells[sort.key]?.text ?? "";
        const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
        return sort.dir === "asc" ? order : -order;
      });
      return copy;
    };
    return source.map((group) => ({ ...group, rows: sortRows(group.rows) })).filter((group) => !closed[group.label]);
  }, [groups, rows, sort, closed]);
  const flat = visible.flatMap((group) => group.rows);

  function onKey(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((index) => Math.min(flat.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      const href = flat[selected]?.href;
      if (href) router.push(href);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto" data-mac-list tabIndex={0} onKeyDown={onKey}>
        <table className="mac-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} style={{ width: widths[column.key] }} className={column.align === "right" ? "text-right" : undefined}>
                  <button
                    type="button"
                    className={`inline-flex w-full items-center gap-1 px-2.5 ${column.align === "right" ? "justify-end" : "justify-start"}`}
                    onClick={() => setSort((current) => ({ key: column.key, dir: current?.key === column.key && current.dir === "asc" ? "desc" : "asc" }))}
                  >
                    {column.header}
                    {sort?.key === column.key ? (sort.dir === "asc" ? "↑" : "↓") : ""}
                  </button>
                  <span
                    aria-hidden
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
                    onMouseDown={(event) => {
                      const startX = event.clientX;
                      const start = widths[column.key] || (event.currentTarget.parentElement?.clientWidth ?? 120);
                      const move = (moveEvent: MouseEvent) => setWidths((current) => ({ ...current, [column.key]: Math.max(72, start + moveEvent.clientX - startX) }));
                      const up = () => {
                        window.removeEventListener("mousemove", move);
                        window.removeEventListener("mouseup", up);
                      };
                      window.addEventListener("mousemove", move);
                      window.addEventListener("mouseup", up);
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(groups ?? [{ label: "", rows, subtotal: undefined }]).filter((group) => group.rows.length > 0 || !group.label).map((group) => (
              <GroupBlock
                key={group.label || "rows"}
                group={group}
                columns={columns}
                closed={Boolean(closed[group.label])}
                sorted={visible.find((item) => item.label === group.label)?.rows ?? []}
                flat={flat}
                selected={selected}
                onToggle={() => setClosed((current) => ({ ...current, [group.label]: !current[group.label] }))}
                onSelect={setSelected}
                onMenu={(event, href) => {
                  event.preventDefault();
                  setMenu({ x: event.clientX, y: event.clientY, href });
                }}
              />
            ))}
          </tbody>
          {footer ? (
            <tfoot>
              <tr>
                {columns.map((column) => {
                  const cell = footer.cells[column.key];
                  const className = `${column.align === "right" || column.fit ? "num" : ""} ${column.align === "right" ? "text-right" : ""} ${cell?.tone === "late" ? "text-[var(--mac-danger)]" : ""} font-semibold`;
                  return (
                    <td key={column.key} className={className} style={cell?.tone === "late" ? { color: "var(--mac-danger)" } : undefined}>
                      {cell?.text ?? ""}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {status ? <div className="flex h-[30px] items-center border-t border-[var(--mac-separator)] px-4 mac-t11 text-[var(--mac-secondary)]">{status}</div> : null}
      {menu ? (
        <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close menu" onClick={() => setMenu(null)}>
          <span
            role="menu"
            className="absolute z-50 min-w-36 rounded-lg bg-[var(--mac-window)] p-1 text-left shadow-[var(--mac-shadow-panel)]"
            style={{ left: menu.x, top: menu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            {menu.href ? (
              <a role="menuitem" className="block rounded-md px-3 py-1.5 mac-t13" href={menu.href}>
                Open
              </a>
            ) : null}
          </span>
        </button>
      ) : null}
    </div>
  );
}

function GroupBlock({
  group,
  columns,
  closed,
  sorted,
  flat,
  selected,
  onToggle,
  onSelect,
  onMenu,
}: {
  group: TableGroup;
  columns: { key: string; header: string; align?: "right"; fit?: boolean; clip?: boolean }[];
  closed: boolean;
  sorted: TableRow[];
  flat: TableRow[];
  selected: number;
  onToggle: () => void;
  onSelect: (index: number) => void;
  onMenu: (event: React.MouseEvent, href?: string) => void;
}) {
  return (
    <>
      {group.label ? (
        <tr>
          <td colSpan={columns.length} className="!h-8 bg-[var(--mac-under)]">
            <button type="button" className="px-2.5 mac-t11 font-semibold text-[var(--mac-secondary)]" onClick={onToggle}>
              {closed ? "▸" : "▾"} {group.label} {group.rows.length}
            </button>
            {group.subtotal ? <span className="float-right pr-2.5 num">{group.subtotal}</span> : null}
          </td>
        </tr>
      ) : null}
      {closed
        ? null
        : sorted.map((row) => {
            const index = flat.indexOf(row);
            return (
              <tr
                key={row.id}
                className={index === selected ? "is-selected" : undefined}
                onClick={() => onSelect(index)}
                onDoubleClick={() => {
                  if (row.href) window.location.assign(row.href);
                }}
                onContextMenu={(event) => onMenu(event, row.href)}
              >
                {columns.map((column, columnIndex) => {
                  const cell = row.cells[column.key];
                  const text = cell?.text ?? "";
                  const className = `${column.align === "right" || column.fit ? "num" : ""} ${column.clip ? "clip" : ""} ${column.align === "right" ? "text-right" : ""} ${cell?.tone === "late" ? "text-[var(--mac-danger)]" : ""}`;
                  return (
                    <td key={column.key} className={className} title={column.clip ? text : undefined} style={cell?.tone === "late" ? { color: "var(--mac-danger)" } : undefined}>
                      {columnIndex === 0 && row.href ? (
                        <>
                          <a href={row.href} className="hover-actions">
                            {text}
                          </a>
                          {row.hint ? (
                            <a href={row.href} className="ml-2 text-[var(--mac-secondary)]">
                              {row.hint}
                            </a>
                          ) : null}
                          {row.badge ? <span className="ml-2 inline-flex h-4 items-center rounded bg-[var(--mac-fill)] px-1.5 text-[11px] font-medium text-[var(--mac-secondary)]">{row.badge}</span> : null}
                        </>
                      ) : cell?.tone === "pill" ? (
                        <span className="fl-pill">{text}</span>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
    </>
  );
}
