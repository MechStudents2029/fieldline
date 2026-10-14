import { formatPercent, formatWhole } from "@/lib/money";
import { canSeeCash, type Role } from "@/lib/permissions";

export type CellKind = "text" | "number" | "money" | "date" | "percent";

export type EngineColumn = {
  key: string;
  label: string;
  kind: CellKind;
  money?: boolean;
};

export type EngineCell = {
  text: string;
  sort: string | number;
  value: number | null;
};

export type EngineRow = {
  id: string;
  href?: string;
  cells: Record<string, EngineCell>;
};

export type FilterOp = "eq" | "contains" | "gt" | "lt" | "in";

export type EngineFilter = {
  column: string;
  op: FilterOp;
  value: string;
};

export type ReportQuery = {
  columns: string[];
  filters: EngineFilter[];
  dateColumn: string;
  from: string;
  to: string;
  sort: string;
  dir: "asc" | "desc";
  groupBy: string;
  chart: "" | "bar" | "line";
  chartColumn: string;
};

export type Agg = { count: number; sum: number; avg: number | null };

export type EngineGroup = {
  key: string;
  rows: EngineRow[];
  subtotal: Record<string, Agg>;
};

export type EngineResult = {
  columns: EngineColumn[];
  groups: EngineGroup[];
  total: Record<string, Agg>;
  chart: { label: string; value: number }[];
  grouped: boolean;
  footer?: Record<string, string>;
};

export function emptyQuery(): ReportQuery {
  return {
    columns: [],
    filters: [],
    dateColumn: "",
    from: "",
    to: "",
    sort: "",
    dir: "asc",
    groupBy: "",
    chart: "",
    chartColumn: "",
  };
}

export function visibleColumns(columns: EngineColumn[], hideMoney: boolean): EngineColumn[] {
  return hideMoney ? columns.filter((column) => !column.money) : columns.slice();
}

export function dayOf(cell: EngineCell | undefined): string {
  if (!cell) return "";
  const raw = String(cell.sort ?? cell.text);
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function numeric(cell: EngineCell | undefined): number | null {
  if (!cell || cell.value == null || !Number.isFinite(cell.value)) return null;
  return cell.value;
}

function matches(row: EngineRow, filter: EngineFilter): boolean {
  const cell = row.cells[filter.column];
  const value = filter.value.trim();
  if (!value) return true;
  if (!cell) return false;
  if (filter.op === "eq") return cell.text.toLowerCase() === value.toLowerCase();
  if (filter.op === "contains") return cell.text.toLowerCase().includes(value.toLowerCase());
  if (filter.op === "in") {
    const wanted = value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
    return wanted.includes(cell.text.toLowerCase());
  }
  const left = numeric(cell);
  const right = Number(value);
  if (left == null || !Number.isFinite(right)) return false;
  if (filter.op === "gt") return left > right;
  return left < right;
}

function inRange(row: EngineRow, query: ReportQuery): boolean {
  if (!query.dateColumn || (!query.from && !query.to)) return true;
  const day = dayOf(row.cells[query.dateColumn]);
  if (!day) return false;
  if (query.from && day < query.from) return false;
  if (query.to && day > query.to) return false;
  return true;
}

function compare(left: EngineRow, right: EngineRow, key: string, dir: "asc" | "desc"): number {
  const a = left.cells[key];
  const b = right.cells[key];
  const av = a?.value;
  const bv = b?.value;
  let order = 0;
  if (typeof av === "number" && typeof bv === "number") order = av - bv;
  else order = String(a?.sort ?? a?.text ?? "").localeCompare(String(b?.sort ?? b?.text ?? ""));
  return dir === "asc" ? order : -order;
}

export function aggregate(rows: EngineRow[], column: EngineColumn): Agg {
  const count = rows.length;
  if (column.kind === "text" || column.kind === "date") return { count, sum: 0, avg: null };
  const values = rows.map((row) => numeric(row.cells[column.key])).filter((value): value is number => value != null);
  const sum = values.reduce((total, value) => total + value, 0);
  return { count, sum, avg: values.length ? sum / values.length : null };
}

export function formatAgg(column: EngineColumn, agg: Agg | undefined, which: "sum" | "avg" | "count"): string {
  if (!agg) return "";
  if (which === "count" || column.kind === "text" || column.kind === "date") return String(agg.count);
  if (column.kind === "percent") return agg.avg == null ? "—" : formatPercent(Math.round(agg.avg));
  if (column.kind === "money") return formatWhole(Math.round(which === "avg" ? agg.avg ?? 0 : agg.sum));
  const value = which === "avg" ? agg.avg : agg.sum;
  if (value == null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function subtotalText(column: EngineColumn, agg: Agg): string {
  if (column.kind === "percent") return formatAgg(column, agg, "avg");
  if (column.kind === "money" || column.kind === "number") return formatAgg(column, agg, "sum");
  return formatAgg(column, agg, "count");
}

export function subtotalLabel(column: EngineColumn, agg: Agg | undefined): string {
  if (!agg) return "";
  return subtotalText(column, agg);
}

/** Month keys render as `Jul 2026`. Anything else stays as stored. */
export function axisLabel(key: string): string {
  const month = /^(\d{4})-(\d{2})$/.exec(key);
  if (!month) return key;
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1)),
  );
}

