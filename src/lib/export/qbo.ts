/** QuickBooks Online Import Data column names. This is a file, not an Intuit connection. */

export const QBO_CUSTOMER_HEADERS = [
  "DisplayName",
  "Company",
  "FirstName",
  "LastName",
  "Email",
  "PhoneNumber",
  "BillingAddressLine1",
  "BillingAddressCity",
  "BillingAddressState",
  "BillingAddressPostalCode",
  "BillingAddressCountry",
] as const;

export const QBO_INVOICE_HEADERS = [
  "InvoiceNo",
  "Customer",
  "InvoiceDate",
  "DueDate",
  "Item",
  "ItemDescription",
  "ItemQuantity",
  "ItemRate",
  "ItemAmount",
  "ItemTaxCode",
] as const;

/** QBO has no tax-code table here. NON is the usual non-taxable placeholder. */
export const QBO_ITEM_TAX_CODE = "NON";

/** One product name so Import Data does not invent a product per line. */
export const QBO_SERVICE_ITEM = "Services";

export const QBO_IMPORT_INVOICE_CAP = 100;
export const QBO_IMPORT_ROW_CAP = 1000;

export type QboCustomerInput = {
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export type QboInvoiceLineInput = {
  description: string;
  amountCents: number;
  sortOrder: number;
};

export type QboInvoiceInput = {
  number: string;
  customer: string;
  issueDate: string;
  dueDate: string;
  totalCents: number;
  type?: string;
  lines: QboInvoiceLineInput[];
};

export function qboDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Two words become first and last. Anything else stays on DisplayName only. */
export function splitPersonName(name: string): { firstName: string; lastName: string } {
  const display = qboDisplayName(name);
  const parts = display.split(" ");
  if (parts.length === 2 && parts[0] && parts[1]) return { firstName: parts[0], lastName: parts[1] };
  return { firstName: "", lastName: "" };
}

export function qboDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return value.trim();
  return `${match[2]}/${match[3]}/${match[1]}`;
}

export function centsToQboAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function qboImportLimitWarning(invoiceCount: number, rowCount: number): string | null {
  if (invoiceCount <= QBO_IMPORT_INVOICE_CAP && rowCount <= QBO_IMPORT_ROW_CAP) return null;
  const count = (value: number) => value.toLocaleString("en-US");
  return `QuickBooks Online imports about ${count(QBO_IMPORT_INVOICE_CAP)} invoices and ${count(QBO_IMPORT_ROW_CAP)} rows at a time. This file has ${count(invoiceCount)} invoices and ${count(rowCount)} rows. Split it before you import.`;
}

export function qboCustomerRows(contacts: QboCustomerInput[]): string[][] {
  return contacts.flatMap((contact) => {
    const display = qboDisplayName(contact.name);
    if (!display) return [];
    const { firstName, lastName } = splitPersonName(display);
    return [
      [
        display,
        (contact.company ?? "").trim(),
        firstName,
        lastName,
        (contact.email ?? "").trim(),
        (contact.phone ?? "").trim(),
        (contact.address ?? "").trim(),
        (contact.city ?? "").trim(),
        (contact.state ?? "").trim(),
        (contact.zip ?? "").trim(),
        "",
      ],
    ];
  });
}

export function qboInvoiceRows(invoices: QboInvoiceInput[]): string[][] {
  const rows: string[][] = [];
  for (const invoice of invoices) {
    const customer = qboDisplayName(invoice.customer);
    const number = invoice.number.trim();
    if (!customer || !number) continue;
    const issue = qboDate(invoice.issueDate);
    const due = qboDate(invoice.dueDate) || issue;
    const lines = [...invoice.lines].sort((a, b) => a.sortOrder - b.sortOrder).filter((line) => line.amountCents > 0);
    const usable = lines.length > 0 ? lines : invoice.totalCents > 0 ? [{ description: summaryDescription(invoice.type), amountCents: invoice.totalCents, sortOrder: 0 }] : [];
    for (const line of usable) {
      const amount = centsToQboAmount(line.amountCents);
      rows.push([number, customer, issue, due, QBO_SERVICE_ITEM, line.description.trim() || summaryDescription(invoice.type), "1", amount, amount, QBO_ITEM_TAX_CODE]);
    }
  }
  return rows;
}

export function qboCustomersCsv(contacts: QboCustomerInput[]): string {
  return toCsv([Array.from(QBO_CUSTOMER_HEADERS), ...qboCustomerRows(contacts)]);
}

export function qboInvoicesCsv(invoices: QboInvoiceInput[]): { csv: string; invoiceCount: number; rowCount: number } {
  const rows = qboInvoiceRows(invoices);
  const invoiceCount = new Set(rows.map((row) => row[0])).size;
  return {
    csv: toCsv([Array.from(QBO_INVOICE_HEADERS), ...rows]),
    invoiceCount,
    rowCount: rows.length,
  };
}

function summaryDescription(type: string | undefined): string {
  const label = (type ?? "").trim();
  if (!label) return "Invoice";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
