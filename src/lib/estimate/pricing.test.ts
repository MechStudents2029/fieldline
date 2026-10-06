import { beforeAll, describe, expect, it } from "vitest";
import { useDatabaseFile } from "@/lib/db/client";
import { assembleSnapshot } from "@/lib/domain/snapshot";
import { qtyToMilli, formatPercent, formatWhole, lineAmounts, marginBps } from "@/lib/money";
import { authenticate, estimateDetail } from "@/lib/services/read";
import { syncEstimateGrid } from "@/lib/services/write";
import { parseGridSync } from "@/lib/estimate/grid";
import { countsTowardTotal, groupSubtotals, markupBpsForMargin, repriceToMargin, sumCounting, type PricedLine } from "@/lib/estimate/pricing";
import { vasquezLines, vasquezSections } from "@/lib/estimate/vasquez";

function priced(line: (typeof vasquezLines)[number]): PricedLine {
  return {
    id: line.id,
    billing: line.billing,
    qtyMilli: qtyToMilli(line.qty),
    unitCostCents: line.unitCostCents,
    markupBps: line.markupBps,
  };
}

describe("estimate pricing", () => {
  it("turns a margin into the markup that produces it", () => {
    expect(markupBpsForMargin(0)).toBe(0);
    expect(markupBpsForMargin(3000)).toBe(4286);
    const amounts = lineAmounts(1000, 252_000, markupBpsForMargin(3000));
    expect(marginBps(amounts.price, amounts.cost)).toBe(3000);
    expect(markupBpsForMargin(2500)).toBe(3333);
    expect(() => markupBpsForMargin(10000)).toThrow(/Margin/);
  });

  it("keeps the Vasquez kitchen at $49,000, 30%, $70,000 without the optional edge", () => {
    const totals = sumCounting(vasquezLines.map(priced));
    expect(formatWhole(totals.costCents)).toBe("$49,000");
    expect(formatWhole(totals.priceCents)).toBe("$70,000");
    expect(formatPercent(totals.marginBps)).toBe("30%");
    const edge = vasquezLines.find((line) => line.billing === "optional")!;
    const edgeAmounts = lineAmounts(qtyToMilli(edge.qty), edge.unitCostCents, edge.markupBps);
    expect(edgeAmounts.price).toBeGreaterThan(0);
    expect(totals.priceCents).toBeLessThan(sumCounting([...vasquezLines.map(priced), { ...priced(edge), billing: "included" }]).priceCents);
  });

  it("excludes optional and excluded lines from group subtotals and keeps allowances", () => {
    const lines = vasquezLines.map(priced);
    const cabinets = lines.filter((line) => vasquezLines.find((row) => row.id === line.id)?.sectionId === "sec_vz_cab");
    const sub = groupSubtotals(cabinets);
    const edge = cabinets.find((line) => line.id === "li_vz_edge")!;
    const edgePrice = lineAmounts(edge.qtyMilli, edge.unitCostCents, edge.markupBps).price;
    const withEdge = groupSubtotals(cabinets.map((line) => (line.id === edge.id ? { ...line, billing: "included" } : line)));
    expect(withEdge.priceCents - sub.priceCents).toBe(edgePrice);
    expect(countsTowardTotal("allowance")).toBe(true);
    expect(countsTowardTotal("optional")).toBe(false);
    expect(countsTowardTotal("excluded")).toBe(false);
    const allowance = lines.find((line) => line.id === "li_vz_appl")!;
    expect(groupSubtotals([allowance]).priceCents).toBe(lineAmounts(allowance.qtyMilli, allowance.unitCostCents, allowance.markupBps).price);
    expect(groupSubtotals([{ ...allowance, billing: "excluded" }]).priceCents).toBe(0);
  });

  it("reprices counting lines to a target margin and leaves the optional line alone", () => {
    const lines = vasquezLines.map(priced);
    const edgeBefore = lines.find((line) => line.id === "li_vz_edge")!.markupBps;
    const next = repriceToMargin(lines, 3500);
    expect(next.find((line) => line.id === "li_vz_edge")?.markupBps).toBe(edgeBefore);
    const repriced = lines.map((line) => ({ ...line, markupBps: next.find((row) => row.id === line.id)!.markupBps }));
    expect(formatPercent(sumCounting(repriced).marginBps)).toBe("35%");
    const cab = repriced.filter((line) => vasquezLines.find((row) => row.id === line.id)?.sectionId === "sec_vz_cab");
    const onlyCab = repriceToMargin(cab, 2000);
    expect(onlyCab.find((line) => line.id === "li_vz_edge")?.markupBps).toBe(edgeBefore);
    expect(formatPercent(sumCounting(cab.map((line) => ({ ...line, markupBps: onlyCab.find((row) => row.id === line.id)!.markupBps }))).marginBps)).toBe("20%");
  });
});