export function groupHeading(key: string, count: number): string {
  const label = axisLabel(key);
  return label ? `${label} · ${count}` : String(count);
}

export function runEngine(rows: EngineRow[], columns: EngineColumn[], query: ReportQuery): EngineResult {
  const selected = columns.filter((column) => query.columns.length === 0 || query.columns.includes(column.key));
  const keys = new Set(selected.map((column) => column.key));
  const filtered = rows.filter((row) => inRange(row, query) && query.filters.every((filter) => !keys.has(filter.column) || matches(row, filter)));
  const sortKey = query.sort && keys.has(query.sort) ? query.sort : selected[0]?.key ?? "";
  const sorted = sortKey ? [...filtered].sort((left, right) => compare(left, right, sortKey, query.dir)) : filtered;
  const grouped = Boolean(query.groupBy && keys.has(query.groupBy));
  const buckets = new Map<string, EngineRow[]>();
  if (!grouped) buckets.set("", sorted);
  else {
    for (const row of sorted) {
      const key = row.cells[query.groupBy]?.text || "—";
      const list = buckets.get(key) ?? [];
      list.push(row);
      buckets.set(key, list);
    }
  }
  const shown = new Set(selected.map((column) => column.key));
  const project = (row: EngineRow): EngineRow => {
    const cells: EngineRow["cells"] = {};
    for (const key of shown) {
      const cell = row.cells[key];
      if (cell) cells[key] = cell;
    }
    return { id: row.id, href: row.href, cells };
  };
  const groups: EngineGroup[] = [...buckets.entries()].map(([key, list]) => ({
    key,
    rows: list.map(project),
    subtotal: Object.fromEntries(selected.map((column) => [column.key, aggregate(list, column)])),
  }));
  const total = Object.fromEntries(selected.map((column) => [column.key, aggregate(sorted, column)]));
  const chartColumn =
    selected.find((column) => column.key === query.chartColumn && column.kind !== "text" && column.kind !== "date") ??
    selected.find((column) => column.kind === "number" || column.kind === "money");
  const chart =
    grouped && query.chart && chartColumn
      ? groups.map((group) => ({
          label: group.key,
          value: chartColumn.kind === "percent" ? (group.subtotal[chartColumn.key]?.avg ?? 0) : (group.subtotal[chartColumn.key]?.sum ?? group.rows.length),
        }))
      : [];
  return { columns: selected, groups, total, chart, grouped };
}

const FIELD_SOURCES = new Set(["jobs", "clients", "leads", "time", "todos", "punch", "deliveries"]);

export function sourceAllowed(role: Role, source: string): boolean {
  if (source === "cash") return canSeeCash(role);
  if (role === "field") return FIELD_SOURCES.has(source);
  return true;
}

export function shareAllowed(role: Role, userId: string, share: string, ownerUserId: string): boolean {
  if (share === "everyone") return true;
  if (share === "office") return role === "owner" || role === "admin" || role === "estimator";
  return ownerUserId === userId;
}
