export type CatalogRow = {
  code: string;
  name: string;
  category: string;
  unit: string;
  unitCostCents: number;
  vendor: string;
  keywords: string;
};

/** Rivera price book. Costs are the contractor's cost, before markup. */
const ROWS: Array<[string, string, string, string, number, string, string]> = [
  ["DEMO-GUT", "Gut demolition", "Demolition", "sf", 1200, "In house", "gut demo tear-out"],
  ["DEMO-HAUL", "Haul-off and dump fees", "Demolition", "ea", 180000, "City roll-off", "haul dumpster"],
  ["DEMO-SELECT", "Selective demolition", "Demolition", "sf", 650, "In house", "selective demo"],
  ["DEMO-FLOOR", "Flooring removal", "Demolition", "sf", 280, "In house", "floor removal"],
  ["DEMO-CAB", "Cabinet removal", "Demolition", "lf", 4500, "In house", "cabinet removal"],
  ["DEMO-PROT", "Floor protection", "Demolition", "sf", 85, "Ram Board", "protection"],
  ["FRM-WALL", "Interior wall framing", "Framing", "lf", 2850, "Summit Lumber", "wall stud"],
  ["FRM-HEADER", "Header, up to 6 ft", "Framing", "ea", 22000, "Summit Lumber", "header"],
  ["FRM-BEAM", "LVL beam", "Framing", "lf", 4800, "Summit Lumber", "beam lvl"],
  ["FRM-BLOCK", "Blocking and backing", "Framing", "ea", 8500, "Summit Lumber", "blocking"],
  ["FRM-SHEAR", "Shear wall panel", "Framing", "ea", 64000, "Summit Lumber", "shear"],
  ["FRM-LABOR", "Carpenter", "Framing", "hr", 7800, "In house", "carpenter labor"],
  ["DW-HANG", "Hang and finish drywall, level 4", "Drywall", "sf", 240, "North Valley Drywall", "drywall hang"],
  ["DW-PATCH", "Drywall patch", "Drywall", "sf", 380, "North Valley Drywall", "patch"],
  ["DW-CEILING", "Ceiling drywall", "Drywall", "sf", 310, "North Valley Drywall", "ceiling"],
  ["DW-TEXTURE", "Orange peel texture", "Drywall", "sf", 95, "North Valley Drywall", "texture"],
  ["DW-MOIST", "Moisture-resistant board", "Drywall", "sf", 420, "North Valley Drywall", "greenboard"],
  ["TILE-BACK", "Kitchen backsplash tile, set", "Tile", "sf", 2200, "Casa Tile", "backsplash"],
  ["TILE-FLR", "Floor tile, set", "Tile", "sf", 1850, "Casa Tile", "floor tile"],
  ["TILE-SHOWER", "Shower wall tile, set", "Tile", "sf", 2400, "Casa Tile", "shower tile"],
  ["TILE-NICHE", "Shower niche", "Tile", "ea", 38000, "Casa Tile", "niche"],
  ["TILE-WATER", "Shower waterproofing", "Tile", "sf", 650, "Schluter", "waterproof"],
  ["TILE-GROUT", "Grout and seal", "Tile", "sf", 180, "Casa Tile", "grout"],
  ["ELE-RECESS", "Recessed LED can", "Electrical", "ea", 18500, "Brighton Electric", "recessed can light"],
  ["ELE-CIRCUIT", "New 20A circuit", "Electrical", "ea", 28500, "Brighton Electric", "circuit"],
  ["ELE-KIT", "Kitchen electrical package", "Electrical", "ea", 220000, "Brighton Electric", "kitchen electrical"],
  ["ELE-PANEL", "Panel upgrade allowance", "Electrical", "ea", 280000, "Brighton Electric", "panel"],
  ["ELE-UNDER", "Under-cabinet lighting", "Electrical", "lf", 4200, "Brighton Electric", "under cabinet"],
  ["ELE-DISP", "Disposal circuit and switch", "Electrical", "ea", 28000, "Brighton Electric", "disposal"],
  ["ELE-DIM", "Dimmer and switch", "Electrical", "ea", 6500, "Brighton Electric", "dimmer"],
  ["ELE-SMOKE", "Smoke and CO detector", "Electrical", "ea", 8500, "Brighton Electric", "smoke detector"],
  ["PLB-SINK", "Relocate or reset kitchen sink", "Plumbing", "ea", 340000, "Harbor Plumbing", "sink relocate"],
  ["PLB-DISH", "Dishwasher connection", "Plumbing", "ea", 98000, "Harbor Plumbing", "dishwasher"],
  ["PLB-VANITY", "Vanity supply and drain", "Plumbing", "ea", 65000, "Harbor Plumbing", "vanity plumbing"],
  ["PLB-SHOWER", "Shower valve and head", "Plumbing", "ea", 145000, "Harbor Plumbing", "shower valve"],
  ["PLB-TOILET", "Toilet supply and set", "Plumbing", "ea", 42000, "Harbor Plumbing", "toilet"],
  ["PLB-GAS", "Gas range connection", "Plumbing", "ea", 38000, "Harbor Plumbing", "gas"],
  ["CAB-BASE", "Semi-custom base cabinets", "Cabinets", "lf", 62000, "Mill & Co", "base cabinet"],
  ["CAB-UPPER", "Semi-custom wall cabinets", "Cabinets", "lf", 41000, "Mill & Co", "upper cabinet"],
  ["CAB-TALL", "Tall pantry cabinet", "Cabinets", "ea", 185000, "Mill & Co", "pantry"],
  ["CAB-FILL", "Filler, scribe, and panels", "Cabinets", "lf", 8500, "Mill & Co", "filler"],
  ["CAB-INSTALL", "Cabinet installation", "Cabinets", "lf", 12000, "In house", "cabinet install"],
  ["CAB-HARD", "Cabinet hardware", "Cabinets", "ea", 1800, "Mill & Co", "pull knob"],
  ["TOP-QUARTZ", "Quartz countertop, installed", "Counters", "sf", 14000, "Slab House", "quartz counter"],
  ["TOP-BUTCH", "Butcher block top", "Counters", "sf", 7500, "Slab House", "butcher"],
  ["TOP-LAM", "Laminate countertop", "Counters", "sf", 4200, "Slab House", "laminate"],
  ["TOP-SINK", "Undermount sink cutout", "Counters", "ea", 18500, "Slab House", "cutout"],
  ["TOP-EDGE", "Upgraded edge profile", "Counters", "lf", 2800, "Slab House", "edge"],
  ["FLR-LVP", "Luxury vinyl plank, installed", "Flooring", "sf", 1400, "Oak & Grain", "lvp vinyl floor"],
  ["FLR-HW", "Site-finished hardwood", "Flooring", "sf", 1850, "Oak & Grain", "hardwood oak floor"],
  ["FLR-TILE", "Tile floor labor and materials", "Flooring", "sf", 2200, "Casa Tile", "tile floor"],
  ["FLR-TRANS", "Transitions and reducers", "Flooring", "ea", 4500, "Oak & Grain", "transition"],
  ["FLR-BASE", "Painted baseboard", "Flooring", "lf", 650, "In house", "baseboard"],
  ["PNT-INT", "Interior paint, walls and ceiling", "Paint", "sf", 185, "In house", "paint interior"],
  ["PNT-DOOR", "Door and trim paint", "Paint", "ea", 12500, "In house", "door paint"],
  ["PNT-CAB", "Cabinet repaint, sprayed", "Paint", "lf", 8500, "In house", "cabinet paint"],
  ["PNT-EXT", "Exterior paint package", "Paint", "ea", 450000, "In house", "exterior paint"],
  ["PNT-PRIME", "Stain-blocking primer", "Paint", "sf", 65, "Sherwin-Williams", "primer"],
  ["APP-ALLOW", "Appliance allowance", "Allowances", "ea", 800000, "Owner selection", "appliance"],
  ["APP-RANGE", "Range allowance", "Allowances", "ea", 220000, "Owner selection", "range"],
  ["APP-HOOD", "Hood allowance", "Allowances", "ea", 95000, "Owner selection", "hood"],
  ["PERMIT-RES", "Residential building permit", "Permits", "ea", 95000, "City", "permit"],
  ["PERMIT-ELEC", "Electrical permit", "Permits", "ea", 28000, "City", "electrical permit"],
  ["PERMIT-PLB", "Plumbing permit", "Permits", "ea", 28000, "City", "plumbing permit"],
  ["GC-SUPER", "Supervision and job setup", "General", "ea", 480000, "In house", "supervision pm"],
  ["GC-CLEAN", "Final clean", "General", "ea", 45000, "In house", "clean"],
  ["GC-TEMP", "Temporary protection and toilet", "General", "ea", 35000, "In house", "temp facilities"],
  ["BATH-VANITY", "Vanity and top allowance", "Bath", "ea", 145000, "Mill & Co", "vanity"],
  ["BATH-GLASS", "Shower glass panel", "Bath", "ea", 98000, "Clearview Glass", "shower glass"],
  ["BATH-ACC", "Bath accessories", "Bath", "ea", 18000, "Casa Tile", "towel bar"],
  ["DECK-BOARD", "Composite deck boards", "Decking", "sf", 1850, "Summit Lumber", "deck board"],
  ["DECK-RAIL", "Deck railing", "Decking", "lf", 8500, "Summit Lumber", "railing"],
  ["DECK-FOOT", "Footing and post", "Decking", "ea", 28000, "Summit Lumber", "footing"],
  ["DECK-STAIR", "Deck stair run", "Decking", "ea", 120000, "Summit Lumber", "stairs"],
  ["ROOF-ARCH", "Architectural shingles", "Roofing", "square", 48500, "Ridgeline Roofing", "roof shingle"],
  ["ROOF-TEAR", "Roof tear-off", "Roofing", "square", 12500, "Ridgeline Roofing", "tear-off"],
  ["ROOF-FLASH", "Flashing and vents", "Roofing", "ea", 35000, "Ridgeline Roofing", "flashing"],
  ["FENCE-WOOD", "Cedar privacy fence", "Fencing", "lf", 6500, "Summit Lumber", "fence"],
  ["FENCE-GATE", "Fence gate", "Fencing", "ea", 45000, "Summit Lumber", "gate"],
  ["FENCE-POST", "Fence post, set", "Fencing", "ea", 8500, "Summit Lumber", "post"],
  ["WIN-REPL", "Window replacement", "Openings", "ea", 85000, "Northline Glass", "window"],
  ["DOOR-EXT", "Exterior door, installed", "Openings", "ea", 145000, "Northline Glass", "entry door"],
  ["DOOR-INT", "Interior door and hardware", "Openings", "ea", 42000, "Summit Lumber", "interior door"],
  ["INS-BATT", "Batt insulation", "Insulation", "sf", 180, "In house", "insulation"],
  ["HVAC-VENT", "Move or add a supply vent", "HVAC", "ea", 45000, "Airside Mechanical", "vent hvac"],
  ["HVAC-BATH", "Bath exhaust fan", "HVAC", "ea", 38000, "Airside Mechanical", "exhaust fan"],
];

/** Default quantity formula for a price-book code. Waste is basis points. Round-up is milli-units. */
export const CATALOG_FORMULAS: Record<string, { expr: string; wasteBps: number; roundToMilli: number | null }> = {
  "FLR-LVP": { expr: "Floor", wasteBps: 1000, roundToMilli: null },
  "TILE-FLR": { expr: "Floor", wasteBps: 1000, roundToMilli: 10_000 },
  "TILE-BACK": { expr: "Backsplash", wasteBps: 1000, roundToMilli: 10_000 },
  "DW-HANG": { expr: "Walls", wasteBps: 1000, roundToMilli: 32_000 },
  "PNT-INT": { expr: "Walls", wasteBps: 1000, roundToMilli: null },
  "FLR-BASE": { expr: "Base", wasteBps: 1000, roundToMilli: null },
};

export function riveraCatalog(): CatalogRow[] {
  return ROWS.map(([code, name, category, unit, unitCostCents, vendor, keywords]) => ({
    code,
    name,
    category,
    unit,
    unitCostCents,
    vendor,
    keywords,
  }));
}

export function northlineCatalog(): CatalogRow[] {
  return riveraCatalog().filter((row) =>
    ["Electrical", "Openings", "Permits", "General"].includes(row.category),
  );
}