describe("estimate grid validation", () => {
  const sectionId = vasquezSections[0].id;

  function line(patch: Record<string, unknown> = {}) {
    return {
      id: "li_vz_demo",
      sectionId,
      name: "Demo and haul-off",
      qty: 1,
      unit: "job",
      unitCostCents: 252_000,
      markupBps: 4286,
      billing: "included",
      costCode: "DEMO-GUT",
      sortOrder: 0,
      ...patch,
    };
  }

  it("rejects negative quantity, negative cost, absurd markup, and a blank name", () => {
    expect(() => parseGridSync({ estimateId: "est_vasquez", lines: [line({ qty: -1 })], deletedIds: [] })).toThrow(/Quantity/);
    expect(() => parseGridSync({ estimateId: "est_vasquez", lines: [line({ unitCostCents: -5 })], deletedIds: [] })).toThrow(/Unit cost/);
    expect(() => parseGridSync({ estimateId: "est_vasquez", lines: [line({ markupBps: 60_000 })], deletedIds: [] })).toThrow(/Markup/);
    expect(() => parseGridSync({ estimateId: "est_vasquez", lines: [line({ name: "  " })], deletedIds: [] })).toThrow(/Check the line/);
    expect(() => parseGridSync({ estimateId: "est_vasquez", lines: [line({ billing: "gift" })], deletedIds: [] })).toThrow(/Check the line/);
  });

  it("leaves optional prices out of the signed total and drops excluded lines", () => {
    const snap = assembleSnapshot({
      title: "Kitchen",
      company: "Rivera",
      clientName: "Elena Vasquez",
      address: "240 Hillcrest Ave",
      sections: [
        {
          name: "Work",
          lines: [
            { name: "In", qtyMilli: 1000, unit: "ea", unitCostCents: 10000, markupBps: 0, costCode: "A", billing: "included" },
            { name: "Opt", qtyMilli: 1000, unit: "ea", unitCostCents: 5000, markupBps: 0, costCode: "B", billing: "optional" },
            { name: "Out", qtyMilli: 1000, unit: "ea", unitCostCents: 8000, markupBps: 0, costCode: "C", billing: "excluded" },
            { name: "Allow", qtyMilli: 1000, unit: "ea", unitCostCents: 2000, markupBps: 0, costCode: "D", billing: "allowance" },
          ],
        },
      ],
      taxBps: 0,
      scheduleParts: [{ type: "final", label: "Final", bps: 10000 }],
    });
    expect(snap.public.totalCents).toBe(12_000);
    expect(snap.public.sections[0]?.lines.map((line) => line.name)).toEqual(["In", "Opt", "Allow"]);
    expect(snap.public.sections[0]?.lines.find((line) => line.name === "Opt")?.kind).toBe("optional");
    expect(snap.public.sections[0]?.lines.find((line) => line.name === "Allow")?.kind).toBe("allowance");
    expect(snap.lines.map((line) => line.name)).toEqual(["In", "Allow"]);
    expect(JSON.stringify(snap.public)).not.toContain("unitCost");
  });

  it("accepts an allowance and an optional line", () => {
    const parsed = parseGridSync({
      estimateId: "est_vasquez",
      lines: [line({ billing: "allowance" }), line({ id: "li_vz_edge", billing: "optional", name: "Upgraded edge profile" })],
      deletedIds: [],
    });
    expect(parsed.lines.map((row) => row.billing)).toEqual(["allowance", "optional"]);
  });
});

describe("estimate grid persistence", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("writes a valid edit and leaves the row alone when validation fails", () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    const before = estimateDetail(maya.orgId, "est_vasquez")!;
    const base = before.lines.find((line) => line.id === "li_vz_base")!;
    expect(base.qtyMilli).toBe(14_000);
    expect(() =>
      syncEstimateGrid(maya, {
        estimateId: "est_vasquez",
        lines: [
          {
            id: "li_vz_base",
            sectionId: "sec_vz_cab",
            name: "Base cabinets",
            qty: -2,
            unit: "lf",
            unitCostCents: base.unitCostCents,
            markupBps: base.markupBps,
            billing: "included",
            costCode: "CAB-BASE",
            sortOrder: 0,
          },
        ],
        deletedIds: [],
      }),
    ).toThrow(/Quantity/);
    expect(estimateDetail(maya.orgId, "est_vasquez")!.lines.find((line) => line.id === "li_vz_base")!.qtyMilli).toBe(14_000);

    syncEstimateGrid(maya, {
      estimateId: "est_vasquez",
      lines: [
        {
          id: "li_vz_base",
          sectionId: "sec_vz_cab",
          name: "Base cabinets",
          qty: 15,
          unit: "lf",
          unitCostCents: base.unitCostCents,
          markupBps: base.markupBps,
          billing: "included",
          costCode: "CAB-BASE",
          sortOrder: 0,
        },
      ],
      deletedIds: [],
      marginTargetBps: 3500,
    });
    const after = estimateDetail(maya.orgId, "est_vasquez")!;
    expect(after.lines.find((line) => line.id === "li_vz_base")!.qtyMilli).toBe(15_000);
    expect(after.estimate.marginTargetBps).toBe(3500);
    expect(after.lines.find((line) => line.id === "li_vz_edge")!.billing).toBe("optional");
    expect(() => syncEstimateGrid(authenticate("dana@rivera.demo", "demo")!, { estimateId: "est_vasquez", lines: [], deletedIds: [] })).toThrow(
      /cannot change prices/,
    );
  });
});
