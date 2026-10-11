import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { estimateMeasurements, lineItems, planScales, proposals, takeoffs } from "@/lib/db/schema";
import { ServiceError } from "@/lib/services/errors";
import { reviseJobFile } from "@/lib/services/files";
import { authenticate } from "@/lib/services/read";
import { savePlanScale, saveTakeoff, takeoffBoard } from "@/lib/services/takeoff";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

const pdf = Buffer.from("%PDF-1.4\n");

describe("plan takeoff", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("lets an estimator measure and refuses field and viewer", () => {
    const board = takeoffBoard(actor("maya@rivera.demo"), "proj_okonkwo", "jf_ok_a101_r2");
    expect(board?.scaleText).toBe("10'");
    expect(board?.sheets.find((sheet) => sheet.current)?.rows.find((row) => row.name === "Walls")?.qtyMilli).toBe(80_000);
    expect(() => savePlanScale(actor("dana@rivera.demo"), { projectId: "proj_okonkwo", jobFileId: "jf_ok_a101_r2", mode: "preset", preset: "arch-1-4" })).toThrow(ServiceError);
    expect(() =>
      saveTakeoff(actor("riley@rivera.demo"), {
        projectId: "proj_okonkwo",
        jobFileId: "jf_ok_a101_r2",
        kind: "count",
        name: "Extra",
        color: "teal",
        points: [{ x: 1, y: 1 }],
      }),
    ).toThrow(/cannot/);
  });

  it("recalculates the assembly when the sheet scale changes", () => {
    const maya = actor("maya@rivera.demo");
    const db = getDb();
    expect(db.select().from(lineItems).where(eq(lineItems.id, "li_ok_tile")).get()?.qtyMilli).toBe(90_000);
    savePlanScale(maya, {
      projectId: "proj_okonkwo",
      jobFileId: "jf_ok_a101_r2",
      mode: "preset",
      preset: "arch-1-4",
      paperWidthInches: 36,
      aspectBps: 10_000,
    });
    const walls = db.select().from(estimateMeasurements).where(eq(estimateMeasurements.id, "meas_ok_walls")).get();
    expect(walls?.valueMilli).toBe(115_200);
    expect(walls?.fromPlan).toBe(1);
    expect(db.select().from(lineItems).where(eq(lineItems.id, "li_ok_tile")).get()?.qtyMilli).toBe(130_000);
    expect(db.select().from(estimateMeasurements).where(eq(estimateMeasurements.id, "meas_ok_curb")).get()?.valueMilli).toBe(43_200);
    expect(takeoffBoard(maya, "proj_okonkwo", "jf_ok_a101_r2")?.scaleText).toBe(`1/4" = 1'`);
  });

  it("leaves a sent proposal on its frozen numbers", () => {
    const maya = actor("maya@rivera.demo");
    const db = getDb();
    const walls = db.select().from(estimateMeasurements).where(eq(estimateMeasurements.id, "meas_ok_walls")).get();
    const tile = db.select().from(lineItems).where(eq(lineItems.id, "li_ok_tile")).get();
    const snap = JSON.stringify({ totalCents: 1, lines: [{ id: "li_ok_tile", qtyMilli: tile?.qtyMilli }] });
    db.insert(proposals)
      .values({
        id: "prop_ok_takeoff",
        orgId: maya.orgId,
        estimateId: "est_ok_takeoff",
        leadId: "lead_okonkwo",
        projectId: "proj_okonkwo",
        status: "sent",
        publicToken: "demo_proposal_ok_takeoff",
        snapshotJson: snap,
        paymentScheduleJson: "[]",
        termsVersion: "2026-09-01",
        totalCents: 1,
        sentAt: "2026-10-11T12:00:00.000Z",
        viewedAt: null,
        signedAt: null,
        declinedAt: null,
        expiresAt: null,
        createdAt: "2026-10-11T12:00:00.000Z",
        updatedAt: "2026-10-11T12:00:00.000Z",
        createdBy: maya.userId,
      })
      .run();
    const saved = saveTakeoff(maya, {
      id: "to_ok_walls",
      projectId: "proj_okonkwo",
      jobFileId: "jf_ok_a101_r2",
      kind: "wall",
      name: "Walls",
      color: "blue",
      room: "Shower",
      points: [
        { x: 10_000, y: 10_000 },
        { x: 40_000, y: 10_000 },
      ],
      heightInches: 96,
      estimateId: "est_ok_takeoff",
      measurementId: "meas_ok_walls",
    });
    expect(saved.frozen).toBe(true);
    expect(saved.qtyMilli).toBe((walls?.valueMilli ?? 0) * 3);
    expect(db.select().from(estimateMeasurements).where(eq(estimateMeasurements.id, "meas_ok_walls")).get()?.valueMilli).toBe(walls?.valueMilli);
    expect(db.select().from(lineItems).where(eq(lineItems.id, "li_ok_tile")).get()?.qtyMilli).toBe(tile?.qtyMilli);
    expect(db.select().from(proposals).where(eq(proposals.id, "prop_ok_takeoff")).get()?.snapshotJson).toBe(snap);
  });

  it("copies the scale and measurements onto the next revision for review", () => {
    const maya = actor("maya@rivera.demo");
    const next = reviseJobFile(maya, { projectId: "proj_okonkwo", fileId: "jf_ok_a101_r2", file: { filename: "a.pdf", bytes: pdf } });
    const db = getDb();
    const copied = db.select().from(takeoffs).where(and(eq(takeoffs.orgId, maya.orgId), eq(takeoffs.jobFileId, next.id), eq(takeoffs.name, "Walls"))).get();
    expect(copied?.reviewed).toBe(0);
    expect(copied?.copiedFromId).toBe("to_ok_walls");
    expect(db.select().from(takeoffs).where(eq(takeoffs.id, "to_ok_walls")).get()?.reviewed).toBe(1);
    expect(db.select().from(planScales).where(and(eq(planScales.orgId, maya.orgId), eq(planScales.jobFileId, next.id))).get()?.preset).toBe("arch-1-4");
    expect(takeoffBoard(maya, "proj_okonkwo", next.id)?.unreviewed).toBeGreaterThan(0);
  });
});
