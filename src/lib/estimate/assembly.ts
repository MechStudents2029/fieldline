import { evaluateFormula, referencedNames } from "@/lib/estimate/formula";

export const DRIVES = ["area", "length", "count"] as const;
export type Drive = (typeof DRIVES)[number];

export const DRIVE_UNIT: Record<Drive, string> = { area: "sf", length: "lf", count: "ea" };

export function driveUnit(drive: string): string {
  if (drive === "area" || drive === "length" || drive === "count") return DRIVE_UNIT[drive];
  throw new Error("Pick area, length, or count.");
}

/** Parts store `Qty` for the driving measurement. Insert binds that name. */
export function bindFormula(expr: string, measurementName: string): string {
  const next = expr.replace(/\bQty\b/g, measurementName).trim();
  if (!next) throw new Error("Check the formula.");
  referencedNames(next);
  return next;
}

export type AssemblySuggestion = { name: string; drive: Drive; reason: string };

const SUGGESTIONS: { name: string; drive: Drive; when: RegExp; reason: string }[] = [
  { name: "Tile shower wall", drive: "area", when: /shower/i, reason: "Shower is in the scope." },
  { name: "Interior wall paint", drive: "area", when: /paint/i, reason: "Paint is in the scope." },
  { name: "Base cabinet run", drive: "length", when: /cabinet/i, reason: "Cabinets are in the scope." },
];

export function suggestAssemblies(scope: string): AssemblySuggestion[] {
  return SUGGESTIONS.filter((row) => row.when.test(scope)).map(({ name, drive, reason }) => ({ name, drive, reason }));
}

export type SeedPart = {
  id: string;
  code: string | null;
  name: string;
  unit: string;
  unitCostCents: number;
  formula: string;
  wasteBps: number;
  roundToMilli: number | null;
};

export type SeedAssembly = { id: string; name: string; drive: Drive; parts: SeedPart[] };

export const DEMO_ASSEMBLIES: SeedAssembly[] = [
  {
    id: "asm_shower",
    name: "Tile shower wall",
    drive: "area",
    parts: [
      { id: "asmp_shower_water", code: "TILE-WATER", name: "Shower waterproofing", unit: "sf", unitCostCents: 650, formula: "Qty", wasteBps: 0, roundToMilli: null },
      { id: "asmp_shower_tile", code: "TILE-SHOWER", name: "Shower wall tile, set", unit: "sf", unitCostCents: 2400, formula: "Qty", wasteBps: 1000, roundToMilli: 10_000 },
      { id: "asmp_shower_grout", code: "TILE-GROUT", name: "Grout and seal", unit: "sf", unitCostCents: 180, formula: "Qty", wasteBps: 1000, roundToMilli: null },
      { id: "asmp_shower_labor", code: null, name: "Tile labor", unit: "sf", unitCostCents: 850, formula: "Qty", wasteBps: 0, roundToMilli: null },
    ],
  },
  {
    id: "asm_paint",
    name: "Interior wall paint",
    drive: "area",
    parts: [
      { id: "asmp_paint_prime", code: "PNT-PRIME", name: "Stain-blocking primer", unit: "sf", unitCostCents: 65, formula: "Qty", wasteBps: 1000, roundToMilli: null },
      { id: "asmp_paint_paint", code: "PNT-INT", name: "Interior paint, walls and ceiling", unit: "sf", unitCostCents: 185, formula: "Qty", wasteBps: 1000, roundToMilli: null },
      { id: "asmp_paint_labor", code: null, name: "Paint labor", unit: "sf", unitCostCents: 120, formula: "Qty", wasteBps: 0, roundToMilli: null },
    ],
  },
  {
    id: "asm_cabinets",
    name: "Base cabinet run",
    drive: "length",
    parts: [
      { id: "asmp_cab_base", code: "CAB-BASE", name: "Semi-custom base cabinets", unit: "lf", unitCostCents: 62_000, formula: "Qty", wasteBps: 0, roundToMilli: null },
      { id: "asmp_cab_fill", code: "CAB-FILL", name: "Filler, scribe, and panels", unit: "lf", unitCostCents: 8500, formula: "Qty", wasteBps: 1000, roundToMilli: null },
      { id: "asmp_cab_install", code: "CAB-INSTALL", name: "Cabinet installation", unit: "lf", unitCostCents: 12_000, formula: "Qty", wasteBps: 0, roundToMilli: null },
    ],
  },
];

export function partQtyMilli(part: { formula: string; wasteBps: number; roundToMilli: number | null }, measurementName: string, valueMilli: number) {
  return evaluateFormula({
    expr: bindFormula(part.formula, measurementName),
    wasteBps: part.wasteBps,
    roundToMilli: part.roundToMilli,
    measurements: [{ name: measurementName, valueMilli }],
  });
}
