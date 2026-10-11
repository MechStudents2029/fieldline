import { describe, expect, it } from "vitest";
import {
  averageDaysLate,
  bucketForecast,
  cashAllowed,
  drawDueDate,
  forecastLines,
  openInvoiceCents,
  weekLabel,
  type CashSnap,
} from "@/lib/cash/forecast";

const TODAY = "2026-10-11";

function snap(partial: Partial<CashSnap> = {}): CashSnap {
  return {
    today: TODAY,
    weekStartsOn: 1,
    termsDays: 7,
    workdays: 62,
    includeProjected: false,
    projects: [{ id: "p", name: "Brooks", status: "active", contactId: "c", endDate: "2026-10-20" }],
    contacts: [{ id: "c", name: "Chris", daysLate: null }],
    invoices: [],
    payments: [],
    draws: [],
    schedule: [],
    assignees: [],
    rates: [],
    changes: [],
    bills: [],
    billLines: [],
    pos: [],
    poLines: [],
    proposals: [],
    leads: [],
    ...partial,
  };
}

function cell(lines: ReturnType<typeof forecastLines>, row: string, column: string) {
  const forecast = bucketForecast({
    today: TODAY,
    weekStartsOn: 1,
    openingCents: 0,
    lowCents: 0,
    includeProjected: lines.some((line) => line.kind === "projected"),
    lines,
  });
  const index = forecast.columns.findIndex((item) => item.key === column || item.label === column);
  const found = forecast.rows.find((item) => item.id === row);
  return { forecast, cents: found?.cells[index]?.cents ?? null, lines: found?.cells[index]?.lines ?? [] };
}

