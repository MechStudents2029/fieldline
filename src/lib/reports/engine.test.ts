import { describe, expect, it } from "vitest";
import { emptyQuery, groupHeading, runEngine, shareAllowed, sourceAllowed, visibleColumns, type EngineColumn, type EngineRow } from "@/lib/reports/engine";

const columns: EngineColumn[] = [
  { key: "name", label: "Name", kind: "text" },
  { key: "day", label: "Day", kind: "date" },
  { key: "amount", label: "Amount", kind: "money", money: true },
  { key: "qty", label: "Qty", kind: "number" },
  { key: "rate", label: "Rate", kind: "percent" },
  { key: "cf_note", label: "Note", kind: "text" },
];

function row(id: string, name: string, day: string, amount: number, qty: number, rate: number): EngineRow {
  return {
    id,
    cells: {
      name: { text: name, sort: name, value: null },
      day: { text: day, sort: day, value: null },
      amount: { text: String(amount), sort: amount, value: amount },
      qty: { text: String(qty), sort: qty, value: qty },
      rate: { text: String(rate), sort: rate, value: rate },
      cf_note: { text: "Referral", sort: "Referral", value: null },
    },
  };
}

const rows = [
  row("a", "Chen", "2026-01-02", 1000, 2, 10000),
  row("b", "Chen", "2026-01-20", 3000, 4, 0),
  row("c", "Brooks", "2026-03-01", 500, 1, 10000),
];

describe("report engine", () => {
  it("groups with count, sum, and average, then totals", () => {
    const result = runEngine(rows, columns, {
      ...emptyQuery(),
      columns: ["name", "amount", "qty", "rate"],
      groupBy: "name",
      sort: "day",
      chart: "bar",
      chartColumn: "amount",
    });
    const chen = result.groups.find((group) => group.key === "Chen");
    const brooks = result.groups.find((group) => group.key === "Brooks");
    expect(chen?.subtotal.amount).toEqual({ count: 2, sum: 4000, avg: 2000 });
    expect(chen?.subtotal.qty).toEqual({ count: 2, sum: 6, avg: 3 });
    expect(chen?.subtotal.rate.avg).toBe(5000);
    expect(brooks?.subtotal.amount.sum).toBe(500);
    expect(result.total.amount).toEqual({ count: 3, sum: 4500, avg: 1500 });
    expect(result.total.qty.count).toBe(3);
    expect(result.chart.map((point) => point.label)).toEqual(["Brooks", "Chen"]);
    expect(result.chart.map((point) => point.value)).toEqual([500, 4000]);
  });

  it("keeps an inclusive date range", () => {
    const result = runEngine(rows, columns, {
      ...emptyQuery(),
      columns: ["name", "day", "amount"],
      dateColumn: "day",
      from: "2026-01-02",
      to: "2026-01-20",
    });
    expect(result.groups[0]?.rows.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.total.amount.sum).toBe(4000);
  });

  it("hides money columns and drops their cells", () => {
    const visible = visibleColumns(columns, true);
    expect(visible.map((column) => column.key)).not.toContain("amount");
    const result = runEngine(rows, visible, { ...emptyQuery(), columns: ["name", "amount", "qty", "cf_note"] });
    expect(result.columns.map((column) => column.key)).toEqual(["name", "qty", "cf_note"]);
    expect(result.groups[0]?.rows[0]?.cells.amount).toBeUndefined();
    expect(result.groups[0]?.rows[0]?.cells.cf_note?.text).toBe("Referral");
  });

  it("limits field to records that role can already open", () => {
    expect(sourceAllowed("field", "jobs")).toBe(true);
    expect(sourceAllowed("field", "todos")).toBe(true);
    expect(sourceAllowed("field", "invoices")).toBe(false);
    expect(sourceAllowed("field", "estimates")).toBe(false);
    expect(sourceAllowed("owner", "invoices")).toBe(true);
    expect(shareAllowed("field", "user_dana", "everyone", "user_maya")).toBe(true);
    expect(shareAllowed("field", "user_dana", "office", "user_maya")).toBe(false);
    expect(shareAllowed("field", "user_dana", "private", "user_maya")).toBe(false);
    expect(shareAllowed("estimator", "user_luis", "office", "user_maya")).toBe(true);
  });

  it("renders a month group as a short label", () => {
    expect(groupHeading("2026-07", 1)).toBe("Jul 2026 · 1");
    expect(groupHeading("Active", 2)).toBe("Active · 2");
  });
});
