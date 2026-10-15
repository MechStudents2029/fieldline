import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { invoiceLines, invoices, lateFees, organizations } from "@/lib/db/schema";
import { cashForecast } from "@/lib/services/cash";
import { listInbox, mentionUnread } from "@/lib/services/comments";
import {
  applyLateFee,
  arAging,
  arAgingCsv,
  billingPolicy,
  feeAllocation,
  lateFeeAttention,
  listLateFees,
  markStatementSent,
  openStatement,
  policyForOrg,
  policyLineForOrg,
  saveLatePolicy,
  scanLateFees,
  statementByToken,
  waiveLateFee,
} from "@/lib/services/late-fees";
import { authenticate, qboInvoicesCsv } from "@/lib/services/read";
import { nowIso } from "@/lib/ids";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

function insertInvoice(patch: Partial<typeof invoices.$inferInsert> & { id: string; number: string; payToken: string }) {
  const now = nowIso();
  getDb()
    .insert(invoices)
    .values({
      orgId: "org_rivera",
      projectId: "proj_brooks",
      changeOrderId: null,
      type: "progress",
      status: "open",
      scheduleIndex: null,
      issueDate: "2026-09-01",
      dueDate: "2026-09-01",
      subtotalCents: 20_000,
      taxCents: 0,
      totalCents: 20_000,
      amountPaidCents: 0,
      applicationNumber: null,
      retainageCents: 0,
      presentAs: "grouped",
      markupDisplay: "baked",
      createdAt: now,
      updatedAt: now,
      createdBy: "user_maya",
      ...patch,
    })
    .run();
}

