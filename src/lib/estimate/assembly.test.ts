import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { proposals } from "@/lib/db/schema";
import { assembleSnapshot } from "@/lib/domain/snapshot";
import { bindFormula, partQtyMilli } from "@/lib/estimate/assembly";
import type { Billing } from "@/lib/estimate/pricing";
import { authenticate, assemblyDetail, estimateDetail, listAssemblies } from "@/lib/services/read";
import {
  archiveAssembly,
  deleteMeasurement,
  duplicateAssembly,
  insertAssembly,
  saveAssembly,
  saveMeasurement,
  sendProposal,
  setGroupPresentation,
  syncEstimateGrid,
  ungroupAssembly,
} from "@/lib/services/write";

describe("assembly quantities", () => {
  it("binds the driving measurement and applies waste, then rounds up", () => {
    expect(bindFormula("Qty", "Walls")).toBe("Walls");
    expect(bindFormula("Qty * 2", "Bench")).toBe("Bench * 2");
    expect(partQtyMilli({ formula: "Qty", wasteBps: 1000, roundToMilli: 32_000 }, "Walls", 410_000)).toBe(480_000);
    expect(partQtyMilli({ formula: "Qty", wasteBps: 1000, roundToMilli: 10_000 }, "Shower", 80_000)).toBe(90_000);
    expect(partQtyMilli({ formula: "Qty", wasteBps: 1000, roundToMilli: null }, "Shower", 80_000)).toBe(88_000);
  });
});

function proposalView(orgId: string, estimateId: string) {
  const detail = estimateDetail(orgId, estimateId)!;
  return assembleSnapshot({
    title: detail.estimate.title,
    company: "Rivera",
    clientName: "Elena",
    address: "",
    taxBps: 0,
    scheduleParts: [{ type: "deposit", label: "Deposit", bps: 10_000 }],
    sections: detail.sections.map((section) => ({
      name: section.name,
      lines: detail.lines
        .filter((line) => line.sectionId === section.id)
        .map((line) => {
          const group = detail.groups.find((item) => item.id === line.groupId);
          const measure = group ? detail.measurements.find((row) => row.id === group.measurementId) : undefined;
          return {
            name: line.name,
            qtyMilli: line.qtyMilli,
            unit: line.unit,
            unitCostCents: line.unitCostCents,
            markupBps: line.markupBps,
            costCode: line.costCode,
            billing: line.billing as Billing,
            groupId: group?.id ?? null,
            groupName: group?.name ?? null,
            presentAs: group ? (group.presentAs === "parts" ? ("parts" as const) : ("one" as const)) : null,
            groupQtyMilli: measure?.valueMilli ?? null,
            groupUnit: measure?.unit ?? null,
          };
        }),
    })),
  });
}

