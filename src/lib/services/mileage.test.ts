import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, costItems, mileageTrips } from "@/lib/db/schema";
import { authenticate } from "@/lib/services/read";
import { reimbursementBoard } from "@/lib/services/cost-receipts";
import {
  approveMileageTrip,
  createMileageTrip,
  editMileageTrip,
  listMileageRates,
  listMileageTrips,
  markMileageReimbursed,
  mileageAttention,
  mileageCsv,
  mileageDetail,
  mileageOwed,
  rejectMileageTrip,
  saveMileageRates,
  submitMileageTrip,
} from "@/lib/services/mileage";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("mileage", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("seeds both 2026 rates and three trips", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const rates = listMileageRates(maya);
    expect(rates.periods.map((row) => [row.startsOn, row.rateDeciCents, row.irsDeciCents])).toEqual([
      ["2026-01-01", 725, 725],
      ["2026-07-01", 760, 760],
    ]);
    expect(rates.canEdit).toBe(true);
    expect(listMileageRates(dana).canEdit).toBe(false);
    const waiting = mileageDetail(maya, "mt_dana_wait");
    expect(waiting).toMatchObject({ status: "submitted", milesMilli: 20_000, amountCents: 1450, snapshotted: false, purpose: "Lumber run" });
    expect(mileageDetail(maya, "mt_maya_paid")).toMatchObject({ status: "reimbursed", amountCents: 760, rateDeciCents: 760, snapshotted: true });
    expect(mileageDetail(dana, "mt_dana_no")).toMatchObject({ status: "rejected", rejectNote: "Home to shop." });
    expect(() => mileageDetail(dana, "mt_maya_paid")).toThrow(/not found/);
    const own = listMileageTrips(dana);
    expect(own.every((row) => row.userId === dana.userId)).toBe(true);
    expect(own.map((row) => row.id).sort()).toEqual(["mt_dana_no", "mt_dana_wait"]);
    expect(JSON.stringify(own)).not.toMatch(/marginBps|unitCostCents|hourly/);
    expect(mileageAttention(maya).count).toBe(1);
    expect(mileageAttention(dana).count).toBe(1);
    expect(mileageOwed(maya).lines.map((row) => row.id)).toEqual(["mt_maya_paid"]);
    expect(mileageOwed(maya).openCents).toBe(0);
    expect(mileageCsv(dana)).not.toContain("Maya Rivera");
    expect(mileageCsv(maya)).toContain("Client walk");
    expect(mileageCsv(maya)).toContain("7.60");
    expect(readFileSync("supabase/rls.sql", "utf8")).toContain("mileage_trips");
    expect(reimbursementBoard(maya).totals.find((row) => row.userId === "user_dana")?.openCents).toBe(1840);
  });

  it("approves business miles at the date's rate and leaves that amount in place", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const luis = actor("luis@rivera.demo");
    expect(() => approveMileageTrip(dana, "mt_dana_wait")).toThrow(/office/);
    expect(() => approveMileageTrip(riley, "mt_dana_wait")).toThrow(/office/);
    expect(() => saveMileageRates(dana, [{ startsOn: "2026-01-01", endsOn: "2026-12-31", rateDeciCents: 700, irsDeciCents: 725 }])).toThrow(/office/);
    expect(() => saveMileageRates(riley, [{ startsOn: "2026-01-01", endsOn: "2026-12-31", rateDeciCents: 700, irsDeciCents: 725 }])).toThrow(/office/);
    expect(() => createMileageTrip(riley, { tripOn: "2026-04-08", milesRaw: "1", purpose: "Errand", business: true })).toThrow(/cannot log/);
    expect(listMileageTrips(riley).some((row) => row.id === "mt_maya_paid")).toBe(true);

    const personal = createMileageTrip(dana, { tripOn: "2026-04-02", milesRaw: "4", purpose: "School run", business: false, submit: true });
    expect(() => approveMileageTrip(maya, personal.id)).toThrow(/Personal/);
    expect(mileageDetail(maya, personal.id).amountCents).toBe(0);

    const draft = createMileageTrip(dana, { tripOn: "2026-03-02", milesRaw: "1", purpose: "Sample door", business: true, userId: "user_maya" });
    expect(mileageDetail(maya, draft.id).userId).toBe(dana.userId);
    expect(mileageDetail(maya, draft.id).status).toBe("draft");
    submitMileageTrip(dana, draft.id);
    expect(() => rejectMileageTrip(maya, draft.id, "  ")).toThrow(/note/);
    rejectMileageTrip(luis, draft.id, "Not a job.");
    expect(mileageDetail(dana, draft.id).rejectNote).toBe("Not a job.");
    expect(() => approveMileageTrip(maya, draft.id)).toThrow(/not waiting/);

    expect(() => createMileageTrip(dana, { tripOn: "2026-04-08", startRaw: "100", endRaw: "90", purpose: "Backwards", business: true })).toThrow(/below the start/);
    expect(() => createMileageTrip(dana, { tripOn: "2026-04-08", startRaw: "100", purpose: "Half", business: true })).toThrow(/both odometer/);
    const odo = createMileageTrip(dana, { tripOn: "2026-04-08", startRaw: "100", endRaw: "110", purpose: "Tile pickup", business: true, fromText: "Yard", toText: "Brooks", submit: true });
    expect(mileageDetail(maya, odo.id).milesMilli).toBe(10_000);
    const approved = approveMileageTrip(maya, odo.id);
    expect(approved.amountCents).toBe(725);
    expect(mileageDetail(maya, odo.id)).toMatchObject({ status: "approved", amountCents: 725, rateDeciCents: 725, irsDeciCents: 725, snapshotted: true });

    saveMileageRates(luis, [
      { id: "mr_2026_h1", startsOn: "2026-01-01", endsOn: "2026-06-30", rateDeciCents: 800, irsDeciCents: 725 },
      { id: "mr_2026_h2", startsOn: "2026-07-01", endsOn: "2026-12-31", rateDeciCents: 760, irsDeciCents: 760 },
    ]);
    expect(mileageDetail(maya, odo.id).amountCents).toBe(725);
    expect(mileageDetail(maya, "mt_maya_paid").amountCents).toBe(760);
    expect(listMileageRates(maya).periods[0]).toMatchObject({ rateDeciCents: 800, irsDeciCents: 725 });
    expect(() =>
      saveMileageRates(maya, [
        { startsOn: "2026-01-01", endsOn: "2026-07-01", rateDeciCents: 725, irsDeciCents: 725 },
        { startsOn: "2026-07-01", endsOn: "2026-12-31", rateDeciCents: 760, irsDeciCents: 760 },
      ]),
    ).toThrow(/overlap/);

    const paid = markMileageReimbursed(maya, odo.id);
    expect(paid.reimbursedAt.slice(0, 10)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mileageDetail(maya, odo.id).status).toBe("reimbursed");
    expect(mileageDetail(maya, odo.id).reimbursedByName).toBe("Maya Rivera");
    expect(() => markMileageReimbursed(maya, odo.id)).toThrow(/not waiting/);
    expect(mileageOwed(maya).lines.some((row) => row.id === odo.id)).toBe(true);
    expect(mileageCsv(dana)).toContain("7.25");
    expect(mileageCsv(dana)).toContain("Tile pickup");
    expect(mileageCsv(dana)).not.toContain("Maya Rivera");
    expect(mileageCsv(dana)).not.toContain("Client walk");

    const owed = mileageOwed(maya);
    expect(owed.openCents).toBe(0);
    const actions = getDb()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.orgId, maya.orgId), eq(auditLogs.entityId, odo.id)))
      .all()
      .map((row) => row.action)
      .sort();
    expect(actions).toEqual(["mileage.approve", "mileage.create", "mileage.reimburse", "mileage.submit"]);

    editMileageTrip(dana, "mt_dana_wait", { tripOn: "2026-05-01", milesRaw: "12", purpose: "Lumber run", business: true, fromText: "Shop", toText: "Brooks", projectId: "proj_brooks" });
    expect(mileageDetail(dana, "mt_dana_wait").milesMilli).toBe(12_000);
    expect(() => editMileageTrip(dana, odo.id, { tripOn: "2026-04-08", milesRaw: "11", purpose: "Tile pickup", business: true })).toThrow(/no longer/);

    const costs = getDb().select().from(costItems).where(eq(costItems.orgId, maya.orgId)).all();
    expect(costs.some((row) => row.memo?.includes("Tile pickup") || row.source === "mileage")).toBe(false);
    const stored = getDb().select().from(mileageTrips).where(eq(mileageTrips.id, odo.id)).get();
    expect(stored?.amountCents).toBe(725);
  });
});
