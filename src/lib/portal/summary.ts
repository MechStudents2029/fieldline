/** Homeowner portal totals and timeline. Integer cents only. No invented dates. */

export type PortalMoneyOrder = {
  status: string;
  priceDeltaCents: number;
};

export type PortalMoneyPayment = {
  status: string;
  amountCents: number;
};

export type PortalMoney = {
  contractCents: number;
  paidCents: number;
  balanceCents: number;
};

function cents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

/** Signed proposal plus approved change orders. Declined, void, sent, and draft stay out. */
export function portalMoney(input: {
  proposalStatus: string | null;
  proposalTotalCents: number | null;
  orders: PortalMoneyOrder[];
  payments: PortalMoneyPayment[];
}): PortalMoney {
  const signed = input.proposalStatus === "signed" ? cents(input.proposalTotalCents ?? 0) : 0;
  const approved = input.orders
    .filter((order) => order.status === "approved")
    .reduce((sum, order) => sum + cents(order.priceDeltaCents), 0);
  const contractCents = signed + approved;
  const paidCents = input.payments
    .filter((payment) => payment.status === "succeeded")
    .reduce((sum, payment) => sum + cents(payment.amountCents), 0);
  return { contractCents, paidCents, balanceCents: contractCents - paidCents };
}

export type TimelineStep = {
  id: "signed" | "deposit" | "started" | "latest" | "final";
  label: string;
  date: string;
};

/** Steps that have a real timestamp. A single log is Work started, not a second latest row. */
export function portalTimeline(input: {
  signedAt: string | null;
  depositPaidAt: string | null;
  logDates: string[];
  finalInvoiceAt: string | null;
}): TimelineStep[] {
  const steps: TimelineStep[] = [];
  if (input.signedAt) steps.push({ id: "signed", label: "Signed", date: input.signedAt });
  if (input.depositPaidAt) steps.push({ id: "deposit", label: "Deposit paid", date: input.depositPaidAt });
  const dates = input.logDates.filter((date) => date.trim()).sort();
  const first = dates[0];
  const latest = dates[dates.length - 1];
  if (first) steps.push({ id: "started", label: "Work started", date: first });
  if (latest && latest !== first) steps.push({ id: "latest", label: "Latest update", date: latest });
  if (input.finalInvoiceAt) steps.push({ id: "final", label: "Final invoice", date: input.finalInvoiceAt });
  return steps;
}

export function depositPaidAt(input: {
  invoices: { id: string; type: string }[];
  payments: { invoiceId: string; status: string; createdAt: string }[];
}): string | null {
  const deposits = new Set(input.invoices.filter((invoice) => invoice.type === "deposit").map((invoice) => invoice.id));
  const dates = input.payments
    .filter((payment) => payment.status === "succeeded" && deposits.has(payment.invoiceId) && payment.createdAt)
    .map((payment) => payment.createdAt)
    .sort();
  return dates[0] ?? null;
}

export function finalInvoiceAt(invoices: { type: string; status: string; issueDate: string | null }[]): string | null {
  const dates = invoices
    .filter((invoice) => invoice.type === "final" && invoice.status !== "void" && invoice.issueDate)
    .map((invoice) => invoice.issueDate as string)
    .sort();
  return dates[0] ?? null;
}

const HOMEOWNER_ORDER = new Set(["sent", "approved", "declined"]);

export function homeownerOrders<T extends { status: string }>(orders: T[]): T[] {
  return orders.filter((order) => HOMEOWNER_ORDER.has(order.status));
}

export function needsYouAction(input: {
  orders: { id: string; status: string }[];
  invoices: { id: string; status: string; issueDate: string }[];
}): { kind: "change-order"; id: string } | { kind: "invoice"; id: string } | null {
  const sent = input.orders.find((order) => order.status === "sent");
  if (sent) return { kind: "change-order", id: sent.id };
  const open = input.invoices
    .filter((invoice) => invoice.status === "open")
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.id.localeCompare(b.id));
  if (open[0]) return { kind: "invoice", id: open[0].id };
  return null;
}

export function portalLogView<T extends { id: string; logDate: string; notes: string; plannedNext: string | null; photos: { id: string; caption: string }[] }>(
  log: T,
): { id: string; logDate: string; notes: string; plannedNext: string | null; photos: { id: string; caption: string }[] } {
  return {
    id: log.id,
    logDate: log.logDate,
    notes: log.notes,
    plannedNext: log.plannedNext,
    photos: log.photos.map((photo) => ({ id: photo.id, caption: photo.caption })),
  };
}

export function sentenceStatus(status: string): string {
  switch (status) {
    case "sent":
      return "Awaiting approval";
    case "approved":
      return "Approved";
    case "declined":
      return "Declined";
    case "void":
      return "Void";
    case "open":
      return "Open";
    case "paid":
      return "Paid";
    case "draft":
      return "Draft";
    default:
      return status ? status.charAt(0).toUpperCase() + status.slice(1) : "";
  }
}

export function invoiceTypeLabel(type: string): string {
  switch (type) {
    case "deposit":
      return "Deposit";
    case "progress":
      return "Progress";
    case "final":
      return "Final";
    case "co":
      return "Change order";
    case "pay_app":
      return "Pay application";
    case "retainage":
      return "Retainage";
    case "cost_plus":
      return "Cost-plus";
    default:
      return type ? type.charAt(0).toUpperCase() + type.slice(1) : "";
  }
}