describe("estimate assemblies", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("saves, duplicates, and archives a catalog assembly", () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    expect(listAssemblies(maya.orgId).map((item) => item.name)).toEqual(["Base cabinet run", "Interior wall paint", "Tile shower wall"]);
    const id = saveAssembly(maya, {
      name: "Bench run",
      drive: "length",
      parts: [{ name: "Bench boards", formula: "Qty", wasteBps: 1000, unit: "lf", unitCostCents: 2500 }],
    });
    expect(assemblyDetail(maya.orgId, id)?.parts[0]).toMatchObject({ formula: "Qty", wasteBps: 1000, unitCostCents: 2500 });
    const copy = duplicateAssembly(maya, id);
    expect(assemblyDetail(maya.orgId, copy)?.assembly.name).toBe("Bench run copy");
    archiveAssembly(maya, id);
    expect(listAssemblies(maya.orgId).some((item) => item.id === id)).toBe(false);
    expect(assemblyDetail(maya.orgId, id)).toBeNull();
    expect(() => saveAssembly(maya, { name: "Bad", drive: "area", parts: [] })).toThrow(/at least one part/);
  });

  it("recalculates a group, keeps an override, blocks delete, and freezes the proposal", async () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    const inserted = insertAssembly(maya, {
      estimateId: "est_vasquez",
      assemblyId: "asm_shower",
      measurementName: "Shower",
      measurementValue: 80,
    });
    let detail = estimateDetail(maya.orgId, "est_vasquez")!;
    const tile = detail.lines.find((line) => line.name === "Shower wall tile, set")!;
    expect(tile.qtyMilli).toBe(90_000);
    expect(tile.qtyFormula).toBe("Shower");
    expect(tile.wasteBps).toBe(1000);
    expect(tile.roundToMilli).toBe(10_000);
    expect(tile.groupId).toBe(inserted.groupId);
    expect(detail.lines.find((line) => line.name === "Grout and seal")!.qtyMilli).toBe(88_000);
    expect(detail.lines.find((line) => line.name === "Shower waterproofing")!.qtyMilli).toBe(80_000);
    expect(detail.groups.find((group) => group.id === inserted.groupId)?.presentAs).toBe("one");

    saveMeasurement(maya, "est_vasquez", { name: "Shower", value: 100, unit: "sf" });
    detail = estimateDetail(maya.orgId, "est_vasquez")!;
    expect(detail.lines.find((line) => line.name === "Shower wall tile, set")!.qtyMilli).toBe(110_000);

    const grout = detail.lines.find((line) => line.name === "Grout and seal")!;
    syncEstimateGrid(maya, {
      estimateId: "est_vasquez",
      lines: [
        {
          id: grout.id,
          sectionId: grout.sectionId,
          name: grout.name,
          qty: 10,
          unit: "sf",
          unitCostCents: grout.unitCostCents,
          markupBps: grout.markupBps,
          billing: "included",
          costCode: grout.costCode,
          sortOrder: grout.sortOrder,
          formula: null,
          groupId: grout.groupId,
          qtyOverridden: true,
        },
      ],
      deletedIds: [],
    });
    saveMeasurement(maya, "est_vasquez", { name: "Shower", value: 120, unit: "sf" });
    detail = estimateDetail(maya.orgId, "est_vasquez")!;
    expect(detail.lines.find((line) => line.name === "Grout and seal")).toMatchObject({ qtyMilli: 10_000, qtyOverridden: 1, qtyFormula: null });
    expect(detail.lines.find((line) => line.name === "Shower wall tile, set")!.qtyMilli).toBe(140_000);
    expect(detail.lines.find((line) => line.id === "li_vz_base")!.qtyMilli).toBe(14_000);

    const shower = detail.measurements.find((row) => row.name === "Shower")!;
    expect(() => deleteMeasurement(maya, "est_vasquez", shower.id)).toThrow("4 lines use Shower.");

    const one = proposalView(maya.orgId, "est_vasquez");
    const oneNames = one.public.sections.flatMap((section) => section.lines).map((line) => line.name);
    expect(oneNames).toContain("Tile shower wall");
    expect(oneNames).not.toContain("Grout and seal");
    expect(oneNames).not.toContain("Shower wall tile, set");
    const bundled = one.public.sections.flatMap((section) => section.lines).find((line) => line.name === "Tile shower wall")!;
    expect(bundled.qty).toBe("120");
    expect(bundled.unit).toBe("sf");
    expect(one.lines.map((line) => line.name)).toContain("Grout and seal");

    setGroupPresentation(maya, inserted.groupId, "parts");
    const parts = proposalView(maya.orgId, "est_vasquez");
    const partNames = parts.public.sections.flatMap((section) => section.lines).map((line) => line.name);
    expect(partNames).toContain("Grout and seal");
    expect(partNames).toContain("Shower wall tile, set");
    expect(partNames).not.toContain("Tile shower wall");
    setGroupPresentation(maya, inserted.groupId, "one");

    const paint = insertAssembly(maya, { estimateId: "est_vasquez", assemblyId: "asm_paint", measurementId: "meas_vz_walls" });
    ungroupAssembly(maya, paint.groupId);
    const primer = estimateDetail(maya.orgId, "est_vasquez")!.lines.find((line) => line.name === "Stain-blocking primer")!;
    expect(primer.groupId).toBeNull();
    expect(primer.qtyFormula).toBe("Walls");
    expect(primer.qtyMilli).toBe(451_000);

    const nicheId = saveAssembly(maya, {
      name: "Niche shelf",
      drive: "count",
      parts: [{ name: "Niche board", formula: "Qty", wasteBps: 0, unit: "ea", unitCostCents: 100 }],
    });
    const niche = insertAssembly(maya, { estimateId: "est_vasquez", assemblyId: nicheId, measurementName: "Niche", measurementValue: 2 });
    const nicheLine = estimateDetail(maya.orgId, "est_vasquez")!.lines.find((line) => line.groupId === niche.groupId)!;
    syncEstimateGrid(maya, { estimateId: "est_vasquez", lines: [], deletedIds: [nicheLine.id] });
    const nicheMeasure = estimateDetail(maya.orgId, "est_vasquez")!.measurements.find((row) => row.name === "Niche")!;
    expect(() => deleteMeasurement(maya, "est_vasquez", nicheMeasure.id)).toThrow("1 line uses Niche.");

    await sendProposal(maya, "est_vasquez");
    const sent = getDb().select().from(proposals).where(eq(proposals.estimateId, "est_vasquez")).all().find((row) => row.status === "sent")!;
    const snapshot = JSON.parse(sent.snapshotJson) as { public: { sections: { lines: { name: string; qty: string }[] }[] }; lines: { name: string }[] };
    const sentNames = snapshot.public.sections.flatMap((section) => section.lines).map((line) => line.name);
    expect(sentNames).toContain("Tile shower wall");
    expect(sentNames).not.toContain("Shower wall tile, set");
    expect(snapshot.public.sections.flatMap((section) => section.lines).find((line) => line.name === "Tile shower wall")?.qty).toBe("120");
    expect(snapshot.lines.map((line) => line.name)).toContain("Shower wall tile, set");
    expect(sent.snapshotJson).not.toContain("qtyFormula");
    expect(sent.snapshotJson).not.toContain("wasteBps");
    expect(() => saveMeasurement(maya, "est_vasquez", { name: "Shower", value: 200, unit: "sf" })).toThrow(/already sent/);
    expect(estimateDetail(maya.orgId, "est_vasquez")!.lines.find((line) => line.name === "Shower wall tile, set")!.qtyMilli).toBe(140_000);
  });
});
