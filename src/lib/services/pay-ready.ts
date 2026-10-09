import { and, eq } from "drizzle-orm";
import { certProblems, overPoIds, billReadiness, type Readiness } from "@/lib/bills/ready";
import { heldCents, releaseAmountCents } from "@/lib/bills/retainage";
import { officeDb } from "@/lib/db/office";
import {
  activities,
  billEvents,
  billLines,
  bills,
  lienWaivers,
  organizations,
  projects,
  purchaseOrderLines,
  purchaseOrders,
  vendorCertificates,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canManageMoney, canSeeMoney, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { requestWaiver, requiredSigned } from "@/lib/services/waivers";
import { localDay } from "@/lib/time/calendar";
import { parseRequiredTypes, parseComplianceMode } from "@/lib/vendor/compliance";
import { PAY_GATE_MESSAGE, parseWaiverMode } from "@/lib/waivers/format";

type Database = NonNullable<ReturnType<typeof officeDb>>;
type BillRecord = typeof bills.$inferSelect;

const FINAL = new Set(["conditional_final", "unconditional_final"]);

function company(orgId: string) {
  return officeDb(orgId);
}

function assertOffice(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Bills are for the office.");
}

export function assessBill(db: Database, orgId: string, bill: BillRecord): Readiness {
  const notes = payNotes(orgId, db);
  return notes.get(bill.id) ?? { ready: false, reason: null, payError: null, payWarning: null };
}

export function payNotes(orgId: string, db = company(orgId)): Map<string, Readiness> {
  const map = new Map<string, Readiness>();
  if (!db) return map;
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) return map;
  const today = localDay(Date.now(), org.timeZone);
  const waiverMode = parseWaiverMode(org.lienWaiverMode);
  const certMode = parseComplianceMode(org.vendorComplianceMode);
  const required = parseRequiredTypes(org.vendorRequiredTypes);
  const rows = db.select().from(bills).where(eq(bills.orgId, orgId)).all();
  const poLines = db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orgId, orgId)).all();
  const totals = new Map<string, number>();
  for (const line of poLines) totals.set(line.purchaseOrderId, (totals.get(line.purchaseOrderId) ?? 0) + line.amountCents);
  const over = overPoIds(rows, totals);
  const certs = db.select().from(vendorCertificates).where(eq(vendorCertificates.orgId, orgId)).all();
  const waivers = db.select().from(lienWaivers).where(eq(lienWaivers.orgId, orgId)).all();
  for (const bill of rows) {
    const release = bill.kind === "release";
    const waiverSigned = release
      ? waivers.some(
          (row) =>
            row.projectId === bill.projectId &&
            row.vendorContactId === bill.vendorContactId &&
            row.status === "signed" &&
            FINAL.has(row.type),
        )
      : requiredSigned(db, bill, "before");
    const problems =
      bill.purchaseOrderId && bill.vendorContactId
        ? certProblems(
            required,
            certs.filter((row) => row.contactId === bill.vendorContactId),
            today,
          )
        : [];
    map.set(
      bill.id,
      billReadiness({
        status: bill.status,
        waiverMode,
        waiverSigned,
        certMode,
        certProblems: problems,
        overPo: over.has(bill.id),
      }),
    );
  }
  return map;
}

export function readyToPay(orgId: string, role: Role) {
  if (!canSeeMoney(role)) return { count: 0, cents: 0, href: null as string | null };
  const db = company(orgId);
  if (!db) return { count: 0, cents: 0, href: null as string | null };
  const notes = payNotes(orgId, db);
  const rows = db.select().from(bills).where(eq(bills.orgId, orgId)).all();
  let count = 0;
  let cents = 0;
  for (const bill of rows) {
    if (!notes.get(bill.id)?.ready) continue;
    count += 1;
    cents += bill.kind === "release" ? bill.amountCents : Math.max(0, bill.amountCents - bill.retainageCents);
  }
  return { count, cents, href: count ? "/bills?ready=1" : null };
}

export function retainageHeldOnClosed(orgId: string, role: Role) {
  if (!canSeeMoney(role)) return { cents: 0, href: null as string | null };
  const db = company(orgId);
  if (!db) return { cents: 0, href: null as string | null };
  const closed = new Set(
    db
      .select()
      .from(projects)
      .where(eq(projects.orgId, orgId))
      .all()
      .filter((project) => project.status === "complete" || Boolean(project.closedAt))
      .map((project) => project.id),
  );
  let retained = 0;
  let released = 0;
  for (const bill of db.select().from(bills).where(eq(bills.orgId, orgId)).all()) {
    if (!closed.has(bill.projectId) || bill.status === "void") continue;
    if (bill.kind === "release") released += bill.amountCents;
    else if (bill.status === "paid") retained += bill.retainageCents;
  }
  const cents = heldCents(retained, released);
  return { cents, href: cents > 0 ? "/bills" : null };
}

