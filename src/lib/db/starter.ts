import { riveraCatalog, type CatalogRow } from "@/lib/db/catalog";
import type { StarterTrade } from "@/lib/security";

export const STARTER_MARK = "Starter — edit your prices";

const CODES: Record<StarterTrade, readonly string[]> = {
  remodel: [
    "DEMO-GUT",
    "DEMO-HAUL",
    "CAB-BASE",
    "CAB-UPPER",
    "TOP-QUARTZ",
    "TILE-BACK",
    "FLR-LVP",
    "ELE-RECESS",
    "ELE-KIT",
    "PLB-SINK",
    "PLB-DISH",
    "DW-HANG",
    "PNT-INT",
    "APP-ALLOW",
    "PERMIT-RES",
    "GC-SUPER",
    "BATH-VANITY",
    "TILE-SHOWER",
  ],
  deck: ["DECK-BOARD", "DECK-RAIL", "DECK-FOOT", "DECK-STAIR", "PERMIT-RES", "GC-SUPER"],
  roofing: ["ROOF-ARCH", "ROOF-TEAR", "ROOF-FLASH", "PERMIT-RES", "GC-SUPER"],
  general: ["DEMO-GUT", "DW-HANG", "PNT-INT", "PNT-EXT", "FLR-HW", "FENCE-WOOD", "ELE-PANEL", "PERMIT-RES", "GC-SUPER", "CAB-BASE"],
};

export const TRADE_FOCUS: Record<StarterTrade, string> = {
  remodel: "Kitchen and bath remodel",
  deck: "Decks",
  roofing: "Roofing",
  general: "General remodeling",
};

/** Built from the shared catalog codes. Never reads another company's rows. */
export function starterRows(trade: StarterTrade): CatalogRow[] {
  const byCode = new Map(riveraCatalog().map((row) => [row.code, row]));
  return CODES[trade].map((code) => {
    const row = byCode.get(code);
    if (!row) throw new Error(`Starter price book is missing ${code}.`);
    return { ...row, vendor: row.vendor ? `${row.vendor} · ${STARTER_MARK}` : STARTER_MARK };
  });
}

export function starterCodes(trade: StarterTrade): readonly string[] {
  return CODES[trade];
}
