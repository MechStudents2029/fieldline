import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import {
  auditLogs,
  billLines,
  bills,
  changeOrders,
  costItems,
  lienWaivers,
  notifications,
  organizations,
  payApplicationVersions,
  purchaseOrderLines,
  tasks,
} from "@/lib/db/schema";
import { applicationTotals, figureLine } from "@/lib/pay-apps/math";
import { nowIso } from "@/lib/ids";
import { mentionUnread } from "@/lib/services/comments";
import { createBill } from "@/lib/services/bills";
import { necReport } from "@/lib/services/nec1099";
import { parseTrigger, saveAutomation } from "@/lib/services/automations";
import {
  approvePayApplication,
  attachApprovedChange,
  copyPayLink,
  createPayApplication,
  jobPaySummary,
  listPayApplications,
  markPayRequested,
  markUnderReview,
  payApplicationAttention,
  payApplicationDetail,
  payApplicationsCsv,
  portalCreatePayApplication,
  portalPayApplications,
  portalSavePayApplication,
  revisePayApplication,
  savePayApplication,
  setProgressBilling,
  submitPayApplication,
  voidPayApplication,
} from "@/lib/services/pay-applications";
import { readyToPay } from "@/lib/services/pay-ready";
import { createPurchaseOrder, issuePurchaseOrder } from "@/lib/services/purchase-orders";
import { authenticate, portalByToken } from "@/lib/services/read";
import { submitPortalPayApp, submitVendorBill } from "@/lib/services/vendor-portal";
import { createChangeOrder } from "@/lib/services/write";
import { wipJob } from "@/lib/services/wip";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";
import { PAY_GATE_MESSAGE } from "@/lib/waivers/format";

function clearSupabaseEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(email);
  return user;
}

function linesOf(purchaseOrderId: string) {
  return getDb().select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId)).all();
}

function issued(vendorContactId: string, lines: { costCode: string; amountCents: number; description?: string }[]) {
  const maya = actor("maya@rivera.demo");
  const po = createPurchaseOrder(maya, { projectId: "proj_brooks", vendorContactId, lines });
  issuePurchaseOrder(maya, po.id);
  return po.id;
}

function inputFor(purchaseOrderLineId: string, thisPeriodCents: number, storedCents = 0, releasedCents = 0, retainageBps = 1000) {
  return { purchaseOrderLineId, thisPeriodCents, storedCents, releasedCents, retainageBps };
}

