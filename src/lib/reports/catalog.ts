import { emptyQuery, type ReportQuery } from "@/lib/reports/engine";

export const BUILDER_SOURCES = [
  { id: "jobs", label: "Jobs", custom: "job" },
  { id: "clients", label: "Clients", custom: "client" },
  { id: "leads", label: "Leads", custom: "lead" },
  { id: "estimates", label: "Estimates", custom: "" },
  { id: "invoices", label: "Invoices", custom: "" },
  { id: "payments", label: "Payments", custom: "" },
  { id: "bills", label: "Bills", custom: "" },
  { id: "time", label: "Time entries", custom: "" },
  { id: "change_orders", label: "Change orders", custom: "" },
  { id: "todos", label: "To-dos", custom: "todo" },
  { id: "deliveries", label: "Deliveries", custom: "" },
] as const;

export type BuilderSource = (typeof BUILDER_SOURCES)[number]["id"];

export type SourceId = BuilderSource | "certificates" | "punch" | "cash" | "confirmations" | "agreements" | "options" | "reviews" | "collections" | "lead_sources";

export type CatalogColumn = {
  key: string;
  label: string;
  kind: "text" | "number" | "money" | "date" | "percent";
  money?: boolean;
};

export type BuiltinReport = {
  id: string;
  name: string;
  source: SourceId;
  field: boolean;
  href?: string;
  query: ReportQuery;
};

function query(partial: Partial<ReportQuery> & Pick<ReportQuery, "columns">): ReportQuery {
  return { ...emptyQuery(), ...partial, filters: partial.filters ?? [] };
}

