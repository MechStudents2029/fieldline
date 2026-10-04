import { beforeAll, describe, expect, it } from "vitest";
import { useDatabaseFile } from "@/lib/db/client";
import {
  QBO_CUSTOMER_HEADERS,
  QBO_INVOICE_HEADERS,
  QBO_ITEM_TAX_CODE,
  qboCustomersCsv,
  qboDisplayName,
  qboImportLimitWarning,
  qboInvoicesCsv,
  splitPersonName,
} from "@/lib/export/qbo";
import { authenticate, contactsCsv, invoicesCsv } from "@/lib/services/read";

describe("QuickBooks Online CSV shape", () => {
  it("splits a two-word name and leaves other names on DisplayName", () => {
    expect(splitPersonName("Elena Vasquez")).toEqual({ firstName: "Elena", lastName: "Vasquez" });
    expect(splitPersonName("  Elena   Vasquez ")).toEqual({ firstName: "Elena", lastName: "Vasquez" });
    expect(splitPersonName("Summit")).toEqual({ firstName: "", lastName: "" });
    expect(splitPersonName("Mary Ann Lee")).toEqual({ firstName: "", lastName: "" });
    expect(qboDisplayName("Elena Vasquez")).toBe("Elena Vasquez");
  });

  it("writes customer headers and billing fields", () => {
    const csv = qboCustomersCsv([
      {
        name: "Elena Vasquez",
        company: "",
        email: "elena.vasquez@example.com",
        phone: "(510) 555-0142",
        address: "240 Hillcrest Ave",
        city: "Oakland",
        state: "CA",
        zip: "94611",
      },
      { name: "Mary Ann Lee", company: "Lee Co", email: "mary@example.com", phone: "", address: "", city: "", state: "", zip: "" },
    ]);
    const [header, elena, mary] = csv.split("\n");
    expect(header).toBe(QBO_CUSTOMER_HEADERS.join(","));
    expect(elena).toContain("Elena Vasquez");
    expect(elena).toContain("Elena,Vasquez");
    expect(elena).toContain("240 Hillcrest Ave,Oakland,CA,94611");
    expect(mary?.startsWith("Mary Ann Lee,Lee Co,,,")).toBe(true);
  });

  it("repeats InvoiceNo for each positive line and drops negatives", () => {
    const { csv, invoiceCount, rowCount } = qboInvoicesCsv([
      {
        number: "RR-2001",
        customer: "Elena Vasquez",
        issueDate: "2026-10-01",
        dueDate: "2026-10-08",
        totalCents: 30000,
        type: "progress",
        lines: [
          { description: "Deposit to schedule", amountCents: 10000, sortOrder: 1 },
          { description: "Tile, set", amountCents: 20000, sortOrder: 0 },
          { description: "Credit", amountCents: -500, sortOrder: 2 },
          { description: "Waived", amountCents: 0, sortOrder: 3 },
        ],
      },
      {
        number: "RR-2002",
        customer: "Mei Chen",
        issueDate: "2026-10-02",
        dueDate: "",
        totalCents: 5000,
        type: "deposit",
        lines: [],
      },
      {
        number: "RR-2003",
        customer: "Tom Briggs",
        issueDate: "2026-10-03",
        dueDate: "2026-10-03",
        totalCents: -100,
        type: "credit",
        lines: [{ description: "Credit memo", amountCents: -100, sortOrder: 0 }],
      },
    ]);
    expect(csv.split("\n")[0]).toBe(QBO_INVOICE_HEADERS.join(","));
    const data = csv.split("\n").slice(1);
    expect(data).toHaveLength(3);
    expect(data.filter((row) => row.startsWith("RR-2001,"))).toHaveLength(2);
    expect(data[0]).toBe(`RR-2001,Elena Vasquez,10/01/2026,10/08/2026,Services,"Tile, set",1,200.00,200.00,${QBO_ITEM_TAX_CODE}`);
    expect(data[1]).toContain("Deposit to schedule,1,100.00,100.00,NON");
    expect(data[2]).toBe(`RR-2002,Mei Chen,10/02/2026,10/02/2026,Services,Deposit,1,50.00,50.00,${QBO_ITEM_TAX_CODE}`);
    expect(csv).not.toContain("RR-2003");
    expect(csv).not.toContain("Credit");
    expect(invoiceCount).toBe(2);
    expect(rowCount).toBe(3);
  });

  it("warns when a file is over the Import Data caps", () => {
    expect(qboImportLimitWarning(8, 12)).toBeNull();
    expect(qboImportLimitWarning(101, 12)).toMatch(/101 invoices/);
    expect(qboImportLimitWarning(1, 1001)).toMatch(/1,001 rows/);
  });
});

describe("seeded QuickBooks exports", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("exports Rivera clients and invoice lines, not another company", () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    const jordan = authenticate("jordan@northline.demo", "demo")!;
    const customers = contactsCsv(maya.orgId);
    expect(customers.startsWith("DisplayName,")).toBe(true);
    expect(customers).toContain("Elena Vasquez,");
    expect(customers).toContain("Elena,Vasquez");
    expect(customers).not.toContain("Gail Nguyen");
    expect(customers).not.toContain("Summit Lumber");

    const invoices = invoicesCsv(maya.orgId);
    expect(invoices.startsWith("InvoiceNo,")).toBe(true);
    const chen = invoices.split("\n").filter((row) => row.startsWith("RR-1041,"));
    expect(chen).toHaveLength(1);
    expect(chen[0]).toContain("Mei Chen");
    expect(chen[0]).toContain("Deposit to schedule the powder room");
    expect(chen[0]).toContain(",7360.00,7360.00,NON");
    expect(invoicesCsv(jordan.orgId)).not.toContain("RR-1041");
    expect(contactsCsv(jordan.orgId)).not.toContain("Elena Vasquez");
  });
});
