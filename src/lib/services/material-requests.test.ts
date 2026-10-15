import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, costItems, materialRequests, purchaseOrderLines, stockBalances } from "@/lib/db/schema";
import { daysAgo } from "@/lib/ids";
import { listInbox, mentionUnread, openNotification } from "@/lib/services/comments";
import {
  approveMaterialRequest,
  createMaterialRequest,
  fulfillMaterialRequest,
  listMaterialRequests,
  materialAttention,
  materialCsv,
  materialDetail,
  orderMaterialRequest,
  rejectMaterialRequest,
} from "@/lib/services/material-requests";
import { authenticate } from "@/lib/services/read";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("material requests", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("seeds one waiting request, a stock issue, a draft PO, and a rejection", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const rows = listMaterialRequests(maya);
    expect(rows.map((row) => row.id).sort()).toEqual(["mrq_done", "mrq_no", "mrq_po", "mrq_urgent"]);
    expect(materialAttention(maya).count).toBe(1);
    expect(materialAttention(maya).href).toBe("/material-requests?status=submitted");
    expect(materialAttention(dana).count).toBe(1);
    expect(listMaterialRequests(dana).map((row) => row.id).sort()).toEqual(["mrq_no", "mrq_urgent"]);
    expect(listMaterialRequests(riley)).toHaveLength(4);
    expect(() => materialDetail(dana, "mrq_po")).toThrow(/not found/);

    const urgent = materialDetail(dana, "mrq_urgent");
    expect(urgent.status).toBe("submitted");
    expect(urgent.urgency).toBe("urgent");
    expect(urgent.note).toBe("Need tile");
    expect(urgent.lines[0]?.qtyMilli).toBe(5_000);
    expect(materialDetail(maya, "mrq_done").lines[0]?.movementId).toBe("mov_tile_issue");
    expect(materialDetail(maya, "mrq_po").purchaseOrderNumber).toBe("PO-1056");
    expect(materialDetail(dana, "mrq_no").rejectNote).toBe("Already on the truck.");

    const blob = JSON.stringify(listMaterialRequests(dana)) + JSON.stringify(urgent);
    expect(blob).not.toMatch(/marginBps|unitCostCents|hourly/);
    expect(materialCsv(dana)).not.toContain("Quartz vanity");
    expect(materialCsv(dana)).not.toContain("PO-1056");
    expect(materialCsv(maya)).toContain("Quartz vanity");
    expect(materialCsv(maya)).toContain("PO-1056");
    expect(materialCsv(maya)).toContain("Already on the truck.");

    const ok = getDb().select().from(costItems).where(eq(costItems.projectId, "proj_okonkwo")).all();
    expect(ok.reduce((sum, row) => sum + row.amountCents, 0)).toBe(1_323_200);
    const yard = getDb()
      .select()
      .from(stockBalances)
      .where(and(eq(stockBalances.stockItemId, "stk_tile"), eq(stockBalances.locationId, "loc_yard")))
      .get();
    expect(yard?.onHandMilli).toBe(100_000);
    const vanity = getDb().select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, "po_ok_vanity")).all();
    expect(vanity).toHaveLength(1);
    expect(vanity[0]?.amountCents).toBe(280_000);

    const inbox = listInbox(maya, "all");
    expect(inbox.some((row) => row.record === "Materials" && row.snippet === "Need tile")).toBe(true);
    expect(mentionUnread(maya)).toBe(2);
    expect(openNotification(maya, "note_mrq_maya")).toBe("/material-requests/mrq_urgent");

    const sql = readFileSync("supabase/rls.sql", "utf8");
    expect(sql).toContain("'material_requests'");
    expect(sql).toContain("'material_request_lines'");

    const db = getDb();
    db.update(materialRequests).set({ urgency: "normal" }).where(eq(materialRequests.id, "mrq_urgent")).run();
    expect(materialAttention(maya).count).toBe(0);
    db.update(materialRequests).set({ submittedAt: daysAgo(5) }).where(eq(materialRequests.id, "mrq_urgent")).run();
    expect(materialAttention(maya).count).toBe(1);
    db.update(materialRequests).set({ urgency: "urgent", submittedAt: daysAgo(1) }).where(eq(materialRequests.id, "mrq_urgent")).run();
    expect(materialAttention(maya).count).toBe(1);
  });

  it("keeps field and viewers out, then fulfills stock and appends a draft PO", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const luis = actor("luis@rivera.demo");
    expect(() => approveMaterialRequest(dana, "mrq_urgent")).toThrow(/office/);
    expect(() => approveMaterialRequest(riley, "mrq_urgent")).toThrow(/office/);
    expect(() => fulfillMaterialRequest(dana, "mrq_urgent", "loc_yard")).toThrow(/office/);
    expect(() => orderMaterialRequest(riley, "mrq_urgent", "c_casa")).toThrow(/office/);
    expect(() =>
      createMaterialRequest(riley, { projectId: "proj_brooks", urgency: "normal", lines: [{ stockItemId: "stk_tile", qtyMilli: 1000 }] }),
    ).toThrow(/cannot request/);
    expect(() => rejectMaterialRequest(maya, "mrq_urgent", "  ")).toThrow(/note/);

    const dup = createMaterialRequest(dana, {
      projectId: "proj_brooks",
      urgency: "normal",
      submit: true,
      lines: [{ stockItemId: "stk_tile", qtyMilli: 1000 }],
    });
    expect(listMaterialRequests(dana).find((row) => row.id === dup.id)?.duplicateId).toBeTruthy();
    expect(materialAttention(maya).count).toBe(1);
    approveMaterialRequest(luis, dup.id);
    expect(materialDetail(maya, dup.id).status).toBe("approved");

    const issued = createMaterialRequest(maya, {
      projectId: "proj_diaz",
      urgency: "normal",
      submit: true,
      lines: [{ stockItemId: "stk_tile", qtyMilli: 1000 }],
    });
    approveMaterialRequest(maya, issued.id);
    const posted = fulfillMaterialRequest(maya, issued.id, "loc_yard");
    expect(materialDetail(maya, issued.id).status).toBe("fulfilled");
    expect(materialDetail(maya, issued.id).lines[0]?.movementId).toBe(posted.movementId);
    const yard = getDb()
      .select()
      .from(stockBalances)
      .where(and(eq(stockBalances.stockItemId, "stk_tile"), eq(stockBalances.locationId, "loc_yard")))
      .get();
    expect(yard?.onHandMilli).toBe(99_000);

    const ordered = createMaterialRequest(maya, {
      projectId: "proj_diaz",
      urgency: "normal",
      submit: true,
      lines: [{ description: "Floor tile, set", qtyMilli: 1000, costCode: "TILE-FLR" }],
    });
    approveMaterialRequest(maya, ordered.id);
    const po = orderMaterialRequest(maya, ordered.id, "c_casa");
    expect(po.number).toBe("PO-1057");
    const firstLines = getDb().select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.purchaseOrderId)).all();
    expect(firstLines.some((line) => line.amountCents === 1850)).toBe(true);

    const extra = createMaterialRequest(maya, {
      projectId: "proj_diaz",
      urgency: "urgent",
      submit: true,
      lines: [{ description: "Shower valve and head", qtyMilli: 1000, costCode: "PLB-SHOWER" }],
    });
    approveMaterialRequest(maya, extra.id);
    const again = orderMaterialRequest(maya, extra.id, "c_casa");
    expect(again.purchaseOrderId).toBe(po.purchaseOrderId);
    expect(getDb().select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.purchaseOrderId)).all()).toHaveLength(2);
    const vanity = getDb().select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, "po_ok_vanity")).all();
    expect(vanity).toHaveLength(1);
    expect(vanity[0]?.description).toBe("Quartz vanity");

    rejectMaterialRequest(maya, "mrq_urgent", "Use the other request.");
    expect(materialDetail(maya, "mrq_urgent").status).toBe("rejected");
    expect(materialDetail(maya, "mrq_urgent").rejectNote).toBe("Use the other request.");

    const actions = getDb()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.orgId, maya.orgId), eq(auditLogs.entityId, issued.id)))
      .all()
      .map((row) => row.action)
      .sort();
    expect(actions).toEqual(["material.approve", "material.create", "material.fulfill", "material.submit"]);
  });
});