describe("subcontractor pay applications", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("figures a line inside the scheduled value", () => {
    const line = figureLine({
      scheduledCents: 100_000,
      previousWorkCents: 40_000,
      previousHeldCents: 4_000,
      thisPeriodCents: 10_000,
      storedCents: 5_000,
      releasedCents: 1_000,
      retainageBps: 1000,
    });
    expect(line).toMatchObject({
      completedCents: 55_000,
      percentBps: 5500,
      balanceCents: 45_000,
      retainageCents: 1_500,
      heldCents: 4_500,
    });
    expect(applicationTotals([line])).toMatchObject({ grossCents: 15_000, retainageCents: 1_500, releasedCents: 1_000, netCents: 14_500, finalRelease: false });
    expect(() =>
      figureLine({
        scheduledCents: 100_000,
        previousWorkCents: 90_000,
        previousHeldCents: 0,
        thisPeriodCents: 10_000,
        storedCents: 1,
        releasedCents: 0,
        retainageBps: 0,
      }),
    ).toThrow(/100%/);
    expect(() =>
      figureLine({
        scheduledCents: 100_000,
        previousWorkCents: 0,
        previousHeldCents: 100,
        thisPeriodCents: 0,
        storedCents: 0,
        releasedCents: 101,
        retainageBps: 0,
      }),
    ).toThrow(/held/);
  });

  it("seeds Brighton and Harbor, and keeps the other surfaces still", () => {
    const sql = readFileSync("supabase/rls.sql", "utf8");
    for (const table of ["pay_applications", "pay_application_lines", "pay_application_versions"]) {
      expect(sql.split(`'${table}'`).length - 1).toBe(2);
    }
    const maya = actor("maya@rivera.demo");
    expect(payApplicationAttention(maya)).toEqual({ count: 1, href: "/pay-applications?filter=age" });
    expect(listPayApplications(maya, { status: "age" }).map((row) => row.id)).toEqual(["pa_br_2"]);
    const approved = payApplicationDetail(maya, "pa_br_1");
    expect(approved).toMatchObject({ status: "approved", poNumber: "SC-1048", number: 1, billNumber: "BE-PA1" });
    expect(approved?.lines.find((line) => line.costCode === "ELE-PA")).toMatchObject({
      scheduledCents: 120_000,
      previousCents: 0,
      thisPeriodCents: 40_000,
      completedCents: 40_000,
      retainageCents: 4_000,
      heldCents: 4_000,
    });
    expect(approved?.totals).toMatchObject({ grossCents: 40_000, retainageCents: 4_000, netCents: 36_000 });
    const submitted = payApplicationDetail(maya, "pa_br_2");
    expect(submitted?.lines.find((line) => line.costCode === "ELE-PA")).toMatchObject({ previousCents: 40_000, thisPeriodCents: 10_000 });
    expect(submitted?.lines.find((line) => line.costCode === "ELE-PA2")?.rejectNote).toBe("Check the percent");
    expect(submitted?.versions).toHaveLength(1);
    expect(payApplicationDetail(maya, "pa_hb_1")).toMatchObject({ status: "draft", poNumber: "SC-1049" });
    expect(payApplicationDetail(maya, "pa_hb_1")?.lines[0]).toMatchObject({ thisPeriodCents: 5_000, storedCents: 1_000, retainageCents: 600 });
    expect(jobPaySummary(maya.orgId, "proj_brooks", "owner")).toEqual({ count: 3, netCents: 36_000 });
    expect(listPayApplications(maya, { vendorContactId: "c_harbor" }).map((row) => row.poNumber)).toEqual(["SC-1049"]);
    expect(listPayApplications(maya, { period: submitted?.periodEnd }).map((row) => row.id)).toEqual(["pa_br_2"]);
    expect(payApplicationsCsv(maya)).toContain("SC-1048");
    expect(payApplicationsCsv(maya)).toContain("Harbor Plumbing");
    expect(mentionUnread(maya)).toBe(2);
    expect(getDb().select().from(notifications).where(eq(notifications.kind, "pay_application")).all()).toHaveLength(0);
    expect(readyToPay(maya.orgId, "owner")).toMatchObject({ count: 1, cents: 180_000, href: "/bills?ready=1" });
    expect(necReport(maya, 2026).rows.find((row) => row.contactId === "c_brighton")?.box1Cents).toBe(250_000);
    expect(wipJob(maya, "proj_chen")).toMatchObject({ costToDateCents: 0, billedCents: 736_000, percentBps: 0, earnedCents: 0, overUnderCents: 736_000 });
    expect(wipJob(maya, "proj_brooks")?.profitCents).toBeLessThan(0);
    expect(payApplicationDetail(actor("jordan@northline.demo"), "pa_br_1")).toBeNull();
    expect(listPayApplications(actor("jordan@northline.demo"))).toEqual([]);
    expect(() => listPayApplications(actor("dana@rivera.demo"))).toThrow(/cannot see/);
    expect(() => approvePayApplication(actor("riley@rivera.demo"), "pa_br_2")).toThrow(/cannot change/);
    expect(listPayApplications(actor("riley@rivera.demo")).length).toBeGreaterThan(0);
    const portal = JSON.stringify(portalByToken("demo_portal_brooks"));
    expect(portal).not.toContain("SC-1048");
    expect(portal).not.toContain("BE-PA1");
    expect(parseTrigger(JSON.stringify({ kind: "pay_application_submitted" }))).toEqual({ kind: "pay_application_submitted" });
    expect(parseTrigger(JSON.stringify({ kind: "pay_application_approved" }))).toEqual({ kind: "pay_application_approved" });
    expect(readFileSync("src/app/(office)/pay-applications/[id]/print/page.tsx", "utf8")).not.toContain("AIA");
    const harbor = JSON.stringify(portalPayApplications(maya.orgId, "c_harbor"));
    expect(harbor).toContain("SC-1049");
    expect(harbor).not.toContain("SC-1048");
  });

  it("bills one period, keeps the prior version, and restores previous when the latest approval is void", () => {
    const maya = actor("maya@rivera.demo");
    saveAutomation(maya, {
      name: "Pay app in",
      enabled: true,
      trigger: { kind: "pay_application_submitted" },
      conditions: [],
      actions: [{ kind: "todo", title: "Review the pay app", who: "", dueDays: 0 }],
    });
    const purchaseOrderId = issued("c_brighton", [
      { costCode: "ELE-PA", amountCents: 100_000, description: "Rough" },
      { costCode: "ELE-PA2", amountCents: 80_000, description: "Trim" },
    ]);
    const rows = linesOf(purchaseOrderId);
    const rough = rows.find((line) => line.costCode === "ELE-PA")!;
    const trim = rows.find((line) => line.costCode === "ELE-PA2")!;
    const firstId = createPayApplication(maya, purchaseOrderId, {
      periodStart: "2026-09-01",
      periodEnd: "2026-09-15",
      lines: [inputFor(rough.id, 40_000, 10_000), inputFor(trim.id, 0)],
    }).id;
    const first = payApplicationDetail(maya, firstId)!;
    expect(first.lines.find((line) => line.costCode === "ELE-PA")).toMatchObject({
      completedCents: 50_000,
      percentBps: 5000,
      balanceCents: 50_000,
      retainageCents: 5_000,
      heldCents: 5_000,
    });
    expect(first.totals.netCents).toBe(45_000);
    submitPayApplication(maya, firstId);
    expect(getDb().select().from(tasks).where(eq(tasks.title, "Review the pay app")).all().length).toBeGreaterThan(0);
    expect(getDb().select().from(notifications).where(eq(notifications.kind, "pay_application")).all().length).toBeGreaterThan(0);
    expect(mentionUnread(maya)).toBe(2);
    markUnderReview(maya, firstId);
    const posted = approvePayApplication(maya, firstId);
    expect(approvePayApplication(maya, firstId).billId).toBe(posted.billId);
    const billCount = () => getDb().select().from(bills).where(eq(bills.purchaseOrderId, purchaseOrderId)).all().length;
    expect(billCount()).toBe(1);
    const bill = getDb().select().from(bills).where(eq(bills.id, posted.billId)).get();
    expect(bill).toMatchObject({ status: "approved", amountCents: 50_000, retainageCents: 5_000, purchaseOrderId });
    expect(getDb().select().from(billLines).where(eq(billLines.billId, posted.billId)).all()).toEqual([
      expect.objectContaining({ costCode: "ELE-PA", amountCents: 50_000 }),
    ]);
    expect(readyToPay(maya.orgId, "owner")).toMatchObject({ count: 1, cents: 180_000 });

    const secondId = createPayApplication(maya, purchaseOrderId, {
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      lines: [inputFor(rough.id, 20_000, 0, 2_000), inputFor(trim.id, 8_000, 1_000)],
    }).id;
    expect(() => createPayApplication(maya, purchaseOrderId, { periodStart: "2026-10-01", periodEnd: "2026-10-10" })).toThrow(/open application/);
    expect(() =>
      savePayApplication(maya, secondId, {
        officeBps: true,
        lines: [inputFor(rough.id, 60_000), inputFor(trim.id, 0)],
      }),
    ).toThrow(/100%/);
    savePayApplication(maya, secondId, {
      officeBps: true,
      lines: [inputFor(rough.id, 20_000, 0, 2_000, 500), inputFor(trim.id, 8_000, 1_000, 0, 1000)],
    });
    expect(payApplicationDetail(maya, secondId)?.lines.find((line) => line.costCode === "ELE-PA")).toMatchObject({
      previousCents: 50_000,
      retainageBps: 500,
      retainageCents: 1_000,
      heldCents: 4_000,
    });
    savePayApplication(maya, secondId, {
      officeBps: true,
      lines: [inputFor(rough.id, 20_000, 0, 2_000, 1000), inputFor(trim.id, 8_000, 1_000, 0, 1000)],
    });
    const second = payApplicationDetail(maya, secondId)!;
    expect(second.lines.find((line) => line.costCode === "ELE-PA")).toMatchObject({
      previousCents: 50_000,
      thisPeriodCents: 20_000,
      completedCents: 70_000,
      retainageCents: 2_000,
      releasedCents: 2_000,
      heldCents: 5_000,
    });
    expect(second.lines.find((line) => line.costCode === "ELE-PA2")).toMatchObject({ storedCents: 1_000, retainageCents: 900, heldCents: 900 });
    expect(second.totals).toMatchObject({ grossCents: 29_000, retainageCents: 2_900, releasedCents: 2_000, netCents: 28_100, finalRelease: false });
    expect(() => voidPayApplication(maya, firstId, "Too soon")).toThrow(/latest/);
    submitPayApplication(maya, secondId);
    markUnderReview(maya, secondId);
    revisePayApplication(maya, secondId, [{ purchaseOrderLineId: trim.id, rejectNote: "Hold the trim" }]);
    expect(payApplicationDetail(maya, secondId)?.status).toBe("revise");
    const snapshot = getDb().select().from(payApplicationVersions).where(eq(payApplicationVersions.applicationId, secondId)).all();
    expect(snapshot.map((row) => row.version)).toEqual([1]);
    expect(snapshot[0]?.linesJson).toContain("20000");
    submitPayApplication(maya, secondId);
    const resubmitted = payApplicationDetail(maya, secondId)!;
    expect(resubmitted.version).toBe(2);
    expect(resubmitted.lines.every((line) => line.rejectNote === "")).toBe(true);
    expect(getDb().select().from(payApplicationVersions).where(eq(payApplicationVersions.applicationId, secondId)).all()).toHaveLength(1);
    markUnderReview(maya, secondId);
    const again = approvePayApplication(maya, secondId);
    expect(approvePayApplication(maya, secondId).billId).toBe(again.billId);
    expect(billCount()).toBe(2);
    const secondCosts = getDb()
      .select()
      .from(billLines)
      .where(eq(billLines.billId, again.billId))
      .all()
      .map((line) => line.costItemId)
      .filter((id): id is string => Boolean(id));
    expect(secondCosts).toHaveLength(2);
    voidPayApplication(maya, secondId, "Wrong period");
    expect(getDb().select().from(bills).where(eq(bills.id, again.billId)).get()?.status).toBe("void");
    for (const costId of secondCosts) {
      expect(getDb().select().from(costItems).where(eq(costItems.id, costId)).get()).toBeUndefined();
    }
    const thirdId = createPayApplication(maya, purchaseOrderId, {
      periodStart: "2026-10-01",
      periodEnd: "2026-10-10",
      lines: [inputFor(rough.id, 1_000), inputFor(trim.id, 0)],
    }).id;
    expect(payApplicationDetail(maya, thirdId)?.lines.find((line) => line.costCode === "ELE-PA")?.previousCents).toBe(50_000);
    const actions = getDb()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, "pay_application"), eq(auditLogs.entityId, secondId)))
      .all()
      .map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["pay_application.create", "pay_application.submit", "pay_application.review", "pay_application.revise", "pay_application.approve", "pay_application.void"]));
    copyPayLink(maya, thirdId);
    markPayRequested(maya, thirdId);
    expect(payApplicationDetail(maya, thirdId)?.copiedAt).toBeTruthy();
    expect(payApplicationDetail(maya, thirdId)?.requestedAt).toBeTruthy();
  });

  it("blocks a final retainage release until a final waiver is signed", () => {
    const maya = actor("maya@rivera.demo");
    const purchaseOrderId = issued("c_brighton", [{ costCode: "ELE-PA", amountCents: 40_000, description: "Release" }]);
    const lineId = linesOf(purchaseOrderId)[0]!.id;
    const firstId = createPayApplication(maya, purchaseOrderId, {
      periodStart: "2026-09-01",
      periodEnd: "2026-09-15",
      lines: [inputFor(lineId, 20_000)],
    }).id;
    submitPayApplication(maya, firstId);
    markUnderReview(maya, firstId);
    const first = approvePayApplication(maya, firstId);
    getDb().update(organizations).set({ lienWaiverMode: "block" }).where(eq(organizations.id, maya.orgId)).run();
    const partialId = createPayApplication(maya, purchaseOrderId, {
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      lines: [inputFor(lineId, 0, 0, 500)],
    }).id;
    submitPayApplication(maya, partialId);
    markUnderReview(maya, partialId);
    expect(payApplicationDetail(maya, partialId)?.totals.finalRelease).toBe(false);
    expect(approvePayApplication(maya, partialId).billId).toBeTruthy();
    const finalId = createPayApplication(maya, purchaseOrderId, {
      periodStart: "2026-10-01",
      periodEnd: "2026-10-10",
      lines: [inputFor(lineId, 0, 0, 1_500)],
    }).id;
    submitPayApplication(maya, finalId);
    markUnderReview(maya, finalId);
    expect(payApplicationDetail(maya, finalId)?.totals).toMatchObject({ releasedCents: 1_500, heldCents: 0, finalRelease: true });
    expect(() => approvePayApplication(maya, finalId)).toThrow(PAY_GATE_MESSAGE);
    const stamp = nowIso();
    getDb()
      .insert(lienWaivers)
      .values({
        id: "lw_pa_final",
        orgId: maya.orgId,
        billId: first.billId,
        projectId: "proj_brooks",
        vendorContactId: "c_brighton",
        type: "conditional_final",
        status: "signed",
        amountCents: 1_500,
        throughDate: "2026-10-10",
        body: "Final",
        signedName: "Pat",
        signedAt: stamp,
        signedText: "signed",
        documentId: null,
        createdAt: stamp,
        updatedAt: stamp,
        createdBy: maya.userId,
      })
      .run();
    expect(approvePayApplication(maya, finalId).billId).toBeTruthy();
    getDb().update(organizations).set({ lienWaiverMode: "warn" }).where(eq(organizations.id, maya.orgId)).run();
  });

  it("keeps flat bills and progress billing from sharing a purchase order", () => {
    const maya = actor("maya@rivera.demo");
    expect(() => createPayApplication(maya, "po_ok_harbor", { periodStart: "2026-10-01", periodEnd: "2026-10-10" })).toThrow(/already has a bill/);
    expect(() =>
      createBill(maya, {
        projectId: "proj_brooks",
        vendorContactId: "c_brighton",
        billNumber: "BE-FLAT",
        billDate: "2026-10-01",
        dueDate: "2026-10-15",
        purchaseOrderId: "po_br_brighton",
        lines: [{ costCode: "ELE-PA", amountCents: 100 }],
      }),
    ).toThrow(/bills by progress/);
    expect(() =>
      submitVendorBill({
        token: DEMO_HARBOR_PORTAL_TOKEN,
        ip: "198.51.100.41",
        purchaseOrderId: "po_hb_prog",
        billNumber: "HP-PROG",
        billDate: "2026-10-01",
        dueDate: "2026-10-15",
        lines: [{ costCode: "PLB-PA", amountCents: 100 }],
      }),
    ).toThrow(/bills by progress/);
    const flatId = issued("c_harbor", [{ costCode: "PLB-PA", amountCents: 20_000 }]);
    createBill(maya, {
      projectId: "proj_brooks",
      vendorContactId: "c_harbor",
      billNumber: "HP-FLAT-1",
      billDate: "2026-10-01",
      dueDate: "2026-10-15",
      purchaseOrderId: flatId,
      lines: [{ costCode: "PLB-PA", amountCents: 1_000 }],
    });
    expect(() => setProgressBilling(maya, flatId)).toThrow(/already has a bill/);
    expect(() => createPayApplication(maya, flatId, { periodStart: "2026-10-01", periodEnd: "2026-10-10" })).toThrow(/already has a bill/);
    const progressId = issued("c_harbor", [{ costCode: "PLB-PA", amountCents: 20_000 }]);
    setProgressBilling(maya, progressId);
    expect(() =>
      createBill(maya, {
        projectId: "proj_brooks",
        vendorContactId: "c_harbor",
        billNumber: "HP-FLAT-2",
        billDate: "2026-10-01",
        dueDate: "2026-10-15",
        purchaseOrderId: progressId,
        lines: [{ costCode: "PLB-PA", amountCents: 1_000 }],
      }),
    ).toThrow(/bills by progress/);
  });

  it("lets the vendor submit only their own progress purchase order, and adds an approved change", () => {
    const maya = actor("maya@rivera.demo");
    expect(() => portalCreatePayApplication(maya.orgId, "c_harbor", "po_ok_harbor", { periodStart: "2026-10-01", periodEnd: "2026-10-10", lines: [] })).toThrow(/not set to bill by progress/);
    expect(() => portalCreatePayApplication(maya.orgId, "c_harbor", "po_br_brighton", { periodStart: "2026-10-01", periodEnd: "2026-10-10", lines: [] })).toThrow(/not found/);
    const purchaseOrderId = issued("c_harbor", [{ costCode: "PLB-PA", amountCents: 30_000, description: "Extra" }]);
    setProgressBilling(maya, purchaseOrderId);
    const lineId = linesOf(purchaseOrderId)[0]!.id;
    const created = portalCreatePayApplication(maya.orgId, "c_harbor", purchaseOrderId, {
      periodStart: "2026-10-01",
      periodEnd: "2026-10-10",
      lines: [inputFor(lineId, 2_000, 500)],
    });
    portalSavePayApplication({
      tokenOrgId: maya.orgId,
      contactId: "c_harbor",
      applicationId: created.id,
      lines: [{ purchaseOrderLineId: lineId, thisPeriodCents: 2_000, storedCents: 500, releasedCents: 0, retainageBps: 0 }],
    });
    expect(payApplicationDetail(maya, created.id)?.lines[0]?.retainageBps).toBe(1000);
    submitPortalPayApp({
      token: DEMO_HARBOR_PORTAL_TOKEN,
      ip: "198.51.100.42",
      applicationId: created.id,
      lines: [{ purchaseOrderLineId: lineId, thisPeriodCents: 2_000, storedCents: 500, releasedCents: 0 }],
    });
    expect(payApplicationDetail(maya, created.id)?.status).toBe("submitted");
    expect(getDb().select().from(auditLogs).where(and(eq(auditLogs.entityId, created.id), eq(auditLogs.action, "pay_application.submit"))).get()?.actorId).toBeNull();

    const amended = issued("c_harbor", [{ costCode: "PLB-PA", amountCents: 10_000 }]);
    const change = createChangeOrder(maya, "proj_brooks", {
      title: "Pay app extra",
      description: "Added scope",
      name: "Added scope",
      qty: 2,
      unit: "ea",
      unitCostCents: 2_500,
      markupBps: 0,
      costCode: "PLB-PA",
    });
    getDb().update(changeOrders).set({ status: "approved" }).where(eq(changeOrders.id, change.changeOrderId)).run();
    attachApprovedChange(maya, amended, change.changeOrderId);
    const scheduled = linesOf(amended).reduce((sum, line) => sum + line.amountCents, 0);
    expect(scheduled).toBe(15_000);
    expect(linesOf(amended).some((line) => line.sourceKind === "change_order" && line.amountCents === 5_000)).toBe(true);
  });
});
