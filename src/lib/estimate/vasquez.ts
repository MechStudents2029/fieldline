import type { Billing } from "@/lib/estimate/pricing";

export const vasquezSections = [
  { id: "sec_vz_demo", name: "Demolition", sortOrder: 0 },
  { id: "sec_vz_cab", name: "Cabinets and counters", sortOrder: 1 },
  { id: "sec_vz_plb", name: "Plumbing and electrical", sortOrder: 2 },
  { id: "sec_vz_fin", name: "Finishes and general", sortOrder: 3 },
] as const;

export type VasquezLine = {
  id: string;
  sectionId: string;
  name: string;
  code: string;
  qty: number;
  unit: string;
  unitCostCents: number;
  markupBps: number;
  billing: Billing;
  confidenceMilli: number | null;
  sourceNote: string | null;
  sortOrder: number;
};

/** Draft that displays as a $49,000 / 30% / $70,000 kitchen, plus one optional upgrade. */
export const vasquezLines: VasquezLine[] = [
  { id: "li_vz_demo", sectionId: "sec_vz_demo", name: "Demo and haul-off", code: "DEMO-GUT", qty: 1, unit: "job", unitCostCents: 252_000, markupBps: 4286, billing: "included", confidenceMilli: null, sourceNote: null, sortOrder: 0 },
  { id: "li_vz_base", sectionId: "sec_vz_cab", name: "Base cabinets", code: "CAB-BASE", qty: 14, unit: "lf", unitCostCents: 90_000, markupBps: 3333, billing: "included", confidenceMilli: 620, sourceNote: "Measure on site", sortOrder: 0 },
  { id: "li_vz_wall", sectionId: "sec_vz_cab", name: "Wall cabinets", code: "CAB-UPPER", qty: 12, unit: "lf", unitCostCents: 59_500, markupBps: 4286, billing: "included", confidenceMilli: null, sourceNote: null, sortOrder: 1 },
  { id: "li_vz_quartz", sectionId: "sec_vz_cab", name: "Quartz counters", code: "TOP-QUARTZ", qty: 52, unit: "sf", unitCostCents: 5654, markupBps: 4285, billing: "included", confidenceMilli: null, sourceNote: null, sortOrder: 2 },
  { id: "li_vz_tile", sectionId: "sec_vz_cab", name: "Tile backsplash", code: "TILE-BACK", qty: 38, unit: "sf", unitCostCents: 6650, markupBps: 4286, billing: "included", confidenceMilli: null, sourceNote: null, sortOrder: 3 },
  { id: "li_vz_edge", sectionId: "sec_vz_cab", name: "Upgraded edge profile", code: "TOP-EDGE", qty: 14, unit: "lf", unitCostCents: 2800, markupBps: 4286, billing: "optional", confidenceMilli: null, sourceNote: null, sortOrder: 4 },
  { id: "li_vz_sink", sectionId: "sec_vz_plb", name: "Relocate sink", code: "PLB-SINK", qty: 1, unit: "ea", unitCostCents: 294_000, markupBps: 4286, billing: "included", confidenceMilli: null, sourceNote: null, sortOrder: 0 },
  { id: "li_vz_appl", sectionId: "sec_vz_plb", name: "Appliance allowance", code: "APP-ALLOW", qty: 5, unit: "ea", unitCostCents: 24_500, markupBps: 4286, billing: "allowance", confidenceMilli: null, sourceNote: null, sortOrder: 1 },
  { id: "li_vz_lights", sectionId: "sec_vz_plb", name: "Recessed lights", code: "ELE-RECESS", qty: 8, unit: "ea", unitCostCents: 21_750, markupBps: 3793, billing: "included", confidenceMilli: null, sourceNote: null, sortOrder: 2 },
  { id: "li_vz_circ", sectionId: "sec_vz_plb", name: "Dedicated circuits", code: "ELE-CIRCUIT", qty: 4, unit: "ea", unitCostCents: 56_000, markupBps: 4286, billing: "included", confidenceMilli: null, sourceNote: null, sortOrder: 3 },
  { id: "li_vz_lvp", sectionId: "sec_vz_fin", name: "LVP flooring", code: "FLR-LVP", qty: 240, unit: "sf", unitCostCents: 1120, markupBps: 4286, billing: "included", confidenceMilli: null, sourceNote: null, sortOrder: 0 },
  { id: "li_vz_dw", sectionId: "sec_vz_fin", name: "Drywall and paint", code: "DW-HANG", qty: 1, unit: "job", unitCostCents: 336_000, markupBps: 4286, billing: "included", confidenceMilli: null, sourceNote: null, sortOrder: 1 },
  { id: "li_vz_permit", sectionId: "sec_vz_fin", name: "Permits and fees", code: "PERMIT-RES", qty: 1, unit: "ea", unitCostCents: 168_000, markupBps: 4286, billing: "included", confidenceMilli: null, sourceNote: null, sortOrder: 2 },
  { id: "li_vz_super", sectionId: "sec_vz_fin", name: "Supervision", code: "GC-SUPER", qty: 6, unit: "wk", unitCostCents: 90_000, markupBps: 6667, billing: "included", confidenceMilli: null, sourceNote: null, sortOrder: 3 },
];