describe("cash forecast buckets", () => {
  it("hides the forecast from field and viewer", () => {
    expect(cashAllowed("owner")).toBe(true);
    expect(cashAllowed("admin")).toBe(true);
    expect(cashAllowed("estimator")).toBe(true);
    expect(cashAllowed("field")).toBe(false);
    expect(cashAllowed("viewer")).toBe(false);
  });

  it("puts a due date on its week and rolls earlier dates into Past due", () => {
    const lines = forecastLines(
      snap({
        invoices: [
          { id: "late", projectId: "p", number: "Late", status: "open", type: "progress", dueDate: "2026-10-10", totalCents: 1000, amountPaidCents: 0, retainageCents: 0, applicationNumber: null, changeOrderId: null },
          { id: "next", projectId: "p", number: "Next", status: "open", type: "progress", dueDate: "2026-10-12", totalCents: 2000, amountPaidCents: 0, retainageCents: 0, applicationNumber: null, changeOrderId: null },
        ],
      }),
    );
    expect(weekLabel("2026-10-12")).toBe("Oct 12");
    expect(cell(lines, "invoice", "past").cents).toBe(1000);
    expect(cell(lines, "invoice", "2026-10-12").cents).toBe(2000);
    expect(cell(lines, "invoice", "2026-10-05").cents).toBe(0);
  });

  it("follows a draw when its schedule item moves", () => {
    const draw = {
      id: "d",
      projectId: "p",
      title: "Tile",
      amountCents: 5000,
      scheduleItemId: "s",
      dueOn: "2026-10-01",
      invoiceId: null,
      changeOrderId: null,
    };
    const before = forecastLines(snap({ draws: [draw], schedule: [{ id: "s", projectId: "p", title: "Tile", startDate: "2026-10-05", endDate: "2026-10-05", status: "planned" }] }));
    const after = forecastLines(snap({ draws: [draw], schedule: [{ id: "s", projectId: "p", title: "Tile", startDate: "2026-10-19", endDate: "2026-10-19", status: "planned" }] }));
    expect(drawDueDate(draw, { endDate: "2026-10-05" }, 7)).toBe("2026-10-12");
    expect(before[0]?.date).toBe("2026-10-12");
    expect(after[0]?.date).toBe("2026-10-26");
    expect(cell(before, "draw", "2026-10-12").cents).toBe(5000);
    expect(cell(after, "draw", "2026-10-26").cents).toBe(5000);
  });

  it("keeps an invoiced draw out and brings it back when the invoice is void", () => {
    const draw = { id: "d", projectId: "p", title: "Deposit", amountCents: 800, scheduleItemId: null, dueOn: "2026-10-12", invoiceId: "inv", changeOrderId: null };
    const open = forecastLines(
      snap({
        draws: [draw],
        invoices: [{ id: "inv", projectId: "p", number: "100", status: "open", type: "deposit", dueDate: "2026-10-12", totalCents: 800, amountPaidCents: 0, retainageCents: 0, applicationNumber: null, changeOrderId: null }],
      }),
    );
    expect(open.map((line) => line.group)).toEqual(["invoice"]);
    const voided = forecastLines(
      snap({
        draws: [draw],
        invoices: [{ id: "inv", projectId: "p", number: "100", status: "void", type: "deposit", dueDate: "2026-10-12", totalCents: 800, amountPaidCents: 0, retainageCents: 0, applicationNumber: null, changeOrderId: null }],
      }),
    );
    expect(voided.map((line) => line.id)).toEqual(["d"]);
    expect(openInvoiceCents("void", 800, 0)).toBeNull();
  });

  it("uses the unpaid balance and drops a paid invoice", () => {
    expect(openInvoiceCents("open", 1000, 400)).toBe(600);
    const lines = forecastLines(
      snap({
        invoices: [
          { id: "part", projectId: "p", number: "Part", status: "open", type: "progress", dueDate: "2026-10-12", totalCents: 1000, amountPaidCents: 400, retainageCents: 0, applicationNumber: null, changeOrderId: null },
          { id: "paid", projectId: "p", number: "Paid", status: "paid", type: "deposit", dueDate: "2026-10-12", totalCents: 900, amountPaidCents: 900, retainageCents: 0, applicationNumber: null, changeOrderId: null },
        ],
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.cents).toBe(600);
  });

  it("shifts receipts by the customer's days late and keeps the historical average", () => {
    expect(averageDaysLate([5, 3, -2])).toBe(3);
    const lines = forecastLines(
      snap({
        contacts: [{ id: "c", name: "Chris", daysLate: 5 }],
        invoices: [{ id: "inv", projectId: "p", number: "100", status: "open", type: "progress", dueDate: "2026-10-12", totalCents: 1000, amountPaidCents: 0, retainageCents: 0, applicationNumber: null, changeOrderId: null }],
        payments: [{ invoiceId: "old", status: "succeeded", createdAt: "2026-09-01" }],
      }),
    );
    expect(lines[0]?.date).toBe("2026-10-17");
    const learned = forecastLines(
      snap({
        invoices: [
          { id: "old", projectId: "p", number: "Old", status: "paid", type: "deposit", dueDate: "2026-09-01", totalCents: 100, amountPaidCents: 100, retainageCents: 0, applicationNumber: null, changeOrderId: null },
          { id: "open", projectId: "p", number: "Open", status: "open", type: "progress", dueDate: "2026-10-12", totalCents: 100, amountPaidCents: 0, retainageCents: 0, applicationNumber: null, changeOrderId: null },
        ],
        payments: [{ invoiceId: "old", status: "succeeded", createdAt: "2026-09-11T12:00:00.000Z" }],
      }),
    );
    expect(learned.find((line) => line.id === "open")?.date).toBe("2026-10-22");
  });

  it("splits retainage receivable from the open invoice and retainage payable from the bill", () => {
    const lines = forecastLines(
      snap({
        invoices: [
          { id: "app", projectId: "p", number: "App", status: "open", type: "progress", dueDate: "2026-10-12", totalCents: 900, amountPaidCents: 0, retainageCents: 100, applicationNumber: 1, changeOrderId: null },
        ],
        bills: [
          { id: "paid", projectId: "p", number: "Paid", status: "paid", kind: "standard", amountCents: 500, retainageCents: 50, dueDate: "2026-10-01", purchaseOrderId: null, vendorId: null },
          { id: "open", projectId: "p", number: "Open", status: "approved", kind: "standard", amountCents: 400, retainageCents: 40, dueDate: "2026-10-13", purchaseOrderId: null, vendorId: null },
        ],
      }),
    );
    expect(lines.find((line) => line.id === "app")?.cents).toBe(900);
    expect(lines.find((line) => line.group === "retainage_in")?.cents).toBe(100);
    expect(lines.find((line) => line.id === "open")?.cents).toBe(360);
    expect(lines.find((line) => line.group === "retainage_out")?.cents).toBe(50);
  });

  it("keeps projected cash out until the toggle is on, and tints a week under the line", () => {
    const lines = forecastLines(
      snap({
        includeProjected: true,
        proposals: [{ id: "pr", leadId: "l", projectId: null, estimateId: "e", title: "Deck", status: "sent", totalCents: 700, sentAt: "2026-10-01", expiresAt: "2026-10-20", contactId: "c" }],
        leads: [{ id: "l2", title: "ADU", status: "open", contactId: "c", valueCents: 300 }],
        bills: [{ id: "b", projectId: "p", number: "B", status: "approved", kind: "standard", amountCents: 5000, retainageCents: 0, dueDate: "2026-10-12", purchaseOrderId: null, vendorId: null }],
      }),
    );
    expect(lines.some((line) => line.kind === "projected")).toBe(true);
    const hidden = bucketForecast({ today: TODAY, weekStartsOn: 1, openingCents: 1000, lowCents: 0, includeProjected: false, lines });
    expect(hidden.rows.find((row) => row.id === "proposal")).toBeUndefined();
    expect(hidden.rows.find((row) => row.id === "bill")?.cells.some((item) => item.cents === 5000)).toBe(true);
    const shown = bucketForecast({ today: TODAY, weekStartsOn: 1, openingCents: 1000, lowCents: 0, includeProjected: true, lines });
    expect(shown.rows.find((row) => row.id === "proposal")).toBeTruthy();
    expect(shown.alert).toBeTruthy();
    expect(shown.columns.some((column) => column.low)).toBe(true);
    const balance = shown.rows.find((row) => row.id === "balance");
    expect(balance?.cells[0]?.cents).toBe(1000);
  });
});
