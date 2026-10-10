export type FinalInvoiceState = "missing" | "draft" | "sent" | "paid";

export type CloseoutFacts = {
  punchOpen: number;
  punchDone: number;
  finalInvoice: FinalInvoiceState;
  draftChangeOrders: number;
  draftBills: number;
  openPurchaseOrders: number;
  unapprovedTime: number;
  permitsOpen: number;
  inspectionsOpen: number;
};

export type CloseoutBlocker = {
  key: "punch" | "invoice" | "changes" | "bills" | "orders" | "time" | "permits" | "inspections";
  label: string;
  count: number;
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function addMonths(day: string, months: number): string {
  const match = DATE.exec(day);
  if (!match || !Number.isInteger(months)) throw new Error("Bad date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  const dayOfMonth = Math.min(date, last);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), dayOfMonth)).toISOString().slice(0, 10);
}

/** Inclusive through the end date. A missing date is closed. */
export function warrantyOpen(endsOn: string | null | undefined, today: string): boolean {
  if (!endsOn || !DATE.test(endsOn) || !DATE.test(today)) return false;
  return today <= endsOn;
}

export function finalInvoiceState(statuses: string[]): FinalInvoiceState {
  if (statuses.length === 0) return "missing";
  if (statuses.some((status) => status === "paid")) return "paid";
  if (statuses.some((status) => status === "open" || status === "sent")) return "sent";
  return "draft";
}

export function closeoutChecklist(facts: CloseoutFacts): CloseoutBlocker[] {
  const invoiceBlocked = facts.finalInvoice === "missing" || facts.finalInvoice === "draft";
  return [
    { key: "punch", label: "Punch", count: facts.punchOpen + facts.punchDone },
    { key: "invoice", label: "Final invoice", count: invoiceBlocked ? 1 : 0 },
    { key: "changes", label: "Change orders", count: facts.draftChangeOrders },
    { key: "bills", label: "Bills", count: facts.draftBills },
    { key: "orders", label: "Purchase orders", count: facts.openPurchaseOrders },
    { key: "time", label: "Time", count: facts.unapprovedTime },
    { key: "permits", label: "Permits", count: facts.permitsOpen },
    { key: "inspections", label: "Inspections", count: facts.inspectionsOpen },
  ];
}

export function openBlockers(facts: CloseoutFacts): CloseoutBlocker[] {
  return closeoutChecklist(facts).filter((row) => row.count > 0);
}
