import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, bills, projects, wipAttempts } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { authenticate } from "@/lib/services/read";
import { setWipOverride, wipCsv, wipJob, wipReport } from "@/lib/services/wip";
import { addCalendarDays } from "@/lib/time/calendar";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("WIP report", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("keeps the report in the company and away from field and viewers", () => {
    const maya = actor("maya@rivera.demo");
    const report = wipReport(maya);
    expect(report.rows.map((row) => row.name)).toContain("Brooks powder room");
    expect(report.rows.map((row) => row.name)).not.toContain("Template bath");
    expect(report.rows.map((row) => row.name)).not.toContain("Phone bath");
    expect(wipReport(actor("jordan@northline.demo")).rows).toEqual([]);
    expect(() => wipReport(actor("dana@rivera.demo"))).toThrow(/cannot see this report/);
    expect(() => wipReport(actor("riley@rivera.demo"))).toThrow(/cannot see this report/);
    expect(wipJob(actor("jordan@northline.demo"), "proj_brooks_bath")).toBeNull();
    expect(wipJob(maya, "proj_other")).toBeNull();
    expect(readFileSync("supabase/rls.sql", "utf8")).toContain("wip_overrides_scope");
  });

  it("shows an overbilled job, an underbilled job, and a negative margin", () => {
    const report = wipReport(actor("maya@rivera.demo"));
    const row = (id: string) => report.rows.find((item) => item.projectId === id);
    const okonkwo = row("proj_okonkwo");
    const chen = row("proj_chen");
    const brooks = row("proj_brooks");
    const powder = row("proj_brooks_bath");
    expect(okonkwo?.costToDateCents).toBe(1_369_000);
    expect(okonkwo?.billedCents).toBe(3_360_000);
    expect(okonkwo && okonkwo.overUnderCents > 0).toBe(true);
    expect(chen).toMatchObject({ costToDateCents: 0, billedCents: 736_000, percentBps: 0, earnedCents: 0, overUnderCents: 736_000 });
    expect(brooks && brooks.profitCents < 0).toBe(true);
    expect(powder).toMatchObject({
      contractCents: 2_800_000,
      projectedCents: 2_000_000,
      costToDateCents: 1_600_000,
      percentBps: 8000,
      earnedCents: 2_240_000,
      billedCents: 560_000,
      overUnderCents: -1_680_000,
      profitCents: 800_000,
      costToCompleteCents: 400_000,
    });
    expect(report.rows.some((item) => item.overUnderCents > 0)).toBe(true);
    expect(report.rows.some((item) => item.overUnderCents < 0)).toBe(true);
    expect(report.rows.some((item) => item.profitCents < 0)).toBe(true);
    expect(report.totals.contractCents).toBe(report.rows.reduce((sum, item) => sum + item.contractCents, 0));
    expect(report.totals.projectedCents).toBe(report.rows.reduce((sum, item) => sum + item.projectedCents, 0));
    expect(report.totals.costToDateCents).toBe(report.rows.reduce((sum, item) => sum + item.costToDateCents, 0));
    expect(report.totals.earnedCents).toBe(report.rows.reduce((sum, item) => sum + item.earnedCents, 0));
    expect(report.totals.billedCents).toBe(report.rows.reduce((sum, item) => sum + item.billedCents, 0));
    expect(report.totals.overUnderCents).toBe(report.rows.reduce((sum, item) => sum + item.overUnderCents, 0));
    expect(report.totals.profitCents).toBe(report.rows.reduce((sum, item) => sum + item.profitCents, 0));
    expect(report.totals.costToCompleteCents).toBe(report.rows.reduce((sum, item) => sum + item.costToCompleteCents, 0));
    expect(report.underbilled.cents).toBe(report.rows.filter((item) => item.overUnderCents < 0).reduce((sum, item) => sum + item.overUnderCents, 0));
    const luis = wipReport(actor("maya@rivera.demo"), { pmUserId: "user_luis" });
    expect(luis.rows.map((item) => item.projectId).sort()).toEqual(["proj_brooks_bath", "proj_okonkwo"]);
    expect(wipReport(actor("maya@rivera.demo"), { status: "complete" }).rows.every((item) => item.status === "complete")).toBe(true);
    expect(getDb().select().from(projects).all().some((project) => project.name === "Template bath")).toBe(false);
  });

  it("drops costs and bills dated after the as-of day and keeps an earlier cutoff at zero", () => {
    const maya = actor("maya@rivera.demo");
    const bill = getDb().select().from(bills).where(eq(bills.id, "bill_brooks_bath")).get();
    expect(bill?.billDate).toBeTruthy();
    const onBill = wipReport(maya, { asOf: bill?.billDate });
    const powder = onBill.rows.find((row) => row.projectId === "proj_brooks_bath");
    expect(powder?.costToDateCents).toBe(1_600_000);
    expect(powder?.billedCents).toBe(0);
    const before = wipReport(maya, { asOf: addCalendarDays(bill?.billDate || "", -1) });
    expect(before.rows.find((row) => row.projectId === "proj_brooks_bath")).toMatchObject({
      costToDateCents: 0,
      billedCents: 0,
      percentBps: 0,
      earnedCents: 0,
    });
  });

  it("applies an audited override without rewriting the cost codes, and ignores it before it was saved", () => {
    const maya = actor("maya@rivera.demo");
    setWipOverride(maya, "proj_brooks_bath", { amountCents: 1_000_000, note: "Owner forecast" });
    const report = wipReport(maya);
    const powder = report.rows.find((row) => row.projectId === "proj_brooks_bath");
    expect(powder?.override).toEqual({ amountCents: 1_000_000, note: "Owner forecast" });
    expect(powder?.projectedCents).toBe(1_000_000);
    expect(powder?.percentBps).toBe(10_000);
    expect(powder?.earnedCents).toBe(2_800_000);
    expect(powder?.codes.reduce((sum, code) => sum + code.projectedCents, 0)).toBe(2_000_000);
    const job = wipJob(maya, "proj_brooks_bath");
    expect(job?.projectedCents).toBe(powder?.projectedCents);
    expect(job?.earnedCents).toBe(powder?.earnedCents);
    const earlier = wipReport(maya, { asOf: addCalendarDays(report.asOf, -1) });
    expect(earlier.rows.find((row) => row.projectId === "proj_brooks_bath")?.projectedCents).toBe(2_000_000);
    const audit = getDb().select().from(auditLogs).where(eq(auditLogs.action, "wip.override")).all();
    expect(audit.some((row) => row.entityId === "proj_brooks_bath")).toBe(true);
    expect(() => setWipOverride(maya, "proj_brooks_bath", { amountCents: 1, note: " " })).toThrow(/Add a note/);
    expect(() => setWipOverride(actor("jordan@northline.demo"), "proj_brooks_bath", { amountCents: 1, note: "No" })).toThrow(/not in your company|cannot see/);
    const csv = wipCsv(maya, { sort: "under", dir: "asc" });
    expect(csv.filename).toBe(`wip-${report.asOf}.csv`);
    expect(csv.body.split("\n")[0]).toContain("Over/under billing");
    expect(csv.body).toContain("Brooks powder room");
    const lines = csv.body.trim().split("\n");
    expect(lines.at(-1)?.startsWith("Total,")).toBe(true);
    expect(lines.filter((line) => line.startsWith("Brooks powder room,")).length).toBe(1);
  });

  it("refuses another override after the rate limit", () => {
    const maya = actor("maya@rivera.demo");
    const stamp = nowIso();
    for (let index = 0; index < 20; index += 1) {
      getDb().insert(wipAttempts).values({ id: id("watt"), orgId: maya.orgId, userId: maya.userId, createdAt: stamp }).run();
    }
    expect(() => setWipOverride(maya, "proj_brooks_bath", { amountCents: 2_000_000, note: "Again" })).toThrow(/Wait a few minutes/);
  });
});
