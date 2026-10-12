import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs } from "@/lib/db/schema";
import { poReceiving } from "@/lib/receiving/facts";
import { approveBill } from "@/lib/services/bills";
import { authenticate } from "@/lib/services/read";
import { billReceived, deliveryBoard, receiveDelivery, voidReceipt } from "@/lib/services/receiving";

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

describe("receiving and three-way match", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  afterAll(() => {
    clearSupabaseEnv();
  });

  it("keeps a partial receipt, refuses over-receive, and restores remaining on void", () => {
    const maya = actor("maya@rivera.demo");
    const before = poReceiving(maya.orgId, "po_ok_harbor");
    expect(before.label).toBe("Partially received");
    expect(before.lines[0]?.text).toBe("1.5 of 4");
    expect(() =>
      receiveDelivery(maya, {
        purchaseOrderId: "po_ok_harbor",
        receivedOn: "2026-10-12",
        note: null,
        documentId: null,
        lines: [{ lineId: "pol_ok_harbor", qtyMilli: 3000, percentBps: 0, condition: "ok", expectedOn: null, scheduleItemId: null, note: null }],
      }),
    ).toThrow(/more than remaining/);
    const saved = receiveDelivery(maya, {
      purchaseOrderId: "po_ok_harbor",
      receivedOn: "2026-10-12",
      note: null,
      documentId: null,
      lines: [{ lineId: "pol_ok_harbor", qtyMilli: 500, percentBps: 0, condition: "ok", expectedOn: null, scheduleItemId: null, note: null }],
    });
    expect(poReceiving(maya.orgId, "po_ok_harbor").lines[0]?.text).toBe("2 of 4");
    const billed = billReceived(maya, "po_ok_harbor", { billNumber: "HP-R70", billDate: "2026-10-12", dueDate: "2026-10-19" });
    expect(billed.id).toBeTruthy();
    voidReceipt(maya, saved.id, "Counted twice");
    expect(poReceiving(maya.orgId, "po_ok_harbor").lines[0]?.text).toBe("1.5 of 4");
  });

  it("requires a reason before billing more than received", () => {
    const maya = actor("maya@rivera.demo");
    expect(() => approveBill(maya, "bill_ok_over")).toThrow(/reason to bill more than received/);
    approveBill(maya, "bill_ok_over", "Accepted the short ship");
    const audit = getDb().select().from(auditLogs).where(eq(auditLogs.action, "bill.match_override")).get();
    expect(audit?.entityId).toBe("bill_ok_over");
    expect(audit?.payloadJson).toContain("Accepted the short ship");
  });

  it("hides prices from the field and lists the late order", () => {
    const dana = actor("dana@rivera.demo");
    const board = deliveryBoard(dana, "");
    expect(board.seeMoney).toBe(false);
    expect(board.rows.every((row) => row.amountCents == null)).toBe(true);
    expect(board.rows.some((row) => row.number === "PO-1042" && row.bucket === "late")).toBe(true);
    expect(board.rows.some((row) => row.number === "PO-1042" && row.backordered)).toBe(true);
  });
});
