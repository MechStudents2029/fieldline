import { beforeAll, describe, expect, it } from "vitest";
import { suggestCostCode } from "@/lib/ai/cost-code";
import { extractReceiptText, receiptAutoPostAllowed, RECEIPT_REVIEW_CONFIDENCE } from "@/lib/ai/receipt";
import { riveraCatalog } from "@/lib/db/catalog";
import { useDatabaseFile } from "@/lib/db/client";
import { authenticate, pendingReceipts, projectDetail } from "@/lib/services/read";
import { captureReceipt, confirmReceiptCost, readDemoReceipt } from "@/lib/services/write";
import type { CostCodeBookRow, CostCodeHistoryRow } from "@/lib/ai/cost-code";

const book: CostCodeBookRow[] = riveraCatalog().map((row) => ({
  code: row.code,
  name: row.name,
  vendor: row.vendor,
  keywords: row.keywords,
}));

function known(code: string, history: CostCodeHistoryRow[]) {
  return book.some((row) => row.code === code) || history.some((row) => row.costCode === code);
}

beforeAll(() => {
  useDatabaseFile(":memory:");
});

describe("receipt text", () => {
  it("reads the demo samples", () => {
    const casa = extractReceiptText(readDemoReceipt("casa-tile.svg"));
    expect(casa.vendor).toBe("Casa Tile");
    expect(casa.amountCents).toBe(86450);
    expect(casa.purchasedOn).toBe("2026-03-12");
    expect(casa.lines.map((line) => line.amountCents)).toEqual([82000, 4450]);
    expect(casa.confidence).toBeGreaterThanOrEqual(RECEIPT_REVIEW_CONFIDENCE);

    const harbor = extractReceiptText(readDemoReceipt("harbor-plumbing.svg"));
    expect(harbor.vendor).toBe("Harbor Plumbing");
    expect(harbor.amountCents).toBe(42600);
    expect(harbor.purchasedOn).toBe("2026-02-02");

    const summit = extractReceiptText(readDemoReceipt("summit-lumber.svg"));
    expect(summit.vendor).toBe("Summit Lumber");
    expect(summit.amountCents).toBe(1842500);
    expect(summit.purchasedOn).toBe("2026-01-18");
    expect(summit.lines[0]?.description).toMatch(/Framing package/);
  });

  it("keeps a labeled total when a subtotal is also present", () => {
    const extracted = extractReceiptText("Vendor: Casa Tile\nSubtotal $800.00\nTax $64.50\nTotal $864.50");
    expect(extracted.amountCents).toBe(86450);
    expect(extracted.confidence).toBeGreaterThanOrEqual(RECEIPT_REVIEW_CONFIDENCE);
    expect(extracted.lines.some((line) => line.description === "Subtotal")).toBe(true);
  });

  it("stays low confidence without a labeled total", () => {
    const vague = extractReceiptText("Thanks for stopping by\n$40.00");
    expect(vague.confidence).toBeLessThan(RECEIPT_REVIEW_CONFIDENCE);
    expect(extractReceiptText("Tile $10.00\nGrout $4.00").confidence).toBeLessThan(RECEIPT_REVIEW_CONFIDENCE);
    expect(extractReceiptText("").note).toMatch(/No readable text/);
    expect(extractReceiptText("Vendor: Casa Tile\nDate: 02/31/2026\nTotal $10.00").purchasedOn).toBeNull();
    expect(receiptAutoPostAllowed(0.9, true)).toBe(false);
    expect(receiptAutoPostAllowed(0.4, true)).toBe(false);
    expect(receiptAutoPostAllowed(0.95, false)).toBe(false);
  });
});

describe("cost code suggestion", () => {
  it("matches the price book and past costs, and does not invent a code", () => {
    const backsplash = suggestCostCode({
      vendor: "Casa Tile",
      lineText: "Backsplash tile",
      book,
      history: [],
      projectId: "proj_okonkwo",
    });
    expect(backsplash?.code).toBe("TILE-BACK");
    expect(known(backsplash!.code, [])).toBe(true);

    const history: CostCodeHistoryRow[] = [{ costCode: "TILE-SHOWER", vendorName: "Casa Tile", projectId: "proj_okonkwo" }];
    const fromJob = suggestCostCode({ vendor: "Casa Tile", lineText: "", book, history, projectId: "proj_okonkwo" });
    expect(fromJob?.code).toBe("TILE-SHOWER");

    expect(suggestCostCode({ vendor: "Casa Tile", lineText: "", book, history: [], projectId: "proj_chen" })).toBeNull();

    const oldOnly: CostCodeHistoryRow[] = [{ costCode: "OLD-CODE", vendorName: "Ada Supply", projectId: "job" }];
    const historical = suggestCostCode({
      vendor: "Ada Supply",
      lineText: "NEW-CODE widgets",
      book: [],
      history: oldOnly,
      projectId: "job",
    });
    expect(historical?.code).toBe("OLD-CODE");
    expect(historical?.code).not.toBe("NEW-CODE");
  });
});

describe("receipt review does not post early", () => {
  it("holds a confident sample and a weak read until confirm", () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    const before = projectDetail(maya.orgId, "proj_okonkwo", "owner")!;
    const waiting = pendingReceipts(maya.orgId).map((row) => row.documentId);
    expect(waiting).toContain("doc_receipt_casa");
    expect(waiting).toContain("doc_receipt_harbor");
    expect(waiting).not.toContain("doc_receipt_summit");

    const captured = captureReceipt(maya, "proj_okonkwo", "casa-tile.svg", readDemoReceipt("casa-tile.svg"));
    expect(captured.extraction.confidence).toBeGreaterThanOrEqual(RECEIPT_REVIEW_CONFIDENCE);
    expect(captured.suggestion?.code).toBe("TILE-BACK");
    expect(projectDetail(maya.orgId, "proj_okonkwo", "owner")!.financials!.actualCents).toBe(before.financials!.actualCents);
    expect(pendingReceipts(maya.orgId).some((row) => row.documentId === captured.documentId)).toBe(true);

    const chenBefore = projectDetail(maya.orgId, "proj_chen", "owner")!.financials!.actualCents;
    const weak = captureReceipt(maya, "proj_chen", "note.txt", "Thanks for stopping by\n$40.00");
    expect(weak.extraction.confidence).toBeLessThan(RECEIPT_REVIEW_CONFIDENCE);
    expect(projectDetail(maya.orgId, "proj_chen", "owner")!.financials!.actualCents).toBe(chenBefore);

    const posted = confirmReceiptCost(maya, "proj_okonkwo", {
      documentId: captured.documentId,
      amountCents: captured.extraction.amountCents!,
      vendorName: captured.extraction.vendor!,
      costCode: captured.suggestion?.code,
      memo: "Backsplash tile",
    });
    expect(posted.marginBps).not.toBeNull();
    const after = projectDetail(maya.orgId, "proj_okonkwo", "owner")!;
    expect(after.financials!.actualCents).toBe(before.financials!.actualCents + 86450);
    expect(pendingReceipts(maya.orgId).some((row) => row.documentId === captured.documentId)).toBe(false);
  });
});