export const CATALOG: Record<SourceId, CatalogColumn[]> = {
  jobs: [
    { key: "name", label: "Job", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "client", label: "Client", kind: "text" },
    { key: "start", label: "Start", kind: "date" },
    { key: "contract", label: "Contract", kind: "money", money: true },
    { key: "cost", label: "Cost", kind: "money", money: true },
    { key: "margin", label: "Margin", kind: "percent", money: true },
    { key: "under", label: "Underbilled", kind: "money", money: true },
  ],
  clients: [
    { key: "name", label: "Name", kind: "text" },
    { key: "company", label: "Company", kind: "text" },
    { key: "city", label: "City", kind: "text" },
    { key: "email", label: "Email", kind: "text" },
    { key: "phone", label: "Phone", kind: "text" },
    { key: "created", label: "Added", kind: "date" },
  ],
  leads: [
    { key: "title", label: "Lead", kind: "text" },
    { key: "stage", label: "Stage", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "source", label: "Source", kind: "text" },
    { key: "value", label: "Value", kind: "money", money: true },
    { key: "created", label: "Added", kind: "date" },
  ],
  estimates: [
    { key: "title", label: "Proposal", kind: "text" },
    { key: "client", label: "Client", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "sent", label: "Sent", kind: "date" },
    { key: "age", label: "Age", kind: "number" },
    { key: "amount", label: "Amount", kind: "money", money: true },
    { key: "month", label: "Month", kind: "text" },
    { key: "won", label: "Won", kind: "number" },
    { key: "rate", label: "Win rate", kind: "percent" },
  ],
  invoices: [
    { key: "number", label: "Invoice", kind: "text" },
    { key: "job", label: "Job", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "issued", label: "Issued", kind: "date" },
    { key: "due", label: "Due", kind: "date" },
    { key: "balance", label: "Balance", kind: "money", money: true },
    { key: "bucket", label: "Bucket", kind: "text" },
  ],
  payments: [
    { key: "invoice", label: "Invoice", kind: "text" },
    { key: "method", label: "Method", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "paid", label: "Paid", kind: "date" },
    { key: "amount", label: "Amount", kind: "money", money: true },
  ],
  bills: [
    { key: "number", label: "Bill", kind: "text" },
    { key: "vendor", label: "Vendor", kind: "text" },
    { key: "job", label: "Job", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "due", label: "Due", kind: "date" },
    { key: "amount", label: "Amount", kind: "money", money: true },
  ],
  time: [
    { key: "job", label: "Job", kind: "text" },
    { key: "code", label: "Cost code", kind: "text" },
    { key: "person", label: "Person", kind: "text" },
    { key: "day", label: "Day", kind: "date" },
    { key: "hours", label: "Hours", kind: "number" },
    { key: "ot", label: "OT", kind: "number" },
    { key: "dt", label: "DT", kind: "number" },
    { key: "pto", label: "PTO", kind: "number" },
    { key: "premium", label: "OT premium", kind: "money", money: true },
    { key: "burden", label: "Burden", kind: "money", money: true },
    { key: "cost", label: "Cost", kind: "money", money: true },
    { key: "share", label: "OT share", kind: "percent", money: true },
    { key: "site", label: "Site", kind: "text" },
  ],
  change_orders: [
    { key: "title", label: "Change order", kind: "text" },
    { key: "job", label: "Job", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "sent", label: "Sent", kind: "date" },
    { key: "price", label: "Price", kind: "money", money: true },
  ],
  todos: [
    { key: "title", label: "To-do", kind: "text" },
    { key: "job", label: "Job", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "assignee", label: "Assignee", kind: "text" },
    { key: "due", label: "Due", kind: "date" },
  ],
  deliveries: [
    { key: "order", label: "Order", kind: "text" },
    { key: "job", label: "Job", kind: "text" },
    { key: "vendor", label: "Vendor", kind: "text" },
    { key: "line", label: "Line", kind: "text" },
    { key: "expected", label: "Expected", kind: "date" },
    { key: "status", label: "Status", kind: "text" },
    { key: "qty", label: "Qty", kind: "text" },
  ],
  certificates: [
    { key: "vendor", label: "Vendor", kind: "text" },
    { key: "type", label: "Type", kind: "text" },
    { key: "expires", label: "Expires", kind: "date" },
    { key: "state", label: "State", kind: "text" },
  ],
  punch: [
    { key: "title", label: "Punch", kind: "text" },
    { key: "job", label: "Job", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "due", label: "Due", kind: "date" },
  ],
  cash: [
    { key: "week", label: "Week", kind: "text" },
    { key: "net", label: "Net", kind: "money", money: true },
    { key: "balance", label: "Balance", kind: "money", money: true },
  ],
  confirmations: [
    { key: "job", label: "Job", kind: "text" },
    { key: "item", label: "Item", kind: "text" },
    { key: "vendor", label: "Vendor", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "start", label: "Start", kind: "date" },
    { key: "proposed", label: "Proposed", kind: "date" },
  ],
  agreements: [
    { key: "name", label: "Agreement", kind: "text" },
    { key: "client", label: "Client", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "monthly", label: "Monthly", kind: "money", money: true },
    { key: "scheduled", label: "Scheduled", kind: "number" },
    { key: "completed", label: "Completed", kind: "number" },
    { key: "rate", label: "Renewal rate", kind: "percent", money: true },
  ],
  options: [
    { key: "set", label: "Set", kind: "text" },
    { key: "wins", label: "Wins", kind: "number" },
    { key: "share", label: "Share", kind: "percent", money: true },
    { key: "amount", label: "Amount", kind: "money", money: true },
  ],
  reviews: [
    { key: "metric", label: "Metric", kind: "text" },
    { key: "count", label: "Count", kind: "number" },
  ],
  collections: [
    { key: "metric", label: "Metric", kind: "text" },
    { key: "count", label: "Count", kind: "number" },
    { key: "open", label: "Open", kind: "money", money: true },
  ],
  lead_sources: [
    { key: "name", label: "Source", kind: "text" },
    { key: "leads", label: "Leads", kind: "number" },
    { key: "won", label: "Won", kind: "number" },
    { key: "rate", label: "Win rate", kind: "percent", money: true },
    { key: "sold", label: "Sold", kind: "money", money: true },
    { key: "collected", label: "Collected", kind: "money", money: true },
    { key: "spend", label: "Spend", kind: "money", money: true },
    { key: "cpl", label: "Cost / lead", kind: "money", money: true },
    { key: "cpw", label: "Cost / won", kind: "money", money: true },
    { key: "ret", label: "Return", kind: "text", money: true },
  ],
};