describe("late fees and statements", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("seeds a pending fee, an applied fee, a waived fee, and a Brooks statement", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    expect(policyLineForOrg("org_rivera")).toBe("$25.00 + 1.00% after 7 days");
    expect(policyForOrg("org_northline").enabled).toBe(false);
    expect(policyLineForOrg("org_northline")).toBeNull();
    const pending = listLateFees(maya).find((row) => row.id === "lf_pending");
    const applied = listLateFees(maya).find((row) => row.id === "lf_applied");
    const waived = listLateFees(maya).find((row) => row.id === "lf_waived");
    expect(pending).toMatchObject({ number: "LF-2001", status: "pending", amountCents: 2_700 });
    expect(applied).toMatchObject({ number: "LF-2002", status: "applied", amountCents: 2_800 });
    expect(waived).toMatchObject({ number: "LF-2003", status: "waived", amountCents: 2_650, reason: "Good customer." });
    expect(lateFeeAttention(maya)).toEqual({ count: 1, cents: 2_700, href: "/fees?status=pending" });
    expect(lateFeeAttention(dana)).toEqual({ count: 0, cents: 0, href: null });
    const bill = getDb().select().from(invoices).where(eq(invoices.id, "inv_lf_applied")).get();
    expect(bill?.totalCents).toBe(32_800);
    const cash = cashForecast(maya, { projected: false, jobId: "proj_brooks", customerId: "" });
    expect(cash.lines.find((row) => row.doc === "LF-2002")?.cents).toBe(32_800);
    const csv = qboInvoicesCsv("org_rivera");
    expect(csv).toContain("Late fee");
    expect(csv).toContain("LF-2002");
    const aging = arAging(maya);
    const brooks = aging.rows.find((row) => row.name === "Chris Brooks");
    expect(brooks?.buckets["1–30"]).toBeGreaterThanOrEqual(20_000 + 32_800 + 15_000);
    expect(arAgingCsv(maya)).toContain("Chris Brooks");
    expect(arAgingCsv(maya)).toContain("1–30");
    const statement = statementByToken("demo_statement_brooks");
    expect(statement?.client).toBe("Chris Brooks");
    expect(statement?.events.some((event) => event.label === "LF-2001")).toBe(true);
    expect(statement?.events.some((event) => event.label.includes("Late fee"))).toBe(true);
    expect(statement?.events.some((event) => event.label.includes("Good customer."))).toBe(true);
    expect(openStatement(maya, "stmt_brooks").id).toBe("stmt_brooks");
    const partial = feeAllocation("org_rivera", "inv_lf_applied", 1_500);
    expect(partial?.fees[0]).toMatchObject({ id: "lf_applied", paidCents: 1_500, openCents: 1_300 });
    expect(partial?.principalPaidCents).toBe(0);
    expect(feeAllocation("org_rivera", "inv_lf_applied", 4_000)).toMatchObject({ principalPaidCents: 1_200, principalOpenCents: 28_800 });
    expect(listInbox(maya, "all").some((row) => row.snippet === "LF-2001" && row.record === "LF-2001")).toBe(true);
    expect(listInbox(dana, "all").some((row) => row.snippet === "LF-2001")).toBe(false);
    expect(mentionUnread(maya)).toBe(2);
    const sql = readFileSync("supabase/rls.sql", "utf8");
    expect(sql).toContain("'late_fees'");
    expect(sql).toContain("'client_statements'");
    expect(readFileSync("src/app/api/cron/follow-ups/route.ts", "utf8")).toContain("scanLateFees");
    expect(() => listLateFees(dana)).toThrow(/cannot see/);
    expect(() => arAging(dana)).toThrow(/cannot see/);
    expect(() => waiveLateFee(actor("riley@rivera.demo"), "lf_pending", "No")).toThrow(/cannot change/);
    expect(() => saveLatePolicy(actor("luis@rivera.demo"), {
      enabled: true,
      flat: "25.00",
      percent: "1.00",
      grace: "7",
      minimum: "50.00",
      cap: "100.00",
      excludeRetainage: true,
      excludeDraws: true,
      excludeAgreements: true,
      mode: "review",
    })).toThrow(/cannot change/);
    expect(billingPolicy(actor("riley@rivera.demo")).canEdit).toBe(false);
  });

  it("charges an invoice once per month and skips excluded or closed invoices", () => {
    expect(scanLateFees("org_rivera").created).toBe(0);
    getDb().delete(lateFees).where(eq(lateFees.id, "lf_pending")).run();
    expect(scanLateFees("org_rivera").created).toBe(1);
    expect(scanLateFees("org_rivera").created).toBe(0);
    const again = getDb().select().from(lateFees).where(eq(lateFees.invoiceId, "inv_lf_pending")).all();
    expect(again).toHaveLength(1);
    expect(again[0]?.status).toBe("pending");
    expect(again[0]?.amountCents).toBe(2_700);
    insertInvoice({ id: "inv_lf_ret", number: "LF-RET", payToken: "pay_lf_ret", retainageCents: 100, type: "retainage" });
    insertInvoice({ id: "inv_lf_draw", number: "LF-DRAW", payToken: "pay_lf_draw", type: "draw" });
    insertInvoice({ id: "inv_lf_agr", number: "LF-AGR", payToken: "pay_lf_agr", type: "service" });
    insertInvoice({ id: "inv_lf_paid", number: "LF-PAID", payToken: "pay_lf_paid", status: "paid" });
    insertInvoice({ id: "inv_lf_void", number: "LF-VOID", payToken: "pay_lf_void", status: "void" });
    insertInvoice({ id: "inv_lf_disp", number: "LF-DISP", payToken: "pay_lf_disp", status: "disputed" });
    insertInvoice({ id: "inv_lf_hold", number: "LF-HOLD", payToken: "pay_lf_hold", status: "hold" });
    insertInvoice({ id: "inv_lf_small", number: "LF-SMALL", payToken: "pay_lf_small", totalCents: 1_000, subtotalCents: 1_000 });
    expect(scanLateFees("org_rivera").created).toBe(0);
    const blocked = getDb()
      .select()
      .from(lateFees)
      .all()
      .map((row) => row.invoiceId);
    for (const invoiceId of ["inv_lf_ret", "inv_lf_draw", "inv_lf_agr", "inv_lf_paid", "inv_lf_void", "inv_lf_disp", "inv_lf_hold", "inv_lf_small"]) {
      expect(blocked).not.toContain(invoiceId);
    }
  });

  it("applies automatically when the policy says so, and a waived fee stays on the invoice history", () => {
    const maya = actor("maya@rivera.demo");
    getDb().update(organizations).set({ lateMode: "apply" }).where(eq(organizations.id, "org_rivera")).run();
    insertInvoice({ id: "inv_lf_auto", number: "LF-AUTO", payToken: "pay_lf_auto" });
    expect(scanLateFees("org_rivera").created).toBe(1);
    expect(scanLateFees("org_rivera").created).toBe(0);
    const fee = getDb().select().from(lateFees).where(eq(lateFees.invoiceId, "inv_lf_auto")).get();
    expect(fee?.status).toBe("applied");
    expect(fee?.amountCents).toBe(2_700);
    expect(getDb().select().from(invoices).where(eq(invoices.id, "inv_lf_auto")).get()?.totalCents).toBe(22_700);
    expect(getDb().select().from(invoiceLines).where(eq(invoiceLines.invoiceId, "inv_lf_auto")).all().some((row) => row.description === "Late fee")).toBe(true);
    getDb().update(organizations).set({ lateMode: "review" }).where(eq(organizations.id, "org_rivera")).run();
    waiveLateFee(maya, "lf_applied", "Courtesy");
    expect(getDb().select().from(invoices).where(eq(invoices.id, "inv_lf_applied")).get()?.totalCents).toBe(30_000);
    expect(getDb().select().from(invoiceLines).where(eq(invoiceLines.id, "invl_lf_fee")).get()).toBeUndefined();
    expect(getDb().select().from(lateFees).where(eq(lateFees.id, "lf_applied")).get()).toMatchObject({ status: "waived", reason: "Courtesy" });
    expect(() => waiveLateFee(maya, "lf_applied", "Again")).toThrow(/Already waived/);
    expect(() => waiveLateFee(maya, "lf_missing", "No")).toThrow(/not found/);
    expect(() => waiveLateFee(maya, "lf_waived", "x")).toThrow(/Enter a reason/);
    const pending = getDb().select().from(lateFees).where(eq(lateFees.invoiceId, "inv_lf_pending")).get();
    expect(pending).toBeTruthy();
    const before = getDb().select().from(invoices).where(eq(invoices.id, "inv_lf_pending")).get()?.totalCents;
    waiveLateFee(maya, pending!.id, "Hold");
    expect(getDb().select().from(invoices).where(eq(invoices.id, "inv_lf_pending")).get()?.totalCents).toBe(before);
    expect(getDb().select().from(lateFees).where(eq(lateFees.id, pending!.id)).get()?.status).toBe("waived");
    expect(() => applyLateFee(maya, fee!.id)).toThrow(/Already applied/);
    expect(() => applyLateFee(maya, "lf_waived")).toThrow(/waived/);
    markStatementSent(maya, "stmt_brooks");
    expect(openStatement(maya, "stmt_brooks").sentByName).toBe("Maya Rivera");
    expect(() => markStatementSent(maya, "stmt_brooks")).toThrow(/Already sent/);
  });
});
