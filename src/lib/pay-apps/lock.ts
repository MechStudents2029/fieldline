import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { bills, payApplications, purchaseOrders } from "@/lib/db/schema";
import { ServiceError } from "@/lib/services/errors";

type Database = AppDatabase;

export function payAppBillIds(db: Database, orgId: string, purchaseOrderId: string) {
  return new Set(
    db
      .select()
      .from(payApplications)
      .where(and(eq(payApplications.orgId, orgId), eq(payApplications.purchaseOrderId, purchaseOrderId)))
      .all()
      .map((row) => row.billId)
      .filter((id): id is string => Boolean(id)),
  );
}

/** A bill that did not come from a pay application locks the purchase order to flat billing. */
export function hasFlatBill(db: Database, orgId: string, purchaseOrderId: string) {
  const linked = payAppBillIds(db, orgId, purchaseOrderId);
  return db
    .select()
    .from(bills)
    .where(and(eq(bills.orgId, orgId), eq(bills.purchaseOrderId, purchaseOrderId)))
    .all()
    .some((bill) => bill.status !== "void" && !linked.has(bill.id));
}

export function hasPayApplication(db: Database, orgId: string, purchaseOrderId: string) {
  return db
    .select()
    .from(payApplications)
    .where(and(eq(payApplications.orgId, orgId), eq(payApplications.purchaseOrderId, purchaseOrderId)))
    .all()
    .some((row) => row.status !== "void");
}

export function billsByProgress(db: Database, orgId: string, purchaseOrderId: string) {
  const order = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.orgId, orgId))).get();
  if (!order) return false;
  return order.billingMethod === "progress" || hasPayApplication(db, orgId, purchaseOrderId);
}

export function assertFlatBillAllowed(db: Database, orgId: string, purchaseOrderId: string) {
  if (billsByProgress(db, orgId, purchaseOrderId)) throw new ServiceError("This purchase order bills by progress.");
}
