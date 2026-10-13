import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { agreementInvoices, agreementVisits, invoices, serviceAgreements } from "@/lib/db/schema";
import { acceptAgreement, addVisits, agreementReport, billPeriods, completeVisit, createAgreement, renewAgreement } from "@/lib/services/agreements";
import { authenticate } from "@/lib/services/read";
import { todayKey } from "@/lib/receiving/facts";

function maya() {
  const user = authenticate("maya@rivera.demo", "demo");
  if (!user) throw new Error("missing maya");
  return user;
}

describe("service agreements", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("bills a visit once and renews the parent when the child is accepted", () => {
    const actor = maya();
    const today = todayKey(getDb(), actor.orgId);
    const created = createAgreement(actor, {
      contactId: "c_okonkwo",
      projectId: "proj_okonkwo",
      name: "Coil check",
      startOn: today,
      termKind: "visits",
      visitLimit: 2,
      cadence: "weekly",
      billing: "per_visit",
      lines: [{ code: "FRM-LABOR", qtyMilli: 1000 }],
    });
    acceptAgreement(actor, created.id, "Amara Okonkwo");
    expect(getDb().select().from(serviceAgreements).where(eq(serviceAgreements.id, created.id)).get()?.status).toBe("active");
    const before = getDb().select().from(invoices).where(eq(invoices.orgId, actor.orgId)).all().length;
    const visit = getDb()
      .select()
      .from(agreementVisits)
      .where(eq(agreementVisits.agreementId, created.id))
      .all()
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
    expect(visit?.dueOn).toBe(today);
    const first = completeVisit(actor, visit!.id, []);
    const second = completeVisit(actor, visit!.id, []);
    expect(first.invoiceId).toBeTruthy();
    expect(second.invoiceId).toBe(first.invoiceId);
    const drafted = getDb().select().from(invoices).where(eq(invoices.id, first.invoiceId!)).get();
    expect(drafted?.status).toBe("draft");
    expect(drafted?.totalCents).toBe(10530);
    expect(getDb().select().from(invoices).where(eq(invoices.orgId, actor.orgId)).all().length).toBe(before + 1);
    const child = renewAgreement(actor, created.id);
    const again = renewAgreement(actor, created.id);
    expect(again.id).toBe(child.id);
    expect(getDb().select().from(serviceAgreements).where(eq(serviceAgreements.id, created.id)).get()?.status).toBe("pending_renewal");
    acceptAgreement(actor, child.id);
    expect(getDb().select().from(serviceAgreements).where(eq(serviceAgreements.id, created.id)).get()?.status).toBe("renewed");
    expect(getDb().select().from(serviceAgreements).where(eq(serviceAgreements.id, child.id)).get()?.status).toBe("active");
  });

  it("writes one draft per period when billing runs twice", () => {
    const actor = maya();
    const created = createAgreement(actor, {
      contactId: "c_brooks",
      projectId: "proj_brooks",
      name: "Quarterly plan",
      startOn: "2026-01-15",
      termKind: "months",
      termMonths: 12,
      cadence: "quarterly",
      billing: "quarterly",
      fixedCents: 45000,
      lines: [{ code: "FRM-LABOR", qtyMilli: 1000 }],
    });
    acceptAgreement(actor, created.id);
    const first = billPeriods(actor.orgId, "2026-10-13");
    const keys = getDb()
      .select()
      .from(agreementInvoices)
      .where(and(eq(agreementInvoices.orgId, actor.orgId), eq(agreementInvoices.agreementId, created.id)))
      .all();
    expect(first).toBe(3);
    expect(keys).toHaveLength(3);
    expect(billPeriods(actor.orgId, "2026-10-13")).toBe(0);
    expect(
      getDb()
        .select()
        .from(agreementInvoices)
        .where(eq(agreementInvoices.agreementId, created.id))
        .all(),
    ).toHaveLength(3);
    const report = agreementReport(actor.orgId, "2026-10-13");
    expect(report.rows.find((row) => row.id === created.id)?.monthlyCents).toBe(15000);
    expect(report.rate).toBeGreaterThan(0);
  });

  it("adds as-needed visits in a block", () => {
    const actor = maya();
    const created = createAgreement(actor, {
      contactId: "c_diaz",
      projectId: "proj_diaz",
      name: "Storm calls",
      startOn: "2026-10-13",
      termKind: "until_cancelled",
      cadence: "as_needed",
      billing: "per_visit",
      lines: [{ code: "FRM-LABOR", qtyMilli: 1000 }],
    });
    acceptAgreement(actor, created.id);
    const added = addVisits(actor, created.id, { startOn: "2026-10-13", count: 3, gapDays: 2 });
    expect(added.ids).toHaveLength(3);
    expect(getDb().select().from(agreementVisits).where(eq(agreementVisits.agreementId, created.id)).all()).toHaveLength(3);
  });
});
