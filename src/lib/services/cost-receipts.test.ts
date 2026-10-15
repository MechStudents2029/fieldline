import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, bills, costItems } from "@/lib/db/schema";
import { authenticate } from "@/lib/services/read";
import {
  codeCostReceipt,
  costReceiptDetail,
  listCostReceipts,
  markReceiptReimbursed,
  postCostReceipt,
  receiptAttention,
  reimbursementBoard,
  reimbursementCsv,
  rejectCostReceipt,
  submitCostReceipt,
} from "@/lib/services/cost-receipts";
import { wipJob } from "@/lib/services/wip";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

function snap(input: { vendorName: string; amountCents: number; payMethod?: string; projectId?: string | null; costCode?: string; purchasedOn?: string; bytes?: Buffer }) {
  return submitCostReceipt(actor("dana@rivera.demo"), {
    filename: "receipt.png",
    bytes: input.bytes ?? PNG,
    projectId: input.projectId === undefined ? "proj_brooks" : input.projectId,
    vendorName: input.vendorName,
    purchasedOn: input.purchasedOn ?? "2026-10-14",
    amountCents: input.amountCents,
    costCode: input.costCode ?? "FRM-WALL",
    note: "",
    payMethod: input.payMethod ?? "personal",
  });
}

describe("cost receipts", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("seeds a duplicate pair, a personal receipt waiting, and a rejection", () => {
    const maya = actor("maya@rivera.demo");
    const rows = listCostReceipts(maya);
    expect(rows.find((row) => row.id === "cr_depot_a")?.duplicateId).toBe("cr_depot_b");
    expect(rows.find((row) => row.id === "cr_depot_b")?.duplicateId).toBe("cr_depot_a");
    expect(rows.find((row) => row.id === "cr_ace")).toMatchObject({ status: "posted", payMethod: "personal", reimbursedAt: null, amountCents: 1840 });
    expect(rows.find((row) => row.id === "cr_kiosk")).toMatchObject({ status: "rejected", rejectNote: "Not this job." });
    expect(receiptAttention(maya).count).toBe(2);
    expect(reimbursementBoard(maya).totals.find((row) => row.userId === "user_dana")?.openCents).toBe(1840);
    expect(readFileSync("supabase/rls.sql", "utf8")).toContain("cost_receipts");
    const dana = actor("dana@rivera.demo");
    const own = listCostReceipts(dana);
    expect(own.every((row) => row.submittedBy === dana.userId)).toBe(true);
    expect(JSON.stringify(own)).not.toMatch(/marginBps|unitCostCents|hourly/);
    expect(receiptAttention(dana).count).toBe(2);
  });

  it("posts a split onto the job, flags a duplicate, and keeps field and viewer out", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const first = snap({ vendorName: "City Supply", amountCents: 3000 });
    const again = snap({ vendorName: "city supply", amountCents: 3000, purchasedOn: "2026-10-12", costCode: "" });
    expect(again.duplicateId).toBe(first.id);
    expect(() => postCostReceipt(dana, first.id)).toThrow(/office/);
    expect(() => postCostReceipt(riley, first.id)).toThrow(/office/);
    expect(() => submitCostReceipt(riley, { filename: "receipt.png", bytes: PNG, vendorName: "X", purchasedOn: "2026-10-14", amountCents: 100, payMethod: "cash" })).toThrow(/cannot submit/);
    expect(() => codeCostReceipt(maya, first.id, { projectId: "proj_brooks", vendorName: "City Supply", purchasedOn: "2026-10-14", amountCents: 3000, splits: [{ costCode: "FRM-WALL", amountCents: 1000 }, { costCode: "HDW-DOOR", amountCents: 1000 }] })).toThrow(/add up/);
    expect(costReceiptDetail(maya, first.id).status).toBe("coded");
    const before = wipJob(maya, "proj_brooks")?.costToDateCents ?? 0;
    const beforeCosts = getDb().select().from(costItems).where(and(eq(costItems.orgId, maya.orgId), eq(costItems.projectId, "proj_brooks"))).all().length;
    codeCostReceipt(maya, first.id, {
      projectId: "proj_brooks",
      vendorName: "City Supply",
      purchasedOn: "2026-10-14",
      amountCents: 3000,
      splits: [
        { costCode: "FRM-WALL", amountCents: 1000 },
        { costCode: "HDW-DOOR", amountCents: 2000 },
      ],
    });
    postCostReceipt(maya, first.id);
    const detail = costReceiptDetail(maya, first.id);
    expect(detail.status).toBe("posted");
    expect(detail.splits.map((split) => split.amountCents).sort()).toEqual([1000, 2000]);
    expect(detail.splits.every((split) => split.costItemId)).toBe(true);
    expect(getDb().select().from(costItems).where(and(eq(costItems.orgId, maya.orgId), eq(costItems.projectId, "proj_brooks"))).all().length).toBe(beforeCosts + 2);
    expect(wipJob(maya, "proj_brooks")?.costToDateCents).toBe(before + 3000);
    expect(getDb().select().from(auditLogs).where(and(eq(auditLogs.orgId, maya.orgId), eq(auditLogs.entityId, first.id), eq(auditLogs.action, "receipt.post"))).all()).toHaveLength(1);
    const hidden = snap({ vendorName: "Maya only", amountCents: 700, payMethod: "cash" });
    submitCostReceipt(maya, { filename: "office.png", bytes: PNG, vendorName: "Office float", purchasedOn: "2026-10-01", amountCents: 700, payMethod: "cash", projectId: "proj_brooks" });
    expect(listCostReceipts(dana).some((row) => row.vendorName === "Office float")).toBe(false);
    expect(() => costReceiptDetail(dana, listCostReceipts(maya).find((row) => row.vendorName === "Office float")!.id)).toThrow(/not found/);
    expect(hidden.id).toBeTruthy();
  });

  it("posts a draft bill when a vendor or PO is chosen and does not add a second cost", () => {
    const maya = actor("maya@rivera.demo");
    const saved = snap({ vendorName: "Summit Lumber", amountCents: 4500, payMethod: "company_card", costCode: "WIN-REPL" });
    const costsBefore = getDb().select().from(costItems).where(eq(costItems.orgId, maya.orgId)).all().length;
    codeCostReceipt(maya, saved.id, {
      projectId: "proj_brooks",
      vendorName: "Summit Lumber",
      purchasedOn: "2026-10-14",
      amountCents: 4500,
      splits: [{ costCode: "WIN-REPL", amountCents: 4500 }],
      vendorContactId: "c_summit",
      purchaseOrderId: "po_br_windows",
    });
    const posted = postCostReceipt(maya, saved.id);
    expect(posted.billId).toBeTruthy();
    expect(getDb().select().from(bills).where(eq(bills.id, posted.billId!)).get()?.status).toBe("draft");
    expect(getDb().select().from(bills).where(eq(bills.id, posted.billId!)).get()?.purchaseOrderId).toBe("po_br_windows");
    expect(getDb().select().from(costItems).where(eq(costItems.orgId, maya.orgId)).all().length).toBe(costsBefore);
    expect(costReceiptDetail(maya, saved.id).splits.every((split) => !split.costItemId)).toBe(true);
  });

  it("rejects with a note and marks a personal receipt reimbursed", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const saved = snap({ vendorName: "Kiosk two", amountCents: 800, payMethod: "cash", projectId: null, costCode: "" });
    expect(saved.status).toBe("new");
    expect(() => rejectCostReceipt(maya, saved.id, "  ")).toThrow(/note/);
    expect(() => rejectCostReceipt(dana, saved.id, "No")).toThrow(/office/);
    rejectCostReceipt(maya, saved.id, "Not this job.");
    expect(costReceiptDetail(dana, saved.id).rejectNote).toBe("Not this job.");
    expect(getDb().select().from(auditLogs).where(and(eq(auditLogs.entityId, saved.id), eq(auditLogs.action, "receipt.reject"))).get()?.actorId).toBe(maya.userId);
    const personal = snap({ vendorName: "Dana card", amountCents: 2200, payMethod: "personal" });
    expect(() => markReceiptReimbursed(maya, personal.id)).toThrow(/not waiting/);
    postCostReceipt(maya, personal.id);
    expect(() => markReceiptReimbursed(dana, personal.id)).toThrow(/office/);
    const openBefore = reimbursementBoard(maya).openCents;
    markReceiptReimbursed(maya, personal.id);
    const line = reimbursementBoard(maya).lines.find((row) => row.id === personal.id);
    expect(line?.reimbursedAt).toBeTruthy();
    expect(line?.reimbursedByName).toBe("Maya Rivera");
    expect(reimbursementBoard(maya).openCents).toBe(openBefore - 2200);
    expect(reimbursementCsv(dana)).toContain("Dana Cho");
    expect(reimbursementCsv(dana)).not.toContain("Maya Rivera");
    expect(getDb().select().from(auditLogs).where(and(eq(auditLogs.entityId, personal.id), eq(auditLogs.action, "receipt.reimburse"))).all()).toHaveLength(1);
    expect(() => markReceiptReimbursed(maya, personal.id)).toThrow(/not waiting/);
    const card = snap({ vendorName: "Card stop", amountCents: 1500, payMethod: "company_card" });
    postCostReceipt(maya, card.id);
    expect(() => markReceiptReimbursed(maya, card.id)).toThrow(/not waiting/);
  });

  it("refuses a photo that is not a JPEG, PNG, or WebP", () => {
    expect(() =>
      submitCostReceipt(actor("dana@rivera.demo"), {
        filename: "note.svg",
        bytes: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
        vendorName: "Store",
        purchasedOn: "2026-10-14",
        amountCents: 100,
        payMethod: "cash",
      }),
    ).toThrow(/JPEG, PNG, or WebP/);
  });
});
