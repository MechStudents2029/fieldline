import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, costItems, invoiceCosts, invoices, timeApprovals, timeEntries } from "@/lib/db/schema";
import { authenticate } from "@/lib/services/read";
import { addManualTime, approveTime } from "@/lib/services/time";
import { addNonJobShift, repriceWeek, saveOvertimeSettings } from "@/lib/time/post";
import { zonedTimeToUtc } from "@/lib/time/calendar";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

function at(month: number, day: number, hour: number) {
  return new Date(zonedTimeToUtc(2026, month, day, hour, 0, 0, "America/New_York")).toISOString();
}

function addShift(userId: string, month: number, day: number, startHour: number, hours: number) {
  const maya = actor("maya@rivera.demo");
  return addManualTime(maya, {
    userId,
    projectId: "proj_okonkwo",
    costCode: "GC-SUPER",
    clockInAt: at(month, day, startHour),
    clockOutAt: at(month, day, startHour + hours),
    reason: "Office entered the shift",
  });
}

function active(entryId: string) {
  return getDb().select().from(timeApprovals).where(and(eq(timeApprovals.entryId, entryId), eq(timeApprovals.status, "active"))).get();
}

describe("overtime posting", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
    saveOvertimeSettings(actor("maya@rivera.demo"), {
      enabled: true,
      dailyHours: null,
      weeklyHours: 40,
      doubleHours: null,
      otMultiplier: 1.5,
      dtMultiplier: 2,
      burdenPercent: 0,
      otDays: [0],
      nonjobCountsTowardOt: false,
      burdenByUser: [],
    });
  });

  it("puts the weekly premium on the punch that crosses 40 and leaves earlier costs", () => {
    const maya = actor("maya@rivera.demo");
    const days = [5, 6, 7, 8, 9].map((day) => addShift("user_maya", 1, day, 8, 8));
    for (const row of days) approveTime(maya, row.entryId);
    const early = active(days[0]!.entryId);
    expect(early?.premiumCents).toBe(0);
    expect(early?.amountCents).toBe(36_000);
    const saturday = addShift("user_maya", 1, 10, 8, 2);
    const posted = approveTime(maya, saturday.entryId);
    expect(posted.amountCents).toBe(13_500);
    expect(active(saturday.entryId)).toMatchObject({ regularMinutes: 0, otMinutes: 120, premiumCents: 4_500, baseCents: 9_000 });
    expect(active(days[0]!.entryId)?.amountCents).toBe(36_000);
    expect(active(days[4]!.entryId)?.premiumCents).toBe(0);
    const premium = getDb().select().from(costItems).where(eq(costItems.source, "labor_premium")).all();
    expect(premium.some((row) => row.amountCents === 4_500 && row.memo === "OT premium")).toBe(true);
    expect(getDb().select().from(auditLogs).all().some((row) => row.action === "time.premium" && row.entityId === saturday.entryId)).toBe(true);
  });

  it("does not rewrite a punch already on an invoice when earlier hours would have made it overtime", () => {
    const maya = actor("maya@rivera.demo");
    const saturday = addShift("user_maya", 1, 17, 8, 2);
    const posted = approveTime(maya, saturday.entryId);
    expect(posted.amountCents).toBe(9_000);
    const stamp = new Date().toISOString();
    getDb()
      .insert(invoices)
      .values({
        id: "inv_ot_lock",
        orgId: "org_rivera",
        projectId: "proj_okonkwo",
        number: "OT-1",
        type: "standard",
        status: "draft",
        issueDate: "2026-01-17",
        dueDate: "2026-01-24",
        subtotalCents: 9_000,
        taxCents: 0,
        totalCents: 9_000,
        payToken: "ot-lock",
        createdAt: stamp,
        updatedAt: stamp,
      })
      .run();
    getDb()
      .insert(invoiceCosts)
      .values({
        id: "icost_ot_lock",
        orgId: "org_rivera",
        projectId: "proj_okonkwo",
        invoiceId: "inv_ot_lock",
        sourceKind: "time",
        sourceId: saturday.entryId,
        costCode: "GC-SUPER",
        label: "Labor",
        occurredOn: "2026-01-17",
        costCents: 9_000,
        markupBps: 0,
        markupCents: 0,
        priceCents: 9_000,
        nonBillable: 0,
        createdAt: stamp,
      })
      .run();
    const week = [12, 13, 14, 15, 16].map((day) => addShift("user_maya", 1, day, 8, 8));
    for (const row of week) approveTime(maya, row.entryId);
    expect(active(saturday.entryId)?.amountCents).toBe(9_000);
    expect(active(saturday.entryId)?.premiumCents).toBe(0);
    expect(active(week[4]!.entryId)?.premiumCents).toBe(0);
    expect(active(week[4]!.entryId)?.amountCents).toBe(36_000);
  });

  it("reprices the crossing punch when it is not on an invoice, including after an edit", () => {
    const maya = actor("maya@rivera.demo");
    const saturday = addShift("user_maya", 2, 7, 8, 2);
    approveTime(maya, saturday.entryId);
    expect(active(saturday.entryId)?.premiumCents).toBe(0);
    const week = [2, 3, 4, 5, 6].map((day) => addShift("user_maya", 2, day, 8, 8));
    for (const row of week) approveTime(maya, row.entryId);
    expect(active(saturday.entryId)).toMatchObject({ otMinutes: 120, premiumCents: 4_500, amountCents: 13_500 });
    expect(active(week[0]!.entryId)?.premiumCents).toBe(0);
    getDb()
      .update(timeEntries)
      .set({ clockOutAt: at(2, 7, 9) })
      .where(eq(timeEntries.id, saturday.entryId))
      .run();
    repriceWeek(maya, "user_maya", at(2, 7, 8));
    expect(active(saturday.entryId)).toMatchObject({ otMinutes: 60, premiumCents: 2_250, amountCents: 6_750 });
  });

  it("posts burden beside labor and keeps PTO off the job", () => {
    const maya = actor("maya@rivera.demo");
    saveOvertimeSettings(maya, {
      enabled: true,
      dailyHours: null,
      weeklyHours: 40,
      doubleHours: null,
      otMultiplier: 1.5,
      dtMultiplier: 2,
      burdenPercent: 15,
      otDays: [0],
      nonjobCountsTowardOt: false,
      burdenByUser: [],
    });
    const punch = addShift("user_maya", 3, 2, 8, 2);
    const before = getDb().select().from(costItems).where(eq(costItems.projectId, "proj_okonkwo")).all().length;
    const posted = approveTime(maya, punch.entryId);
    expect(posted).toMatchObject({ baseCents: 9_000, premiumCents: 0, burdenCents: 1_350, amountCents: 10_350 });
    const mine = getDb().select().from(costItems).where(eq(costItems.projectId, "proj_okonkwo")).all();
    expect(mine.length).toBe(before + 2);
    expect(mine.some((row) => row.memo === "Labor" && row.amountCents === 9_000)).toBe(true);
    expect(mine.some((row) => row.memo === "Burden" && row.amountCents === 1_350)).toBe(true);
    const pto = addNonJobShift(maya, { userId: "user_maya", day: "2026-03-03", hours: 8, shiftType: "pto" });
    expect(active(pto.entryId)).toMatchObject({ nonjobMinutes: 480, amountCents: 0, costItemId: null });
    expect(getDb().select().from(costItems).where(eq(costItems.projectId, "proj_okonkwo")).all().length).toBe(before + 2);
    expect(getDb().select().from(auditLogs).all().some((row) => row.action === "time.ot_settings")).toBe(true);
    expect(getDb().select().from(auditLogs).all().some((row) => row.action === "time.nonjob" && row.entityId === pto.entryId)).toBe(true);
  });
});
