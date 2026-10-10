import { describe, expect, it } from "vitest";
import { addMonths, closeoutChecklist, finalInvoiceState, openBlockers, warrantyOpen, type CloseoutFacts } from "@/lib/closeout/check";

const clear: CloseoutFacts = {
  punchOpen: 0,
  punchDone: 0,
  finalInvoice: "sent",
  draftChangeOrders: 0,
  draftBills: 0,
  openPurchaseOrders: 0,
  unapprovedTime: 0,
  permitsOpen: 0,
  inspectionsOpen: 0,
  equipmentOn: 0,
};

describe("closeout checklist", () => {
  it("counts unfinished punch, a missing final, drafts, open orders, and unapproved time", () => {
    const rows = closeoutChecklist({
      punchOpen: 2,
      punchDone: 1,
      finalInvoice: "missing",
      draftChangeOrders: 1,
      draftBills: 2,
      openPurchaseOrders: 1,
      unapprovedTime: 3,
      permitsOpen: 1,
      inspectionsOpen: 2,
      equipmentOn: 0,
    });
    expect(rows.map((row) => [row.key, row.count])).toEqual([
      ["punch", 3],
      ["invoice", 1],
      ["changes", 1],
      ["bills", 2],
      ["orders", 1],
      ["time", 3],
      ["permits", 1],
      ["inspections", 2],
      ["equipment", 0],
    ]);
    expect(openBlockers(clear)).toEqual([]);
  });

  it("treats a sent or paid final invoice as clear and a draft final as blocked", () => {
    expect(finalInvoiceState([])).toBe("missing");
    expect(finalInvoiceState(["draft"])).toBe("draft");
    expect(finalInvoiceState(["open"])).toBe("sent");
    expect(finalInvoiceState(["paid"])).toBe("paid");
    expect(finalInvoiceState(["draft", "open"])).toBe("sent");
    expect(closeoutChecklist({ ...clear, finalInvoice: "paid" }).find((row) => row.key === "invoice")?.count).toBe(0);
    expect(closeoutChecklist({ ...clear, finalInvoice: "draft" }).find((row) => row.key === "invoice")?.count).toBe(1);
  });

  it("keeps a verified-only punch list clear", () => {
    expect(closeoutChecklist({ ...clear, punchOpen: 0, punchDone: 0 }).find((row) => row.key === "punch")?.count).toBe(0);
    expect(closeoutChecklist({ ...clear, punchOpen: 1, punchDone: 0 }).find((row) => row.key === "punch")?.count).toBe(1);
  });
});

describe("warranty window", () => {
  it("adds calendar months and clamps the day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-10-06", 12)).toBe("2027-10-06");
  });

  it("is open through the end date and closed after", () => {
    expect(warrantyOpen("2027-10-06", "2027-10-06")).toBe(true);
    expect(warrantyOpen("2027-10-06", "2027-10-07")).toBe(false);
    expect(warrantyOpen(null, "2026-10-06")).toBe(false);
    expect(warrantyOpen("2027-10-06", "nope")).toBe(false);
  });
});
