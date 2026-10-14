import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { jobFacts } from "@/lib/commissions/apply";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { commissionLines, commissionPlanOverrides, commissionPlans, commissionSplits, payments, projects } from "@/lib/db/schema";
import { applyClientCredit, voidClientCredit } from "@/lib/services/client-credits";
import {
  commissionCsv,
  commissionSettings,
  jobCommission,
  listCommissions,
  markCommission,
  saveCommissionPlan,
  saveJobSplits,
  setPlanStatus,
  syncJobCommissions,
} from "@/lib/services/commissions";
import { authenticate } from "@/lib/services/read";
import { approveChangeOrder, payInvoice } from "@/lib/services/write";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(email);
  return user;
}

function lines(projectId?: string) {
  return getDb()
    .select()
    .from(commissionLines)
    .where(projectId ? and(eq(commissionLines.orgId, "org_rivera"), eq(commissionLines.projectId, projectId)) : eq(commissionLines.orgId, "org_rivera"))
    .all();
}

function fingerprint(projectId?: string) {
  return lines(projectId)
    .map((row) => `${row.sourceKey}|${row.status}|${row.earnedCents}|${row.rateBps}|${row.basisCents}`)
    .sort();
}

describe("sales commissions", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("seeds plans, splits, and mixed owed and paid rows without doubling on a second sync", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const jordan = actor("jordan@northline.demo");
    const settings = commissionSettings(maya);
    expect(settings?.plans.map((plan) => plan.name).sort()).toEqual(["Luis", "Maya", "Office"]);
    expect(settings?.plans.find((plan) => plan.name === "Maya")?.overrides).toEqual([
      expect.objectContaining({ projectType: "Bath remodel", rateBps: 600 }),
    ]);
    expect(getDb().select().from(commissionSplits).where(eq(commissionSplits.orgId, "org_rivera")).all()).toHaveLength(5);
    expect(getDb().select().from(commissionPlanOverrides).all().some((row) => row.id === "cpov_maya_bath")).toBe(true);

    const sql = readFileSync("supabase/rls.sql", "utf8");
    expect(sql).toContain("commission_plans");
    expect(sql).toContain("commission_lines");

    listCommissions(maya);
    const once = fingerprint();
    listCommissions(maya);
    expect(fingerprint()).toEqual(once);

    const open = listCommissions(maya);
    const okonkwo = open.filter((row) => row.projectId === "proj_okonkwo");
    const diaz = open.filter((row) => row.projectId === "proj_diaz");
    expect(okonkwo.some((row) => row.status === "paid" && row.earnedCents > 0)).toBe(true);
    expect(okonkwo.some((row) => row.status === "owed" && row.earnedCents > 0)).toBe(true);
    expect(diaz.some((row) => row.status === "paid" && row.earnedCents > 0)).toBe(true);
    expect(diaz.some((row) => row.status === "owed")).toBe(true);
    expect(okonkwo.filter((row) => row.userId === "user_maya").every((row) => row.rateBps === 600)).toBe(true);
    expect(diaz.filter((row) => row.userId === "user_maya").every((row) => row.rateBps === 500)).toBe(true);

    const facts = jobFacts(getDb(), "org_rivera", "proj_okonkwo");
    expect(facts?.facts.jobCostCents).toBeGreaterThan(0);
    const luis = okonkwo.find((row) => row.userId === "user_luis");
    expect(luis).toBeTruthy();
    expect(luis!.basisCents).toBeLessThan(facts!.facts.soldCents);
    expect(jobCommission(maya, "proj_brooks")?.remainderLabel).toBe("Unassigned 50%");

    expect(commissionSettings(dana)).toBeNull();
    expect(() => markCommission(dana, open[0]!.id, "paid")).toThrow(/owner or admin/);
    expect(listCommissions(dana)).toEqual([]);
    expect(listCommissions(riley).length).toBeGreaterThan(0);
    expect(() => markCommission(riley, open[0]!.id, "paid")).toThrow(/owner or admin/);
    expect(listCommissions(jordan)).toEqual([]);
    expect(commissionSettings(jordan)?.plans).toEqual([]);
    expect(commissionCsv(maya)).toContain("Person,Job,Seat,Milestone");
    expect(commissionCsv(maya)).toContain("Okonkwo primary bath");
  });

  it("marks an owed line paid and leaves it paid when the job syncs again", () => {
    const maya = actor("maya@rivera.demo");
    const owed = listCommissions(maya, { status: "owed" }).find((row) => row.projectId === "proj_okonkwo" && row.earnedCents > 0);
    if (!owed) throw new Error("missing owed line");
    const before = lines("proj_okonkwo").find((row) => row.id === owed.id);
    markCommission(maya, owed.id, "paid");
    listCommissions(maya);
    const after = lines("proj_okonkwo").filter((row) => row.sourceKey === before?.sourceKey);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ status: "paid", earnedCents: before?.earnedCents, paidBy: "user_maya" });
    expect(() => markCommission(maya, owed.id, "paid")).toThrow(/owed/);
  });

  it("voids a line and does not recreate it", () => {
    const maya = actor("maya@rivera.demo");
    const owed = listCommissions(maya, { status: "owed" }).find((row) => row.projectId === "proj_diaz" && row.earnedCents > 0);
    if (!owed) throw new Error("missing diaz owed line");
    const before = lines("proj_diaz").find((row) => row.id === owed.id);
    markCommission(maya, owed.id, "void");
    listCommissions(maya, { status: "all" });
    const after = lines("proj_diaz").filter((row) => row.sourceKey === before?.sourceKey || row.sourceKey.startsWith(`${before?.sourceKey}:`));
    expect(after.map((row) => row.status)).toEqual(["void"]);
    expect(listCommissions(maya).some((row) => row.id === owed.id)).toBe(false);
    expect(listCommissions(maya, { status: "void" }).some((row) => row.id === owed.id)).toBe(true);
  });

  it("recalculates earned commission when a change order changes the sold amount", () => {
    const maya = actor("maya@rivera.demo");
    const before = fingerprint("proj_okonkwo");
    const beforeSum = lines("proj_okonkwo")
      .filter((row) => row.status !== "void")
      .reduce((sum, row) => sum + row.earnedCents, 0);
    approveChangeOrder({ token: "demo_co_okonkwo_3", typedName: "Ada Okonkwo", consent: true });
    const afterSum = lines("proj_okonkwo")
      .filter((row) => row.status !== "void")
      .reduce((sum, row) => sum + row.earnedCents, 0);
    expect(afterSum).not.toBe(beforeSum);
    expect(fingerprint("proj_okonkwo")).not.toEqual(before);
    const board = jobCommission(maya, "proj_okonkwo");
    expect(board?.deltaCents).not.toBe(0);
    const stable = fingerprint("proj_okonkwo");
    syncJobCommissions("org_rivera", "proj_okonkwo");
    expect(fingerprint("proj_okonkwo")).toEqual(stable);
    const paid = lines("proj_okonkwo").filter((row) => row.status === "paid");
    expect(paid.length).toBeGreaterThan(0);
    expect(paid.every((row) => row.paidBy)).toBe(true);
  });

  it("counts an applied credit memo once and reverses it when the memo is voided", () => {
    const maya = actor("maya@rivera.demo");
    const before = jobFacts(getDb(), "org_rivera", "proj_brooks")?.facts.collectedCents ?? 0;
    const keys = fingerprint("proj_brooks");
    applyClientCredit(maya, { memoId: "ccm_open", invoiceId: "inv_br_prog", amountCents: 5_000, idempotencyKey: "comm-credit-apply" });
    expect(jobFacts(getDb(), "org_rivera", "proj_brooks")?.facts.collectedCents).toBe(before + 5_000);
    applyClientCredit(maya, { memoId: "ccm_open", invoiceId: "inv_br_prog", amountCents: 5_000, idempotencyKey: "comm-credit-apply" });
    expect(jobFacts(getDb(), "org_rivera", "proj_brooks")?.facts.collectedCents).toBe(before + 5_000);
    const afterApply = lines("proj_brooks").length;
    expect(afterApply).toBeGreaterThanOrEqual(keys.length);
    voidClientCredit(maya, "ccm_open", "Window allowance returned");
    expect(jobFacts(getDb(), "org_rivera", "proj_brooks")?.facts.collectedCents).toBe(before);
    syncJobCommissions("org_rivera", "proj_brooks");
    expect(lines("proj_brooks").length).toBeLessThanOrEqual(afterApply);
    expect(new Set(lines("proj_brooks").map((row) => row.sourceKey)).size).toBe(lines("proj_brooks").length);
  });

  it("earns on a collected deposit and drops that earn when the payment is voided", () => {
    const maya = actor("maya@rivera.demo");
    saveJobSplits(maya, "proj_chen", {
      projectType: "Bath remodel",
      mode: "percent",
      rows: [{ userId: "user_maya", seat: "setter", share: "100" }],
    });
    expect(lines("proj_chen").every((row) => row.rateBps === 600)).toBe(true);
    const paid = payInvoice({
      token: "demo_pay_chen_deposit",
      method: "ach",
      routing: "110000000",
      account: "000123456789",
      idempotencyKey: "comm-chen-deposit",
    });
    expect(paid.ok).toBe(true);
    const earned = lines("proj_chen")
      .filter((row) => row.status !== "void")
      .reduce((sum, row) => sum + row.earnedCents, 0);
    expect(earned).toBeGreaterThan(0);
    const count = lines("proj_chen").length;
    getDb().update(payments).set({ status: "void" }).where(eq(payments.idempotencyKey, "comm-chen-deposit")).run();
    syncJobCommissions("org_rivera", "proj_chen");
    const after = lines("proj_chen")
      .filter((row) => row.status !== "void")
      .reduce((sum, row) => sum + row.earnedCents, 0);
    expect(after).toBeLessThan(earned);
    expect(lines("proj_chen")).toHaveLength(count);
    syncJobCommissions("org_rivera", "proj_chen");
    expect(lines("proj_chen")).toHaveLength(count);
    expect(getDb().select().from(projects).where(eq(projects.id, "proj_chen")).get()?.projectType).toBe("Bath remodel");
  });

  it("uses the role plan when the person's plan is archived, then restores it", () => {
    const maya = actor("maya@rivera.demo");
    const paid = lines().find((row) => row.userId === "user_luis" && row.status === "paid");
    if (!paid) throw new Error("missing paid luis line");
    setPlanStatus(maya, "cplan_luis", true);
    const unpaid = lines().filter((row) => row.userId === "user_luis" && row.status !== "void" && row.status !== "paid");
    expect(unpaid.some((row) => row.rateBps === 400)).toBe(true);
    expect(lines().find((row) => row.id === paid.id)?.earnedCents).toBe(paid.earnedCents);
    setPlanStatus(maya, "cplan_luis", false);
    expect(lines().some((row) => row.userId === "user_luis" && row.status !== "void" && row.rateBps === 1000)).toBe(true);
    expect(getDb().select().from(commissionPlans).where(eq(commissionPlans.id, "cplan_luis")).get()?.status).toBe("active");
  });

  it("shows a salesperson only their own rows", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    saveCommissionPlan(maya, {
      name: "Dana",
      subject: "user:user_dana",
      basis: "contract",
      rate: "4",
      deposit: "50",
      start: "0",
      completion: "50",
    });
    saveJobSplits(maya, "proj_chen", {
      projectType: "Bath remodel",
      mode: "percent",
      rows: [{ userId: "user_dana", seat: "setter", share: "100" }],
    });
    const own = listCommissions(dana);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((row) => row.userId === "user_dana")).toBe(true);
    expect(own.some((row) => row.job.includes("Chen") || row.projectId === "proj_chen")).toBe(true);
    expect(commissionSettings(dana)).toBeNull();
    expect(() => saveJobSplits(dana, "proj_chen", { projectType: "Bath remodel", mode: "percent", rows: [] })).toThrow(/view/);
  });
});
