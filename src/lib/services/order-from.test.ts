import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, automationRules, notifications, purchaseOrderLines, purchaseOrders } from "@/lib/db/schema";
import { emitAutomation, saveAutomation } from "@/lib/services/automations";
import { chooseSelection } from "@/lib/services/selections";
import { createOrdersFrom, selectionsNeedingPo } from "@/lib/services/order-from";
import { authenticate } from "@/lib/services/read";
import { voidPurchaseOrder } from "@/lib/services/purchase-orders";
import { poKindLabel } from "@/lib/purchasing/cover";

function clearSupabaseEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

function linesFor(number: string) {
  const order = getDb().select().from(purchaseOrders).where(eq(purchaseOrders.number, number)).get();
  if (!order) return [];
  return getDb().select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, order.id)).all();
}

describe("orders from approved lines", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  afterAll(() => {
    clearSupabaseEnv();
  });

  it("flags a stale confirmed selection and skips one that already has a draft", () => {
    const rows = selectionsNeedingPo("org_rivera");
    expect(rows.map((row) => row.title)).toEqual(["Door hardware"]);
    expect(rows[0]?.href).toBe("/projects/proj_brooks/selections");
  });

  it("creates a draft from the confirmed selection once, including a work order and an added change-order line", () => {
    const maya = actor("maya@rivera.demo");
    saveAutomation(maya, {
      name: "Order the selection",
      enabled: true,
      trigger: { kind: "selection_confirmed" },
      conditions: [],
      actions: [{ kind: "create_draft_po" }],
    });
    emitAutomation({
      orgId: maya.orgId,
      kind: "selection_confirmed",
      recordType: "selection",
      recordId: "sel_br_hardware",
      recordLabel: "Door hardware",
      projectId: "proj_brooks",
      name: "Door hardware",
    });
    const created = linesFor("PO-1057");
    expect(created).toMatchObject([{ sourceKind: "selection", sourceId: "sel_br_hardware:choc_br_bronze", costCode: "HDW-DOOR", amountCents: 42000, qtyMilli: 1000, unitCostCents: 42000 }]);
    expect(getDb().select().from(auditLogs).where(and(eq(auditLogs.action, "po.create"), eq(auditLogs.entityType, "purchase_order"))).all().some((row) => row.payloadJson?.includes("PO-1057"))).toBe(true);
    const again = createOrdersFrom(maya, { sourceKind: "selection", sourceIds: ["sel_br_hardware"] });
    expect(again.orders[0]).toMatchObject({ number: "PO-1057", added: 0 });
    expect(linesFor("PO-1057")).toHaveLength(1);
    expect(selectionsNeedingPo("org_rivera")).toEqual([]);

    const added = createOrdersFrom(maya, { sourceKind: "change_order_line", sourceIds: ["col_ok_1"], purchaseOrderId: "po_ok_vanity" });
    expect(added.orders[0]).toMatchObject({ number: "PO-1056", added: 1 });
    expect(linesFor("PO-1056").some((line) => line.sourceId === "col_ok_1" && line.amountCents === 110000)).toBe(true);
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.action, "po.add")).all().length).toBeGreaterThan(0);
    expect(createOrdersFrom(maya, { sourceKind: "change_order_line", sourceIds: ["col_ok_1"], purchaseOrderId: "po_ok_vanity" }).orders[0]?.added).toBe(0);

    const work = createOrdersFrom(maya, { sourceKind: "budget_line", sourceIds: ["bud_proj_brooks_0"], vendorContactId: "c_casa", kind: "work" });
    expect(work.orders[0]?.number.startsWith("WO-")).toBe(true);
    expect(getDb().select().from(purchaseOrders).where(eq(purchaseOrders.number, work.orders[0]!.number)).get()?.kind).toBe("work");
    expect(poKindLabel("work")).toBe("Work order");
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.action, "po.work_order")).all().length).toBeGreaterThan(0);

    voidPurchaseOrder(maya, again.orders[0]!.id, "Wrong finish");
    const reordered = createOrdersFrom(maya, { sourceKind: "selection", sourceIds: ["sel_br_hardware"] });
    expect(reordered.orders[0]?.added).toBe(1);
    expect(reordered.orders[0]?.number).not.toBe("PO-1057");
  });

  it("notifies the office when a portal confirmation still needs an order, and hides ordering from the field", () => {
    const maya = actor("maya@rivera.demo");
    getDb().update(automationRules).set({ enabled: 0 }).where(eq(automationRules.orgId, maya.orgId)).run();
    chooseSelection({
      token: "demo_portal_okonkwo",
      selectionId: "sel_ok_floor",
      choiceId: "choc_ok_porcelain",
      typedName: "Amara Okonkwo",
      consent: true,
    });
    const notes = getDb().select().from(notifications).where(eq(notifications.kind, "selection")).all();
    expect(notes.some((note) => note.snippet === "Floor tile needs a purchase order" && note.userId === maya.userId)).toBe(true);
    expect(() => createOrdersFrom(actor("dana@rivera.demo"), { sourceKind: "selection", sourceIds: ["sel_br_hardware"] })).toThrow(/office/);
  });
});