export function poRetainage(orgId: string, purchaseOrderId: string) {
  const db = company(orgId);
  if (!db) return null;
  const po = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.orgId, orgId))).get();
  if (!po) return null;
  const linked = db
    .select()
    .from(bills)
    .where(and(eq(bills.orgId, orgId), eq(bills.purchaseOrderId, po.id)))
    .all();
  const retained = linked
    .filter((bill) => bill.kind !== "release" && bill.status === "paid")
    .reduce((sum, bill) => sum + bill.retainageCents, 0);
  const release = linked.find((bill) => bill.kind === "release" && bill.status !== "void");
  const released = release?.amountCents ?? 0;
  const held = heldCents(retained, released);
  return {
    bps: po.retainageBps,
    retainedCents: retained,
    releasedCents: released,
    heldCents: held,
    canRelease: held > 0 && !release,
    releaseId: release?.id ?? null,
    releaseNumber: release?.billNumber ?? null,
  };
}

export function releaseRetainage(actor: Actor, purchaseOrderId: string) {
  assertOffice(actor);
  const db = company(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  const figures = poRetainage(actor.orgId, purchaseOrderId);
  const po = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.orgId, actor.orgId))).get();
  if (!po || !figures) throw new ServiceError("Purchase order not found.");
  if (figures.releaseId) throw new ServiceError("Retainage was already released.");
  let amount = 0;
  try {
    amount = releaseAmountCents(figures.heldCents, figures.heldCents);
  } catch {
    throw new ServiceError("No retainage is held on this purchase order.");
  }
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  if (!org) throw new ServiceError("Company not found.");
  const mode = parseWaiverMode(org.lienWaiverMode);
  const signed = db
    .select()
    .from(lienWaivers)
    .where(eq(lienWaivers.orgId, actor.orgId))
    .all()
    .some(
      (row) =>
        row.projectId === po.projectId &&
        row.vendorContactId === po.vendorContactId &&
        row.status === "signed" &&
        FINAL.has(row.type),
    );
  if (mode === "block" && !signed) throw new ServiceError(PAY_GATE_MESSAGE);
  const number = `${po.number}-R`;
  const duplicate = db
    .select()
    .from(bills)
    .where(and(eq(bills.orgId, actor.orgId), eq(bills.vendorContactId, po.vendorContactId), eq(bills.billNumber, number)))
    .all()
    .find((row) => row.status !== "void");
  if (duplicate) throw new ServiceError(`${number} is already on file.`);
  const line = db
    .select()
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.purchaseOrderId, po.id), eq(purchaseOrderLines.orgId, actor.orgId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
  const billId = id("bill");
  const now = nowIso();
  const day = localDay(Date.now(), org.timeZone);
  db.transaction((tx) => {
    tx.insert(bills)
      .values({
        id: billId,
        orgId: actor.orgId,
        projectId: po.projectId,
        vendorContactId: po.vendorContactId,
        billNumber: number,
        billDate: day,
        amountCents: amount,
        dueDate: day,
        status: "approved",
        memo: `Retainage on ${po.number}`,
        voidReason: null,
        paidAt: null,
        payMethod: null,
        payReference: null,
        documentId: null,
        purchaseOrderId: po.id,
        approvedAt: now,
        lowConfidence: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.userId,
        portalSubmitted: 0,
        retainageCents: 0,
        kind: "release",
      })
      .run();
    tx.insert(billLines)
      .values({
        id: id("bln"),
        orgId: actor.orgId,
        billId,
        costCode: line?.costCode ?? "RETAINAGE",
        description: `Retainage on ${po.number}`,
        amountCents: amount,
        costItemId: null,
        sortOrder: 0,
      })
      .run();
    tx.insert(billEvents)
      .values({
        id: id("bev"),
        orgId: actor.orgId,
        billId,
        actorId: actor.userId,
        type: "released",
        reason: null,
        beforeJson: null,
        afterJson: JSON.stringify({ amountCents: amount, purchaseOrderId: po.id }),
        createdAt: now,
      })
      .run();
    tx.insert(activities)
      .values({
        id: id("act"),
        orgId: actor.orgId,
        entityType: "project",
        entityId: po.projectId,
        type: "bill",
        actorType: "user",
        actorId: actor.userId,
        summary: `Released ${number} for retainage on ${po.number}. No payment was sent.`,
        payloadJson: null,
        createdAt: now,
      })
      .run();
  });
  if (mode === "warn" && !signed) {
    requestWaiver(actor, billId, { type: "conditional_final", throughDate: day });
  }
  return { id: billId, number, amountCents: amount };
}
