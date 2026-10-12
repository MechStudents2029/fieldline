import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { costItems, purchaseOrderLines, purchaseOrders, stockBalances } from "@/lib/db/schema";
import { receiveDelivery, voidReceipt } from "@/lib/services/receiving";
import { authenticate } from "@/lib/services/read";
import { ServiceError } from "@/lib/services/errors";
import {
  accountingInventoryRows,
  adjustStock,
  issueStock,
  jobStockSummary,
  listStock,
  reorderStock,
  returnStock,
  stockDetail,
  transferJobStock,
  transferStock,
  voidMovement,
} from "@/lib/services/inventory";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(email);
  return user;
}

function onHand(stockItemId: string, locationId: string) {
  return getDb()
    .select()
    .from(stockBalances)
    .where(and(eq(stockBalances.stockItemId, stockItemId), eq(stockBalances.locationId, locationId)))
    .get();
}

describe("inventory", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("issues once, returns the cost, and voids back to the same balance", () => {
    const maya = actor("maya@rivera.demo");
    const before = onHand("stk_tile", "loc_yard");
    expect(before?.onHandMilli).toBe(100_000);
    const issued = issueStock(maya, {
      stockItemId: "stk_tile",
      fromLocationId: "loc_yard",
      projectId: "proj_okonkwo",
      qtyMilli: 5_000,
      sourceKey: "issue-once",
    });
    const again = issueStock(maya, {
      stockItemId: "stk_tile",
      fromLocationId: "loc_yard",
      projectId: "proj_okonkwo",
      qtyMilli: 5_000,
      sourceKey: "issue-once",
    });
    expect(again).toMatchObject({ id: issued.id, existing: true });
    expect(onHand("stk_tile", "loc_yard")?.onHandMilli).toBe(95_000);
    const job = onHand("stk_tile", "loc_job_ok");
    expect(job?.onHandMilli).toBe(17_000);
    expect(job?.allocatedMilli).toBe(17_000);
    const posted = getDb().select().from(costItems).where(eq(costItems.id, issued.id)).get();
    expect(posted).toBeUndefined();
    const costs = getDb().select().from(costItems).where(and(eq(costItems.projectId, "proj_okonkwo"), eq(costItems.source, "inventory"))).all();
    const net = costs.reduce((sum, row) => sum + row.amountCents, 0);
    expect(net).toBe(22_200 + 9_250);

    const returned = returnStock(maya, {
      stockItemId: "stk_tile",
      fromLocationId: "loc_job_ok",
      toLocationId: "loc_yard",
      qtyMilli: 5_000,
      sourceKey: "return-once",
    });
    expect(returnStock(maya, { stockItemId: "stk_tile", fromLocationId: "loc_job_ok", toLocationId: "loc_yard", qtyMilli: 5_000, sourceKey: "return-once" }).existing).toBe(true);
    expect(onHand("stk_tile", "loc_yard")?.onHandMilli).toBe(100_000);
    voidMovement(maya, returned.id, "Counted twice");
    expect(onHand("stk_tile", "loc_yard")?.onHandMilli).toBe(95_000);
    expect(onHand("stk_tile", "loc_job_ok")?.allocatedMilli).toBe(17_000);
    const afterVoid = getDb()
      .select()
      .from(costItems)
      .where(and(eq(costItems.projectId, "proj_okonkwo"), eq(costItems.source, "inventory")))
      .all()
      .reduce((sum, row) => sum + row.amountCents, 0);
    expect(afterVoid).toBe(net);
    voidMovement(maya, issued.id, "Put it back");
    expect(onHand("stk_tile", "loc_yard")?.onHandMilli).toBe(100_000);
    expect(onHand("stk_tile", "loc_job_ok")?.onHandMilli).toBe(12_000);
  });

  it("moves issued tile and its cost from one job to another, then voids the move", () => {
    const maya = actor("maya@rivera.demo");
    const beforeOk = jobStockSummary("org_rivera", "proj_okonkwo", "owner")?.issuedCents;
    const beforeBr = jobStockSummary("org_rivera", "proj_brooks", "owner")?.issuedCents;
    const moved = transferJobStock(maya, {
      stockItemId: "stk_tile",
      fromProjectId: "proj_okonkwo",
      toProjectId: "proj_brooks",
      qtyMilli: 4_000,
      sourceKey: "job-once",
    });
    expect(transferJobStock(maya, { stockItemId: "stk_tile", fromProjectId: "proj_okonkwo", toProjectId: "proj_brooks", qtyMilli: 4_000, sourceKey: "job-once" }).existing).toBe(true);
    expect(jobStockSummary("org_rivera", "proj_okonkwo", "owner")?.issuedCents).toBe((beforeOk ?? 0) - 7_400);
    expect(jobStockSummary("org_rivera", "proj_brooks", "owner")?.issuedCents).toBe((beforeBr ?? 0) + 7_400);
    expect(jobStockSummary("org_rivera", "proj_okonkwo", "field")?.issuedCents).toBeNull();
    voidMovement(maya, moved.id, "Wrong bath");
    expect(jobStockSummary("org_rivera", "proj_okonkwo", "owner")?.issuedCents).toBe(beforeOk);
    expect(onHand("stk_tile", "loc_job_ok")?.onHandMilli).toBe(12_000);
  });

  it("keeps damaged receipts out of stock and stocks a good receipt once", () => {
    const maya = actor("maya@rivera.demo");
    const yard = onHand("stk_valve", "loc_yard")?.onHandMilli ?? 0;
    const damaged = receiveDelivery(maya, {
      purchaseOrderId: "po_ok_harbor",
      receivedOn: "2026-10-12",
      note: null,
      documentId: null,
      stockTo: "loc_yard",
      lines: [{ lineId: "pol_ok_harbor", qtyMilli: 500, percentBps: 0, condition: "damaged", expectedOn: null, scheduleItemId: null, note: null }],
    });
    expect(onHand("stk_valve", "loc_yard")?.onHandMilli).toBe(yard);
    const good = receiveDelivery(maya, {
      purchaseOrderId: "po_ok_harbor",
      receivedOn: "2026-10-12",
      note: null,
      documentId: null,
      stockTo: "loc_yard",
      lines: [{ lineId: "pol_ok_harbor", qtyMilli: 1000, percentBps: 0, condition: "ok", expectedOn: null, scheduleItemId: null, note: null }],
    });
    expect(onHand("stk_valve", "loc_yard")?.onHandMilli).toBe(yard + 1000);
    voidReceipt(maya, good.id, "Wrong slip");
    expect(onHand("stk_valve", "loc_yard")?.onHandMilli).toBe(yard);
    voidReceipt(maya, damaged.id, "Not stock");
  });

  it("writes one draft for a low item and refuses a second open line", () => {
    const maya = actor("maya@rivera.demo");
    const low = listStock(maya, { low: true }).rows.map((row) => row.id);
    expect(low).toContain("stk_valve");
    expect(low).not.toContain("stk_tile");
    const first = reorderStock(maya, "stk_valve", "proj_okonkwo");
    const second = reorderStock(maya, "stk_valve", "proj_okonkwo");
    expect(second).toMatchObject({ id: first.id, existing: true });
    const lines = getDb()
      .select()
      .from(purchaseOrderLines)
      .where(and(eq(purchaseOrderLines.purchaseOrderId, first.id), eq(purchaseOrderLines.sourceId, "stk_valve")))
      .all();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ qtyMilli: 2000, sourceKind: "stock_item", unitCostCents: 145_000 });
    expect(getDb().select().from(purchaseOrders).where(eq(purchaseOrders.id, first.id)).get()?.status).toBe("draft");
    expect(() => reorderStock(actor("dana@rivera.demo"), "stk_valve", "proj_okonkwo")).toThrow(ServiceError);
  });

  it("transfers between the yard and the truck without a job cost", () => {
    const maya = actor("maya@rivera.demo");
    const before = getDb().select().from(costItems).all().length;
    const moved = transferStock(maya, {
      stockItemId: "stk_tile",
      fromLocationId: "loc_yard",
      toLocationId: "loc_truck",
      qtyMilli: 1_000,
      sourceKey: "truck-once",
    });
    expect(onHand("stk_tile", "loc_truck")?.onHandMilli).toBe(16_000);
    expect(getDb().select().from(costItems).all()).toHaveLength(before);
    voidMovement(maya, moved.id, "Leave it");
    expect(onHand("stk_tile", "loc_truck")?.onHandMilli).toBe(15_000);
    const lost = adjustStock(maya, {
      stockItemId: "stk_valve",
      locationId: "loc_yard",
      qtyMilli: 1000,
      direction: "out",
      reason: "loss",
      sourceKey: "loss-once",
    });
    expect(onHand("stk_valve", "loc_yard")?.onHandMilli).toBe(1_000);
    voidMovement(maya, lost.id, "Found it");
    expect(onHand("stk_valve", "loc_yard")?.onHandMilli).toBe(2_000);
    expect(stockDetail(actor("dana@rivera.demo"), "stk_valve")?.money).toBe(false);
    expect(accountingInventoryRows("org_rivera").some((row) => row[8] === "Inventory")).toBe(true);
    expect(() => issueStock(actor("jordan@northline.demo"), { stockItemId: "stk_tile", fromLocationId: "loc_yard", projectId: "proj_okonkwo", qtyMilli: 1000, sourceKey: "nope" })).toThrow(ServiceError);
  });
});
