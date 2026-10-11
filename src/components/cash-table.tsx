import { Fragment } from "react";
import { formatWhole } from "@/lib/money";
import type { CashForecast } from "@/lib/cash/forecast";

export function CashTable({ forecast, hrefFor }: { forecast: CashForecast; hrefFor?: (rowId: string, columnKey: string) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="mac-table cash-sheet">
        <thead>
          <tr>
            <th className="text-left"> </th>
            {forecast.columns.map((column) => (
              <th key={column.key} className={`num text-right ${column.low ? "cash-low" : ""}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {forecast.rows.map((row, index) => {
            const previous = forecast.rows[index - 1];
            const heading = row.section !== "total" && previous?.section !== row.section ? row.section : "";
            return (
              <Fragment key={row.id}>
                {heading ? (
                  <tr>
                    <th className="text-left" colSpan={forecast.columns.length + 1}>
                      {row.section === "in" ? "In" : "Out"}
                    </th>
                  </tr>
                ) : null}
                <tr data-cash-row={row.id}>
                  <th className="text-left">{row.label}</th>
                  {row.cells.map((cell, index) => {
                    const column = forecast.columns[index]!;
                    const projected = cell.lines.length > 0 && cell.lines.every((line) => line.kind === "projected");
                    const show = row.section === "total" || cell.cents !== 0;
                    const href = hrefFor && row.id !== "balance" && cell.lines.length > 0 ? hrefFor(row.id, column.key) : "";
                    const className = `num text-right ${column.low ? "cash-low" : ""} ${projected ? "opacity-60" : ""} ${cell.cents < 0 ? "text-[var(--mac-danger)]" : ""}`;
                    return (
                      <td key={column.key} className={className} data-cash-cell={`${row.id}:${column.key}`}>
                        {href ? (
                          <a href={href}>{show ? formatWhole(cell.cents) : ""}</a>
                        ) : show ? (
                          formatWhole(cell.cents)
                        ) : (
                          ""
                        )}
                      </td>
                    );
                  })}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
