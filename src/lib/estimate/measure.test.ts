import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { proposals, templateLines } from "@/lib/db/schema";
import { formatWhole } from "@/lib/money";
import { sumCounting } from "@/lib/estimate/pricing";
import { authenticate, estimateDetail } from "@/lib/services/read";
import { addManualLine, deleteMeasurement, saveMeasurement, sendProposal, syncEstimateGrid } from "@/lib/services/write";

describe("estimate measurements", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("recalculates formula lines when a measurement changes and leaves typed lines", () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    const before = estimateDetail(maya.orgId, "est_vasquez")!;
    expect(before.measurements.map((row) => row.name)).toEqual(["Floor", "Walls", "Backsplash", "Base"]);
    expect(before.lines.find((line) => line.id === "li_vz_drywall")!.qtyMilli).toBe(480_000);
    expect(before.lines.find((line) => line.id === "li_vz_paint")!.qtyMilli).toBe(451_000);
    expect(before.lines.find((line) => line.id === "li_vz_base")!.qtyMilli).toBe(14_000);

    saveMeasurement(maya, "est_vasquez", { id: "meas_vz_walls", name: "Walls", value: 500, unit: "sf" });
    const after = estimateDetail(maya.orgId, "est_vasquez")!;
    expect(after.lines.find((line) => line.id === "li_vz_drywall")!.qtyMilli).toBe(576_000);
    expect(after.lines.find((line) => line.id === "li_vz_paint")!.qtyMilli).toBe(550_000);
    expect(after.lines.find((line) => line.id === "li_vz_lvp")!.qtyMilli).toBe(240_000);
    expect(after.lines.find((line) => line.id === "li_vz_base")!.qtyMilli).toBe(14_000);
    expect(formatWhole(sumCounting(after.lines).priceCents)).toBe("$69,262");
  });

  it("blocks deleting a measurement that lines use, and rejects a bad formula", () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    saveMeasurement(maya, "est_vasquez", { name: "Niche", value: 4, unit: "ea" });
    const niche = estimateDetail(maya.orgId, "est_vasquez")!.measurements.find((row) => row.name === "Niche")!;
    deleteMeasurement(maya, "est_vasquez", niche.id);
    expect(estimateDetail(maya.orgId, "est_vasquez")!.measurements.some((row) => row.name === "Niche")).toBe(false);
    expect(() => deleteMeasurement(maya, "est_vasquez", "meas_vz_walls")).toThrow("2 lines use Walls.");
    expect(() => deleteMeasurement(maya, "est_vasquez", "meas_vz_floor")).toThrow("1 line uses Floor.");

    const base = estimateDetail(maya.orgId, "est_vasquez")!.lines.find((line) => line.id === "li_vz_base")!;
    expect(() =>
      syncEstimateGrid(maya, {
        estimateId: "est_vasquez",
        lines: [
          {
            id: "li_vz_base",
            sectionId: "sec_vz_cab",
            name: "Base cabinets",
            qty: 14,
            unit: "lf",
            unitCostCents: base.unitCostCents,
            markupBps: base.markupBps,
            billing: "included",
            costCode: "CAB-BASE",
            sortOrder: 0,
            formula: "Nope",
            wasteBps: 0,
            roundToMilli: null,
          },
        ],
        deletedIds: [],
      }),
    ).toThrow("Unknown measurement Nope.");
    expect(() =>
      syncEstimateGrid(maya, {
        estimateId: "est_vasquez",
        lines: [
          {
            id: "li_vz_base",
            sectionId: "sec_vz_cab",
            name: "Base cabinets",
            qty: 14,
            unit: "lf",
            unitCostCents: base.unitCostCents,
            markupBps: base.markupBps,
            billing: "included",
            costCode: "CAB-BASE",
            sortOrder: 0,
            formula: "Floor / 0",
            wasteBps: 0,
            roundToMilli: null,
          },
        ],
        deletedIds: [],
      }),
    ).toThrow("Can't divide by zero.");
    expect(estimateDetail(maya.orgId, "est_vasquez")!.lines.find((line) => line.id === "li_vz_base")!.qtyFormula).toBeNull();
  });

  it("picks up a catalog formula and freezes the computed quantity on the proposal", async () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    const template = getDb().select().from(templateLines).where(eq(templateLines.id, "tpl_kitchen_line_6")).get();
    expect(template?.qtyFormula).toBe("Backsplash");
    expect(template?.wasteBps).toBe(1000);
    expect(template?.roundToMilli).toBe(10_000);

    addManualLine(maya, "est_vasquez", {
      name: "Extra backsplash",
      qty: 1,
      unit: "sf",
      unitCostCents: 6650,
      markupBps: 4286,
      costCode: "TILE-BACK",
    });
    const added = estimateDetail(maya.orgId, "est_vasquez")!.lines.find((line) => line.name === "Extra backsplash")!;
    expect(added.qtyFormula).toBe("Backsplash");
    expect(added.wasteBps).toBe(1000);
    expect(added.roundToMilli).toBe(10_000);
    expect(added.qtyMilli).toBe(50_000);

    await sendProposal(maya, "est_vasquez");
    const sent = getDb().select().from(proposals).where(eq(proposals.estimateId, "est_vasquez")).all().find((row) => row.status === "sent")!;
    const snapshot = JSON.parse(sent.snapshotJson) as {
      public: { sections: { lines: { name: string; qty: string }[] }[] };
    };
    const drywall = snapshot.public.sections.flatMap((section) => section.lines).find((line) => line.name === "Drywall");
    expect(drywall?.qty).toBe("576");
    expect(sent.snapshotJson).not.toContain("qtyFormula");
    expect(sent.snapshotJson).not.toContain("wasteBps");
    expect(sent.snapshotJson).not.toContain("roundToMilli");
    expect(() => saveMeasurement(maya, "est_vasquez", { id: "meas_vz_walls", name: "Walls", value: 600, unit: "sf" })).toThrow(/already sent/);
    expect(estimateDetail(maya.orgId, "est_vasquez")!.lines.find((line) => line.id === "li_vz_drywall")!.qtyMilli).toBe(576_000);
  });
});
