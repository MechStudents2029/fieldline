import { Fragment } from "react";
import { groupHeading, subtotalLabel, type EngineColumn, type EngineResult } from "@/lib/reports/engine";

function numeric(kind: string) {
  return kind === "money" || kind === "number" || kind === "percent" || kind === "date";
}

function aggregateCell(column: EngineColumn, index: number, label: string, mode: "sub" | "total") {
  if (column.kind === "text" || column.kind === "date") return mode === "total" && index === 0 ? label : "";
  return label;
}

export function ReportTable({ result }: { result: EngineResult }) {
  const count = result.groups.reduce((sum, group) => sum + group.rows.length, 0);
  return (
    <div className="min-h-0 flex-1 overflow-auto" data-mac-list>
      <table className="mac-table">
        <thead>
          <tr>
            {result.columns.map((column) => (
              <th key={column.key} className={numeric(column.kind) ? "num text-right" : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.groups.map((group) => (
            <Fragment key={group.key || "all"}>
              {result.grouped ? (
                <tr data-group={group.key}>
                  <td colSpan={result.columns.length} className="!h-8 bg-[var(--mac-under)] mac-t11 font-semibold">
                    {groupHeading(group.key, group.rows.length)}
                  </td>
                </tr>
              ) : null}
              {group.rows.map((row) => (
                <tr key={row.id}>
                  {result.columns.map((column, index) => {
                    const cell = row.cells[column.key];
                    const align = numeric(column.kind) ? "num text-right" : "";
                    const text = cell?.text ?? "";
                    return (
                      <td key={column.key} className={align}>
                        {index === 0 && row.href ? <a href={row.href}>{text}</a> : text}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {result.grouped ? (
                <tr data-subtotal={group.key}>
                  {result.columns.map((column, index) => (
                    <td key={column.key} className={`font-semibold ${numeric(column.kind) ? "num text-right" : ""}`}>
                      {aggregateCell(column, index, subtotalLabel(column, group.subtotal[column.key]), "sub")}
                    </td>
                  ))}
                </tr>
              ) : null}
            </Fragment>
          ))}
          <tr data-total="1">
            {result.columns.map((column, index) => (
              <td key={column.key} className={`font-semibold ${numeric(column.kind) ? "num text-right" : ""}`}>
                {result.footer
                  ? (result.footer[column.key] ?? "")
                  : aggregateCell(column, index, index === 0 ? `Total ${count}` : subtotalLabel(column, result.total[column.key]), "total")}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
