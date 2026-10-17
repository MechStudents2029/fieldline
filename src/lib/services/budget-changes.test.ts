import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { budgetLines, changeOrders, costItems, invoices } from "@/lib/db/schema";
import { mentionUnread } from "@/lib/services/comments";
import { convertChangeEvent, createChangeEvent, listChangeEvents, markChangeReady } from "@/lib/services/change-events";
import { portalBilling } from "@/lib/services/draws";
import {
  approveBudgetChange,
  budgetChangeAttention,
  budgetChangeDetail,
  budgetChangesCsv,
  contingencyFor,
  createBudgetChange,
  fundFromContingency,
  listBudgetChanges,
  setBudgetLineKind,
  voidBudgetChange,
} from "@/lib/services/budget-changes";
import { createFromBudget, specPack } from "@/lib/services/job-specs";
import { authenticate, portalByToken, projectDetail } from "@/lib/services/read";
import { wipJob } from "@/lib/services/wip";
import { nowIso } from "@/lib/ids";

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

describe("budget changes", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("names the new tables in the Postgres policy list", () => {
    const sql = readFileSync("supabase/rls.sql", "utf8");
    for (const table of ["budget_changes", "budget_change_lines"]) {
      expect(sql.split(`'${table}'`).length - 1).toBe(2);
    }
  });

  it("seeds a contingency draw, an old draft, and keeps client surfaces clear", () => {
    const maya = actor("maya@rivera.demo");
    const attention = budgetChangeAttention(maya);
    expect(attention.age).toEqual({ count: 1, href: "/budget-changes?filter=age" });
    expect(attention.low).toEqual({ count: 1, href: "/budget-changes?filter=low" });
    expect(listBudgetChanges(maya, { filter: "age" }).map((row) => row.title)).toEqual(["Tile shift"]);
    expect(budgetChangeDetail(maya, "bc_chen_draw")).toMatchObject({
      status: "approved",
      type: "contingency",
      amountCents: 80_000,
      changeEventId: "ce_chen_fund",
    });
    expect(budgetChangeDetail(maya, "bc_chen_xfer")).toMatchObject({ status: "draft", type: "transfer", amountCents: 10_000 });
    expect(contingencyFor(maya.orgId, "proj_chen")).toEqual({ originalCents: 100_000, revisedCents: 20_000, low: true });
    expect(getDb().select().from(budgetLines).where(eq(budgetLines.id, "bud_chen_cont")).get()).toMatchObject({
      budgetCostCents: 100_000,
      budgetPriceCents: 0,
      kind: "contingency",
    });
    expect(getDb().select().from(budgetLines).where(eq(budgetLines.id, "bud_proj_chen_4")).get()?.budgetCostCents).toBe(180_000);
    expect(getDb().select().from(budgetLines).where(eq(budgetLines.id, "bud_ok_floor")).get()?.kind).toBe("allowance");
    const chen = wipJob(maya, "proj_chen");
    expect(chen?.codes.find((row) => row.code === "GC-CONT")?.revisedBudgetCents).toBe(20_000);
    expect(chen?.codes.find((row) => row.code === "GC-SUPER")?.revisedBudgetCents).toBe(260_000);
    expect(chen).toMatchObject({ costToDateCents: 0, billedCents: 736_000, percentBps: 0, earnedCents: 0, overUnderCents: 736_000 });
    const glass = projectDetail(maya.orgId, "proj_okonkwo", "owner")?.financials?.byCode.find((row) => row.code === "BATH-GLASS");
    expect(glass).toMatchObject({ budgetCents: 320_000, pendingCents: 22_000, projectedCents: 342_000 });
    expect(listChangeEvents(maya, { filter: "open" }).map((row) => row.title)).toEqual(["Valve height gap"]);
    expect(mentionUnread(maya)).toBe(2);
    expect(budgetChangeDetail(actor("jordan@northline.demo"), "bc_chen_draw")).toBeNull();
    expect(budgetChangesCsv(maya)).toContain("Supervision cover");
    expect(budgetChangesCsv(maya)).toContain("Tile shift");
    const portal = JSON.stringify(portalByToken("demo_portal_chen"));
    const billing = JSON.stringify(portalBilling("demo_portal_chen"));
    const bills = JSON.stringify(getDb().select().from(invoices).where(eq(invoices.projectId, "proj_chen")).all());
    for (const blob of [portal, billing, bills]) {
      expect(blob).not.toContain("Supervision cover");
      expect(blob).not.toContain("Tile shift");
      expect(blob).not.toContain("GC-CONT");
    }
    const spec = specPack(maya, createFromBudget(maya, "proj_chen").id);
    expect(spec?.lines.some((line) => line.description === "Contingency" || line.costCode === "GC-CONT")).toBe(false);
    expect(spec?.lines.some((line) => line.description === "Vanity and top")).toBe(true);
    expect(() => listBudgetChanges(actor("dana@rivera.demo"))).toThrow(/cannot see/);
    expect(() => createBudgetChange(actor("riley@rivera.demo"), "proj_chen", { title: "Nope", type: "transfer", fromBudgetLineId: "bud_chen_cont", fromCents: 100, lines: [{ budgetLineId: "bud_proj_chen_4", amountCents: 100 }] })).toThrow(/cannot change/);
  });

  it("enforces net-zero, the floor, an admin override, and void", () => {
    const maya = actor("maya@rivera.demo");
    const luis = actor("luis@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const line = getDb().select().from(budgetLines).where(eq(budgetLines.id, "bud_proj_chen_2")).get();
    setBudgetLineKind(maya, "bud_proj_chen_2", "allowance");
    expect(getDb().select().from(budgetLines).where(eq(budgetLines.id, "bud_proj_chen_2")).get()).toMatchObject({
      kind: "allowance",
      budgetCostCents: line?.budgetCostCents,
    });
    setBudgetLineKind(maya, "bud_proj_chen_2", "");
    expect(() =>
      createBudgetChange(maya, "proj_chen", {
        title: "Uneven",
        type: "transfer",
        fromBudgetLineId: "bud_proj_chen_1",
        fromCents: 1_000,
        lines: [{ budgetLineId: "bud_proj_chen_2", amountCents: 900 }],
      }),
    ).toThrow(/net to zero/);
    const moved = createBudgetChange(luis, "proj_chen", {
      title: "Vanity to toilet",
      type: "transfer",
      fromBudgetLineId: "bud_proj_chen_1",
      fromCents: 100,
      lines: [{ budgetLineId: "bud_proj_chen_2", amountCents: 100 }],
    });
    approveBudgetChange(luis, moved);
    expect(getDb().select().from(budgetLines).where(eq(budgetLines.id, "bud_proj_chen_1")).get()?.budgetCostCents).toBe(420_000);
    expect(() => approveBudgetChange(luis, moved)).toThrow(/locked/);
    expect(() => voidBudgetChange(riley, moved, "No")).toThrow(/cannot change/);
    expect(() => voidBudgetChange(maya, moved, " ")).toThrow(/Add a reason/);
    voidBudgetChange(maya, moved, "Undo");
    expect(budgetChangeDetail(maya, moved)?.status).toBe("voided");
    expect(() => voidBudgetChange(maya, moved, "Again")).toThrow(/locked/);
    expect(wipJob(maya, "proj_chen")?.codes.find((row) => row.code === "BATH-VANITY")?.revisedBudgetCents).toBe(420_000);

    getDb()
      .insert(costItems)
      .values({
        id: "cost_chen_floor",
        orgId: maya.orgId,
        projectId: "proj_chen",
        budgetLineId: null,
        costCode: "DEMO-GUT",
        amountCents: 60_000,
        vendorName: "Test",
        memo: "Floor",
        source: "bill",
        aiExtracted: 0,
        documentId: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        createdBy: maya.userId,
      })
      .run();
    const below = {
      title: "Below the floor",
      type: "transfer" as const,
      fromBudgetLineId: "bud_proj_chen_0",
      fromCents: 20_000,
      lines: [{ budgetLineId: "bud_proj_chen_1", amountCents: 20_000 }],
    };
    expect(() => createBudgetChange(luis, "proj_chen", below)).toThrow(/below what is already committed/);
    expect(() => createBudgetChange(luis, "proj_chen", { ...below, overrideNote: "Office note" })).toThrow(/cannot override/);
    const overridden = createBudgetChange(maya, "proj_chen", { ...below, overrideNote: "Cover the demo" });
    approveBudgetChange(maya, overridden);
    expect(budgetChangeDetail(maya, overridden)?.overrideNote).toBe("Cover the demo");
    expect(wipJob(maya, "proj_chen")?.codes.find((row) => row.code === "DEMO-GUT")?.revisedBudgetCents).toBe(50_000);
    voidBudgetChange(maya, overridden, "Restore");
    expect(wipJob(maya, "proj_chen")?.codes.find((row) => row.code === "DEMO-GUT")?.revisedBudgetCents).toBe(70_000);
    expect(getDb().select().from(budgetLines).where(eq(budgetLines.id, "bud_proj_chen_0")).get()?.budgetCostCents).toBe(70_000);
  });

  it("funds a ready event once and blocks a client change order", () => {
    const maya = actor("maya@rivera.demo");
    const before = getDb().select().from(changeOrders).all().length;
    const eventId = createChangeEvent(maya, "proj_chen", {
      title: "In-scope cover",
      reason: "unforeseen",
      costCode: "GC-SUPER",
      romCostCents: 5_000,
      romPriceCents: 0,
      scheduleDays: 0,
    });
    markChangeReady(maya, eventId);
    const changeId = fundFromContingency(maya, eventId);
    expect(budgetChangeDetail(maya, changeId)).toMatchObject({ status: "draft", type: "contingency", changeEventId: eventId, amountCents: 5_000 });
    expect(() => fundFromContingency(maya, eventId)).toThrow(/Already converted/);
    expect(() => convertChangeEvent(maya, eventId)).toThrow(/Already converted/);
    expect(getDb().select().from(changeOrders).all().length).toBe(before);
    voidBudgetChange(maya, changeId, "Release");
    const again = fundFromContingency(maya, eventId);
    expect(again).not.toBe(changeId);
    expect(() => convertChangeEvent(maya, eventId)).toThrow(/Already converted/);
    expect(getDb().select().from(changeOrders).all().length).toBe(before);
  });
});