export const BUILTINS: BuiltinReport[] = [
  {
    id: "pending_proposals",
    name: "Pending proposals",
    source: "estimates",
    field: false,
    query: query({
      columns: ["title", "client", "sent", "age", "amount"],
      filters: [{ column: "status", op: "in", value: "sent,viewed" }],
      dateColumn: "sent",
      sort: "age",
      dir: "desc",
    }),
  },
  {
    id: "ar_aging",
    name: "AR aging",
    source: "invoices",
    field: false,
    query: query({
      columns: ["number", "job", "due", "balance", "bucket"],
      dateColumn: "due",
      sort: "due",
      dir: "asc",
      groupBy: "bucket",
      chart: "bar",
      chartColumn: "balance",
    }),
  },
  {
    id: "job_profit",
    name: "Job profitability",
    source: "jobs",
    field: false,
    query: query({
      columns: ["name", "status", "contract", "cost", "margin"],
      sort: "margin",
      dir: "asc",
    }),
  },
  {
    id: "sales_month",
    name: "Sales by month",
    source: "estimates",
    field: false,
    query: query({
      columns: ["month", "title", "amount", "won", "rate"],
      filters: [{ column: "status", op: "in", value: "signed,declined" }],
      sort: "month",
      dir: "asc",
      groupBy: "month",
      chart: "bar",
      chartColumn: "amount",
    }),
  },
  {
    id: "labor_cost",
    name: "Labor cost",
    source: "time",
    field: false,
    query: query({
      columns: ["job", "code", "person", "day", "hours", "ot", "premium", "burden", "cost", "share", "site"],
      dateColumn: "day",
      sort: "job",
      groupBy: "job",
      chart: "bar",
      chartColumn: "cost",
    }),
  },
  {
    id: "time_job",
    name: "Time by job and cost code",
    source: "time",
    field: true,
    query: query({
      columns: ["job", "code", "hours", "cost"],
      dateColumn: "day",
      sort: "job",
      groupBy: "job",
      chart: "bar",
      chartColumn: "hours",
    }),
  },
  {
    id: "vendor_coi",
    name: "Expiring or expired vendor COIs",
    source: "certificates",
    field: false,
    query: query({
      columns: ["vendor", "type", "expires", "state"],
      dateColumn: "expires",
      sort: "expires",
      groupBy: "state",
    }),
  },
  {
    id: "open_changes",
    name: "Open change orders",
    source: "change_orders",
    field: false,
    query: query({
      columns: ["title", "job", "status", "price"],
      filters: [{ column: "status", op: "in", value: "draft,sent,viewed" }],
      sort: "title",
    }),
  },
  {
    id: "underbilled",
    name: "Underbilled",
    source: "jobs",
    field: false,
    query: query({
      columns: ["name", "contract", "under"],
      filters: [{ column: "under", op: "gt", value: "0" }],
      sort: "under",
      dir: "desc",
    }),
  },
  {
    id: "todos_today",
    name: "Today's to-dos",
    source: "todos",
    field: true,
    query: query({
      columns: ["title", "job", "assignee", "due"],
      filters: [{ column: "status", op: "eq", value: "open" }],
      dateColumn: "due",
      from: "today",
      to: "today",
      sort: "title",
    }),
  },
  {
    id: "punch_open",
    name: "Open punch items",
    source: "punch",
    field: true,
    query: query({
      columns: ["title", "job", "due"],
      filters: [{ column: "status", op: "eq", value: "open" }],
      dateColumn: "due",
      sort: "due",
    }),
  },
  {
    id: "confirmations",
    name: "Confirmations",
    source: "confirmations",
    field: false,
    query: query({
      columns: ["job", "item", "vendor", "status", "start", "proposed"],
      sort: "start",
    }),
  },
  {
    id: "deliveries",
    name: "Deliveries",
    source: "deliveries",
    field: true,
    href: "/deliveries",
    query: query({
      columns: ["order", "job", "vendor", "line", "expected", "status", "qty"],
      sort: "expected",
    }),
  },
  {
    id: "agreement_revenue",
    name: "Agreement revenue",
    source: "agreements",
    field: false,
    href: "/agreements",
    query: query({
      columns: ["name", "client", "status", "monthly"],
      sort: "monthly",
      dir: "desc",
      chart: "bar",
      chartColumn: "monthly",
    }),
  },
  {
    id: "agreement_visits",
    name: "Agreement visits",
    source: "agreements",
    field: true,
    href: "/agreements",
    query: query({
      columns: ["name", "client", "status", "scheduled", "completed"],
      sort: "name",
    }),
  },
  {
    id: "agreement_renewal",
    name: "Agreement renewal",
    source: "agreements",
    field: false,
    href: "/agreements",
    query: query({
      columns: ["name", "status", "rate"],
      sort: "name",
    }),
  },
  {
    id: "cash_13",
    name: "13-week cash",
    source: "cash",
    field: false,
    href: "/reports/cash",
    query: query({
      columns: ["week", "net", "balance"],
      groupBy: "week",
      chart: "line",
      chartColumn: "balance",
      sort: "week",
    }),
  },
  {
    id: "option_tiers",
    name: "Option tiers",
    source: "options",
    field: false,
    query: query({
      columns: ["set", "wins", "share", "amount"],
      sort: "set",
      dir: "asc",
    }),
  },
  {
    id: "review_requests",
    name: "Review requests",
    source: "reviews",
    field: false,
    query: query({
      columns: ["metric", "count"],
      sort: "metric",
      dir: "asc",
    }),
  },
  {
    id: "invoice_followups",
    name: "Invoice follow-ups",
    source: "collections",
    field: false,
    query: query({
      columns: ["metric", "count", "open"],
      sort: "metric",
      dir: "asc",
    }),
  },
  {
    id: "lead_sources",
    name: "Lead sources",
    source: "lead_sources",
    field: false,
    query: query({
      columns: ["name", "leads", "won", "rate", "sold", "collected", "spend", "cpl", "cpw", "ret"],
      sort: "name",
      dir: "asc",
    }),
  },
];

export const PAGE_REPORTS = [
  { id: "wip", name: "WIP", href: "/reports/wip", field: false },
  { id: "variance", name: "Variance", href: "/reports/schedule", field: false },
  { id: "cash", name: "Cash", href: "/reports/cash", field: false },
  { id: "nec", name: "1099", href: "/reports/nec", field: false },
  { id: "client_ar", name: "Client AR", href: "/reports/ar", field: false },
];

export function builtinById(id: string): BuiltinReport | undefined {
  return BUILTINS.find((report) => report.id === id);
}

export function sourceLabel(source: string): string {
  return BUILDER_SOURCES.find((item) => item.id === source)?.label ?? (source === "certificates" ? "Vendor COIs" : source === "punch" ? "Punch items" : source === "cash" ? "Cash" : source === "confirmations" ? "Confirmations" : source === "agreements" ? "Agreements" : source === "options" ? "Options" : source === "reviews" ? "Reviews" : source === "collections" ? "Collections" : source === "lead_sources" ? "Lead sources" : source);
}

export function customRecord(source: string): string {
  return BUILDER_SOURCES.find((item) => item.id === source)?.custom ?? "";
}
